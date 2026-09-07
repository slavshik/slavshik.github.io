import { describe, expect, it } from 'vitest';
import { LOOK } from '../../src/tv/look.js';
import { woodHeight } from '../../src/tv/wood.js';

const spec = LOOK.grain.wood;
describe('wood veneer', () => {
	it('tiles without colour or height discontinuities', () => {
		for (const t of [0, 0.13, 0.49, 0.83, 1]) {
			expect(woodHeight(0, t, spec)).toBeCloseTo(woodHeight(1, t, spec), 10);
			expect(woodHeight(t, 0, spec)).toBeCloseTo(woodHeight(t, 1, spec), 10);
		}
	});
	it('keeps long fibres, bounded height and deterministic detail', () => {
		let along = 0,
			across = 0;
		for (let i = 0; i < 128; i++) {
			const u = i / 128,
				v = ((i * 37) % 128) / 128;
			const h = woodHeight(u, v, spec);
			expect(h).toBeGreaterThanOrEqual(0);
			expect(h).toBeLessThanOrEqual(1);
			expect(woodHeight(u, v, spec)).toBe(h);
			along += Math.abs(h - woodHeight(u + 1 / 512, v, spec));
			across += Math.abs(h - woodHeight(u, v + 1 / 512, spec));
		}
		expect(across).toBeGreaterThan(along * 2);
	});
});
