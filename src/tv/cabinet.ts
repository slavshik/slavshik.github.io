/*
 * Корпус: геометрия и материалы телевизора, собранные по спеке облика.
 *
 * Фабрики с явными аргументами (как велит ADR-0005): спека и палитра
 * внутрь, группа наружу. Ни провода, ни вилки, ни прокси — только то, что
 * зритель называет «сам телевизор». Всё остальное собирает scene.ts.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import type { BodyRole, GrainSpec, MaterialSpec, ShapeSpec } from './look.js';
import type { Palette } from './palette.js';
import { BLOOM_LAYER } from './bloom.js';
import { SCREEN_FRAG, SCREEN_VERT } from './shaders.js';

export interface Disposable {
	dispose(): void;
}

/** Антенна: угол и угловая скорость живут в физике, поворот — здесь. */
export interface AntennaPart {
	pivot: THREE.Group;
	a: number;
	av: number;
	side: number;
}

export interface Materials {
	roles: Record<BodyRole, THREE.MeshPhysicalMaterial>;
	disposables: Disposable[];
}

export interface Cabinet {
	tilt: THREE.Group;
	screen: THREE.Mesh;
	screenMat: THREE.ShaderMaterial;
	/** Прозрачный отражающий купол поверх люминофора. */
	screenGlass: THREE.Mesh;
	glow: THREE.PointLight;
	antennas: AntennaPart[];
	/** Вся антенная надстройка одним узлом: блюдце, винт и оба рожка. */
	antennaGroup: THREE.Group;
	disposables: Disposable[];
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
export function taperAt(z: number, spec: ShapeSpec): number {
	const { min, start, end } = spec.taper;
	return min + (1 - min) * THREE.MathUtils.smoothstep(z, spec.body.d * start, spec.body.d * end);
}

function taperShell(geo: THREE.BufferGeometry, spec: ShapeSpec): void {
	const pos = geo.attributes.position!;
	for (let i = 0; i < pos.count; i++) {
		const z = pos.getZ(i);
		const k = taperAt(z, spec);
		pos.setX(i, pos.getX(i) * k);
		pos.setY(i, pos.getY(i) * k);
	}
	pos.needsUpdate = true;
	geo.computeVertexNormals();
}

// Стекло кинескопа: произведение двух квадратик — ровно форма реальной
// маски трубки. Радиальная формула тут не годится: она уходит в ноль по
// окружности, и углы экрана проваливаются внутрь корпуса.
function bulgeScreen(geo: THREE.BufferGeometry, amount: number, power: number): void {
	const pos = geo.attributes.position!;
	const uv = geo.attributes.uv!;
	for (let i = 0; i < pos.count; i++) {
		const u = (uv.getX(i) - 0.5) * 2;
		const v = (uv.getY(i) - 0.5) * 2;
		const z = Math.pow(1 - u * u, power) * Math.pow(1 - v * v, power);
		pos.setZ(i, amount * (Number.isFinite(z) ? z : 0));
	}
	pos.needsUpdate = true;
	geo.computeVertexNormals();
}

/* ── Шероховатость корпуса ──────────────────────────────────────────────
 *
 * Клеточный шум, он же Вороной: по плитке рассыпаны точки, высота в текселе —
 * расстояние до ближайшей. Там, где две точки равноудалены, идёт складка, и
 * складка эта резкая — потому поверхность и читается зернистой.
 *
 * Первым тут стояло сглаженное значение-шум, и оно давало мутную кашу:
 * интерполяция Эрмита округляет всё до мягких бугров, у которых нет граней,
 * а без граней нормаль меняется плавно и блик по ней не дробится, а
 * размазывается. Клеточный шум даёт ровно то, чего не хватало, — края.
 *
 * Точки берутся из 3×3 соседних ячеек: ближайшая может лежать и в соседней.
 * Индекс ячейки замыкается по модулю, а координата точки считается от
 * незамкнутого индекса — так плитка сходится сама с собой без разрыва поля.
 */
function latticeHash(x: number, y: number, seed: number): number {
	const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
	return n - Math.floor(n);
}

function cellNoise(u: number, v: number, cells: number, seed: number): number {
	const x = u * cells;
	const y = v * cells;
	const xi = Math.floor(x);
	const yi = Math.floor(y);
	let best = 4;
	for (let j = -1; j <= 1; j++) {
		for (let i = -1; i <= 1; i++) {
			const cx = xi + i;
			const cy = yi + j;
			const wx = ((cx % cells) + cells) % cells;
			const wy = ((cy % cells) + cells) % cells;
			const fx = cx + latticeHash(wx, wy, seed);
			const fy = cy + latticeHash(wx, wy, seed + 11);
			const d = (fx - x) * (fx - x) + (fy - y) * (fy - y);
			if (d < best) best = d;
		}
	}
	return Math.min(1, Math.sqrt(best));
}

/**
 * Карта нормалей шероховатости.
 *
 * Высота — клеточный шум двух масштабов плюс щепоть попиксельного шума: он
 * сидит на самом мелком масштабе, какой вообще есть у текстуры, и добавляет
 * ту микрозернистость, которой не даст никакая решётка.
 *
 * Нормаль — наклон поля по X и Y конечными разностями, третья компонента
 * единица, всё нормируется и пакуется в RGB сдвигом на половину. Соседи
 * берутся по модулю стороны: иначе по краю плитки нормаль ломается, и шов
 * видно именно на бликах — там, где эта карта и работает.
 */
export function grainTexture(spec: GrainSpec): THREE.CanvasTexture {
	const S = spec.size;
	const c = document.createElement('canvas');
	c.width = c.height = S;
	const ctx = c.getContext('2d')!;

	const h = new Float32Array(S * S);
	for (let y = 0; y < S; y++) {
		for (let x = 0; x < S; x++) {
			const u = x / S;
			const v = y / S;
			h[y * S + x] =
				cellNoise(u, v, spec.cells, 1) * 0.6 +
				cellNoise(u, v, spec.cells * 2, 5) * 0.28 +
				latticeHash(x, y, 17) * 0.12;
		}
	}

	const img = ctx.createImageData(S, S);
	const d = img.data;
	const wrap = (i: number): number => ((i % S) + S) % S;
	for (let y = 0; y < S; y++) {
		for (let x = 0; x < S; x++) {
			const dx = (h[y * S + wrap(x + 1)]! - h[y * S + wrap(x - 1)]!) * spec.relief;
			const dy = (h[wrap(y + 1) * S + x]! - h[wrap(y - 1) * S + x]!) * spec.relief;
			const len = Math.hypot(dx, dy, 1);
			const o = (y * S + x) * 4;
			d[o] = Math.round((-dx / len) * 127.5 + 127.5);
			d[o + 1] = Math.round((-dy / len) * 127.5 + 127.5);
			d[o + 2] = Math.round((1 / len) * 127.5 + 127.5);
			d[o + 3] = 255;
		}
	}
	ctx.putImageData(img, 0, 0);

	const tex = new THREE.CanvasTexture(c);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.repeat.set(spec.repeat, spec.repeat);
	// Карта нормалей — не цвет: через передаточную функцию её гнать нельзя,
	// иначе наклоны поедут и рельеф станет несимметричным.
	tex.colorSpace = THREE.NoColorSpace;
	// Бок корпуса виден под скользящим углом, и без анизотропии зерно там
	// замывается мипмапом в гладкую полосу — ровно там, где оно нужнее всего.
	//
	// Шестнадцать, а не восемь: на развороте в три четверти бок сжат по
	// горизонтали примерно всемеро против своей высоты, и восьми ступеней
	// хватало только пока зерно было вдвое крупнее. Стоило удвоить repeat —
	// бок вылизался в гладкий пластик при живом зерне на фасаде и крышке.
	// three сам обрежет число по возможностям видеокарты, так что просить
	// больше, чем она умеет, безопасно.
	tex.anisotropy = 16;
	return tex;
}

export function buildMaterials(pal: Palette, spec: Record<BodyRole, MaterialSpec>): Materials {
	const disposables: Disposable[] = [];
	const roles = {} as Record<BodyRole, THREE.MeshPhysicalMaterial>;
	for (const role of Object.keys(spec) as BodyRole[]) {
		const s = spec[role];
		const m = new THREE.MeshPhysicalMaterial({
			// Цвет — из палитры, а не из спеки: палитра и сеет его из спеки, и
			// умеет перекрасить по роли, когда меняется тема. userData.role — имя
			// ключа, по которому refreshTheme находит материал.
			color: new THREE.Color(pal[role]),
			roughness: s.roughness,
			metalness: s.metalness,
			clearcoat: s.clearcoat,
			clearcoatRoughness: s.clearcoatRoughness,
			specularIntensity: s.specularIntensity,
			// Бок корпуса — большое ровное пятно с плавным затуханием, и в
			// восьми битах на канал по нему идут полосы. Дизеринг разбивает их
			// шумом в пол-единицы.
			dithering: true,
		});
		m.userData.role = role;
		disposables.push(m);
		roles[role] = m;
	}
	return { roles, disposables };
}

export function buildCabinet(
	spec: ShapeSpec,
	mats: Materials,
	accent: string,
	grain: GrainSpec,
): Cabinet {
	const disposables: Disposable[] = [];
	const keep = <T extends Disposable>(x: T): T => (disposables.push(x), x);
	const { shell, bezel: bezelMat, knob, steel } = mats.roles;

	// tilt — постоянный разворот на три четверти. Физика крутит только
	// родителя вокруг Z, поэтому проекция экрана остаётся ортогональной и
	// пересчёт «экранные пиксели ↔ мир» остаётся тривиальным.
	const tilt = new THREE.Group();
	// Наклон по X положительный: смотрим на игрушку чуть сверху, крышку с
	// блюдцем антенн видно, днище — нет. Снизу смотреть не на что.
	tilt.rotation.set(spec.tilt.x, spec.tilt.y, 0);

	const shellGeo = keep(
		new RoundedBoxGeometry(
			spec.body.w,
			spec.body.h,
			spec.body.d,
			spec.body.roundSegs,
			spec.body.round,
		),
	);
	taperShell(shellGeo, spec);

	/* Шероховатость — только корпусу. Рамка, ручки и хром остаются гладкими:
	   это разные материалы, и красить их одним зерном значит стирать разницу.

	   Лак поверх (clearcoat) нарочно остаётся ровным: у крашеного бакелита
	   шероховатая краска под гладкой плёнкой, и блик обязан скользить по
	   плёнке, а не дробиться о зерно.

	   Касательные под карту нормалей three считает производными в шейдере,
	   поэтому атрибут tangent геометрии не нужен. */
	if (grain.scale > 0) {
		shell.normalMap = keep(grainTexture(grain));
		shell.normalScale.setScalar(grain.scale);
	}
	tilt.add(new THREE.Mesh(shellGeo, shell));

	// Волосяной паз выдаёт, что корпус собран из двух отформованных
	// половин, а не вырезан из одного куска. Кольцо стоит внутри силуэта:
	// снаружи остаётся только тёмная щель, а не второй корпус.
	const seamK = taperAt(spec.details.seamZ, spec);
	const seamOuter = roundedRect(
		spec.body.w * seamK - 0.006,
		spec.body.h * seamK - 0.006,
		spec.body.round * seamK,
	);
	seamOuter.holes.push(
		roundedRect(
			spec.body.w * seamK - 0.018,
			spec.body.h * seamK - 0.018,
			spec.body.round * seamK - 0.006,
		),
	);
	const seamGeo = keep(
		new THREE.ExtrudeGeometry(seamOuter, {
			depth: spec.details.seamWidth,
			bevelEnabled: false,
			curveSegments: 12,
		}),
	);
	const seam = new THREE.Mesh(seamGeo, knob);
	seam.position.z = spec.details.seamZ - spec.details.seamWidth / 2;
	tilt.add(seam);

	// Щели вентиляции лежат чуть над крышкой: это тёмные углубления,
	// а не накладная решётка. Одна общая геометрия держит их дешёвыми.
	const ventGeo = keep(new THREE.BoxGeometry(spec.details.ventW, 0.006, spec.details.ventD));
	for (let i = -2; i <= 2; i++) {
		const vent = new THREE.Mesh(ventGeo, knob);
		vent.position.set(
			i * spec.details.ventGap,
			(spec.body.h / 2) * taperAt(spec.details.ventZ, spec) + 0.001,
			spec.details.ventZ,
		);
		tilt.add(vent);
	}

	// Рамка по центру и во всю ширину фасада: ручек справа больше нет, панель
	// под них не нужна. До самого края корпуса не доходит нарочно — рамка
	// стоит плитой перед фасадом, а фасад к краям заворачивается скруглением,
	// и у самых краёв плита повисла бы в воздухе перед корпусом.
	// Высота прежняя: сверху и снизу корпус скруглён так же, и рамка повыше
	// вылезала бы углами за силуэт.
	const bezelShape = roundedRect(spec.bezel.w, spec.bezel.h, spec.bezel.r);
	bezelShape.holes.push(roundedRect(spec.bezel.holeW, spec.bezel.holeH, spec.bezel.holeR));
	const bezelGeo = keep(
		new THREE.ExtrudeGeometry(bezelShape, {
			depth: spec.bezel.depth,
			bevelEnabled: true,
			bevelSize: spec.bezel.bevel,
			bevelThickness: spec.bezel.bevel,
			bevelSegments: 3,
			// Скругления рамки заданы кривыми, и их дробность — здесь: по
			// умолчанию их двенадцать на кривую, и углы окна видны гранями.
			curveSegments: 32,
		}),
	);
	const bezel = new THREE.Mesh(bezelGeo, bezelMat);
	// Порядок по глубине: передняя грань корпуса 0.40 → стекло от 0.41 →
	// рамка 0.405…0.475. Стекло обязано начинаться впереди корпуса, иначе он
	// его перекрывает и от картинки остаётся только выпуклая середина.
	bezel.position.set(0, 0, spec.bezel.z);
	tilt.add(bezel);

	// Между лицевой рамкой и трубкой есть ещё одна, тёмная ступень. Она
	// даёт глубину даже тогда, когда сама кривизна стекла занимает всего пару пикселей.
	const lipShape = roundedRect(spec.bezel.holeW, spec.bezel.holeH, spec.bezel.holeR);
	lipShape.holes.push(roundedRect(spec.bezel.lipW, spec.bezel.lipH, spec.bezel.lipR));
	const lipGeo = keep(
		new THREE.ExtrudeGeometry(lipShape, {
			depth: spec.bezel.lipDepth,
			bevelEnabled: false,
			curveSegments: 24,
		}),
	);
	const lip = new THREE.Mesh(lipGeo, knob);
	lip.position.z = spec.bezel.z + spec.bezel.depth - spec.bezel.lipDepth * 1.5;
	tilt.add(lip);

	// Экран чуть больше отверстия: край уходит под рамку, стыка не видно.
	// Купол лишь слегка выходит за лицевую грань рамки: кривизна читается в
	// силуэте и отражениях, но не возвращается к исходной форме пузыря.
	const screenGeo = keep(new THREE.PlaneGeometry(spec.screen.w, spec.screen.h, 44, 32));
	bulgeScreen(screenGeo, spec.screen.bulge, spec.screen.power);
	// Заглушка под uTex: сэмплер обязан быть привязан к чему-то и тогда, когда
	// передачи нет. Один чёрный пиксель — при uTexMix = 0 он всё равно не
	// участвует в картинке.
	const blankTex = keep(new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1));
	blankTex.needsUpdate = true;

