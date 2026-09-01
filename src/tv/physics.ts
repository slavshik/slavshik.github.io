/*
 * Физика телевизора: корпус, антенны и проводок.
 *
 * Модуль намеренно ничего не знает ни про three, ни про DOM — сюда приходят
 * числа и уходят числа. Именно поэтому его можно гонять юнит-тестами без
 * браузера и без WebGL.
 */

import { ANCHOR_X, ANCHOR_Y, HALF_H, HALF_W, ROPE_N, ROPE_Z, type TvParams } from './constants.js';

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
 * Цепочка трёхмерная, и это не роскошь. Пока она была плоской, вилку нельзя
 * было закрутить по-настоящему: кручение — это поворот вокруг собственной
 * касательной стержня, касательная плоской цепочки всегда лежит в XY, а
 * корпус вращается только вокруг Z, то есть поперёк неё. Проекция ровно
 * ноль — крутить нечем. Третья координата и есть то, что делает кручение
 * степенью свободы, а не выдумкой.
 *
 * Вилка на конце висит в воздухе и никуда не воткнута — в этом вся шутка,
 * поэтому нижний конец принципиально свободен, ни к чему не привязан.
 */
export class Rope {
	readonly n: number;
	readonly seg: number;
	/** Позиции, по три числа на точку. */
	readonly p: Float32Array;
	readonly q: Float32Array; // предыдущая позиция

	constructor(n: number, seg: number) {
		this.n = n;
		this.seg = seg;
		this.p = new Float32Array(n * 3);
		this.q = new Float32Array(n * 3);
		for (let i = 0; i < n; i++) {
			this.p[i * 3 + 1] = -i * seg;
			this.q[i * 3 + 1] = -i * seg;
		}
	}

	/** Целиком перенести к якорю — при сбросе и первом кадре. */
	reset(ax: number, ay: number, az: number): void {
		for (let i = 0; i < this.n; i++) {
			const o = i * 3;
			this.p[o] = this.q[o] = ax;
			this.p[o + 1] = this.q[o + 1] = ay - i * this.seg;
			this.p[o + 2] = this.q[o + 2] = az;
		}
	}

