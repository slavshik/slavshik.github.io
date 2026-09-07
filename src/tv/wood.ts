import type { GrainSpec } from './look.js';

// Periodic value noise: unequal fibres, with no repeated sine-wave stripes.
function noise(x: number, y: number, nx: number, ny: number): number {
	const ix = Math.floor(x),
		iy = Math.floor(y);
	const fx = x - ix,
		fy = y - iy;
	const sx = fx * fx * (3 - 2 * fx),
		sy = fy * fy * (3 - 2 * fy);
	const hash = (a: number, b: number): number => {
		const n =
			Math.sin((((a % nx) + nx) % nx) * 127.1 + (((b % ny) + ny) % ny) * 311.7) * 43758.5453;
		return n - Math.floor(n);
	};
	const a = hash(ix, iy),
		b = hash(ix + 1, iy);
	const c = hash(ix, iy + 1),
		d = hash(ix + 1, iy + 1);
	return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/** Shared colour/height signal, seamless at integer UV boundaries. */
export function woodHeight(u: number, v: number, spec: GrainSpec['wood']): number {
	const bands = Math.max(1, Math.round(spec.bands));
	const warp = (noise(u * 3, v * 4, 3, 4) - 0.5) * spec.warp;
	const y = v * bands + warp;
	const fibres = noise(u * 4, y, 4, bands);
	const pores = noise(u * 24, y * 4, 24, bands * 4);
	const tone = noise(u * 2, v * 6, 2, 6);
	return 0.6 * fibres + 0.25 * pores + 0.15 * tone;
}
