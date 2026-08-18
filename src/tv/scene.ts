/*
 * Сборка корпуса: вся геометрия телевизора и его тени.
 *
 * Геометрия целиком процедурная, файлов моделей нет.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import { BODY_D, BODY_H, BODY_W, FOOT_H, ROPE_N, ROPE_R, ROPE_RAD, ROPE_Z } from './constants.js';
import type { Palette, PaletteRole } from './palette.js';
import type { Rope } from './physics.js';
import { SCREEN_FRAG, SCREEN_VERT } from './shaders.js';

interface Disposable {
  dispose(): void;
}

/** Антенна: угол и угловая скорость живут в физике, поворот — здесь. */
export interface AntennaPart {
  pivot: THREE.Group;
  a: number;
  av: number;
  side: number;
}

export interface TvParts {
  body: THREE.Group;
  tilt: THREE.Group;
  screen: THREE.Mesh;
  screenMat: THREE.ShaderMaterial;
  glow: THREE.PointLight;
  antennas: AntennaPart[];
  proxy: THREE.Mesh;
  disposables: Disposable[];
  ropeMesh: THREE.Mesh;
  ropeGeo: THREE.BufferGeometry;
  plug: THREE.Group;
}

function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
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
// Во сколько раз корпус ужат на данной глубине. Вынесено из taperShell:
// сужение идёт и по ширине, и по высоте, поэтому дно у затылка заметно выше
// нуля, и всё, что крепится снизу, обязано это учитывать.
export function taperAt(z: number): number {
  return 0.84 + 0.16 * THREE.MathUtils.smoothstep(z, -BODY_D * 0.5, BODY_D * 0.34);
}

