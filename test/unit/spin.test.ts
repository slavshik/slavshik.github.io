/*
 * Закрутка вилки: крутильный маятник на конце провода.
 *
 * Проверяется поведение, а не числа: спокойный провод вилку не крутит,
 * рывок — крутит, шнур возвращает её к нулю, и хвост затухания не мешает
 * телевизору заснуть.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULTS, type TvParams } from '../../src/tv/constants.js';
import { createSpinState, spinMoving, stepSpin } from '../../src/tv/physics.js';

const P: TvParams = DEFAULTS;
const DT = 1 / 120;

/** Прокрутить n шагов с постоянным моментом, вернуть наибольший угол по модулю. */
function run(drive: number, n: number, s = createSpinState()): number {
	let peak = 0;
	for (let i = 0; i < n; i++) {
		stepSpin(s, DT, drive, P);
		peak = Math.max(peak, Math.abs(s.a));
	}
	return peak;
}

describe('закрутка вилки', () => {
	it('без рывка не крутится вовсе', () => {
		const s = createSpinState();
		for (let i = 0; i < 600; i++) stepSpin(s, DT, 0, P);
		expect(s.a).toBe(0);
		expect(s.v).toBe(0);
		expect(spinMoving(s)).toBe(false);
	});

	it('рывок закручивает, и тем сильнее, чем он резче', () => {
		expect(run(1, 60)).toBeGreaterThan(0);
		expect(run(3, 60)).toBeGreaterThan(run(1, 60));
	});

	it('знак закрутки идёт за знаком рывка', () => {
		const l = createSpinState();
		const r = createSpinState();
		for (let i = 0; i < 40; i++) {
			stepSpin(l, DT, -2, P);
			stepSpin(r, DT, 2, P);
		}
		expect(l.a).toBeLessThan(0);
		expect(r.a).toBeGreaterThan(0);
	});

	it('шнур раскручивает вилку обратно к нулю, а не к ближайшему обороту', () => {
		const s = createSpinState();
		for (let i = 0; i < 60; i++) stepSpin(s, DT, 8, P);
		expect(Math.abs(s.a)).toBeGreaterThan(0.3);
		for (let i = 0; i < 3000; i++) stepSpin(s, DT, 0, P);
		expect(Math.abs(s.a)).toBeLessThan(0.01);
	});

	it('затухает, а не раскачивается: каждый следующий размах меньше', () => {
		const s = createSpinState();
		for (let i = 0; i < 60; i++) stepSpin(s, DT, 8, P);
		const first = run(0, 400, s);
		const second = run(0, 400, s);
		expect(second).toBeLessThan(first);
	});

	it('успокоившись, отпускает физику спать', () => {
		const s = createSpinState();
		for (let i = 0; i < 60; i++) stepSpin(s, DT, 8, P);
		expect(spinMoving(s)).toBe(true);
		let steps = 0;
		while (spinMoving(s) && steps < 12000) {
			stepSpin(s, DT, 0, P);
			steps++;
		}
		expect(spinMoving(s)).toBe(false);
		// Хвост не должен тянуться дольше нескольких секунд: пока он идёт,
		// телевизор не спит и гоняет кадры.
		expect(steps * DT).toBeLessThan(8);
	});
});
