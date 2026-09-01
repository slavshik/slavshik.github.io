/*
 * Кручение провода: крутильная цепочка вдоль верле-цепочки.
 *
 * Проверяется физика, а не подобранные числа. Главное здесь — что привод
 * кручения берётся из геометрии и обращается в ноль на плоском проводе:
 * ровно из-за этого цепочка и стала трёхмерной.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULTS, FIXED, ROPE_N, ROPE_SEG, ROPE_Z } from '../../src/tv/constants.js';
import { Rope, Twist, clampTwist, twistMoving } from '../../src/tv/physics.js';

const K = DEFAULTS.twistK;
const C = DEFAULTS.twistC;
const J = DEFAULTS.plugInertia;

function hang(curl: number, steps = 400): Rope {
	const rope = new Rope(ROPE_N, ROPE_SEG);
	rope.reset(0, 0, ROPE_Z);
	for (let i = 0; i < steps; i++) {
		rope.step(FIXED, 0, 0, ROPE_Z, DEFAULTS.ropeG, DEFAULTS.ropeDamp, curl, null);
	}
	return rope;
}

describe('привод кручения', () => {
	it('на плоском проводе тождественно ноль — крутить нечем', () => {
		const flat = hang(0);
		expect(clampTwist(flat, 0.4)).toBeCloseTo(0, 6);
		expect(clampTwist(flat, -1.2)).toBeCloseTo(0, 6);
	});

	it('свитый шнур выводит провод из плоскости, и привод оживает', () => {
		// Порог намеренно грубый: точная величина зависит от ropeCurl, а он
		// подбирается на глаз. Тест стережёт качество — что привод перестал
		// быть тождественным нулём, — а не подобранное число.
		const curly = hang(DEFAULTS.ropeCurl);
		const off = Math.abs(curly.p[3 * 3 + 2]! - ROPE_Z);
		expect(off).toBeGreaterThan(0.002);
		expect(Math.abs(clampTwist(curly, 0.4))).toBeGreaterThan(1e-3);
		// И что он на порядки больше, чем у плоского провода
		expect(Math.abs(clampTwist(curly, 0.4))).toBeGreaterThan(
			Math.abs(clampTwist(hang(0), 0.4)) + 1e-4,
		);
	});

	it('без крена корпуса не крутит даже свитый шнур', () => {
		// toBe(0) тут не годится: Object.is различает -0 и +0
		expect(clampTwist(hang(DEFAULTS.ropeCurl), 0)).toBeCloseTo(0, 12);
	});
});

describe('крутильная цепочка', () => {
	it('без защемления стоит на месте', () => {
		const t = new Twist(ROPE_N);
		for (let i = 0; i < 600; i++) t.step(FIXED, 0, K, C, J);
		expect(t.tail).toBe(0);
		expect(twistMoving(t)).toBe(false);
	});

	it('волна доходит от защемления до вилки, а не бьёт мгновенно', () => {
		const t = new Twist(ROPE_N);
		t.step(FIXED, 0.5, K, C, J);
		expect(t.tail).toBe(0); // за один шаг конец ещё не знает
		for (let i = 0; i < 200; i++) t.step(FIXED, 0.5, K, C, J);
		expect(Math.abs(t.tail)).toBeGreaterThan(0.1);
	});

	it('свободный конец доворачивает дальше защемления', () => {
		const t = new Twist(ROPE_N);
		let peak = 0;
		for (let i = 0; i < 600; i++) {
			t.step(FIXED, 0.5, K, C, J);
			peak = Math.max(peak, Math.abs(t.tail));
		}
		expect(peak).toBeGreaterThan(0.5);
	});

	it('знак кручения идёт за знаком крена', () => {
		const l = new Twist(ROPE_N);
		const r = new Twist(ROPE_N);
		for (let i = 0; i < 300; i++) {
			l.step(FIXED, -0.5, K, C, J);
			r.step(FIXED, 0.5, K, C, J);
		}
		expect(l.tail).toBeLessThan(0);
		expect(r.tail).toBeGreaterThan(0);
	});

	it('вилка тяжелее звена, поэтому отзывается медленнее', () => {
		const light = new Twist(ROPE_N);
		const heavy = new Twist(ROPE_N);
		for (let i = 0; i < 120; i++) {
			light.step(FIXED, 0.5, K, C, 1);
			heavy.step(FIXED, 0.5, K, C, 8);
		}
		expect(Math.abs(heavy.tail)).toBeLessThan(Math.abs(light.tail));
	});

	it('затухает и отпускает физику спать', () => {
		const t = new Twist(ROPE_N);
		for (let i = 0; i < 300; i++) t.step(FIXED, 0.5, K, C, J);
		expect(twistMoving(t)).toBe(true);
		let steps = 0;
		while (twistMoving(t) && steps < 20000) {
			t.step(FIXED, 0, K, C, J);
			steps++;
		}
		expect(twistMoving(t)).toBe(false);
		expect(steps * FIXED).toBeLessThan(8);
	});

	it('reset обнуляет всю цепочку, а не только конец', () => {
		const t = new Twist(ROPE_N);
		for (let i = 0; i < 300; i++) t.step(FIXED, 0.5, K, C, J);
		t.reset();
		expect([...t.a].every((v) => v === 0)).toBe(true);
		expect([...t.v].every((v) => v === 0)).toBe(true);
	});
});
