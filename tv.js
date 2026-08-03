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

/* ── Габариты в «телевизорных» единицах: высота корпуса = 0.80 ─────────── */

const BODY_W = 1.00;
const BODY_H = 0.80;
const BODY_D = 0.86;
const FOOT_H = 0.05;

const HALF_H = BODY_H / 2 + FOOT_H;   // от центра масс до низа ножек
const HALF_W = BODY_W / 2;
const TV_VIS_H = BODY_H + FOOT_H + 0.30;  // с антеннами — по этому масштабируем

const FOV = 30;
const CAM_DIST = 3.4;

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
  antK:       90.0,   // жёсткость антенн
  antC:        6.0,
  antLever:    0.30,
};

const FIXED = 1 / 120;
const MAX_SUB = 5;

/* ── Тема берётся из CSS-переменных страницы, а не задаётся здесь ──────── */

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function readPalette(forceDark) {
  const dark = forceDark === null || forceDark === undefined
    ? matchMedia('(prefers-color-scheme: dark)').matches
    : !!forceDark;
  return {
    dark,
    accent: cssVar('--accent', '#2f6b57'),
    paper:  cssVar('--paper', dark ? '#101014' : '#f4f1ec'),
    shell:  dark ? '#2e2b35' : '#c9bda6',
    bezel:  dark ? '#1b1a21' : '#9d9179',
    knob:   dark ? '#565060' : '#7b7264',
    metal:  dark ? '#837b90' : '#8e857a',
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
    float scan = 0.82 + 0.18 * sin(uv.y * 560.0);

    // Завал яркости к краям. Виньетка по прямоугольнику, а не по радиусу, и
    // полоса спада узкая: круглая или размазанная превращает картинку в овал.
    vec2  c   = abs(uv - 0.5) * 2.0;
    float vig = smoothstep(1.01, 0.88, c.x) * smoothstep(1.01, 0.86, c.y);

    vec3 col = vec3(n) * scan * vig;
    col = mix(col, col * uAccent * 1.7, 0.20);   // люминофор в цвет акцента
    col += uAccent * 0.025 * vig;                // общее свечение трубки

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

// Корпус сужается к затылку — отсюда и берётся «пузатость» силуэта.
function taperShell(geo) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const t = THREE.MathUtils.smoothstep(z, -BODY_D * 0.5, BODY_D * 0.34);
    const k = 0.70 + 0.30 * t;
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

  const matShell = plastic('shell');
  const matBezel = plastic('bezel', { roughness: 0.7 });
  const matKnob  = plastic('knob',  { roughness: 0.35, metalness: 0.45 });
  const matMetal = plastic('metal', { roughness: 0.3,  metalness: 0.65 });

  // tilt — постоянный разворот на три четверти. Физика крутит только
  // родителя вокруг Z, поэтому проекция экрана остаётся ортогональной и
  // пересчёт «экранные пиксели ↔ мир» остаётся тривиальным.
  const tilt = new THREE.Group();
  tilt.rotation.set(-0.06, -0.46, 0);

  const shellGeo = keep(new RoundedBoxGeometry(BODY_W, BODY_H, BODY_D, 3, 0.075));
  taperShell(shellGeo);
  tilt.add(new THREE.Mesh(shellGeo, matShell));

  // Рамка сдвинута влево: справа остаётся панель под ручки и динамик.
  const BX = -0.13;
  const bezelShape = roundedRect(0.68, 0.60, 0.07);
  bezelShape.holes.push(roundedRect(0.56, 0.46, 0.05));
  const bezelGeo = keep(new THREE.ExtrudeGeometry(bezelShape, {
    depth: 0.06, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1,
  }));
  const bezel = new THREE.Mesh(bezelGeo, matBezel);
  // Порядок по глубине: передняя грань корпуса 0.43 → стекло 0.437…0.487 →
  // рамка 0.432…0.492. Стекло обязано быть впереди корпуса, иначе он его
  // перекрывает и от картинки остаётся только выпуклая середина.
  bezel.position.set(BX, 0, 0.432);
  tilt.add(bezel);

  // Экран чуть больше отверстия: край уходит под рамку, стыка не видно.
  const screenGeo = keep(new THREE.PlaneGeometry(0.58, 0.48, 20, 16));
  bulgeScreen(screenGeo, 0.05);
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
  screen.position.set(BX, 0, 0.437);
  screen.scale.y = 0.02;              // розжиг растянет до 1
  tilt.add(screen);

  // Свет трубки, падающий на рамку изнутри
  const glow = new THREE.PointLight(new THREE.Color(pal.accent), 0, 1.2, 2);
  glow.position.set(BX, 0, 0.60);
  tilt.add(glow);

  // Ручки и верньер на правой панели
  const knobGeo = keep(new THREE.CylinderGeometry(0.048, 0.052, 0.04, 14));
  for (const y of [0.19, 0.03]) {
    const k = new THREE.Mesh(knobGeo, matKnob);
    k.rotation.x = Math.PI / 2;
    k.position.set(0.33, y, 0.44);
    tilt.add(k);
  }
  const dialGeo = keep(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 10));
  const dial = new THREE.Mesh(dialGeo, matMetal);
  dial.rotation.x = Math.PI / 2;
  dial.position.set(0.33, -0.10, 0.45);
  tilt.add(dial);

  // Решётка динамика
  const barGeo = keep(new THREE.BoxGeometry(0.19, 0.011, 0.014));
  for (let i = 0; i < 5; i++) {
    const bar = new THREE.Mesh(barGeo, matBezel);
    bar.position.set(0.33, -0.19 - i * 0.038, 0.435);
    tilt.add(bar);
  }

  // Антенны: у каждой свой шарнир, который догоняет корпус с запозданием.
  // Геометрия стержня сдвинута так, что его основание лежит в начале
  // координат — тогда наклон это просто поворот группы, без тригонометрии
  // на позицию (и без шанса ошибиться в знаке).
  const ROD_L = 0.52;
  const rodGeo = keep(new THREE.CylinderGeometry(0.005, 0.008, ROD_L, 6));
  rodGeo.translate(0, ROD_L / 2, 0);
  const tipGeo = keep(new THREE.SphereGeometry(0.015, 8, 6));
  const antennas = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();                 // сюда пишет пружина
    pivot.position.set(side * 0.17, BODY_H / 2 - 0.02, -0.08);
    const arm = new THREE.Group();                   // постоянный развал «ушей»
    arm.rotation.set(-0.22, 0, side * 0.38);
    const rod = new THREE.Mesh(rodGeo, matMetal);
    const tip = new THREE.Mesh(tipGeo, matMetal);
    tip.position.y = ROD_L;
    arm.add(rod, tip);
    pivot.add(arm);
    tilt.add(pivot);
    antennas.push({ pivot, a: 0, av: 0, side });
  }

  // Ножки
  const footGeo = keep(new THREE.CylinderGeometry(0.036, 0.028, FOOT_H, 8));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const f = new THREE.Mesh(footGeo, matBezel);
      f.position.set(sx * 0.38, -BODY_H / 2 - FOOT_H / 2 + 0.008, sz * 0.30);
      tilt.add(f);
    }
  }

  // Невидимый прокси под рейкаст: один бокс вместо двадцати мешей
  const proxyGeo = keep(new THREE.BoxGeometry(BODY_W, BODY_H + FOOT_H, BODY_D));
  const proxy = new THREE.Mesh(proxyGeo, keep(new THREE.MeshBasicMaterial({ visible: false })));
  proxy.position.y = -FOOT_H / 2;

  const body = new THREE.Group();
  body.add(tilt, proxy);

  return { body, tilt, screen, screenMat, glow, antennas, proxy, disposables };
}

