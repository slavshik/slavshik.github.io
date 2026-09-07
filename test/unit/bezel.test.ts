import { expect, it } from 'vitest';
import { LOOK } from '../../src/tv/look.js';
import { bezelMesh } from '../../src/tv/bezel.js';

it('builds a closed frame with nondegenerate triangles', () => {
	const { positions: p, indices } = bezelMesh(LOOK.shape.bezel);
	const edges = new Map<string, number>();
	for (let i = 0; i < indices.length; i += 3) {
		const tri = indices.slice(i, i + 3);
		const [a, b, c] = tri.map((v) => p.slice(v * 3, v * 3 + 3));
		const u = b!.map((v, j) => v - a![j]!);
		const v = c!.map((v, j) => v - a![j]!);
		expect(
			Math.hypot(
				u[1]! * v[2]! - u[2]! * v[1]!,
				u[2]! * v[0]! - u[0]! * v[2]!,
				u[0]! * v[1]! - u[1]! * v[0]!,
			),
		).toBeGreaterThan(1e-12);
		for (let j = 0; j < 3; j++) {
			const edge = [tri[j]!, tri[(j + 1) % 3]!].sort((a, b) => a - b).join(',');
			edges.set(edge, (edges.get(edge) ?? 0) + 1);
		}
	}
	expect([...edges.values()].every((count) => count === 2)).toBe(true);
});

it('recesses the inner face while preserving the outer rim', () => {
	const spec = LOOK.shape.bezel;
	const mesh = bezelMesh(spec).positions;
	const flat = bezelMesh({ ...spec, innerLift: 0 }).positions;
	const deltas = mesh.filter((_, i) => i % 3 === 2).map((z, i) => z - flat[i * 3 + 2]!);
	expect(Math.min(...deltas)).toBeCloseTo(spec.innerLift);
	expect(Math.max(...deltas)).toBe(0);
});