	/**
	 * @param curl  Своя кривизна покоя: шнур сматывали, и он это помнит.
	 *   Из-за неё провод висит пологой спиралью, а не строго в плоскости.
	 *   Это не украшение: пока цепочка идеально плоская, касательная у
	 *   корпуса перпендикулярна оси крена, привод кручения тождественно ноль
	 *   и вилку крутить нечем. Ноль возвращает плоский провод — и мёртвое
	 *   кручение вместе с ним.
	 */
	step(
		dt: number,
		ax: number,
		ay: number,
		az: number,
		g: number,
		damp: number,
		curl: number,
	): void {
		const { p, q, n, seg } = this;

		// Интегрирование: x' = x + (x - x_prev)·damp + a·dt²
		for (let i = 1; i < n; i++) {
			const o = i * 3;
			const vx = (p[o]! - q[o]!) * damp;
			const vy = (p[o + 1]! - q[o + 1]!) * damp;
			const vz = (p[o + 2]! - q[o + 2]!) * damp;
			q[o] = p[o]!;
			q[o + 1] = p[o + 1]!;
			q[o + 2] = p[o + 2]!;
			p[o] = p[o]! + vx;
			p[o + 1] = p[o + 1]! + vy - g * dt * dt;
			p[o + 2] = p[o + 2]! + vz;
		}
		p[0] = ax; // верхняя точка приколочена к корпусу
		p[1] = ay;
		p[2] = az;

		/* Своя кривизна покоя: шнур сматывали, и прямым он висеть не хочет.
		   Каждая внутренняя точка тянется не к месту в пространстве, а к
		   смещению относительно своих соседей — вбок от прямой, их
		   соединяющей, причём направление смещения проворачивается от точки
		   к точке. Получается пологая спираль, то есть ровно то, что делает
		   с проводом сматывание.

		   Пружина к абсолютной глубине тут не работает: её пересиливает
		   натяжение, которое тянет провод прямо, — первая попытка дала выход
		   из плоскости в семь сотых миллиметра вместо пяти. Изгиб же
		   действует поперёк натяжения и с ним не спорит.

		   Пасс идёт до связей, чтобы восемь проходов следом убрали растяжение,
		   которое он вносит. */
		if (curl !== 0) {
			for (let i = 1; i < n - 1; i++) {
				const o = i * 3;
				const a = o - 3;
				const b = o + 3;
				const ox = curl * Math.cos(i * 1.05);
				const oz = curl * Math.sin(i * 1.05);
				p[o] = p[o]! + ((p[a]! + p[b]!) / 2 + ox - p[o]!) * 0.35;
				p[o + 2] = p[o + 2]! + ((p[a + 2]! + p[b + 2]!) / 2 + oz - p[o + 2]!) * 0.35;
			}
		}

		// Связи. Восьми проходов хватает, чтобы провод не тянулся заметно.
		for (let it = 0; it < 8; it++) {
			for (let i = 0; i < n - 1; i++) {
				const a = i * 3;
				const b = a + 3;
				let dx = p[b]! - p[a]!;
				let dy = p[b + 1]! - p[a + 1]!;
				let dz = p[b + 2]! - p[a + 2]!;
				const d = Math.hypot(dx, dy, dz) || 1e-6;
				const k = (d - seg) / d;
				if (i === 0) {
					// Верхняя точка приколочена — всю поправку забирает нижняя
					p[b] = p[b]! - dx * k;
					p[b + 1] = p[b + 1]! - dy * k;
					p[b + 2] = p[b + 2]! - dz * k;
				} else {
					dx *= k * 0.5;
					dy *= k * 0.5;
					dz *= k * 0.5;
					p[a] = p[a]! + dx;
					p[a + 1] = p[a + 1]! + dy;
					p[a + 2] = p[a + 2]! + dz;
					p[b] = p[b]! - dx;
					p[b + 1] = p[b + 1]! - dy;
					p[b + 2] = p[b + 2]! - dz;
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
	const i = (ROPE_N - 1) * 3;
	return (
		Math.abs(rope.p[i]! - rope.q[i]!) > 0.0006 ||
		Math.abs(rope.p[i + 1]! - rope.q[i + 1]!) > 0.0006 ||
		Math.abs(rope.p[i + 2]! - rope.q[i + 2]!) > 0.0006
	);
}

/* ── Кручение провода ───────────────────────────────────────────────────── */

/**
 * Крутильная цепочка вдоль провода — вторая половина стержня Коссера.
 *
 * Положение точек считает Rope, а здесь живёт то, чего в цепочке точек нет
 * в принципе: поворот материала вокруг собственной оси провода. У каждой
 * точки свой угол и своя угловая скорость, соседей связывает крутильная
 * пружина — провод сопротивляется тому, чтобы соседние сечения были
 * повёрнуты друг относительно друга, и по нему бежит крутильная волна.
 *
 * Верхняя точка защемлена в корпусе, её угол не свободен: он равен той доле
 * крена телевизора, которая приходится на ось провода, то есть th·(ẑ·t̂₀).
 * Вот это и есть настоящий привод. И он тождественно ноль, пока провод лежит
 * в плоскости XY: там ẑ ⟂ t̂₀. Ровно поэтому цепочка и стала трёхмерной —
 * без третьей координаты крутить нечем, и любая закрутка была бы выдумкой.
 *
 * Нижняя точка свободна и несёт вилку: у неё свой момент инерции, поэтому на
 * тот же момент она отзывается медленнее, чем голое звено провода. Свободный
 * конец вдобавок отражает волну без переворота знака, и угол там выходит
 * больше, чем задан на защемлении, — вилку «доворачивает».
 */
export class Twist {
	readonly n: number;
	/** Угол поворота материала в каждой точке. */
	readonly a: Float32Array;
	/** Угловая скорость. */
	readonly v: Float32Array;

	constructor(n: number) {
		this.n = n;
		this.a = new Float32Array(n);
		this.v = new Float32Array(n);
	}

	reset(): void {
		this.a.fill(0);
		this.v.fill(0);
	}

	/** Угол на свободном конце — его и отыгрывает вилка. */
	get tail(): number {
		return this.a[this.n - 1]!;
	}

	step(dt: number, clamp: number, k: number, c: number, plugInertia: number): void {
		const { a, v, n } = this;
		a[0] = clamp;
		v[0] = 0;
		for (let i = 1; i < n; i++) {
			const up = a[i - 1]! - a[i]!;
			const down = i + 1 < n ? a[i + 1]! - a[i]! : 0;
			const inertia = i === n - 1 ? plugInertia : 1;
			v[i] = (v[i]! + ((up + down) * k * dt) / inertia) * Math.exp(-c * dt);
		}
		for (let i = 1; i < n; i++) a[i] = a[i]! + v[i]! * dt;
	}
}

/**
 * Доля крена корпуса, приходящаяся на ось провода: ẑ·t̂₀.
 *
 * Корпус вращается вокруг Z. Провод у корпуса смотрит в сторону t̂₀. На
 * кручение работает только проекция одного на другое — остальное идёт в
 * изгиб, и его уже считают связи Rope.
 */
export function clampTwist(rope: Rope, th: number): number {
	const dx = rope.p[3]! - rope.p[0]!;
	const dy = rope.p[4]! - rope.p[1]!;
	const dz = rope.p[5]! - rope.p[2]!;
	const len = Math.hypot(dx, dy, dz) || 1;
	return th * (dz / len);
}

/** Провод ещё крутит — значит, физике спать рано. */
export function twistMoving(t: Twist): boolean {
	for (let i = 1; i < t.n; i++) {
		if (Math.abs(t.v[i]!) > 0.12 || Math.abs(t.a[i]!) > 0.06) return true;
	}
	return false;
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
	twist: Twist;
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
	const { state: S, params, env, drag, antennas, rope, twist } = w;

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
		!twistMoving(twist);
	if (still) {
		S.sleepFor += dt;
		if (S.sleepFor > 0.5) {
			S.x = env.homeX;
			S.y = HALF_H;
			S.th = 0;
			S.vx = S.vy = S.om = 0;
			// Кручение добиваем в ноль вместе с остальным: спящий кадр обязан
			// быть одним и тем же, иначе вилка застынет там, где её застали.
			twist.reset();
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
	rope.step(dt, a.x, a.y, ROPE_Z, params.ropeG, params.ropeDamp, params.ropeCurl);

	// Кручение — после провода: защемление считается по свежей касательной.
	twist.step(dt, clampTwist(rope, S.th), params.twistK, params.twistC, params.plugInertia);

	return impact;
}
