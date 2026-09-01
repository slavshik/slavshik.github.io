import { describe, expect, it } from 'vitest';

import {
	ANCHOR_X,
	BODY_D,
	BODY_H,
	ANCHOR_Y,
	DEFAULTS,
	FIXED,
	FOOT_H,
	HALF_H,
	HALF_W,
	ROPE_N,
	ROPE_SEG,
	ROPE_Z,
	type TvParams,
} from '../../src/tv/constants.js';
import {
	Rope,
	anchorAt,
	createBodyState,
	stepWorld,
	supportY,
	Twist,
	wake,
	type PhysicsWorld,
} from '../../src/tv/physics.js';

/**
 * Мир, в котором телевизор стоит дома на полу и его никто не трогает.
 * Провод сразу собран под якорем — как после mount().
 */
function makeWorld(overrides: Partial<TvParams> = {}): PhysicsWorld {
	const state = createBodyState();
	const rope = new Rope(ROPE_N, ROPE_SEG);
	const a = anchorAt(state.x, state.y, state.th);
	rope.reset(a.x, a.y, ROPE_Z);
	return {
		state,
		params: { ...DEFAULTS, ...overrides },
		env: { tiltG: 0, homeX: 0, halfH: 6, limX: 4 },
		drag: { active: false, tx: 0, ty: 0 },
		antennas: [
			{ a: 0, av: 0 },
			{ a: 0, av: 0 },
		],
		twist: new Twist(ROPE_N),
		rope,
	};
}

function run(w: PhysicsWorld, steps: number): number {
	let maxImpact = 0;
	for (let i = 0; i < steps; i++) maxImpact = Math.max(maxImpact, stepWorld(w, FIXED));
	return maxImpact;
}

describe('supportY', () => {
	it('в вертикали равна половине высоты с ножками', () => {
		expect(supportY(0)).toBeCloseTo(HALF_H, 12);
	});

	it('симметрична по знаку крена', () => {
		expect(supportY(0.4)).toBeCloseTo(supportY(-0.4), 12);
	});

	it('накренённый корпус стоит выше: он опирается на угол', () => {
		expect(supportY(0.5)).toBeGreaterThan(supportY(0));
	});

	it('на 90° опирается на бок — высота равна половине ширины', () => {
		expect(supportY(Math.PI / 2)).toBeCloseTo(HALF_W, 12);
	});
});

describe('anchorAt', () => {
	it('без крена — просто смещение от центра корпуса', () => {
		const a = anchorAt(1, 2, 0);
		expect(a.x).toBeCloseTo(1 + ANCHOR_X, 12);
		expect(a.y).toBeCloseTo(2 + ANCHOR_Y, 12);
	});

	it('крен уводит якорь — из-за этого провод качается и от наклона', () => {
		const flat = anchorAt(0, 0, 0);
		const tilted = anchorAt(0, 0, 0.3);
		expect(tilted.x).not.toBeCloseTo(flat.x, 3);
		expect(tilted.y).not.toBeCloseTo(flat.y, 3);
	});

	it('расстояние до якоря от крена не зависит', () => {
		const r = Math.hypot(ANCHOR_X, ANCHOR_Y);
		for (const th of [0, 0.3, -1.2, 2.5]) {
			const a = anchorAt(0, 0, th);
			expect(Math.hypot(a.x, a.y)).toBeCloseTo(r, 12);
		}
	});
});

