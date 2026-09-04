/* Визуальное представление шнура: трубка вдоль физической цепочки и её оплётка. */

import * as THREE from 'three';

import { ROPE_N, ROPE_R, ROPE_RAD } from './constants.js';
import type { CordSpec } from './look.js';
import type { Rope, Twist } from './physics.js';

// Колец в трубке столько же, сколько точек в цепочке, а столбцов на один
// больше радиальных сегментов. Лишний столбец лежит ровно на нулевом, но с
// u = 1 вместо u = 0: без него шов трубки протаскивал бы всю текстуру назад
// одним квадом, и по шнуру шла бы сплошная полоса.
const ROPE_COLS = ROPE_R + 1;

// Трубка вдоль цепочки. Геометрия создаётся один раз, каждый кадр
// переписываются только позиции и нормали — новых аллокаций нет. Развёртка
// статична: длина цепочки задана звеньями и не меняется.
export function makeRopeMesh(mat: THREE.Material): { mesh: THREE.Mesh; geo: THREE.BufferGeometry } {
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
