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
import type { Rope } from './physics.js';

export type { AntennaPart } from './cabinet.js';

export interface TvParts {
	body: THREE.Group;
	tilt: THREE.Group;
	screen: THREE.Mesh;
	screenMat: THREE.ShaderMaterial;
	screenGlass: THREE.Mesh;
	glow: THREE.PointLight;
	bloomMat: THREE.MeshBasicMaterial;
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
		for (let j = 0; j < ROPE_COLS; j++) {
			// Замыкающий столбец — тот же угол, что и нулевой: точка одна,
			// а вершины две, и различает их только развёртка.
			const a = ((j % ROPE_R) / ROPE_R) * Math.PI * 2;
			const ca = Math.cos(a);
			const sa = Math.sin(a);
			const ux = nx * ca;
			const uy = ny * ca;
			const uz = sa; // бинормаль = ось Z
			const o = (i * ROPE_COLS + j) * 3;
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
	const cab = buildCabinet(LOOK.shape, mats, pal.accent);
	const disposables: Disposable[] = [...mats.disposables, ...cab.disposables];
	const keep = <T extends Disposable>(x: T): T => (disposables.push(x), x);

	const { metal: matMetal, cord: matCord, plug: matPlug } = mats.roles;

	/* Вилка на конце провода. Висит в воздухе и никуда не воткнута — при этом
     экран работает. Ради этой шутки провод и заведён.
     Круглая и чёрная, с рёбрами под пальцы и латунными штырями. */
	const plug = new THREE.Group();

	const plugBody = new THREE.Mesh(
		keep(new THREE.CylinderGeometry(0.07, 0.082, 0.155, 28)),
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
	const flange = new THREE.Mesh(
		keep(new THREE.CylinderGeometry(0.093, 0.093, 0.028, 32)),
		matPlug,
	);
	flange.position.y = -0.111;
	plug.add(flange);

	// Штыри — латунь, с закруглёнными концами
	const prongGeo = keep(new THREE.CylinderGeometry(0.017, 0.017, 0.115, 18));
	prongGeo.translate(0, -0.0575, 0);
	const prongCapGeo = keep(new THREE.SphereGeometry(0.017, 18, 12));
	for (const sx of [-1, 1]) {
		const prong = new THREE.Mesh(prongGeo, matMetal);
		prong.position.set(sx * 0.04, -0.125, 0);
		plug.add(prong);
		const cap = new THREE.Mesh(prongCapGeo, matMetal);
		cap.position.set(sx * 0.04, -0.24, 0);
		plug.add(cap);
	}
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
		bloomMat: cab.bloomMat,
		antennas: cab.antennas,
		proxy,
		disposables,
		ropeMesh: ropeParts.mesh,
		ropeGeo: ropeParts.geo,
		plug,
	};
}