describe('шаг физики', () => {
	it('корпус, отпущенный в воздухе, падает и встаёт на пол', () => {
		const w = makeWorld();
		w.state.y = 3;
		w.state.grounded = false;

		run(w, 600); // 5 секунд

		expect(w.state.grounded).toBe(true);
		expect(w.state.y).toBeCloseTo(supportY(w.state.th), 3);
	});

	it('падение с высоты возвращает скорость удара', () => {
		const w = makeWorld();
		w.state.y = 3;
		w.state.grounded = false;

		const impact = run(w, 600);

		expect(impact).toBeGreaterThan(2.2); // порог, за которым зажигается вспышка
	});

	it('стоящий дома корпус не даёт ударов, от которых вспыхивает экран', () => {
		const w = makeWorld();

		// Касания пола за шаг тут есть — гравитация утаскивает корпус на доли
		// миллиметра ниже опоры, и он тут же возвращается. Порог вспышки живёт
		// не здесь, а в вызывающем: физика просто сообщает скорость удара.
		expect(run(w, 600)).toBeLessThan(2.2);
	});

	it('корпус в покое засыпает', () => {
		const w = makeWorld();
		expect(w.state.sleeping).toBe(false);

		run(w, 600);

		expect(w.state.sleeping).toBe(true);
		expect(w.state.x).toBeCloseTo(w.env.homeX, 12);
		expect(w.state.y).toBeCloseTo(HALF_H, 12);
		expect(w.state.th).toBe(0);
	});

	it('брошенный вбок корпус не улетает за границу сцены', () => {
		const w = makeWorld();
		w.state.vx = 40;

		run(w, 600);

		expect(Math.abs(w.state.x)).toBeLessThanOrEqual(w.env.limX + 1e-6);
	});

	it('подброшенный корпус не пробивает потолок', () => {
		const w = makeWorld();
		w.state.vy = 60;

		const ceil = w.env.halfH - HALF_H * 0.4;
		for (let i = 0; i < 600; i++) {
			stepWorld(w, FIXED);
			expect(w.state.y).toBeLessThanOrEqual(ceil + 1e-6);
		}
	});

	it('пружина возвращает корпус домой', () => {
		const w = makeWorld();
		w.env.homeX = 1.5;
		w.state.x = -1.5;

		run(w, 1200); // 10 секунд

		expect(w.state.x).toBeCloseTo(1.5, 2);
	});

	it('за курсором корпус идёт без гравитации', () => {
		const w = makeWorld();
		w.drag.active = true;
		w.drag.tx = 2;
		w.drag.ty = 2.5;

		run(w, 600);

		expect(w.state.x).toBeCloseTo(2, 2);
		expect(w.state.y).toBeCloseTo(2.5, 2);
		expect(w.state.grounded).toBe(false); // на пружине пол не ловит
	});

	it('случайностей внутри нет: одинаковый старт даёт одинаковый результат', () => {
		const a = makeWorld();
		const b = makeWorld();
		for (const w of [a, b]) {
			w.state.y = 2.4;
			w.state.vx = 3;
			w.state.om = -1.5;
			w.state.grounded = false;
		}

		run(a, 500);
		run(b, 500);

		expect(b.state).toEqual(a.state);
		expect(Array.from(b.rope.p)).toEqual(Array.from(a.rope.p));
	});

	it('антенны догоняют корпус и остаются в пределах хода', () => {
		const w = makeWorld();
		w.state.om = 14;

		let moved = false;
		for (let i = 0; i < 600; i++) {
			stepWorld(w, FIXED);
			for (const ant of w.antennas) {
				expect(ant.a).toBeGreaterThanOrEqual(-0.7);
				expect(ant.a).toBeLessThanOrEqual(0.7);
				if (Math.abs(ant.a) > 1e-3) moved = true;
			}
		}
		expect(moved).toBe(true);
	});

	it('наклон устройства сносит корпус в сторону', () => {
		const w = makeWorld();
		w.env.tiltG = 0.45;

		run(w, 240);

		// ax = -gravity·tiltG, а gravity отрицательна — положительный наклон
		// уводит корпус вправо.
		expect(w.state.x).toBeGreaterThan(0);
	});
});

describe('провод и корпус', () => {
	/**
	 * Насколько глубоко точка сидит внутри коробки корпуса; 0 — снаружи.
	 *
	 * Глубину проверять обязательно, и это не педантизм. Первая версия
	 * замера её игнорировала и показывала провал 0.371 — а виноватая точка
	 * оказалась на z = −0.536 при задней грани корпуса −0.418, то есть
	 * честно ЗА телевизором. Провод туда уходит по своей свитости, и рисуется
	 * он там перекрытым. Без этой проверки тест ловил бы не столкновение, а
	 * нормальный заход за корпус.
	 */
	function penetration(w: PhysicsWorld, i: number): number {
		const S = w.state;
		const c = Math.cos(S.th);
		const s = Math.sin(S.th);
		const dx = w.rope.p[i * 3]! - S.x;
		const dy = w.rope.p[i * 3 + 1]! - (S.y - FOOT_H / 2);
		const lx = dx * c + dy * s;
		const ly = -dx * s + dy * c;
		const ox = HALF_W - Math.abs(lx);
		const oy = BODY_H / 2 + FOOT_H / 2 - Math.abs(ly);
		const oz = BODY_D / 2 - Math.abs(w.rope.p[i * 3 + 2]!);
		return ox > 0 && oy > 0 && oz > 0 ? Math.min(ox, oy) : 0;
	}

	it('вилку не протаскивает сквозь корпус, как её ни раскачивай', () => {
		const w = makeWorld();
		let worst = 0;
		// Серия пинков в разные стороны: одиночный не загоняет вилку в корпус
		for (let kick = 0; kick < 6; kick++) {
			wake(w.state);
			w.state.vx = kick % 2 ? 4.5 : -4.5;
			w.state.vy = DEFAULTS.kickV;
			w.state.om = kick % 2 ? 7 : -7;
			w.state.grounded = false;
			for (let i = 0; i < 400; i++) {
				stepWorld(w, FIXED);
				// Первые два звена внутри по делу — их пропускает skip
				for (let j = 2; j < ROPE_N; j++) worst = Math.max(worst, penetration(w, j));
			}
		}
		// Связи звеньев тянут точку обратно между проходами, поэтому речь о
		// «не проваливается», а не «идеально снаружи»: полсантиметра сцены
		// при корпусе шириной 1.1 не видно.
		expect(worst).toBeLessThan(0.05);
	});
});