	const screenMat = keep(
		new THREE.ShaderMaterial({
			vertexShader: SCREEN_VERT,
			fragmentShader: SCREEN_FRAG,
			uniforms: {
				uTime: { value: 0 },
				uIntensity: { value: 0 },
				uRoll: { value: 0 },
				uAccent: { value: new THREE.Color(accent) },
				uTex: { value: blankTex },
				uTexMix: { value: 0 },
			},
		}),
	);
	const screen = new THREE.Mesh(screenGeo, screenMat);
	// Люминофор — единственное, что светится само. Слой сияния читает
	// именно его, поэтому пометка живёт тут, рядом с созданием меша.
	screen.layers.enable(BLOOM_LAYER);
	screen.position.set(0, 0, spec.screen.z);
	screen.scale.y = 0.02; // розжиг растянет до 1
	tilt.add(screen);

	// Картинка — светящийся люминофор, а отражения живут на отдельном куполе.
	// Если рисовать блик прямо в сигнале, он ездит вместе с изображением и не
	// реагирует ни на ракурс, ни на свет. Одна и та же геометрия гарантирует,
	// что стекло повторяет кривизну трубки; малый сдвиг разводит поверхности.
	const glassMat = keep(
		new THREE.MeshPhysicalMaterial({
			color: new THREE.Color(spec.screen.glassColor),
			roughness: spec.screen.glassRoughness,
			metalness: 0,
			ior: spec.screen.glassIor,
			specularIntensity: 1,
			clearcoat: 1,
			clearcoatRoughness: spec.screen.glassRoughness * 0.5,
			transparent: true,
			opacity: spec.screen.glassOpacity,
			depthWrite: false,
			dithering: true,
		}),
	);
	const screenGlass = new THREE.Mesh(screenGeo, glassMat);
	screenGlass.position.set(0, 0, spec.screen.z + spec.screen.glassOffset);
	screenGlass.scale.y = 0.02;
	screenGlass.renderOrder = 1;
	tilt.add(screenGlass);

