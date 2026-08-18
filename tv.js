/*
 * Маленький ЭЛТ-телевизор в верхней части страницы.
 *
 * Правила, которые задают всю конструкцию:
 *   — модуль грузится лениво, после первой отрисовки, и только если WebGL есть
 *     и посетитель не просил убрать анимацию. Страница обязана быть полностью
 *     рабочей без него;
 *   — никаких внешних запросов: three лежит в /vendor, версия зафиксирована
 *     (r0.185.1). Геометрия целиком процедурная, файлов моделей нет;
 *   — канвас не перехватывает ввод. Попадания по корпусу считаются рейкастом,
 *     всё остальное уходит странице, поэтому ссылки и выделение текста живы.
 *
 * mount(el) → { destroy(), debug } — debug нужен стенду /lab/tv.html.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/* ── Габариты. Пропорции нарочно игрушечные: коробка почти квадратная,
 *    углы крупно скруглены, детали великоваты. ──────────────────────────── */

const BODY_W = 1.10;
const BODY_H = 0.88;
const BODY_D = 0.80;
const FOOT_H = 0.045;

const HALF_H = BODY_H / 2 + FOOT_H;   // от центра масс до низа ножек
const HALF_W = BODY_W / 2;
const TV_VIS_H = BODY_H + FOOT_H + 0.50;  // с антеннами — по этому масштабируем

const FOV = 30;
const CAM_DIST = 3.4;

/* Проводок: верле-цепочка, висящая из задней стенки */
const ROPE_N = 14;                    // точек в цепочке
const ROPE_SEG = 0.075;               // длина звена
const ROPE_R = 6;                     // радиальных сегментов трубки
const ROPE_RAD = 0.018;               // толщина
const ROPE_Z = -0.34;                 // плоскость, в которой болтается

/* ── Константы физики. Стенд правит их вживую через api.debug.params ───── */

const DEFAULTS = {
  gravity:   -22.0,   // единиц/с²
  homeK:       7.0,   // пружина к домашней позиции по X
  homeC:       2.6,   // ζ≈0.49 — возвращается за ~3 с, без долгого дозвона
  uprightK:   26.0,   // момент, возвращающий корпус в вертикаль
  uprightC:    3.2,
  airV:        0.5,   // затухание скорости в воздухе
  airW:        0.8,   // затухание вращения
  rest:        0.42,  // коэффициент восстановления при ударе о пол
  vRest:       0.55,  // ниже этой скорости удара не отскакиваем, а ложимся
  friction:    0.86,  // тангенциальное трение в момент удара
  groundDrag:  3.0,   // трение покоя, пока стоит на полу
  spinLoss:    0.70,
  kickV:       7.5,   // импульс по клику
  wheelV:      0.012, // чувствительность к колесу
  swipeV:      0.055, // чувствительность к свайпу пальцем по странице
  antK:       58.0,   // жёсткость антенн — мягче, чтобы болтались смешнее
  antC:        3.4,
  antLever:    0.55,
  ropeG:      18.0,   // гравитация проводка
  ropeDamp:    0.988, // сохранение скорости в верле
  dropY:       1.6,   // высота падения при загрузке, в высотах телевизора
  homeGap:    10.0,   // px между правым краем имени и левым бортом корпуса
  floorGap:    0.0,   // px, на сколько поднять ножки над низом фамилии;
                      // единственный параметр в пикселях — он и меряется от
                      // вёрстки, а не от сцены
};

const FIXED = 1 / 120;
const MAX_SUB = 5;

// Время, на котором замирает шейдер экрана в неподвижном режиме. Значение
// само по себе ничего не значит — важно, что оно одно и то же всегда.
const FROZEN_T = 12.5;
// Шагов физики на успокоение провода перед снимком. После rope.reset() он
// собран в точку, и замереть на нём значило бы замереть на комке.
const FROZEN_SETTLE = 240;

/* ── Тема берётся из CSS-переменных страницы, а не задаётся здесь ──────── */

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Цвета корпуса нарочно одни и те же в светлой и тёмной теме: это игрушка,
// а игрушка не перекрашивается от системной настройки. Под тему подстраивается
// только свет. Со страницей телевизор связан через --accent — им светится
// кинескоп, поэтому время суток он всё равно отыгрывает.
// Кнопка темы на странице ставит data-theme на <html>. Телевизор про кнопку
// не знает и знать не должен: он смотрит на атрибут, а системную настройку
// спрашивает только когда выбора не сделано.
function pageDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

function readPalette(forceDark) {
  const dark = forceDark === null || forceDark === undefined
    ? pageDark()
    : !!forceDark;
  return {
    dark,
    accent: cssVar('--accent', '#2f6b57'),
    paper:  cssVar('--paper', dark ? '#101014' : '#f4f1ec'),
    shell:  '#e8543a',   // тёплый красно-оранжевый
    bezel:  '#f6ead3',   // сливочная рамка
    knob:   '#322f38',   // почти чёрный
    steel:  '#b6bcc3',   // телескопические колена антенн и шарики
    metal:  '#c08b2a',   // латунные штыри вилки
    cord:   '#322f38',
    plug:   '#2a2830',   // чёрный корпус вилки
  };
}

/* ── Шейдер белого шума ────────────────────────────────────────────────
 * Аплоад DataTexture каждый кадр — это генерация массива на CPU плюс
 * texSubImage2D шестьдесят раз в секунду. Шейдер даёт то же самое даром и
 * сразу с развёрткой и виньеткой.
 */

const SCREEN_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SCREEN_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform float uTime, uIntensity, uRoll;
  uniform vec3  uAccent;

  float hash(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p.yx + 19.19);
    return fract((p.x + p.y) * p.x);
  }

  void main() {
    vec2 uv = vec2(vUv.x, fract(vUv.y + uRoll));

    // Зерно крупное и квантованное по времени: 24 кадра в секунду, как у
    // плёнки. Попиксельный шум на 60 Гц читается как цифровой мусор, а не
    // как аналоговая трубка.
    vec2  cell = floor(uv * vec2(160.0, 115.0));
    float n = hash(cell + floor(uTime * 24.0) * 7.31);

    // Широкие полосы помех, медленно ползущие вверх
    float band = smoothstep(0.87, 1.0, sin((uv.y + uTime * 0.07) * 84.0) * 0.5 + 0.5);
    n = mix(n, min(n * 1.5, 1.0), band);

    // Строчная развёртка
    float scan = 0.84 + 0.16 * sin(uv.y * 560.0);

    // Шум идёт до самого края стекла. Виньетка осталась только как намёк на
    // толщину колбы — на последних процентах ширины, не больше.
    vec2  c   = abs(uv - 0.5) * 2.0;
    float vig = smoothstep(1.02, 0.95, c.x) * smoothstep(1.02, 0.94, c.y);

    // Снег белый: акцент уходит в свечение, а не в сам шум.
    vec3 col = vec3(n) * scan * vig;
    col = mix(col, col * uAccent * 1.6, 0.09);
    col += uAccent * 0.05 * vig;                 // ореол трубки

    // Блик на стекле. Камера смотрит в лоб, и геометрический купол сам по
    // себе почти не читается — выпуклость продаёт именно это пятно.
    // Считается по неискажённым UV, чтобы не ездило вместе со срывом кадра.
    vec2  hp = (vUv - vec2(0.28, 0.74)) * vec2(1.0, 1.9);
    float hl = exp(-dot(hp, hp) * 9.0);
    col += vec3(0.26) * hl;

    gl_FragColor = vec4(col * uIntensity, 1.0);

    #include <colorspace_fragment>
  }