/* ── Точка входа ───────────────────────────────────────────────────────── */

export function mount(el, opts = {}) {
  const params = Object.assign({}, DEFAULTS, opts.params);
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
  rig.add(tv.body);

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
  let homeX = 0, floorTop = 0, halfW = 1, halfH = 1;
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
    const lim = Math.max(0.2, halfW - HALF_W * 0.9);
    if (S.x < -lim) { S.x = -lim; S.vx = Math.abs(S.vx) * 0.4; }
    if (S.x >  lim) { S.x =  lim; S.vx = -Math.abs(S.vx) * 0.4; }
    const ceil = halfH - HALF_H * 0.4;
    if (S.y > ceil) { S.y = ceil; S.vy = -Math.abs(S.vy) * 0.3; }

    // Сон: иначе корпус вечно микро-дрожит на полу
    const still = S.grounded
      && Math.abs(S.vx) < 0.012 && Math.abs(S.vy) < 0.012
      && Math.abs(S.om) < 0.012 && Math.abs(S.th) < 0.01
      && Math.abs(S.x - homeX) < 0.01;
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
      ant.a = THREE.MathUtils.clamp(ant.a, -0.5, 0.5);
    }
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
    // Пересчитываем DPR здесь же: переезд окна на другой монитор его меняет
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    const worldH = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAM_DIST;
    const worldW = worldH * camera.aspect;

    const narrow = w < 680;
    const targetPx = THREE.MathUtils.clamp(h * (narrow ? 0.30 : 0.36), 96, 250);
    const s = (targetPx * (worldH / h)) / TV_VIS_H;
    rig.scale.setScalar(s);

    halfW = worldW / 2 / s;
    halfH = worldH / 2 / s;

    // Пол — ниже середины стейджа, чтобы сверху осталось место на прыжок.
    // Домашняя позиция уходит вправо: слева стоит колонка текста.
    // На узком экране места сбоку нет вообще, поэтому телевизор поднимается
    // над именем целиком — иначе корпус ложится на буквы.
    floorTop = narrow ? -halfH * 0.02 : -halfH * 0.34;
    homeX = narrow
      ? Math.min(halfW * 0.34, halfW - HALF_W * 1.1)
      : Math.min(halfW * 0.42, halfW - HALF_W * 1.15);

    rig.position.y = floorTop * s;
    if (S.sleeping) { S.x = homeX; }
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

    const a = S.sleeping ? 1 : acc / FIXED;
    tv.body.position.x = prev.x + (S.x - prev.x) * a;
    tv.body.position.y = prev.y + (S.y - prev.y) * a;
    tv.body.rotation.z = prev.th + (S.th - prev.th) * a;
    for (const ant of tv.antennas) ant.pivot.rotation.z = ant.a;

    // Чем выше корпус, тем шире и бледнее пятно
    const lift = Math.max(0, tv.body.position.y - HALF_H);
    const k = 1 / (1 + lift * 1.1);
    shadow.position.x = tv.body.position.x;
    shadow.position.y = 0.02;
    shadow.scale.set(0.85 + (1 - k) * 0.5, 0.20 + (1 - k) * 0.12, 1);
    shadowMat.opacity = (pal.dark ? 0.30 : 0.42) * k;

    updateScreen(dtReal, clock);
    renderer.render(scene, camera);
  }

  function start() {
    if (running || !visible || !onScreen) return;
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
  window.addEventListener('deviceorientation', onOrient, { passive: true });
  darkMq.addEventListener('change', onScheme);

  layout();
  refreshTheme();
  S.x = homeX;
  prev.x = S.x;
  start();

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
      window.removeEventListener('deviceorientation', onOrient);
      darkMq.removeEventListener('change', onScheme);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      for (const d of tv.disposables) d.dispose();
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
      reset() {
        S.x = homeX; S.y = HALF_H; S.th = 0;
        S.vx = S.vy = S.om = 0;
        prev = { x: S.x, y: S.y, th: S.th };
        power = 0; flashV = 0; roll = 0; rollV = 0;
        wake();
      },
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
