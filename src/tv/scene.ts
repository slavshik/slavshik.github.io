/*
 * Сборка телевизора целиком: корпус из cabinet.ts плюс провод, вилка,
 * рейкаст-прокси и тени.
 *
 * Геометрия целиком процедурная, файлов моделей нет.
 */

import * as THREE from 'three';

import { buildCabinet, buildMaterials, type AntennaPart, type Disposable } from './cabinet.js';
import { BODY_D, BODY_H, BODY_W, FOOT_H, ROPE_Z } from './constants.js';
import { LOOK } from './look.js';
import type { Palette } from './palette.js';
import { braidTexture, makeRopeMesh } from './rope-view.js';

export type { AntennaPart } from './cabinet.js';

export interface TvParts {
	body: THREE.Group;
	tilt: THREE.Group;
	screen: THREE.Mesh;
	screenMat: THREE.ShaderMaterial;
	screenGlass: THREE.Mesh;
	glow: THREE.PointLight;
	antennas: AntennaPart[];
	proxy: THREE.Mesh;
	/** Мишень под палец на вилке: рейкаст ходит по ней, а не по вилке. */
	plugProxy: THREE.Mesh;
	disposables: Disposable[];
	ropeMesh: THREE.Mesh;
	ropeGeo: THREE.BufferGeometry;
	plug: THREE.Group;
}

/** Точка на ребре from→to, отступив от from на r (но не дальше середины). */
function alongEdge(from: [number, number], to: [number, number], r: number): [number, number] {
	const dx = to[0] - from[0];
	const dy = to[1] - from[1];
	const len = Math.hypot(dx, dy) || 1;
	const k = Math.min(r, len / 2) / len;
	return [from[0] + dx * k, from[1] + dy * k];
}

/** Многоугольник со скруглёнными углами: угол становится квадратичной кривой. */
function roundedPoly(pts: [number, number][], r: number): THREE.Shape {
	const shape = new THREE.Shape();
	const n = pts.length;
	for (let i = 0; i < n; i++) {
		const cur = pts[i]!;
		const a = alongEdge(cur, pts[(i - 1 + n) % n]!, r);
		const b = alongEdge(cur, pts[(i + 1) % n]!, r);
		if (i === 0) shape.moveTo(a[0], a[1]);
		else shape.lineTo(a[0], a[1]);
		shape.quadraticCurveTo(cur[0], cur[1], b[0], b[1]);
	}
	shape.closePath();
	return shape;
}

