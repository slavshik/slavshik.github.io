/*
 * Физика телевизора: корпус, антенны и проводок.
 *
 * Модуль намеренно ничего не знает ни про three, ни про DOM — сюда приходят
 * числа и уходят числа. Именно поэтому его можно гонять юнит-тестами без
 * браузера и без WebGL.
 */

import { ANCHOR_X, ANCHOR_Y, HALF_H, HALF_W, ROPE_N, type TvParams } from './constants.js';

/** Единственная причина, по которой сюда раньше затягивался весь three. */
export function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
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
export class Rope {
	readonly n: number;
	readonly seg: number;
	readonly p: Float32Array;
	readonly q: Float32Array; // предыдущая позиция

	constructor(n: number, seg: number) {
		this.n = n;
		this.seg = seg;
		this.p = new Float32Array(n * 2);
		this.q = new Float32Array(n * 2);
		for (let i = 0; i < n; i++) {
			this.p[i * 2] = 0;
			this.p[i * 2 + 1] = -i * seg;
			this.q[i * 2] = 0;
			this.q[i * 2 + 1] = -i * seg;
		}
	}

	/** Целиком перенести к якорю — при сбросе и первом кадре. */
	reset(ax: number, ay: number): void {
		for (let i = 0; i < this.n; i++) {
			this.p[i * 2] = this.q[i * 2] = ax;
			this.p[i * 2 + 1] = this.q[i * 2 + 1] = ay - i * this.seg;
		}
	}

	step(dt: number, ax: number, ay: number, g: number, damp: number): void {
		const { p, q, n, seg } = this;

		// Интегрирование: x' = x + (x - x_prev)·damp + a·dt²
		for (let i = 1; i < n; i++) {
			const ix = i * 2;
			const iy = ix + 1;
			const vx = (p[ix]! - q[ix]!) * damp;
			const vy = (p[iy]! - q[iy]!) * damp;
			q[ix] = p[ix]!;
			q[iy] = p[iy]!;
			p[ix] = p[ix]! + vx;
			p[iy] = p[iy]! + vy - g * dt * dt;
		}
		p[0] = ax; // верхняя точка приколочена к корпусу
		p[1] = ay;

		// Связи. Восьми проходов хватает, чтобы провод не тянулся заметно.
		for (let it = 0; it < 8; it++) {
			for (let i = 0; i < n - 1; i++) {
				const a = i * 2;
				const b = a + 2;
				let dx = p[b]! - p[a]!;
				let dy = p[b + 1]! - p[a + 1]!;
				const d = Math.hypot(dx, dy) || 1e-6;
				const k = (d - seg) / d;
				if (i === 0) {
					// Верхняя точка приколочена — всю поправку забирает нижняя
					p[b] = p[b]! - dx * k;
					p[b + 1] = p[b + 1]! - dy * k;
				} else {
					dx *= k * 0.5;
					dy *= k * 0.5;
					p[a] = p[a]! + dx;
					p[a + 1] = p[a + 1]! + dy;
					p[b] = p[b]! - dx;
					p[b + 1] = p[b + 1]! - dy;
				}
			}
		}
	}
}

/**
 * Провод шевелится сам по себе — значит, физика не спит, даже если корпус
 * стоит. Проверяем по нижней точке: она успокаивается последней.
 */
export function ropeMoving(rope: Rope): boolean {
	const i = (ROPE_N - 1) * 2;
	return (
		Math.abs(rope.p[i]! - rope.q[i]!) > 0.0006 ||
		Math.abs(rope.p[i + 1]! - rope.q[i + 1]!) > 0.0006
	);
}

/* ── Закрутка вилки ─────────────────────────────────────────────────────── */

/** Поворот вилки вокруг оси провода: угол и угловая скорость. */
export interface SpinState {
	a: number;
	v: number;
}

export function createSpinState(): SpinState {
	return { a: 0, v: 0 };
}

/**
 * Вилка на шнуре — крутильный маятник.
 *
 * Момент берётся от поперечной скорости нижней точки провода: повело
 * телевизор вбок — вилку закрутило вокруг оси шнура. Пока провод висит
 * ровно, момента нет и крутить нечему.
 *
 * Шнур тянет назад к нулю — настоящий возвращается тем же путём, каким его
 * закрутили, а не доворачивается до ближайшего оборота. Поэтому в покое
 * широкая грань сама встаёт к зрителю, а не застывает ребром, и кадр всегда
 * приходит в одно и то же положение. Сильный пинок при этом успевает
 * провернуть вилку дальше полуоборота — там пружина её и подхватывает.
 *
 * Вязкость берётся как exp(-c·dt), а не умножением на константу: шаг
 * фиксированный, но подстраховка от переменного dt стоит один exp на кадр.
 */
export function stepSpin(s: SpinState, dt: number, drive: number, p: TvParams): void {
	s.v += (drive * p.spinDrive - s.a * p.spinK) * dt;
	s.v *= Math.exp(-p.spinC * dt);
	s.a += s.v * dt;
}

/**
 * Вилка ещё вертится — значит, физике спать рано.
 *
 * Порог нарочно крупный. 0.06 рад — три с половиной градуса, а вилка на
 * экране шириной в три десятка пикселей: такой доворот меняет её ширину на
 * сотые доли пикселя. Затухание же тянется долго, и по тонкому порогу
 * телевизор не засыпал лишних пять секунд, гоняя кадры впустую. При
 * засыпании угол всё равно добивается в ноль.
 */
export function spinMoving(s: SpinState): boolean {
	return Math.abs(s.v) > 0.12 || Math.abs(s.a) > 0.06;
}

/* ── Корпус ─────────────────────────────────────────────────────────────── */

