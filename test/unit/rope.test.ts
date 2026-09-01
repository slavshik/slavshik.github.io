import { describe, expect, it } from 'vitest';

import {
	BODY_H,
	DEFAULTS,
	FIXED,
	FOOT_H,
	HALF_W,
	ROPE_N,
	ROPE_SEG,
	ROPE_Z,
} from '../../src/tv/constants.js';
import { Rope, ropeMoving } from '../../src/tv/physics.js';

function point(rope: Rope, i: number): { x: number; y: number; z: number } {
	return { x: rope.p[i * 3]!, y: rope.p[i * 3 + 1]!, z: rope.p[i * 3 + 2]! };
}

function linkLengths(rope: Rope): number[] {
	const out: number[] = [];
	for (let i = 0; i < rope.n - 1; i++) {
		const a = point(rope, i);
		const b = point(rope, i + 1);
		out.push(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
	}
	return out;
}

/* Свитость тут нулевая: эти тесты про связи и провисание, а волна по
   глубине только мешала бы им читаться. Про неё — отдельный тест. */
function settle(rope: Rope, ax: number, ay: number, steps: number, curl = 0): void {
	for (let i = 0; i < steps; i++) {
		rope.step(FIXED, ax, ay, ROPE_Z, DEFAULTS.ropeG, DEFAULTS.ropeDamp, curl, null);
	}
}

describe('Rope', () => {
	it('reset вешает цепочку прямо вниз от якоря', () => {
		const rope = new Rope(ROPE_N, ROPE_SEG);
		rope.reset(1.5, -2, ROPE_Z);

		// Точки лежат во Float32Array, поэтому сравнение до седьмого знака —
		// это уже сравнение с точностью самого хранилища.
		for (let i = 0; i < ROPE_N; i++) {
			const p = point(rope, i);
			expect(p.x).toBeCloseTo(1.5, 6);
			expect(p.y).toBeCloseTo(-2 - i * ROPE_SEG, 6);
		}
	});

	it('после reset цепочка неподвижна', () => {
		const rope = new Rope(ROPE_N, ROPE_SEG);
		rope.reset(0, 0, ROPE_Z);
		expect(ropeMoving(rope)).toBe(false);
	});

	it('верхняя точка приколочена к якорю', () => {
		const rope = new Rope(ROPE_N, ROPE_SEG);
		rope.reset(0, 0, ROPE_Z);
		settle(rope, 0.7, -0.3, 50);

		const head = point(rope, 0);
		expect(head.x).toBeCloseTo(0.7, 6);
		expect(head.y).toBeCloseTo(-0.3, 6);
	});

	it('звенья не тянутся: длины держатся у номинала', () => {
		const rope = new Rope(ROPE_N, ROPE_SEG);
		rope.reset(0, 0, ROPE_Z);

		// Якорь качается с той же амплитудой, что даёт настоящий телевизор:
		// корпус ходит в пределах пары своих ширин и не телепортируется.
		for (let i = 0; i < 400; i++) {
			rope.step(
				FIXED,
				Math.sin(i / 40) * 0.4,
				0,
				ROPE_Z,
				DEFAULTS.ropeG,
				DEFAULTS.ropeDamp,
				0,
				null,
			);
		}

		// Восемь проходов по связям — это не жёсткое ограничение, а сходящееся,
		// поэтому речь о «не тянется заметно», а не «не тянется вовсе».
		for (const len of linkLengths(rope)) {
			expect(len).toBeGreaterThan(ROPE_SEG * 0.95);
			expect(len).toBeLessThan(ROPE_SEG * 1.05);
		}
	});

	it('рывок якоря раскачивает провод, а покой его успокаивает', () => {
		const rope = new Rope(ROPE_N, ROPE_SEG);
		rope.reset(0, 0, ROPE_Z);

		settle(rope, 1.5, 0, 20); // якорь дёрнули
		expect(ropeMoving(rope)).toBe(true);

		settle(rope, 1.5, 0, 4000); // и держим
		expect(ropeMoving(rope)).toBe(false);
	});

	it('успокоившись, провод висит под якорем', () => {
		const rope = new Rope(ROPE_N, ROPE_SEG);
		rope.reset(0, 0, ROPE_Z);
		settle(rope, 0, 0, 4000);

		const tail = point(rope, ROPE_N - 1);
		expect(tail.x).toBeCloseTo(0, 2);
		// Провод висит отвесно и под собственным весом чуть вытянут — но не
		// больше пары процентов от номинала.
		const nominal = (ROPE_N - 1) * ROPE_SEG;
		expect(-tail.y).toBeGreaterThanOrEqual(nominal);
		expect(-tail.y).toBeLessThan(nominal * 1.02);
	});

	it('нижний конец свободен — в этом вся шутка с вилкой', () => {
		const rope = new Rope(ROPE_N, ROPE_SEG);
		rope.reset(0, 0, ROPE_Z);
		const before = point(rope, ROPE_N - 1);

		settle(rope, 2.5, 1.5, 30);

		const after = point(rope, ROPE_N - 1);
		expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(0.01);
	});
});

describe('корпус как препятствие', () => {
	/* Коробка стоит в начале координат, невёрнутая: HALF_W = 0.55 по X,
	   полувысота с ножками — 0.462 вниз от центра масс, сдвинутого вниз на
	   пол-ножки. Провода тут нет, проверяется чистая выталкивающая связь. */
	const box = { x: 0, y: 0, th: 0, skip: 0, pad: 0, tailPad: 0 };
	/* Коробка — корпус вместе с ножками, её центр на пол-ножки ниже центра
	   масс, отсюда и полувысота. Числом не вписываю нарочно: разъедется с
	   constants.ts — и тест начнёт врать, а не падать. */
	const HY = BODY_H / 2 + FOOT_H / 2;

	function at(x: number, y: number, z = ROPE_Z): Rope {
		const rope = new Rope(ROPE_N, ROPE_SEG);
		for (let i = 0; i < ROPE_N; i++) {
			rope.p[i * 3] = x;
			rope.p[i * 3 + 1] = y;
			rope.p[i * 3 + 2] = z;
		}
		return rope;
	}

	it('точку внутри выталкивает наружу', () => {
		const rope = at(0.1, -0.1);
		rope.pushOutOfBox(box);
		const p = point(rope, 5);
		const outX = Math.abs(p.x) >= HALF_W - 1e-6;
		const outY = Math.abs(p.y + FOOT_H / 2) >= HY - 1e-6;
		expect(outX || outY).toBe(true);
	});

	it('точку снаружи не трогает', () => {
		const rope = at(2, 2);
		rope.pushOutOfBox(box);
		expect(point(rope, 5).x).toBeCloseTo(2, 6);
		expect(point(rope, 5).y).toBeCloseTo(2, 6);
	});

	it('выталкивает по ближней грани, а не по дальней', () => {
		// Точка у правого борта: до него 0.05, до дна — куда дальше
		const rope = at(0.5, -0.05);
		rope.pushOutOfBox(box);
		const p = point(rope, 5);
		expect(p.x).toBeGreaterThan(0.5);
		expect(p.y).toBeCloseTo(-0.05, 6);
	});

	it('глубина учитывается: за задней стенкой корпуса нет', () => {
		const rope = at(0, 0, -5);
		rope.pushOutOfBox(box);
		expect(point(rope, 5).x).toBeCloseTo(0, 6);
		expect(point(rope, 5).y).toBeCloseTo(0, 6);
	});

	it('skip оставляет первые точки внутри — провод выходит из корпуса', () => {
		const rope = at(0.1, -0.1);
		rope.pushOutOfBox({ ...box, skip: 3 });
		// Выталкивает тут по Y: до дна ближе, чем до борта
		expect(point(rope, 0).y).toBeCloseTo(-0.1, 6);
		expect(point(rope, 2).y).toBeCloseTo(-0.1, 6);
		expect(point(rope, 3).y).toBeLessThan(-0.4);
	});

	it('вилка толще звена, поэтому отходит дальше', () => {
		const rope = at(0.5, -0.05);
		rope.pushOutOfBox({ ...box, tailPad: 0.11 });
		expect(point(rope, ROPE_N - 1).x).toBeGreaterThan(point(rope, 5).x);
	});
});