function taperShell(geo: THREE.BufferGeometry): void {
  const pos = geo.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const k = taperAt(z);
    pos.setX(i, pos.getX(i) * k);
    pos.setY(i, pos.getY(i) * k);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

// Стекло кинескопа: произведение двух квадратик — ровно форма реальной
// маски трубки. Радиальная формула тут не годится: она уходит в ноль по
// окружности, и углы экрана проваливаются внутрь корпуса.
function bulgeScreen(geo: THREE.BufferGeometry, amount: number): void {
  const pos = geo.attributes.position!;
  const uv = geo.attributes.uv!;
  for (let i = 0; i < pos.count; i++) {
    const u = (uv.getX(i) - 0.5) * 2;
    const v = (uv.getY(i) - 0.5) * 2;
    const z = Math.pow(1 - u * u, 0.8) * Math.pow(1 - v * v, 0.8);
    pos.setZ(i, amount * (Number.isFinite(z) ? z : 0));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

// Трубка вдоль цепочки. Геометрия создаётся один раз, каждый кадр
// переписываются только позиции и нормали — новых аллокаций нет.
function makeRopeMesh(mat: THREE.Material): { mesh: THREE.Mesh; geo: THREE.BufferGeometry } {
  const verts = ROPE_N * ROPE_R;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  const idx: number[] = [];
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

export function updateRopeMesh(geo: THREE.BufferGeometry, rope: Rope): void {
  const pos = (geo.attributes.position as THREE.BufferAttribute).array as Float32Array;
  const nrm = (geo.attributes.normal as THREE.BufferAttribute).array as Float32Array;
  const p = rope.p;
  for (let i = 0; i < ROPE_N; i++) {
    // Касательная по соседям, нормаль — перпендикуляр в той же плоскости
    const i0 = Math.max(0, i - 1) * 2;
    const i1 = Math.min(ROPE_N - 1, i + 1) * 2;
    let tx = p[i1]! - p[i0]!;
    let ty = p[i1 + 1]! - p[i0 + 1]!;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const nx = -ty;
    const ny = tx; // в плоскости XY
    const cx = p[i * 2]!;
    const cy = p[i * 2 + 1]!;
    for (let j = 0; j < ROPE_R; j++) {
      const a = (j / ROPE_R) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const ux = nx * ca;
      const uy = ny * ca;
      const uz = sa; // бинормаль = ось Z
      const o = (i * ROPE_R + j) * 3;
      pos[o] = cx + ux * ROPE_RAD;
      pos[o + 1] = cy + uy * ROPE_RAD;
      pos[o + 2] = ROPE_Z + uz * ROPE_RAD;
      nrm[o] = ux;
      nrm[o + 1] = uy;
      nrm[o + 2] = uz;
    }
  }
  geo.attributes.position!.needsUpdate = true;
  geo.attributes.normal!.needsUpdate = true;
}

export function shadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function buildTV(pal: Palette): TvParts {
  const disposables: Disposable[] = [];
  const keep = <T extends Disposable>(x: T): T => (disposables.push(x), x);

  // role — имя ключа в палитре. По нему refreshTheme перекрашивает материал,
  // когда меняется системная тема или акцент времени суток.
  const plastic = (
    role: PaletteRole,
    extra?: THREE.MeshStandardMaterialParameters,
  ): THREE.MeshStandardMaterial => {
    const m = keep(
      new THREE.MeshStandardMaterial(
        Object.assign(
          { color: new THREE.Color(pal[role]), roughness: 0.58, metalness: 0.05 },
          extra,
        ),
      ),
    );
    m.userData.role = role;
    return m;
  };

  // Матовый пластик без бликов — так игрушка читается силуэтом и цветом,
  // а не отражениями.
  const matShell = plastic('shell', { roughness: 0.85 });
  const matBezel = plastic('bezel', { roughness: 0.9 });
  const matKnob = plastic('knob', { roughness: 0.8 });
  // Металл на игрушке ровно в двух местах: колена антенн и штыри вилки.
  // Блики им оставлены нарочно — матовая сталь читается крашеным пластиком.
  const matSteel = plastic('steel', { roughness: 0.32, metalness: 0.8 });
  const matMetal = plastic('metal', { roughness: 0.34, metalness: 0.85 });
  const matCord = plastic('cord', { roughness: 0.85 });
  const matPlug = plastic('plug', { roughness: 0.85 });

  // tilt — постоянный разворот на три четверти. Физика крутит только
  // родителя вокруг Z, поэтому проекция экрана остаётся ортогональной и
  // пересчёт «экранные пиксели ↔ мир» остаётся тривиальным.
  const tilt = new THREE.Group();
  tilt.rotation.set(-0.07, -0.54, 0);

  // Углы скруглены крупно — главный приём игрушечного силуэта
  const shellGeo = keep(new RoundedBoxGeometry(BODY_W, BODY_H, BODY_D, 4, 0.15));
  taperShell(shellGeo);
  tilt.add(new THREE.Mesh(shellGeo, matShell));

  // Рамка по центру и во всю ширину фасада: ручек справа больше нет, панель
  // под них не нужна. До самого края корпуса не доходит нарочно — рамка
  // стоит плитой на z=0.405, а фасад к краям заворачивается скруглением, и
  // у самых краёв плита повисла бы в воздухе перед корпусом.
  // Высота прежняя: сверху и снизу корпус скруглён так же, и рамка повыше
  // вылезала бы углами за силуэт.
  const BX = 0;
  const bezelShape = roundedRect(0.98, 0.66, 0.13);
  bezelShape.holes.push(roundedRect(0.84, 0.52, 0.1));
  const bezelGeo = keep(
    new THREE.ExtrudeGeometry(bezelShape, {
      depth: 0.07,
      bevelEnabled: true,
      bevelSize: 0.012,
      bevelThickness: 0.012,
      bevelSegments: 2,
    }),
  );
  const bezel = new THREE.Mesh(bezelGeo, matBezel);
  // Порядок по глубине: передняя грань корпуса 0.40 → стекло от 0.41 →
  // рамка 0.405…0.475. Стекло обязано начинаться впереди корпуса, иначе он
  // его перекрывает и от картинки остаётся только выпуклая середина.
  bezel.position.set(BX, 0, 0.405);
  tilt.add(bezel);

  // Экран чуть больше отверстия: край уходит под рамку, стыка не видно.
  // Купол сильный и вылезает за рамку — колба выпучена наружу.
  const screenGeo = keep(new THREE.PlaneGeometry(0.86, 0.54, 28, 20));
  bulgeScreen(screenGeo, 0.17);
  const screenMat = keep(
    new THREE.ShaderMaterial({
      vertexShader: SCREEN_VERT,
      fragmentShader: SCREEN_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uRoll: { value: 0 },
        uAccent: { value: new THREE.Color(pal.accent) },
      },
    }),
  );
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.set(BX, 0, 0.41);
  screen.scale.y = 0.02; // розжиг растянет до 1
  tilt.add(screen);

  // Свет трубки, падающий на рамку изнутри
  const glow = new THREE.PointLight(new THREE.Color(pal.accent), 0, 1.4, 2);
  glow.position.set(BX, 0, 0.62);
  tilt.add(glow);

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
    matKnob,
  );
  antBase.scale.set(1, 0.42, 1);
  antBase.position.set(0, BODY_H / 2 + 0.015, ANT_Z);
  tilt.add(antBase);

  const ANT_Y = BODY_H / 2 + 0.075;

  const antScrew = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(0.019, 0.026, 0.05, 8)),
    matSteel,
  );
  antScrew.position.set(0, ANT_Y + 0.012, ANT_Z);
  tilt.add(antScrew);

  // Колена: снизу толстое и короткое, кверху тоньше и длиннее — так выглядит
  // выдвинутая антенна, у которой секции входят одна в другую.
  const SEG_R = [0.021, 0.0155, 0.0105];
  const SEG_PART = [0.28, 0.33, 0.39];

  const antennas: AntennaPart[] = [];
  const antSpec = [
    { side: -1, len: 0.56, splay: 0.15, back: -0.09 },
    { side: 1, len: 0.49, splay: 0.11, back: -0.06 },
  ];
  for (const spec of antSpec) {
    const pivot = new THREE.Group(); // сюда пишет пружина
    pivot.position.set(spec.side * 0.05, ANT_Y, ANT_Z);
    const arm = new THREE.Group(); // постоянный развал «ушей»
    // Знак минус обязателен: поворот вокруг Z уводит верх штыря в -X, и без
    // него левый рожок валится вправо, правый влево, и они складываются
    // крестом. Развал должен разводить их в стороны, а не сводить.
    arm.rotation.set(spec.back, 0, -spec.side * spec.splay);

    let y = 0;
    for (let i = 0; i < SEG_R.length; i++) {
      const h = spec.len * SEG_PART[i]!;
      const segGeo = keep(new THREE.CylinderGeometry(SEG_R[i]! * 0.9, SEG_R[i]!, h, 8));
      segGeo.translate(0, h / 2, 0);
      const seg = new THREE.Mesh(segGeo, matSteel);
      seg.position.y = y;
      arm.add(seg);
      // Обжимка на стыке: без неё три цилиндра читаются одним конусом
      if (i) {
        const ring = new THREE.Mesh(
          keep(new THREE.CylinderGeometry(SEG_R[i]! * 1.45, SEG_R[i]! * 1.45, 0.014, 8)),
          matSteel,
        );
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
  const footGeo = keep(new THREE.CylinderGeometry(0.03, 0.026, FOOT_H, 8));
  // Каждая ножка садится по своей глубине: корпус к затылку ужат, и дно там
  // выше. По номинальной высоте задняя пара висела в воздухе с зазором в
  // полножки. По X сужение учитывается тоже, иначе задние уезжают из-под
  // корпуса наружу.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const z = sz * 0.26;
      const k = taperAt(z);
      const f = new THREE.Mesh(footGeo, matKnob);
      f.position.set(sx * 0.4 * k, (-BODY_H / 2) * k - FOOT_H / 2 + 0.012, z);
      tilt.add(f);
    }
  }

  /* Вилка на конце провода. Висит в воздухе и никуда не воткнута — при этом
     экран работает. Ради этой шутки провод и заведён.
     Круглая и чёрная, с рёбрами под пальцы и латунными штырями. */
  const plug = new THREE.Group();

  const plugBody = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(0.07, 0.082, 0.155, 16)),
    matPlug,
  );
  plugBody.position.y = -0.02;
  plug.add(plugBody);

  // Рёбра под пальцы: восьми хватает, чтобы силуэт перестал быть гладким
  const ribGeo = keep(new THREE.BoxGeometry(0.012, 0.1, 0.016));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rib = new THREE.Mesh(ribGeo, matPlug);
    rib.position.set(Math.cos(a) * 0.074, -0.02, Math.sin(a) * 0.074);
    rib.rotation.y = Math.PI / 2 - a;
    plug.add(rib);
  }

  // Фланец — диск у основания штырей
  const flange = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.093, 0.093, 0.028, 18)), matPlug);
  flange.position.y = -0.111;
  plug.add(flange);

  // Штыри — латунь, с закруглёнными концами
  const prongGeo = keep(new THREE.CylinderGeometry(0.017, 0.017, 0.115, 10));
  prongGeo.translate(0, -0.0575, 0);
  const prongCapGeo = keep(new THREE.SphereGeometry(0.017, 10, 8));
  for (const sx of [-1, 1]) {
    const prong = new THREE.Mesh(prongGeo, matMetal);
    prong.position.set(sx * 0.04, -0.125, 0);
    plug.add(prong);
    const cap = new THREE.Mesh(prongCapGeo, matMetal);
    cap.position.set(sx * 0.04, -0.24, 0);
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
    body,
    tilt,
    screen,
    screenMat,
    glow,
    antennas,
    proxy,
    disposables,
    ropeMesh: ropeParts.mesh,
    ropeGeo: ropeParts.geo,
    plug,
  };
}