	// Свет трубки, падающий на рамку изнутри
	const glow = new THREE.PointLight(new THREE.Color(accent), 0, spec.glow.dist, spec.glow.decay);
	glow.position.set(0, 0, spec.glow.z);
	tilt.add(glow);

	// Антенны — комнатные «рожки»: приплюснутое блюдце с хромированным винтом
	// по центру, из него два телескопических штыря узким домиком. У каждого
	// штыря свой шарнир, который догоняет корпус с запозданием. Геометрия колена
	// сдвинута так, что его низ лежит в начале координат — тогда наклон это
	// просто поворот группы, без тригонометрии на позицию (и без шанса
	// ошибиться в знаке).
	//
	// Блюдце стоит НА крышке и чуть ближе к переду: утопленное в корпус или
	// сдвинутое к затылку, оно с этого ракурса просто не видно.
	//
	// Вся надстройка собрана в свою группу без собственного преобразования:
	// на картинке это ничего не меняет, зато стенд облика гасит её одним
	// visible, когда нужно смотреть на корпус, а не на рожки.
	const antennaGroup = new THREE.Group();
	tilt.add(antennaGroup);
	const ant = spec.antennas;
	// Крышка на этой глубине ужата сужением корпуса, и её верх — не h / 2,
	// а h / 2 * taperAt(dish.z). По номинальной высоте блюдце висело над
	// корпусом с зазором, который стало видно, как только камера поднялась.
	// Небольшой утоп добавлен нарочно: стык двух матовых поверхностей впритык
	// даёт волосяную щель на просвет.
	const dishY = (spec.body.h / 2) * taperAt(spec.dish.z, spec) - spec.dish.sink;
	const antBase = new THREE.Mesh(
		keep(new THREE.SphereGeometry(spec.dish.r, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2)),
		knob,
	);
	antBase.scale.set(1, spec.dish.squash, 1);
	antBase.position.set(0, dishY, spec.dish.z);
	antennaGroup.add(antBase);