`;

/* ── Сборка корпуса ────────────────────────────────────────────────────── */

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// Корпус сужается к затылку, но заметно меньше, чем у настоящего ЭЛТ:
// игрушке нужен чанки-силуэт, а не технически верный клин.
function taperShell(geo) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const t = THREE.MathUtils.smoothstep(z, -BODY_D * 0.5, BODY_D * 0.34);
    const k = 0.84 + 0.16 * t;
    pos.setX(i, pos.getX(i) * k);
    pos.setY(i, pos.getY(i) * k);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

// Стекло кинескопа: произведение двух квадратик — ровно форма реальной
// маски трубки. Радиальная формула тут не годится: она уходит в ноль по
// окружности, и углы экрана проваливаются внутрь корпуса.
function bulgeScreen(geo, amount) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const u = (uv.getX(i) - 0.5) * 2;
    const v = (uv.getY(i) - 0.5) * 2;
    const z = Math.pow(1 - u * u, 0.8) * Math.pow(1 - v * v, 0.8);
    pos.setZ(i, amount * (Number.isFinite(z) ? z : 0));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/* ── Проводок ───────────────────────────────────────────────────────────
 * Верле-цепочка: позиция и предыдущая позиция, между ними жёсткие связи.
 * Верле выбран потому, что связь «расстояние между точками постоянно»
 * решается прямым переносом точек, без матриц и без сил — для верёвки это
 * и стабильнее пружин, и втрое короче.
 *
 * Цепочка плоская (XY на фиксированной глубине): в лобовой проекции разницы
 * с трёхмерной нет, а стоит она вдвое дешевле.
 *
 * Вилка на конце висит в воздухе и никуда не воткнута — в этом вся шутка,
 * поэтому нижний конец принципиально свободен, ни к чему не привязан.
 */
class Rope {
  constructor(n, seg) {
    this.n = n;
    this.seg = seg;
    this.p = new Float32Array(n * 2);
    this.q = new Float32Array(n * 2);   // предыдущая позиция
    for (let i = 0; i < n; i++) {
      this.p[i * 2] = 0;
      this.p[i * 2 + 1] = -i * seg;
      this.q[i * 2] = 0;
      this.q[i * 2 + 1] = -i * seg;
    }
  }

  // Целиком перенести к якорю — при сбросе и первом кадре
  reset(ax, ay) {
    for (let i = 0; i < this.n; i++) {
      this.p[i * 2] = this.q[i * 2] = ax;
      this.p[i * 2 + 1] = this.q[i * 2 + 1] = ay - i * this.seg;
    }
  }

  step(dt, ax, ay, g, damp) {
    const { p, q, n, seg } = this;

    // Интегрирование: x' = x + (x - x_prev)·damp + a·dt²
    for (let i = 1; i < n; i++) {
      const ix = i * 2, iy = ix + 1;
      const vx = (p[ix] - q[ix]) * damp;
      const vy = (p[iy] - q[iy]) * damp;
      q[ix] = p[ix];
      q[iy] = p[iy];
      p[ix] += vx;
      p[iy] += vy - g * dt * dt;
    }
    p[0] = ax; p[1] = ay;               // верхняя точка приколочена к корпусу

    // Связи. Восьми проходов хватает, чтобы провод не тянулся заметно.
    for (let it = 0; it < 8; it++) {
      for (let i = 0; i < n - 1; i++) {
        const a = i * 2, b = a + 2;
        let dx = p[b] - p[a];
        let dy = p[b + 1] - p[a + 1];
        const d = Math.hypot(dx, dy) || 1e-6;
        const k = (d - seg) / d;
        if (i === 0) {
          // Верхняя точка приколочена — всю поправку забирает нижняя
          p[b] -= dx * k;
          p[b + 1] -= dy * k;
        } else {
          dx *= k * 0.5; dy *= k * 0.5;
          p[a] += dx; p[a + 1] += dy;
          p[b] -= dx; p[b + 1] -= dy;
        }
      }
    }
  }
}

// Трубка вдоль цепочки. Геометрия создаётся один раз, каждый кадр
// переписываются только позиции и нормали — новых аллокаций нет.
function makeRopeMesh(mat) {
  const verts = ROPE_N * ROPE_R;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  const idx = [];
  for (let i = 0; i < ROPE_N - 1; i++) {
    for (let j = 0; j < ROPE_R; j++) {
      const a = i * ROPE_R + j;
      const b = i * ROPE_R + ((j + 1) % ROPE_R);
      const c = (i + 1) * ROPE_R + j;
      const d = (i + 1) * ROPE_R + ((j + 1) % ROPE_R);
      idx.push(a, c, b, b, c, d);
    }
  }
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
  return { mesh: new THREE.Mesh(geo, mat), geo };
}

function updateRopeMesh(geo, rope) {
  const pos = geo.attributes.position.array;
  const nrm = geo.attributes.normal.array;
  const p = rope.p;
  for (let i = 0; i < ROPE_N; i++) {
    // Касательная по соседям, нормаль — перпендикуляр в той же плоскости
    const i0 = Math.max(0, i - 1) * 2;
    const i1 = Math.min(ROPE_N - 1, i + 1) * 2;
    let tx = p[i1] - p[i0];
    let ty = p[i1 + 1] - p[i0 + 1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const nx = -ty, ny = tx;            // в плоскости XY
    const cx = p[i * 2], cy = p[i * 2 + 1];
    for (let j = 0; j < ROPE_R; j++) {
      const a = (j / ROPE_R) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const ux = nx * ca, uy = ny * ca, uz = sa;   // бинормаль = ось Z
      const o = (i * ROPE_R + j) * 3;
      pos[o]     = cx + ux * ROPE_RAD;
      pos[o + 1] = cy + uy * ROPE_RAD;
      pos[o + 2] = ROPE_Z + uz * ROPE_RAD;
      nrm[o] = ux; nrm[o + 1] = uy; nrm[o + 2] = uz;
    }
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.normal.needsUpdate = true;
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d').createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  const ctx = c.getContext('2d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function buildTV(pal) {
  const disposables = [];
  const keep = (x) => (disposables.push(x), x);

  // role — имя ключа в палитре. По нему refreshTheme перекрашивает материал,
  // когда меняется системная тема или акцент времени суток.
  const plastic = (role, extra) => {
    const m = keep(new THREE.MeshStandardMaterial(
      Object.assign({ color: new THREE.Color(pal[role]), roughness: 0.58, metalness: 0.05 }, extra)
    ));
    m.userData.role = role;
    return m;
  };

  // Матовый пластик без бликов — так игрушка читается силуэтом и цветом,
  // а не отражениями.
  const matShell = plastic('shell', { roughness: 0.85 });
  const matBezel = plastic('bezel', { roughness: 0.9 });
  const matKnob  = plastic('knob',  { roughness: 0.8 });
  // Металл на игрушке ровно в двух местах: колена антенн и штыри вилки.
  // Блики им оставлены нарочно — матовая сталь читается крашеным пластиком.
  const matSteel = plastic('steel', { roughness: 0.32, metalness: 0.80 });
  const matMetal = plastic('metal', { roughness: 0.34, metalness: 0.85 });
  const matCord  = plastic('cord',  { roughness: 0.85 });
  const matPlug  = plastic('plug',  { roughness: 0.85 });

  // tilt — постоянный разворот на три четверти. Физика крутит только
  // родителя вокруг Z, поэтому проекция экрана остаётся ортогональной и
  // пересчёт «экранные пиксели ↔ мир» остаётся тривиальным.
  const tilt = new THREE.Group();
  tilt.rotation.set(-0.07, -0.54, 0);

  // Углы скруглены крупно — главный приём игрушечного силуэта
  const shellGeo = keep(new RoundedBoxGeometry(BODY_W, BODY_H, BODY_D, 4, 0.15));
  taperShell(shellGeo);
  tilt.add(new THREE.Mesh(shellGeo, matShell));

  // Рамка занимает почти весь фасад: справа осталась только одна ручка, и
  // панель под неё нужна узкая. Раньше там жили вторая ручка, регулятор и
  // решётка динамика — от них экран и был вдвое уже, чем мог быть.
  const BX = -0.11;
  // Высота прежняя: рамка стоит плитой впереди фасада, и по высоте корпус
  // уже скруглён — подняв её, углы вылезали за силуэт. Растём только вширь.
  const bezelShape = roundedRect(0.82, 0.66, 0.13);
  bezelShape.holes.push(roundedRect(0.68, 0.52, 0.10));
  const bezelGeo = keep(new THREE.ExtrudeGeometry(bezelShape, {
    depth: 0.07, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2,
  }));
  const bezel = new THREE.Mesh(bezelGeo, matBezel);
  // Порядок по глубине: передняя грань корпуса 0.40 → стекло от 0.41 →
  // рамка 0.405…0.475. Стекло обязано начинаться впереди корпуса, иначе он
  // его перекрывает и от картинки остаётся только выпуклая середина.
  bezel.position.set(BX, 0, 0.405);
  tilt.add(bezel);

  // Экран чуть больше отверстия: край уходит под рамку, стыка не видно.
  // Купол сильный и вылезает за рамку — колба выпучена наружу.
  const screenGeo = keep(new THREE.PlaneGeometry(0.70, 0.54, 24, 20));
  bulgeScreen(screenGeo, 0.17);
  const screenMat = keep(new THREE.ShaderMaterial({
    vertexShader: SCREEN_VERT,
    fragmentShader: SCREEN_FRAG,
    uniforms: {
      uTime:      { value: 0 },
      uIntensity: { value: 0 },
      uRoll:      { value: 0 },
      uAccent:    { value: new THREE.Color(pal.accent) },
    },
  }));
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.set(BX, 0, 0.41);
  screen.scale.y = 0.02;              // розжиг растянет до 1
  tilt.add(screen);

  // Свет трубки, падающий на рамку изнутри
  const glow = new THREE.PointLight(new THREE.Color(pal.accent), 0, 1.4, 2);
  glow.position.set(BX, 0, 0.62);
  tilt.add(glow);

  // Одна ручка — просто чтобы фасад не был голым. Крупная: мелкие детали в
  // этой стилистике не читаются.
  const knobGeo = keep(new THREE.CylinderGeometry(0.062, 0.068, 0.05, 16));
  const knob = new THREE.Mesh(knobGeo, matKnob);
  knob.rotation.x = Math.PI / 2;
  knob.position.set(0.42, 0.02, 0.40);
  tilt.add(knob);

  // Антенны — комнатные «рожки»: приплюснутое блюдце с хромированным винтом
  // по центру, из него два телескопических штыря узким домиком. У каждого
  // штыря свой шарнир, который догоняет корпус с запозданием. Геометрия колена
  // сдвинута так, что его низ лежит в начале координат — тогда наклон это
  // просто поворот группы, без тригонометрии на позицию (и без шанса
  // ошибиться в знаке).
  //
  // Длины чуть разные: идеально симметричная пара выглядит технично, а
  // разная — глупо, что нам и нужно.
  // Блюдце стоит НА крышке и чуть ближе к переду: утопленное в корпус или
  // сдвинутое к затылку, оно с этого ракурса просто не видно.
  const ANT_Z = -0.03;
  const antBase = new THREE.Mesh(
    keep(new THREE.SphereGeometry(0.19, 22, 8, 0, Math.PI * 2, 0, Math.PI / 2)),
    matKnob);
  antBase.scale.set(1, 0.42, 1);
  antBase.position.set(0, BODY_H / 2 + 0.015, ANT_Z);
  tilt.add(antBase);

  const ANT_Y = BODY_H / 2 + 0.075;

  const antScrew = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(0.019, 0.026, 0.05, 8)), matSteel);
  antScrew.position.set(0, ANT_Y + 0.012, ANT_Z);
  tilt.add(antScrew);

  // Колена: снизу толстое и короткое, кверху тоньше и длиннее — так выглядит
  // выдвинутая антенна, у которой секции входят одна в другую.
  const SEG_R = [0.0210, 0.0155, 0.0105];
  const SEG_PART = [0.28, 0.33, 0.39];

  const antennas = [];
  const antSpec = [
    { side: -1, len: 0.56, splay: 0.15, back: -0.09 },
    { side:  1, len: 0.49, splay: 0.11, back: -0.06 },
  ];
  for (const spec of antSpec) {
    const pivot = new THREE.Group();                 // сюда пишет пружина
    pivot.position.set(spec.side * 0.050, ANT_Y, ANT_Z);
    const arm = new THREE.Group();                   // постоянный развал «ушей»
    // Знак минус обязателен: поворот вокруг Z уводит верх штыря в -X, и без
    // него левый рожок валится вправо, правый влево, и они складываются
    // крестом. Развал должен разводить их в стороны, а не сводить.
    arm.rotation.set(spec.back, 0, -spec.side * spec.splay);

    let y = 0;
    for (let i = 0; i < SEG_R.length; i++) {
      const h = spec.len * SEG_PART[i];
      const segGeo = keep(new THREE.CylinderGeometry(SEG_R[i] * 0.9, SEG_R[i], h, 8));
      segGeo.translate(0, h / 2, 0);
      const seg = new THREE.Mesh(segGeo, matSteel);
      seg.position.y = y;
      arm.add(seg);
      // Обжимка на стыке: без неё три цилиндра читаются одним конусом
      if (i) {
        const ring = new THREE.Mesh(
          keep(new THREE.CylinderGeometry(SEG_R[i] * 1.45, SEG_R[i] * 1.45, 0.014, 8)),
          matSteel);
        ring.position.y = y;
        arm.add(ring);
      }
      y += h;
    }
    const tip = new THREE.Mesh(keep(new THREE.SphereGeometry(0.027, 10, 8)), matSteel);
    tip.position.y = y;
    arm.add(tip);

    pivot.add(arm);
    tilt.add(pivot);
    antennas.push({ pivot, a: 0, av: 0, side: spec.side });
  }

  // Ножки — минимальные, только чтобы корпус не лежал на полу брюхом
  const footGeo = keep(new THREE.CylinderGeometry(0.030, 0.026, FOOT_H, 8));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const f = new THREE.Mesh(footGeo, matKnob);
      f.position.set(sx * 0.40, -BODY_H / 2 - FOOT_H / 2 + 0.01, sz * 0.26);
      tilt.add(f);
    }
  }

  /* Вилка на конце провода. Висит в воздухе и никуда не воткнута — при этом
     экран работает. Ради этой шутки провод и заведён.
     Круглая и чёрная, с рёбрами под пальцы и латунными штырями. */
  const plug = new THREE.Group();

  const plugBody = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(0.070, 0.082, 0.155, 16)), matPlug);
  plugBody.position.y = -0.020;
  plug.add(plugBody);

  // Рёбра под пальцы: восьми хватает, чтобы силуэт перестал быть гладким
  const ribGeo = keep(new THREE.BoxGeometry(0.012, 0.100, 0.016));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rib = new THREE.Mesh(ribGeo, matPlug);
    rib.position.set(Math.cos(a) * 0.074, -0.020, Math.sin(a) * 0.074);
    rib.rotation.y = Math.PI / 2 - a;
    plug.add(rib);
  }

  // Фланец — диск у основания штырей
  const flange = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(0.093, 0.093, 0.028, 18)), matPlug);
  flange.position.y = -0.111;
  plug.add(flange);

  // Штыри — латунь, с закруглёнными концами
  const prongGeo = keep(new THREE.CylinderGeometry(0.017, 0.017, 0.115, 10));
  prongGeo.translate(0, -0.0575, 0);
  const prongCapGeo = keep(new THREE.SphereGeometry(0.017, 10, 8));
  for (const sx of [-1, 1]) {
    const prong = new THREE.Mesh(prongGeo, matMetal);
    prong.position.set(sx * 0.040, -0.125, 0);
    plug.add(prong);
    const cap = new THREE.Mesh(prongCapGeo, matMetal);
    cap.position.set(sx * 0.040, -0.240, 0);
    plug.add(cap);
  }
  plug.position.z = ROPE_Z;

  // Невидимый прокси под рейкаст: один бокс вместо двадцати мешей
  const proxyGeo = keep(new THREE.BoxGeometry(BODY_W, BODY_H + FOOT_H, BODY_D));
  const proxy = new THREE.Mesh(proxyGeo, keep(new THREE.MeshBasicMaterial({ visible: false })));
  proxy.position.y = -FOOT_H / 2;

  const body = new THREE.Group();
  body.add(tilt, proxy);

  // Провод живёт не в body: его точки считаются сразу в координатах rig,
  // а якорь берётся от корпуса. Иначе пришлось бы гонять их через матрицу
  // вращающегося родителя туда и обратно каждый кадр.
  const ropeParts = makeRopeMesh(matCord);

  return {
    body, tilt, screen, screenMat, glow, antennas, proxy, disposables,
    ropeMesh: ropeParts.mesh, ropeGeo: ropeParts.geo, plug,
  };
}

/* ── Точка входа ───────────────────────────────────────────────────────── */

export function mount(el, opts = {}) {
  const params = Object.assign({}, DEFAULTS, opts.params);
  // Неподвижный режим: один кадр и никакого цикла. Нужен скриншотным тестам,
  // которым важно, чтобы один и тот же коммит давал одну и ту же картинку.
  const frozen = !!opts.frozen;
  let forceDark = opts.forceDark === undefined ? null : opts.forceDark;
  let pal = readPalette(forceDark);

  const renderer = new THREE.WebGLRenderer({
    antialias: window.devicePixelRatio < 2,
    alpha: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20);
  camera.position.set(0, 0, CAM_DIST);

  const hemi = new THREE.HemisphereLight(new THREE.Color(pal.paper), 0x1a1720, pal.dark ? 1.5 : 2.2);
  const key = new THREE.DirectionalLight(0xffffff, pal.dark ? 1.6 : 2.0);
  key.position.set(-1.6, 2.0, 2.4);
  const fill = new THREE.DirectionalLight(new THREE.Color(pal.accent), 0.35);
  fill.position.set(2.0, -0.6, 0.8);
  scene.add(hemi, key, fill);

  const rig = new THREE.Group();
  scene.add(rig);

  let tv = buildTV(pal);
  rig.add(tv.body, tv.ropeMesh, tv.plug);

  const rope = new Rope(ROPE_N, ROPE_SEG);
  // Якорь в системе корпуса: низ задней стенки. Поворот корпуса его сносит,
  // поэтому провод раскачивается и когда телевизор просто кренится.
  const ANCHOR_X = 0.40, ANCHOR_Y = -0.30;
  const anchor = { x: 0, y: 0 };

  function anchorAt(x, y, th) {
    const c = Math.cos(th), s = Math.sin(th);
    anchor.x = x + ANCHOR_X * c - ANCHOR_Y * s;
    anchor.y = y + ANCHOR_X * s + ANCHOR_Y * c;
    return anchor;
  }

  const shadowTex = shadowTexture();
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex, transparent: true, depthWrite: false, opacity: 0.5,
  });
  // Камера смотрит строго в лоб, поэтому «тень на полу» была бы видна с
  // ребра — тонкой полоской. Вместо неё мягкое пятно в плоскости кадра,
  // прижатое к ножкам: в такой проекции это читается как контактная тень.
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), shadowMat);
  shadow.position.z = -0.5;
  rig.add(shadow);

  /* ── Состояние физики ───────────────────────────────────────────────── */

  const S = {
    x: 0, y: HALF_H, vx: 0, vy: 0,
    th: 0, om: 0,
    grounded: true, sleeping: false, sleepFor: 0,
  };
  let prev = { x: S.x, y: S.y, th: S.th };
  let homeX = 0, halfW = 1, halfH = 1, limX = 1;
  let lastW = 0, lastH = 0, lastDpr = 0;
  let tiltG = 0;                    // наклон устройства, доля g по горизонтали

  // Высота центра масс, при которой коробка, повёрнутая на th, касается пола.
  const supportY = (th) => HALF_H * Math.cos(th) + HALF_W * Math.abs(Math.sin(th));

  function wake() { S.sleeping = false; S.sleepFor = 0; }

  function step(dt) {
    let ax = -params.gravity * tiltG;
    let ay = params.gravity;

    if (drag.active) {
      // Пока держим — телевизор на пружине к курсору, гравитации нет
      ax = (drag.tx - S.x) * 140 - S.vx * 18;
      ay = (drag.ty - S.y) * 140 - S.vy * 18;
    } else {
      ax += -params.homeK * (S.x - homeX) - params.homeC * S.vx;
    }

    const al = -params.uprightK * S.th - params.uprightC * S.om;

    S.vx += ax * dt;  S.vx *= Math.exp(-params.airV * dt);
    S.vy += ay * dt;  S.vy *= Math.exp(-params.airV * dt);
    S.om += al * dt;  S.om *= Math.exp(-params.airW * dt);

    S.x += S.vx * dt;
    S.y += S.vy * dt;
    S.th += S.om * dt;

    S.grounded = false;
    const floorY = supportY(S.th);
    if (!drag.active && S.y < floorY) {
      S.y = floorY;
      if (S.vy < 0) {
        const hit = -S.vy;
        // Порог обязателен: без него за шаг гравитация успевает набрать
        // скорость, отскок её возвращает, и корпус вечно микро-дрожит,
        // никогда не попадая в условие сна.
        S.vy = hit < params.vRest ? 0 : hit * params.rest;
        // Трение — только в момент настоящего удара. Если умножать на него
        // каждый шаг, пока корпус просто стоит, оно за секунду съедает всё
        // (0.86¹²⁰ ≈ 0), пружина не может дотянуть его домой, и условие сна
        // не выполняется никогда.
        if (hit >= params.vRest) S.vx *= params.friction;
        // Удар в угол доворачивает корпус в сторону наклона
        S.om = S.om * params.spinLoss - S.th * hit * 1.2;
        if (hit > 2.2) flash(Math.min(hit * 0.22, 0.9));
      }
      // Трение покоя: экспоненциальное по времени, а не по шагу — иначе
      // поведение зависит от частоты кадров.
      S.vx *= Math.exp(-params.groundDrag * dt);
      S.grounded = true;
    }

    // Не выпускаем за пределы канваса
    const lim = Math.max(0.2, limX);
    if (S.x < -lim) { S.x = -lim; S.vx = Math.abs(S.vx) * 0.4; }
    if (S.x >  lim) { S.x =  lim; S.vx = -Math.abs(S.vx) * 0.4; }
    const ceil = halfH - HALF_H * 0.4;
    if (S.y > ceil) { S.y = ceil; S.vy = -Math.abs(S.vy) * 0.3; }

    // Сон: иначе корпус вечно микро-дрожит на полу
    // Провод входит в условие сна наравне с корпусом: он качается заметно
    // дольше, и заснуть, пока вилка ещё болтается, было бы видно.
    const still = S.grounded
      && Math.abs(S.vx) < 0.012 && Math.abs(S.vy) < 0.012
      && Math.abs(S.om) < 0.012 && Math.abs(S.th) < 0.01
      && Math.abs(S.x - homeX) < 0.01
      && !ropeMoving();
    if (still) {
      S.sleepFor += dt;
      if (S.sleepFor > 0.5) {
        S.x = homeX; S.y = HALF_H; S.th = 0;
        S.vx = S.vy = S.om = 0;
        S.sleeping = true;
      }
    } else {
      S.sleepFor = 0;
    }

    // Антенны догоняют корпус с запозданием — самая дешёвая деталь и самая
    // заметная: без неё прыжок выглядит как перемещение картинки.
    for (const ant of tv.antennas) {
      const acc = -params.antK * ant.a - params.antC * ant.av - al * params.antLever;
      ant.av += acc * dt;
      ant.a  += ant.av * dt;
      ant.a = THREE.MathUtils.clamp(ant.a, -0.7, 0.7);
    }

    const a = anchorAt(S.x, S.y, S.th);
    rope.step(dt, a.x, a.y, params.ropeG, params.ropeDamp);
  }

  // Провод шевелится сам по себе — значит, физика не спит, даже если корпус
  // стоит. Проверяем по нижней точке: она успокаивается последней.
  function ropeMoving() {
    const i = (ROPE_N - 1) * 2;
    return Math.abs(rope.p[i] - rope.q[i]) > 0.0006
        || Math.abs(rope.p[i + 1] - rope.q[i + 1]) > 0.0006;
  }

  /* ── Экран: розжиг, срыв кадра, вспышка от удара ────────────────────── */

  let power = 0, flashV = 0, roll = 0, rollV = 0, nextGlitch = 3 + Math.random() * 5;

  function flash(amount) { flashV = Math.max(flashV, amount); }

  function updateScreen(dt, t) {
    power = Math.min(1, power + dt / 0.9);
    const ease = 1 - Math.pow(1 - power, 3);
    tv.screen.scale.y = 0.02 + 0.98 * Math.min(1, ease * 1.06);

    flashV *= Math.exp(-dt / 0.09);

    nextGlitch -= dt;
    if (nextGlitch <= 0) { rollV = 1 / 0.25; nextGlitch = 4 + Math.random() * 5; }
    if (rollV > 0) {
      roll += rollV * dt;
      if (roll >= 1) { roll = 0; rollV = 0; }
    }

    const u = tv.screenMat.uniforms;
    u.uTime.value = t;
    u.uRoll.value = roll;
    u.uIntensity.value = ease + flashV;
    tv.glow.intensity = (0.5 + flashV * 2.5) * ease;
  }

  /* ── Раскладка ──────────────────────────────────────────────────────── */

  function layout() {
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    // DPR считаем здесь же: переезд окна на другой монитор его меняет
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);

    // ResizeObserver дёргается пачками, а каждый setSize пересоздаёт буфер и
    // очищает канвас. Трогаем рендерер только когда размер правда изменился.
    const resized = w !== lastW || h !== lastH || dpr !== lastDpr;
    if (resized) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      lastW = w; lastH = h; lastDpr = dpr;
    }

    const worldH = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAM_DIST;
    const worldW = worldH * (w / h);

    const narrow = w < 680;

    // Канвас во весь вьюпорт, но размер телевизора и его место в кадре
    // считаются от «сцены» — прямоугольника прежних габаритов у заголовка.
    // Иначе на высоком окне игрушку раздувало бы заодно с канвасом.
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const stageH = Math.min(h * 0.58, rem * 28);

    const targetPx = THREE.MathUtils.clamp(stageH * (narrow ? 0.30 : 0.36), 96, 250);
    const s = (targetPx * (worldH / h)) / TV_VIS_H;
    rig.scale.setScalar(s);

    // halfW от высоты окна не зависит: targetPx считается от stageH, и высота
    // из формулы сокращается. Поэтому разъезд по горизонтали остался прежним,
    // а halfH вырос вместе с канвасом — это и есть «летать по всему вьюпорту».
    halfW = worldW / 2 / s;
    halfH = worldH / 2 / s;

    // Пол ставим от заголовка, а не от края окна: main центрируется по
    // вертикали, и на высоком экране телевизор иначе отрывается от композиции
    // и висит сам по себе. Коэффициент разный по ширине, потому что от неё
    // зависит и расположение: на широком телевизор стоит справа от текста и
    // низу можно заходить на имя — там ножки и провод; на узком он висит прямо
    // над колонкой, и на буквы заходить не должен.
    // Заголовок скрыт или его нет (стенд с выключенным текстом) — считаем
    // от центра сцены, как было раньше.
    const heading = document.querySelector('h1');
    const hr = heading && heading.getBoundingClientRect();

    // Пол — по низу фамилии, одинаково на широком и узком. Раньше широкий
    // считал от волосяной линии, а узкий подвешивал телевизор над заголовком
    // долей от stageH; и то и другое ни к чему в вёрстке не привязано, а
    // просили ровно одного: чтобы ножки стояли на нижнем крае второй строки
    // имени. У h1 line-height 0.95, поэтому низ его бокса и есть этот край.
    // floorGap приподнимает игрушку над ним — на случай подгонки.
    const floorPx = hr && hr.height > 0
      ? hr.bottom - params.floorGap
      : stageH * 0.5 * (1 + (narrow ? 0.02 : 0.34));

    rig.position.y = (h / 2 - floorPx) * (worldH / h);

    // Телевизор стоит сразу за именем: левый борт корпуса — у правого края
    // текста заголовка, с зазором homeGap. Считается от вёрстки, а не долей
    // от halfW: доля не знает, где на самом деле кончаются буквы.
    //
    // Край берётся у Range по содержимому, а не у бокса h1. Бокс блочный и
    // растянут во всю колонку — по нему телевизор встал бы далеко правее
    // букв, с дырой посередине. Range даёт объединение строк, то есть правый
    // край длинной из двух: имени.
    //
    // Если справа не хватает места, игрушка уезжает за край — так и просили:
    // сначала имя и фамилия, телевизор следом и пусть будет обрезан.
    const pxToLocal = (worldH / h) / s;
    let textRight = w / 2;
    if (heading) {
      const range = document.createRange();
      range.selectNodeContents(heading);
      const tr = range.getBoundingClientRect();
      if (tr.width > 0) textRight = tr.right;
    }
    // Правый борт — у правого края колонки, там же, где кончается волосяная
    // линия: справа от имени обычно остаётся место, и прижимать игрушку
    // вплотную к буквам значит это место выбросить. h1 блочный, поэтому его
    // бокс и есть колонка.
    //
    // Но ближе homeGap к буквам корпус не подходит. Если имя длинное и места
    // не остаётся, эта граница побеждает, и телевизор уезжает за правый край
    // экрана — сначала имя и фамилия, телевизор следом и пусть обрезан.
    const colRight = hr && hr.width > 0 ? hr.right : w / 2;
    const tvW = (2 * HALF_W) / pxToLocal;
    const rightPx = Math.max(colRight, textRight + params.homeGap + tvW);
    homeX = (rightPx - w / 2) * pxToLocal - HALF_W;

    // Стены не должны спорить с домашней позицией: если дом оказался за краем
    // канваса, предел раздвигается. Иначе пружина тянет влево, стенка толкает
    // вправо, и телевизор дрожит на границе, никогда не засыпая.
    limX = Math.max(halfW - HALF_W * 0.9, Math.abs(homeX) + HALF_W * 0.2);

    if (S.sleeping) { S.x = homeX; }

    // Свежий буфер пуст, а спящий цикл рисует через кадр — вот в этот зазор и
    // проваливалась картинка при перетаскивании окна. Рисуем кадр сразу же и
    // по актуальному состоянию, чтобы пустого канваса не увидел никто.
    if (resized) {
      syncMeshes(1);
      renderer.render(scene, camera);
    }

    wake();
  }

  /* ── Ввод ───────────────────────────────────────────────────────────── */

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hitPoint = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  const drag = { active: false, id: -1, tx: 0, ty: 0, dx: 0, dy: 0, t0: 0, x0: 0, y0: 0, hist: [] };

  function toNdc(e) {
    const r = el.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    return r;
  }

  // Точка курсора, спроецированная на плоскость z=0, в координатах rig
  function pointerWorld(e) {
    toNdc(e);
    raycaster.setFromCamera(ndc, camera);
    raycaster.ray.intersectPlane(plane, hitPoint);
    rig.worldToLocal(hitPoint);
    return hitPoint;
  }

  function hitTV(e) {
    // Канвас с pointer-events:none, поэтому под курсором виден реальный
    // элемент страницы. Если это ссылка — телевизор молчит, клик её.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (under && under.closest && under.closest('a, button, input, textarea, select, label')) return null;
    toNdc(e);
    if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return null;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(tv.proxy, false);
    return hits.length ? hits[0] : null;
  }

  let hovering = false;
  let hoverThrottle = 0;

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (!hitTV(e)) return;
    const p = pointerWorld(e);
    drag.active = true;
    drag.id = e.pointerId;
    drag.dx = S.x - p.x;
    drag.dy = S.y - p.y;
    drag.tx = S.x; drag.ty = S.y;
    drag.t0 = performance.now();
    drag.x0 = e.clientX; drag.y0 = e.clientY;
    drag.hist.length = 0;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    wake();
    if (e.preventDefault) e.preventDefault();
  }

  function onPointerMove(e) {
    if (drag.active && e.pointerId === drag.id) {
      const p = pointerWorld(e);
      drag.tx = p.x + drag.dx;
      drag.ty = p.y + drag.dy;
      drag.hist.push({ t: performance.now(), x: drag.tx, y: drag.ty });
      if (drag.hist.length > 5) drag.hist.shift();
      wake();
      return;
    }
    const now = performance.now();
    if (now - hoverThrottle < 33) return;
    hoverThrottle = now;
    const over = !!hitTV(e);
    if (over !== hovering) {
      hovering = over;
      document.body.style.cursor = over ? 'grab' : '';
    }
  }

  function onPointerUp(e) {
    if (!drag.active || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    drag.active = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = hovering ? 'grab' : '';

    const moved = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
    const held = performance.now() - drag.t0;

    if (moved < 6 && held < 250) {
      // Короткий тык — подскок. Клик по краю закручивает сильнее, чем по центру.
      const off = THREE.MathUtils.clamp((pointerWorld(e).x - S.x) / HALF_W, -1, 1);
      S.vy += params.kickV + Math.random() * 1.5;
      S.vx += off * 2.0;
      S.om -= off * 14.0;
      flash(0.6);
    } else if (drag.hist.length > 1) {
      // Бросок: скорость считаем по последним кадрам жеста
      const a = drag.hist[0], b = drag.hist[drag.hist.length - 1];
      const dt = Math.max((b.t - a.t) / 1000, 1 / 120);
      S.vx = THREE.MathUtils.clamp((b.x - a.x) / dt * 1.1, -14, 14);
      S.vy = THREE.MathUtils.clamp((b.y - a.y) / dt * 1.1, -14, 14);
      S.om += THREE.MathUtils.clamp(-S.vx * 1.2, -10, 10);
    }
    wake();
  }

  // Страница одноэкранная и не скроллится, поэтому колесо — просто импульс.
  // passive и без preventDefault: Ctrl+колесо (зум браузера) не ломаем.
  function onWheel(e) {
    const d = THREE.MathUtils.clamp(e.deltaY, -110, 110);
    if (!d) return;
    S.vx += d * params.wheelV;
    S.om -= d * params.wheelV * 0.33;
    S.vy += Math.abs(d) * params.wheelV * 0.85;
    wake();
  }

  /* ── Свайп ──────────────────────────────────────────────────────────────
   * Страница одноэкранная, и на iOS вертикальный жест по ней уходит в
   * резинку. Подавлять это не хочется: жест штатный, привычный и приятный —
   * поэтому он не гасится, а используется. Свайп мимо корпуса качает страницу
   * как обычно и заодно подбрасывает телевизор.
   *
   * Слушаем touchmove, а не scroll: страница нескроллируемая, и событие
   * scroll на резинке в разных версиях Safari приходит по-разному или не
   * приходит вовсе, а координаты пальца есть всегда. Всё passive и без
   * preventDefault — ни скролл, ни резинка не трогаются.
   *
   * Палец, начавший жест на корпусе, — это перетаскивание, и оно тут не
   * участвует: свайп смотрит только на жесты мимо телевизора.
   */
  const swipe = { x: 0, y: 0, t: 0, id: null, cool: 0 };

  function onTouchStart(e) {
    if (drag.active) return;
    const t = e.changedTouches[0];
    if (!t) return;
    swipe.id = t.identifier;
    swipe.x = t.clientX; swipe.y = t.clientY;
    swipe.t = performance.now();
  }

  function onTouchMove(e) {
    if (drag.active || swipe.id === null) return;
    let t = null;
    for (const c of e.changedTouches) if (c.identifier === swipe.id) { t = c; break; }
    if (!t) return;

    const now = performance.now();
    const dt = Math.max((now - swipe.t) / 1000, 1 / 120);
    const dx = t.clientX - swipe.x;
    const dy = t.clientY - swipe.y;
    swipe.x = t.clientX; swipe.y = t.clientY; swipe.t = now;

    // Скорость жеста в px/с. Порог отсекает медленное ведение пальцем:
    // подпрыгивать должен именно бросок, а не любое касание.
    const vy = dy / dt, vx = dx / dt;
    if (Math.hypot(vx, vy) < 900 || now < swipe.cool) return;

    // Один свайп — один прыжок: без паузы длинный жест сыпал бы импульсами
    // каждый кадр, и телевизор улетал бы в потолок.
    swipe.cool = now + 420;
    swipeImpulse(vx, vy);
  }

  // Скорость жеста в px/с → импульс. Отдельно от обработчика, потому что то
  // же самое дёргает стенд кнопкой: жест иначе не проверить без телефона.
  function swipeImpulse(vx, vy) {
    // Подбрасывает любой резкий жест, вверх или вниз: подпрыгнуть от тряски
    // страницы честнее, чем угадывать намерение по знаку. Горизонталь идёт
    // вбок и в закрутку — та же логика, что у колеса.
    const k = THREE.MathUtils.clamp(Math.hypot(vx, vy) / 1000, 0, 3.2);
    const side = THREE.MathUtils.clamp(vx / 1000, -2, 2);
    S.vy += k * params.swipeV * 34;
    S.vx += side * params.swipeV * 26;
    S.om -= side * params.swipeV * 90;
    flash(0.45);
    wake();
  }

  function onTouchEnd(e) {
    for (const c of e.changedTouches) if (c.identifier === swipe.id) { swipe.id = null; return; }
  }

  function onOrient(e) {
    if (e.gamma === null || e.gamma === undefined) return;
    tiltG = THREE.MathUtils.clamp(e.gamma / 45, -1, 1) * 0.45;
    if (Math.abs(tiltG) > 0.05) wake();
  }

  /* ── Тема ───────────────────────────────────────────────────────────── */

  function refreshTheme() {
    pal = readPalette(forceDark);
    const accent = new THREE.Color(pal.accent);
    tv.screenMat.uniforms.uAccent.value.copy(accent);
    tv.glow.color.copy(accent);
    fill.color.copy(accent);
    hemi.color.set(pal.paper);
    hemi.intensity = pal.dark ? 1.5 : 2.2;
    key.intensity = pal.dark ? 1.6 : 2.0;
    tv.body.traverse((o) => {
      if (!o.isMesh || !o.material || !o.material.color) return;
      const m = o.material;
      if (m.userData.role) m.color.set(pal[m.userData.role]);
    });
    shadowMat.opacity = pal.dark ? 0.32 : 0.5;
  }

  /* ── Цикл ───────────────────────────────────────────────────────────── */

  let raf = 0, last = 0, acc = 0, clock = 0, parity = 0, visible = true, onScreen = true;
  let running = false;
  let paused = false;

  // Перенос состояния физики в меши. Вынесено из frame(), потому что то же
  // самое нужно layout(): он после пересоздания буфера рисует кадр синхронно,
  // и рисовать этот кадр надо по свежему состоянию, а не по позапрошлому.
  // a — доля интерполяции между prev и текущим шагом; 1 значит «как есть».
  function syncMeshes(a) {
    tv.body.position.x = prev.x + (S.x - prev.x) * a;
    tv.body.position.y = prev.y + (S.y - prev.y) * a;
    tv.body.rotation.z = prev.th + (S.th - prev.th) * a;
    for (const ant of tv.antennas) ant.pivot.rotation.z = ant.a;

    updateRopeMesh(tv.ropeGeo, rope);

    // Вилка садится на последнюю точку и разворачивается по последнему звену
    const tail = (ROPE_N - 1) * 2;
    const dx = rope.p[tail] - rope.p[tail - 2];
    const dy = rope.p[tail + 1] - rope.p[tail - 1];
    tv.plug.position.set(rope.p[tail], rope.p[tail + 1], ROPE_Z);
    tv.plug.rotation.z = Math.atan2(dy, dx) + Math.PI / 2;

    // Чем выше корпус, тем шире и бледнее пятно
    const lift = Math.max(0, tv.body.position.y - HALF_H);
    const k = 1 / (1 + lift * 1.1);
    shadow.position.x = tv.body.position.x;
    shadow.position.y = 0.02;
    shadow.scale.set(0.85 + (1 - k) * 0.5, 0.20 + (1 - k) * 0.12, 1);
    shadowMat.opacity = (pal.dark ? 0.30 : 0.42) * k;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dtReal = last ? Math.min((now - last) / 1000, 0.25) : 1 / 60;
    last = now;
    clock += dtReal;

    if (!paused) {
      if (S.sleeping) {
        // Физика спит — шум продолжает жить, но рендерим через кадр
        acc = 0;
        prev.x = S.x; prev.y = S.y; prev.th = S.th;
      } else {
        acc += dtReal;
        let n = 0;
        while (acc >= FIXED && n < MAX_SUB) {
          prev.x = S.x; prev.y = S.y; prev.th = S.th;
          step(FIXED);
          acc -= FIXED;
          n++;
        }
        if (n === MAX_SUB) acc = 0;
      }
    }

    if (S.sleeping && !paused && (parity ^= 1)) return;

    syncMeshes(S.sleeping ? 1 : acc / FIXED);
    updateScreen(dtReal, clock);
    renderer.render(scene, camera);
  }

  function start() {
    if (frozen || running || !visible || !onScreen) return;
    running = true;
    last = 0; acc = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  /* ── Подписки ───────────────────────────────────────────────────────── */

  const ro = new ResizeObserver(layout);
  ro.observe(el);

  const io = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    onScreen ? start() : stop();
  }, { threshold: 0 });
  io.observe(el);

  const onVis = () => {
    visible = !document.hidden;
    visible ? start() : stop();
  };
  const darkMq = matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => refreshTheme();

  // Смена темы кнопкой — это смена атрибута, события от matchMedia при ней
  // не будет. Поэтому за атрибутом следим отдельно.
  const themeMo = new MutationObserver(() => refreshTheme());
  themeMo.observe(document.documentElement,
    { attributes: true, attributeFilter: ['data-theme'] });

  // Потеря контекста — молча исчезаем. Восстанавливать нечего: страница
  // без телевизора и есть штатное состояние.
  const onContextLost = (e) => {
    e.preventDefault();
    stop();
    el.style.display = 'none';
  };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);

  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pointerdown', onPointerDown, { passive: false });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  window.addEventListener('pointercancel', onPointerUp, { passive: true });
  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true });
  window.addEventListener('deviceorientation', onOrient, { passive: true });
  darkMq.addEventListener('change', onScheme);

  layout();
  refreshTheme();
  S.x = homeX;

  // Телевизор приезжает падением. Высота задана в его собственных высотах:
  // размер игрушки считается от stageH, поэтому в высотах корпуса падение
  // выглядит одинаково и на ноутбуке, и на большом мониторе. Потолок сцены
  // всё равно уважаем — иначе на низком окне вместо падения будет отскок
  // от верхнего края.
  if (!frozen) {
    S.y = Math.min(HALF_H + params.dropY * TV_VIS_H, halfH - HALF_H * 0.4);
    S.grounded = false;
  }
  prev.x = S.x; prev.y = S.y; prev.th = S.th;
  {
    const a = anchorAt(S.x, S.y, S.th);
    rope.reset(a.x, a.y);
  }

  if (frozen) {
    // Снимок должен совпадать от запуска к запуску: падения нет, случайные
    // срывы кадра выключены, шум прибит к постоянному времени, экран сразу
    // разожжён. Провод перед этим успокаиваем фиксированным числом шагов —
    // в step() случайностей нет, значит результат воспроизводим.
    nextGlitch = Infinity;
    for (let i = 0; i < FROZEN_SETTLE; i++) step(FIXED);
    prev.x = S.x; prev.y = S.y; prev.th = S.th;
    power = 1;
    syncMeshes(1);
    updateScreen(0, FROZEN_T);
    renderer.render(scene, camera);
  } else {
    start();
  }

  /* ── Публичный интерфейс ────────────────────────────────────────────── */

  const api = {
    destroy() {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('deviceorientation', onOrient);
      darkMq.removeEventListener('change', onScheme);
      themeMo.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      for (const d of tv.disposables) d.dispose();
      tv.ropeGeo.dispose();
      shadow.geometry.dispose();
      shadowMat.dispose();
      shadowTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.remove();
    },

    // Всё ниже — для стенда /lab/tv.html
    debug: {
      params, state: S, renderer, scene, camera, rig, tv,
      kick(force) {
        S.vy += force === undefined ? params.kickV : force;
        S.om -= (Math.random() - 0.5) * 12;
        flash(0.6);
        wake();
      },
      wheel(delta) { onWheel({ deltaY: delta }); },
      swipe(vx, vy) { swipeImpulse(vx || 0, vy === undefined ? -1600 : vy); },
      reset() {
        S.x = homeX; S.y = HALF_H; S.th = 0;
        S.vx = S.vy = S.om = 0;
        prev = { x: S.x, y: S.y, th: S.th };
        power = 0; flashV = 0; roll = 0; rollV = 0;
        const a = anchorAt(S.x, S.y, S.th);
        rope.reset(a.x, a.y);
        wake();
      },
      rope,
      setPaused(v) { paused = !!v; if (!v) { last = 0; acc = 0; } wake(); },
      setForceDark(v) { forceDark = v; refreshTheme(); },
      setWireframe(v) {
        tv.body.traverse((o) => { if (o.isMesh && o.material.wireframe !== undefined) o.material.wireframe = !!v; });
      },
      refreshTheme,
      relayout: layout,
    },
  };

  return api;
}
