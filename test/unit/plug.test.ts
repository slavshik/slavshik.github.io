import { describe, expect, it } from 'vitest';

import {
	BODY_H,
	DEFAULTS,
	FIXED,
	HALF_H,
	HALF_W,
	ROPE_N,
	ROPE_SEG,
	ROPE_Z,
	type TvParams,
} from '../../src/tv/constants.js';
import {
	Rope,
	Twist,
	anchorAt,
	cordTension,
	createBodyState,
	createPlugHold,
	reachable,
	stepWorld,
	type PhysicsEnv,
	type PhysicsWorld,
	type PlugHold,
} from '../../src/tv/physics.js';

/** Вся длина шнура: столько он даёт от якоря и ни сантиметром больше. */
const LEN = (ROPE_N - 1) * ROPE_SEG;

function hold(tx: number, ty: number): PlugHold {
	const h = createPlugHold();
	h.active = true;
	h.tx = tx;
	h.ty = ty;
	h.tz = ROPE_Z;
	return h;
}

function world(h: PlugHold): PhysicsWorld {
	const params: TvParams = { ...DEFAULTS };
	const state = createBodyState();
	const env: PhysicsEnv = { tiltG: 0, homeX: 0, halfH: 4, limX: 4 };
	const rope = new Rope(ROPE_N, ROPE_SEG);
	const a = anchorAt(state.x, state.y, state.th);
	rope.reset(a.x, a.y, ROPE_Z);
	return {
		state,
		params,
		env,
		drag: { active: false, tx: 0, ty: 0 },
		plug: h,
		antennas: [],
		rope,
		twist: new Twist(ROPE_N),
	};
}

describe('натяжение шнура', () => {
	it('провисший шнур не тянет вовсе', () => {
		// Палец на половине длины от якоря — шнуру ещё есть чем провиснуть.
		const f = cordTension(0, 0, LEN * 0.5, 0, 0, 0, LEN, DEFAULTS);
		expect(f.x).toBe(0);
		expect(f.y).toBe(0);
	});

	it('распрямившись, тянет к пальцу и тем сильнее, чем дальше', () => {
		const near = cordTension(0, 0, LEN + 0.1, 0, 0, 0, LEN, DEFAULTS);
		const far = cordTension(0, 0, LEN + 0.3, 0, 0, 0, LEN, DEFAULTS);

		expect(near.x).toBeGreaterThan(0);
		expect(near.y).toBe(0);
		expect(far.x).toBeGreaterThan(near.x);
	});

	it('шнур только тянет: оттолкнуть корпус он не может', () => {
		// Корпус несётся к пальцу быстрее, чем шнур успевает выбраться, и
		// вязкость одна дала бы силу «назад». У верёвки её не бывает.
		const f = cordTension(0, 0, LEN + 0.02, 0, 40, 0, LEN, DEFAULTS);
		expect(f.x).toBe(0);
	});

	it('сила упирается в потолок, а не растёт без предела', () => {
		const f = cordTension(0, 0, LEN + 12, 0, 0, 0, LEN, DEFAULTS);
		expect(Math.hypot(f.x, f.y)).toBeCloseTo(DEFAULTS.cordMax, 6);
	});
});

describe('досягаемость вилки', () => {
	it('в пределах шнура вилка идёт ровно за пальцем', () => {
		const r = reachable(0, 0, hold(0.2, -0.3), LEN);
		expect(r.x).toBeCloseTo(0.2, 6);
		expect(r.y).toBeCloseTo(-0.3, 6);
	});

	it('дальше — подрезается по длине, сохраняя направление', () => {
		const r = reachable(0, 0, hold(3, -4), LEN);
		expect(Math.hypot(r.x, r.y)).toBeCloseTo(LEN, 6);
		// Направление то же: 3/-4 — это те же три четвёртых.
		expect(r.x / -r.y).toBeCloseTo(0.75, 6);
	});
});

describe('вилку держат', () => {
	it('хвост цепочки садится туда, куда его держат', () => {
		// Точка сбоку от корпуса и в пределах шнура: и не в коробке, и не за
		// длиной, — тогда за пальцем идёт ровно вилка, без оговорок.
		const w = world(hold(0.85, -0.1));
		for (let i = 0; i < 60; i++) stepWorld(w, FIXED);

		const t = (ROPE_N - 1) * 3;
		expect(w.rope.p[t]).toBeCloseTo(0.85, 3);
		expect(w.rope.p[t + 1]).toBeCloseTo(-0.1, 3);
	});

	it('в корпус вилку не затащить — коробка выталкивает её из-под пальца', () => {
		// Палец посреди телевизора. Столкновение считается после удержания и
		// потому забирает последнее слово: вилка скользит по борту, а внутрь
		// не проваливается.
		const w = world(hold(0, HALF_H));
		for (let i = 0; i < 60; i++) stepWorld(w, FIXED);

		const t = (ROPE_N - 1) * 3;
		const inside =
			Math.abs(w.rope.p[t]!) < HALF_W && Math.abs(w.rope.p[t + 1]! - w.state.y) < BODY_H / 2;
		expect(inside).toBe(false);
	});

	it('за шнур телевизор можно утащить', () => {
		const h = hold(3, HALF_H);
		const w = world(h);
		const x0 = w.state.x;
		for (let i = 0; i < 240; i++) stepWorld(w, FIXED);

		expect(w.state.x).toBeGreaterThan(x0 + 0.5);
		expect(w.plug.tension).toBeGreaterThan(0);
	});

	it('и поднять в воздух — но только потянув вверх', () => {
		const w = world(hold(0.4, 3));
		for (let i = 0; i < 240; i++) stepWorld(w, FIXED);

		expect(w.state.y).toBeGreaterThan(HALF_H + 0.3);
		expect(w.state.grounded).toBe(false);
	});

	it('тянут за угол, поэтому корпус ещё и кренится', () => {
		// Якорь сидит внизу задней стенки, а не в центре масс: сила на нём
		// даёт момент. Без него телевизор ехал бы за шнуром плашмя.
		const w = world(hold(3, HALF_H));
		for (let i = 0; i < 120; i++) stepWorld(w, FIXED);

		expect(Math.abs(w.state.th)).toBeGreaterThan(0.05);
	});

	it('пока держат — не засыпает, даже стоя на месте', () => {
		// Вилка неподвижна и шнур провисает: без явной оговорки корпус
		// заснул бы, а сон возвращает его домой и обнуляет кручение — прямо
		// из-под пальца.
		const w = world(hold(0.4, HALF_H - LEN));
		for (let i = 0; i < 2000; i++) stepWorld(w, FIXED);
		expect(w.state.sleeping).toBe(false);

		w.plug.active = false;
		for (let i = 0; i < 2000; i++) stepWorld(w, FIXED);
		expect(w.state.sleeping).toBe(true);
	});
});
