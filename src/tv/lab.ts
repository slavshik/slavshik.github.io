/*
 * Пульт стенда /lab/tv.html.
 *
 * Отдельная точка входа нарочно: всё, что здесь, нужно только стенду, и в
 * куске, который скачивает посетитель, ему делать нечего.
 */

import type * as THREE from 'three';

import { HALF_H } from './constants.js';
import type { TvInternals } from './index.js';

export interface LabControls extends TvInternals {
  kick: (force?: number) => void;
  swipe: (vx?: number, vy?: number) => void;
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