	// Шарнир — там же, где и был относительно блюдца: у его макушки.
	const antY = dishY + ant.pivotLift;

	const antScrew = new THREE.Mesh(
		keep(new THREE.CylinderGeometry(spec.screw.rTop, spec.screw.rBot, spec.screw.h, 20)),
		steel,
	);
	antScrew.position.set(0, antY + spec.screw.lift, spec.dish.z);
	antennaGroup.add(antScrew);

	// Колена: снизу толстое и короткое, кверху тоньше и длиннее — так выглядит
	// выдвинутая антенна, у которой секции входят одна в другую.
	const antennas: AntennaPart[] = [];
	for (const arm of ant.arms) {
		const pivot = new THREE.Group(); // сюда пишет пружина
		pivot.position.set(arm.side * ant.pivotX, antY, spec.dish.z);
		const armGroup = new THREE.Group(); // постоянный развал «ушей»
		// Знак минус обязателен: поворот вокруг Z уводит верх штыря в -X, и без
		// него левый рожок валится вправо, правый влево, и они складываются
		// крестом. Развал должен разводить их в стороны, а не сводить.
		armGroup.rotation.set(arm.back, 0, -arm.side * arm.splay);

		let y = 0;
		for (let i = 0; i < ant.segR.length; i++) {
			const h = arm.len * ant.segPart[i]!;
			const segGeo = keep(
				new THREE.CylinderGeometry(ant.segR[i]! * ant.segTop, ant.segR[i]!, h, 16),
			);
			segGeo.translate(0, h / 2, 0);
			const seg = new THREE.Mesh(segGeo, steel);
			seg.position.y = y;
			armGroup.add(seg);
			// Обжимка на стыке: без неё три цилиндра читаются одним конусом
			if (i) {
				const r = ant.segR[i]! * ant.crimpK;
				const ring = new THREE.Mesh(
					keep(new THREE.CylinderGeometry(r, r, ant.crimpH, 16)),
					steel,
				);
				ring.position.y = y;
				armGroup.add(ring);
			}
			y += h;
		}
		const tip = new THREE.Mesh(keep(new THREE.SphereGeometry(ant.tipR, 20, 14)), steel);
		tip.position.y = y;
		armGroup.add(tip);

		pivot.add(armGroup);
		antennaGroup.add(pivot);
		antennas.push({ pivot, a: 0, av: 0, side: arm.side });
	}

	// Ножки — минимальные, только чтобы корпус не лежал на полу брюхом
	const footGeo = keep(
		new THREE.CylinderGeometry(spec.feet.rTop, spec.feet.rBot, spec.feet.h, 20),
	);
	// Каждая ножка садится по своей глубине: корпус к затылку ужат, и дно там
	// выше. По номинальной высоте задняя пара висела в воздухе с зазором в
	// полножки. По X сужение учитывается тоже, иначе задние уезжают из-под
	// корпуса наружу.
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			const z = sz * spec.feet.z;
			const k = taperAt(z, spec);
			const f = new THREE.Mesh(footGeo, knob);
			f.position.set(
				sx * spec.feet.x * k,
				(-spec.body.h / 2) * k - spec.feet.h / 2 + spec.feet.lift,
				z,
			);
			tilt.add(f);
		}
	}

	return {
		tilt,
		screen,
		screenMat,
		screenGlass,
		glow,
		antennas,
		antennaGroup,
		disposables,
	};
}
