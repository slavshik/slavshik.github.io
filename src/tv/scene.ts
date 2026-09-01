/*
 * Сборка телевизора целиком: корпус из cabinet.ts плюс провод, вилка,
 * рейкаст-прокси и тени.
 *
 * Геометрия целиком процедурная, файлов моделей нет.
 */

import * as THREE from 'three';

import { buildCabinet, buildMaterials, type AntennaPart, type Disposable } from './cabinet.js';
import { BODY_D, BODY_H, BODY_W, FOOT_H, ROPE_N, ROPE_R, ROPE_RAD, ROPE_Z } from './constants.js';
import { LOOK, type CordSpec } from './look.js';
import type { Palette } from './palette.js';
import type { Rope, Twist } from './physics.js';

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
	disposables: Disposable[];
	ropeMesh: THREE.Mesh;
	ropeGeo: THREE.BufferGeometry;
	plug: THREE.Group;
}

// Колец в трубке столько же, сколько точек в цепочке, а столбцов на один
// больше радиальных сегментов. Лишний столбец лежит ровно на нулевом, но с
// u = 1 вместо u = 0: без него шов трубки протаскивал бы всю текстуру назад
// одним квадом, и по шнуру шла бы сплошная полоса.
const ROPE_COLS = ROPE_R + 1;

// Трубка вдоль цепочки. Геометрия создаётся один раз, каждый кадр
// переписываются только позиции и нормали — новых аллокаций нет. Развёртка
// статична: длина цепочки задана звеньями и не меняется.
function makeRopeMesh(mat: THREE.Material): { mesh: THREE.Mesh; geo: THREE.BufferGeometry } {
	const verts = ROPE_N * ROPE_COLS;
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
	geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));

	const uv = new Float32Array(verts * 2);
	for (let i = 0; i < ROPE_N; i++) {
		for (let j = 0; j < ROPE_COLS; j++) {
			const o = (i * ROPE_COLS + j) * 2;
			uv[o] = j / ROPE_R;
			uv[o + 1] = i / (ROPE_N - 1);
		}
	}
	geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

	const idx: number[] = [];
	for (let i = 0; i < ROPE_N - 1; i++) {
		for (let j = 0; j < ROPE_R; j++) {
			const a = i * ROPE_COLS + j;
			const b = i * ROPE_COLS + j + 1;
			const c = (i + 1) * ROPE_COLS + j;
			const d = (i + 1) * ROPE_COLS + j + 1;
			idx.push(a, c, b, b, c, d);
		}
	}
	geo.setIndex(idx);
	geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
	return { mesh: new THREE.Mesh(geo, mat), geo };
}

/**
 * Пересчёт трубки провода по цепочке.
 *
 * Рамка вдоль трубки строится параллельным переносом: нормаль следующего
 * кольца — это нормаль предыдущего, с которой снята составляющая вдоль новой
 * касательной. Формулы Френе тут не годятся вовсе: на прямом участке
 * кривизна нулевая, её нормаль не определена, и трубку в таких местах
 * перекручивает рывком. Перенос же не помнит ничего, кроме предыдущего
 * кольца, и на прямом участке просто ничего не меняет.
 *
 * Поверх переноса ложится собственная закрутка провода — угол из Twist.
 * Именно она поворачивает материал трубки вокруг её оси, и именно её видно
 * на оплётке: пунктир едет по спирали, когда провод закручивают.
 */