export function shadowTexture(): THREE.CanvasTexture {
	const c = document.createElement('canvas');
	c.width = c.height = 128;
	const ctx = c.getContext('2d')!;
	const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
	g.addColorStop(0, 'rgba(0,0,0,0.55)');
	g.addColorStop(0.55, 'rgba(0,0,0,0.22)');
	g.addColorStop(1, 'rgba(0,0,0,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 128, 128);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.NoColorSpace;
	return tex;
}

export function buildTV(pal: Palette): TvParts {
	const mats = buildMaterials(pal, LOOK.materials);
	const cab = buildCabinet(LOOK.shape, mats, pal.accent, LOOK.grain);
	const disposables: Disposable[] = [...mats.disposables, ...cab.disposables];
	const keep = <T extends Disposable>(x: T): T => (disposables.push(x), x);

	const { metal: matMetal, cord: matCord, plug: matPlug, knob: matKnob } = mats.roles;

	/* Вилка на конце провода. Висит в воздухе и никуда не воткнута — при этом
     экран работает. Ради этой шутки провод и заведён.

     Форма советская, узнаваемая: круглое основание, а за ним не цилиндр, а
     ПЛОСКАЯ лопатка, сужающаяся к проводу. Оттого вилка и выглядит с одного
     бока треугольной, а с другого — тонкой пластиной. Цилиндр, который тут
     стоял раньше, эту породу терял начисто: с любой стороны он одинаковый.

     Плоскость — не мелочь, а то, ради чего всё: вилку каждый кадр доворачивает
     вокруг Z (index.ts), в плоскости XY, поэтому широкая грань всегда против
     камеры. Штыри разведены по X, то есть лежат в той же плоскости, что и
     лопатка, — как на настоящей. */
	const plug = new THREE.Group();

	// Лопатка: скруглённая трапеция, выдавленная по Z с фаской. У тарелки она
	// почти во всю её ширину, к проводу сужается вдвое с лишним.
	const bodyShape = roundedPoly(
		[
			[-0.072, -0.108],
			[0.072, -0.108],
			[0.032, 0.058],
			[-0.032, 0.058],
		],
		0.026,
	);
	const bodyGeo = keep(
		new THREE.ExtrudeGeometry(bodyShape, {
			depth: 0.05,
			bevelEnabled: true,
			bevelSize: 0.014,
			bevelThickness: 0.014,
			bevelSegments: 4,
			curveSegments: 12,
		}),
	);
	// Выдавливание идёт от нуля вперёд, а вилке нужно стоять серединой в
	// плоскости провода: иначе она висит сбоку от него.
	bodyGeo.translate(0, 0, -0.025);
	plug.add(new THREE.Mesh(bodyGeo, matPlug));

	// Круглое основание: тонкая тарелка чуть шире лопатки — из неё штыри
	const disc = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.098, 0.094, 0.022, 40)), matPlug);
	disc.position.y = -0.114;
	plug.add(disc);

	/* Винт стяжки: ровно между штырями по X, посреди лопатки по Y и осью
     ПОПЕРЁК штырей — он держит две половинки корпуса, а те разъединяются по
     плоскости лопатки. Головка выступает над гранью: заподлицо от неё на
     этом размере не осталось бы ничего. */
	const screw = new THREE.Mesh(
		keep(new THREE.CylinderGeometry(0.021, 0.021, 0.014, 16)),
		matMetal,
	);
	screw.rotation.x = Math.PI / 2;
	screw.position.set(0, -0.042, 0.042);
	plug.add(screw);
	const slot = new THREE.Mesh(keep(new THREE.BoxGeometry(0.026, 0.005, 0.005)), matKnob);
	slot.position.set(0, -0.042, 0.0475);
	plug.add(slot);

	// Штыри — латунь, с закруглёнными концами
	const prongGeo = keep(new THREE.CylinderGeometry(0.015, 0.015, 0.1, 18));
	prongGeo.translate(0, -0.05, 0);
	const prongCapGeo = keep(new THREE.SphereGeometry(0.015, 18, 12));
	for (const sx of [-1, 1]) {
		const prong = new THREE.Mesh(prongGeo, matMetal);
		prong.position.set(sx * 0.043, -0.125, 0);
		plug.add(prong);
		const cap = new THREE.Mesh(prongCapGeo, matMetal);
		cap.position.set(sx * 0.043, -0.225, 0);
		plug.add(cap);
	}

	/* Вилка нарочно крупнее натуральной: по габаритам корпуса ей полагается
     около двадцати пикселей, а на таком размере форма не работает вовсе. */
	plug.scale.setScalar(1.45);
	plug.position.z = ROPE_Z;

	/* Мишень, за которую вилку берут пальцем. Шар, а не сама вилка: та собрана
     из десятка мелких мешей с фасками, рейкаст по ним и дороже, и норовит
     провалиться между штырями.

     Радиус задан пальцем, а не вилкой. Вилка на экране — 54 px в высоту и 36
     в ширину на ноутбуке и заметно меньше на телефоне, а палец меньше сорока
     четырёх не бывает; отсюда 0.20, что даёт круг в 54 px на телефоне и 68
     на ноутбуке. Промахнуться таким запасом некуда: вилка висит ниже
     корпуса, в пустоте, и брать там больше нечего. Центр — посередине
     вилки, между тарелкой и лопаткой, а не в начале координат группы. */
	const plugProxy = new THREE.Mesh(
		keep(new THREE.SphereGeometry(0.2, 8, 6)),
		keep(new THREE.MeshBasicMaterial({ visible: false })),
	);
	plugProxy.position.y = -0.09;
	plug.add(plugProxy);

	// Невидимый прокси под рейкаст: один бокс вместо двадцати мешей.
	// Габариты — из constants.ts, как и у физики: прокси обязан накрывать
	// ровно тот корпус, который она считает.
	const proxyGeo = keep(new THREE.BoxGeometry(BODY_W, BODY_H + FOOT_H, BODY_D));
	const proxy = new THREE.Mesh(proxyGeo, keep(new THREE.MeshBasicMaterial({ visible: false })));
	proxy.position.y = -FOOT_H / 2;

	const body = new THREE.Group();
	body.add(cab.tilt, proxy);

	// Провод живёт не в body: его точки считаются сразу в координатах rig,
	// а якорь берётся от корпуса. Иначе пришлось бы гонять их через матрицу
	// вращающегося родителя туда и обратно каждый кадр.
	// Цвет оплётки живёт в текстуре, а не в материале: у нити и у пунктира
	// он разный, а color у материала один на всех. Анизотропию ставит
	// index.ts — про renderer тут не знают.
	matCord.map = keep(braidTexture(LOOK.cord));

	const ropeParts = makeRopeMesh(matCord);

	return {
		body,
		tilt: cab.tilt,
		screen: cab.screen,
		screenMat: cab.screenMat,
		screenGlass: cab.screenGlass,
		glow: cab.glow,
		antennas: cab.antennas,
		proxy,
		plugProxy,
		disposables,
		ropeMesh: ropeParts.mesh,
		ropeGeo: ropeParts.geo,
		plug,
	};
}