export interface BodyState {
	x: number;
	y: number;
	vx: number;
	vy: number;
	th: number;
	om: number;
	grounded: boolean;
	sleeping: boolean;
	sleepFor: number;
}

export interface AntennaState {
	a: number;
	av: number;
}

/** Границы сцены и домашняя позиция — их считает раскладка. */
export interface PhysicsEnv {
	tiltG: number; // наклон устройства, доля g по горизонтали
	homeX: number;
	halfH: number;
	limX: number;
}

export interface DragState {
	active: boolean;
	tx: number;
	ty: number;
}

export interface PhysicsWorld {
	state: BodyState;
	params: TvParams;
	env: PhysicsEnv;
	drag: DragState;
	antennas: AntennaState[];
	rope: Rope;
	spin: SpinState;
}

export function createBodyState(): BodyState {
	return {
		x: 0,
		y: HALF_H,
		vx: 0,
		vy: 0,
		th: 0,
		om: 0,
		grounded: true,
		sleeping: false,
		sleepFor: 0,
	};
}

/** Высота центра масс, при которой коробка, повёрнутая на th, касается пола. */
export function supportY(th: number): number {
	return HALF_H * Math.cos(th) + HALF_W * Math.abs(Math.sin(th));
}

/**
 * Якорь провода в мировых координатах. Считается от положения и крена
 * корпуса, поэтому провод раскачивается и от одного только наклона.
 */
export function anchorAt(x: number, y: number, th: number): { x: number; y: number } {
	const c = Math.cos(th);
	const s = Math.sin(th);
	return {
		x: x + ANCHOR_X * c - ANCHOR_Y * s,
		y: y + ANCHOR_X * s + ANCHOR_Y * c,
	};
}

export function wake(state: BodyState): void {
	state.sleeping = false;
	state.sleepFor = 0;
}

/**
 * Один шаг физики: корпус, антенны, провод — ровно в этом порядке.
 *
 * Возвращает скорость удара о пол, если удар в этом шаге случился, иначе 0.
 * Вспышку экрана от удара зажигает вызывающий: экран — это уже рендер.
 */
export function stepWorld(w: PhysicsWorld, dt: number): number {
	const { state: S, params, env, drag, antennas, rope, spin } = w;

	let ax = -params.gravity * env.tiltG;
	let ay = params.gravity;

	if (drag.active) {
		// Пока держим — телевизор на пружине к курсору, гравитации нет
		ax = (drag.tx - S.x) * 140 - S.vx * 18;
		ay = (drag.ty - S.y) * 140 - S.vy * 18;
	} else {
		ax += -params.homeK * (S.x - env.homeX) - params.homeC * S.vx;
	}

	const al = -params.uprightK * S.th - params.uprightC * S.om;

	S.vx += ax * dt;
	S.vx *= Math.exp(-params.airV * dt);
	S.vy += ay * dt;
	S.vy *= Math.exp(-params.airV * dt);
	S.om += al * dt;
	S.om *= Math.exp(-params.airW * dt);

	S.x += S.vx * dt;
	S.y += S.vy * dt;
	S.th += S.om * dt;

	let impact = 0;

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
			impact = hit;
		}
		// Трение покоя: экспоненциальное по времени, а не по шагу — иначе
		// поведение зависит от частоты кадров.
		S.vx *= Math.exp(-params.groundDrag * dt);
		S.grounded = true;
	}

	// Не выпускаем за пределы канваса
	const lim = Math.max(0.2, env.limX);
	if (S.x < -lim) {
		S.x = -lim;
		S.vx = Math.abs(S.vx) * 0.4;
	}
	if (S.x > lim) {
		S.x = lim;
		S.vx = -Math.abs(S.vx) * 0.4;
	}
	const ceil = env.halfH - HALF_H * 0.4;
	if (S.y > ceil) {
		S.y = ceil;
		S.vy = -Math.abs(S.vy) * 0.3;
	}

	// Сон: иначе корпус вечно микро-дрожит на полу
	// Провод входит в условие сна наравне с корпусом: он качается заметно
	// дольше, и заснуть, пока вилка ещё болтается, было бы видно.
	const still =
		S.grounded &&
		Math.abs(S.vx) < 0.012 &&
		Math.abs(S.vy) < 0.012 &&
		Math.abs(S.om) < 0.012 &&
		Math.abs(S.th) < 0.01 &&
		Math.abs(S.x - env.homeX) < 0.01 &&
		!ropeMoving(rope) &&
		!spinMoving(spin);
	if (still) {
		S.sleepFor += dt;
		if (S.sleepFor > 0.5) {
			S.x = env.homeX;
			S.y = HALF_H;
			S.th = 0;
			S.vx = S.vy = S.om = 0;
			// Закрутку добиваем в ноль вместе с остальным: спящий кадр обязан
			// быть одним и тем же, иначе вилка застынет там, где её застали.
			spin.a = spin.v = 0;
			S.sleeping = true;
		}
	} else {
		S.sleepFor = 0;
	}

	// Антенны догоняют корпус с запозданием — самая дешёвая деталь и самая
	// заметная: без неё прыжок выглядит как перемещение картинки.
	for (const ant of antennas) {
		const acc = -params.antK * ant.a - params.antC * ant.av - al * params.antLever;
		ant.av += acc * dt;
		ant.a += ant.av * dt;
		ant.a = clamp(ant.a, -0.7, 0.7);
	}

	const a = anchorAt(S.x, S.y, S.th);
	rope.step(dt, a.x, a.y, params.ropeG, params.ropeDamp);

	// Закрутка идёт после провода: момент снимается с уже посчитанного шага
	// нижней точки, поделённого на dt, то есть с её поперечной скорости.
	const tail = (ROPE_N - 1) * 2;
	stepSpin(spin, dt, (rope.p[tail]! - rope.q[tail]!) / dt, params);

	return impact;
}