export function updateRopeMesh(geo: THREE.BufferGeometry, rope: Rope, twist: Twist): void {
	const pos = (geo.attributes.position as THREE.BufferAttribute).array as Float32Array;
	const nrm = (geo.attributes.normal as THREE.BufferAttribute).array as Float32Array;
	const p = rope.p;

	// Затравка переноса: любой вектор, заведомо не параллельный касательной.
	let nx = 0;
	let ny = 0;
	let nz = 1;

	for (let i = 0; i < ROPE_N; i++) {
		// Касательная по соседям — на концах по одному соседу
		const i0 = Math.max(0, i - 1) * 3;
		const i1 = Math.min(ROPE_N - 1, i + 1) * 3;
		let tx = p[i1]! - p[i0]!;
		let ty = p[i1 + 1]! - p[i0 + 1]!;
		let tz = p[i1 + 2]! - p[i0 + 2]!;
		const tl = Math.hypot(tx, ty, tz) || 1;
		tx /= tl;
		ty /= tl;
		tz /= tl;

		// Перенос: снять с нормали составляющую вдоль касательной
		let d = nx * tx + ny * ty + nz * tz;
		nx -= tx * d;
		ny -= ty * d;
		nz -= tz * d;
		let nl = Math.hypot(nx, ny, nz);
		if (nl < 1e-4) {
			// Нормаль легла на касательную — взять любую другую и повторить
			nx = ty;
			ny = -tx;
			nz = 0;
			d = nx * tx + ny * ty + nz * tz;
			nx -= tx * d;
			ny -= ty * d;
			nz -= tz * d;
			nl = Math.hypot(nx, ny, nz) || 1;
		}
		nx /= nl;
		ny /= nl;
		nz /= nl;

		// Бинормаль дополняет рамку до правой тройки
		const bx = ty * nz - tz * ny;
		const by = tz * nx - tx * nz;
		const bz = tx * ny - ty * nx;

		// Собственная закрутка провода в этой точке
		const ca = Math.cos(twist.a[i]!);
		const sa = Math.sin(twist.a[i]!);
		const mx = nx * ca + bx * sa;
		const my = ny * ca + by * sa;
		const mz = nz * ca + bz * sa;
		const lx = -nx * sa + bx * ca;
		const ly = -ny * sa + by * ca;
		const lz = -nz * sa + bz * ca;

		const cx = p[i * 3]!;
		const cy = p[i * 3 + 1]!;
		const cz = p[i * 3 + 2]!;
		for (let j = 0; j < ROPE_COLS; j++) {
			const ang = ((j % ROPE_R) / ROPE_R) * Math.PI * 2;
			const c = Math.cos(ang);
			const sn = Math.sin(ang);
			const ux = mx * c + lx * sn;
			const uy = my * c + ly * sn;
			const uz = mz * c + lz * sn;
			const o = (i * ROPE_COLS + j) * 3;
			pos[o] = cx + ux * ROPE_RAD;
			pos[o + 1] = cy + uy * ROPE_RAD;
			pos[o + 2] = cz + uz * ROPE_RAD;
			nrm[o] = ux;
			nrm[o + 1] = uy;
			nrm[o + 2] = uz;
		}
	}
	geo.attributes.position!.needsUpdate = true;
	geo.attributes.normal!.needsUpdate = true;
}

/**
 * Оплётка шнура: чёрная нить в жёлтую крапину.
 *
 * Штрихи стоят по центрам клеток через одну, как чёрные поля на доске, и
 * все наклонены одинаково — так плетение читается направлением, а не
 * рисунком, которого на трёх пикселях всё равно не разглядеть. За край
 * клетки штрих не выходит (это стережёт dash), поэтому плитка сходится
 * сама с собой и по горизонтали, и по вертикали: шва нет ни на витке, ни
 * на стыке повторов.
 */
export function braidTexture(spec: CordSpec): THREE.CanvasTexture {
	const S = 64;
	const c = document.createElement('canvas');
	c.width = c.height = S;
	const ctx = c.getContext('2d')!;
	ctx.fillStyle = spec.base;
	ctx.fillRect(0, 0, S, S);

	const step = S / spec.cells;
	// Полудлина штриха вместе с круглым колпачком: колпачок торчит за
	// конец на половину толщины, и без него в запасе плитка бы разъехалась.
	const half = Math.min((step * spec.dash) / 2, step / 2 - (spec.width * S) / 2);
	const dx = Math.cos(spec.skew) * half;
	const dy = Math.sin(spec.skew) * half;
	ctx.strokeStyle = spec.fleck;
	ctx.lineWidth = spec.width * S;
	ctx.lineCap = 'round';
	for (let row = 0; row < spec.cells; row++) {
		for (let col = 0; col < spec.cells; col++) {
			if ((row + col) % 2) continue;
			const x = (col + 0.5) * step;
			const y = (row + 0.5) * step;
			ctx.beginPath();
			ctx.moveTo(x - dx, y - dy);
			ctx.lineTo(x + dx, y + dy);
			ctx.stroke();
		}
	}

	const tex = new THREE.CanvasTexture(c);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.repeat.set(spec.repeat[0], spec.repeat[1]);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

/** Точка на ребре from→to, отступив от from на r (но не дальше середины). */
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
		disposables,
		ropeMesh: ropeParts.mesh,
		ropeGeo: ropeParts.geo,
		plug,
	};
}
