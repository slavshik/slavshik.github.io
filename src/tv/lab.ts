/*
 * Пульт стенда /lab/tv.html.
 *
 * Отдельная точка входа нарочно: всё, что здесь, нужно только стенду, и в
 * куске, который скачивает посетитель, ему делать нечего.
 */

import type * as THREE from 'three';

import { HALF_H, ROPE_N, ROPE_SEG, ROPE_Z } from './constants.js';
import type { TvInternals } from './index.js';

export interface LabControls extends TvInternals {
	kick: (force?: number) => void;
	swipe: (vx?: number, vy?: number) => void;
	/**
	 * Взять вилку и утащить её в сторону на заданное число длин шнура, а
	 * через секунду отпустить. Мышью то же самое проверяется, но не в
	 * headless-браузере и не одной строкой из консоли.
	 *
	 * По умолчанию — вверх и на две с лишним длины: шнур обязан не просто
	 * распрямиться, а перетянуть, иначе тянуть будет нечем. Вверх, а не вбок,
	 * потому что вбок телевизор упирается в стенку сцены — на широком окне
	 * он и так стоит у самого правого края, и тянуть его туда некуда.
	 */
	tugPlug: (dx?: number, dy?: number, ms?: number) => void;
	reset: () => void;
	setWireframe: (v: boolean) => void;
	/** Историческое имя: стенд знает телевизор как tv. */
	tv: TvInternals['parts'];
}

export function createLabControls(internals: TvInternals): LabControls {
	const { state: S, params, env, parts, wake, flash } = internals;

	return {
		...internals,
		tv: parts,

		kick(force?: number) {
			S.vy += force === undefined ? params.kickV : force;
			S.om -= (Math.random() - 0.5) * 12;
			flash(0.6);
			wake();
		},

		swipe(vx?: number, vy?: number) {
			internals.swipeImpulse(vx ?? 0, vy === undefined ? -1600 : vy);
		},

		tugPlug(dx = 0.8, dy = 2.2, ms = 900) {
			const hold = internals.plugHold;
			const len = (ROPE_N - 1) * ROPE_SEG;
			hold.tx = S.x + dx * len;
			hold.ty = S.y + dy * len;
			hold.tz = ROPE_Z;
			hold.active = true;
			wake();
			setTimeout(() => {
				hold.active = false;
				hold.tension = 0;
				wake();
			}, ms);
		},

		reset() {
			S.x = env.homeX;
			S.y = HALF_H;
			S.th = 0;
			S.vx = S.vy = S.om = 0;
			internals.syncPrev();
			internals.resetScreen();
			internals.resetRope();
			wake();
		},

		setWireframe(v: boolean) {
			parts.body.traverse((o) => {
				const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
				if ((o as THREE.Mesh).isMesh && m && m.wireframe !== undefined) m.wireframe = !!v;
			});
		},
	};
}
