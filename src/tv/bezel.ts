import type { ShapeSpec } from './look.js';

/** A closed moulded frame: matching perimeter samples prevent long cap triangles. */
export function bezelMesh(spec: ShapeSpec['bezel']): {
	positions: number[];
	uvs: number[];
	indices: number[];
} {
	const { segments, bevel: b, depth, innerLift } = spec;
	const positions: number[] = [],
		uvs: number[] = [],
		indices: number[] = [];
	const rings: [number, number, number][] = [];
	// Each ring is [outer-to-inner blend, contour expansion, depth].
	for (let j = 0; j <= segments; j++) {
		const a = ((j / segments) * Math.PI) / 2;
		rings.push([0, b * Math.cos(a), depth + b * Math.sin(a)]);
	}
	for (let j = 1; j <= segments; j++) {
		const t = j / segments;
		rings.push([t, 0, depth + b + innerLift * t * t * (3 - 2 * t)]);
	}
	for (let j = 1; j <= segments; j++) {
		const a = ((j / segments) * Math.PI) / 2;
		rings.push([1, -b * Math.sin(a), depth + b * Math.cos(a) + innerLift]);
	}
	rings.push([1, -b, 0]);
	for (let j = 1; j <= segments; j++) {
		const a = ((j / segments) * Math.PI) / 2;
		rings.push([1, -b * Math.cos(a), -b * Math.sin(a)]);
	}
	rings.push([0, 0, -b]);
	for (let j = 1; j <= segments; j++) {
		const a = ((j / segments) * Math.PI) / 2;
		rings.push([0, b * Math.sin(a), -b * Math.cos(a)]);
	}
	const arc = segments * 2,
		straight = segments;
	const count = 4 * (arc + straight);
	for (const [t, offset, z] of rings) {
		const w = spec.w + (spec.holeW - spec.w) * t + offset * 2;
		const h = spec.h + (spec.holeH - spec.h) * t + offset * 2;
		const r = spec.r + (spec.holeR - spec.r) * t + offset;
		const point = (corner: number, u: number): [number, number] => {
			// Quadratic corners match the original frame outline.
			const x = r * (1 - u * u),
				y = r * (2 * u - u * u);
			const a = (corner * Math.PI) / 2,
				c = Math.cos(a),
				s = Math.sin(a);
			return [
				Math.sign(c - s) * (w / 2 - r) + x * c - y * s,
				Math.sign(c + s) * (h / 2 - r) + x * s + y * c,
			];
		};
		const add = (x: number, y: number): void => {
			positions.push(x, y, z);
			uvs.push(x, y);
		};
		for (let corner = 0; corner < 4; corner++) {
			for (let j = 0; j < arc; j++) add(...point(corner, j / arc));
			const end = point(corner, 1),
				next = point((corner + 1) % 4, 0);
			for (let j = 0; j < straight; j++) {
				const u = j / straight;
				add(end[0] + (next[0] - end[0]) * u, end[1] + (next[1] - end[1]) * u);
			}
		}
	}
	for (let ring = 0; ring < rings.length; ring++) {
		for (let j = 0; j < count; j++) {
			const a = ring * count + j,
				b = ring * count + ((j + 1) % count);
			const c = ((ring + 1) % rings.length) * count + j;
			const d = ((ring + 1) % rings.length) * count + ((j + 1) % count);
			indices.push(a, b, c, b, d, c);
		}
	}
	return { positions, uvs, indices };
}
