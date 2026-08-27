/*
 * Облик: форма корпуса, материалы и свет — числами, без three и без DOM.
 *
 * Единственный источник правды о том, как телевизор выглядит. Сцена
 * (cabinet.ts, lighting.ts) собирает объекты по этой спеке, стенд
 * /lab/look.html крутит её вживую, а результат тюнинга возвращается сюда
 * простой заменой чисел.
 *
 * Габариты корпуса сеются из constants.ts: физика, рейкаст-прокси и
 * раскладка меряют телевизор оттуда же, и два источника размеров разошлись
 * бы при первом же тюнинге. Если корпус меняет габариты — правится
 * constants.ts, а эта спека едет за ним.
 */

import { BODY_D, BODY_H, BODY_W, FOOT_H } from './constants.js';

/** Роли материалов корпуса — те же, которыми красит палитра. */
export type BodyRole = 'shell' | 'bezel' | 'knob' | 'steel' | 'metal' | 'cord' | 'plug';

export interface MaterialSpec {
	color: string;
	roughness: number;
	metalness: number;
}

export interface ShapeSpec {
	body: { w: number; h: number; d: number; round: number; roundSegs: number };
	/** Сужение к затылку: min — во сколько раз ужат зад; start/end — доли глубины. */
	taper: { min: number; start: number; end: number };
	/** Постоянный разворот на три четверти. */
	tilt: { x: number; y: number };
	bezel: {
		w: number;
		h: number;
		r: number;
		holeW: number;
		holeH: number;
		holeR: number;
		depth: number;
		bevel: number;
		z: number;
	};
	screen: { w: number; h: number; bulge: number; power: number; z: number };
	/** Свет трубки внутри корпуса. */
	glow: { z: number; dist: number; decay: number };
	/** Аддитивное пятно-сияние перед рамкой. */
	halo: { w: number; h: number; z: number };
	dish: { r: number; squash: number; z: number; sink: number };
	screw: { rTop: number; rBot: number; h: number; lift: number };
	antennas: {
		pivotX: number;
		pivotLift: number;
		segR: [number, number, number];
		segPart: [number, number, number];
		segTop: number;
		crimpK: number;
		crimpH: number;
		tipR: number;
		arms: { side: number; len: number; splay: number; back: number }[];
	};
	feet: { rTop: number; rBot: number; h: number; x: number; z: number; lift: number };
}

export interface LightSpec {
	/** Небо полусферы — цвет бумаги страницы, поэтому его здесь нет. */
	hemi: { ground: string; day: number; night: number };
	key: { color: string; day: number; night: number; pos: [number, number, number] };
	/** Цвет заливки — акцент времени суток, поэтому его здесь нет. */
	fill: { intensity: number; pos: [number, number, number] };
	/** Контровой. По умолчанию выключен: ноль интенсивности — ноль пикселей. */
	rim: { color: string; intensity: number; pos: [number, number, number] };
	/** Карта среды из вертикального градиента. 0 — среды нет. */
	env: { intensity: number; top: string; bottom: string };
	exposure: number;
	toneMapping: 'none' | 'aces' | 'agx' | 'neutral';
}

export interface LookSpec {
	shape: ShapeSpec;
	lights: LightSpec;
	materials: Record<BodyRole, MaterialSpec>;
}

export const LOOK: LookSpec = {
	shape: {
		// Углы скруглены крупно — главный приём игрушечного силуэта
		body: { w: BODY_W, h: BODY_H, d: BODY_D, round: 0.15, roundSegs: 8 },
		taper: { min: 0.84, start: -0.5, end: 0.34 },
		tilt: { x: 0.17, y: -0.54 },
		bezel: {
			w: 0.98,
			h: 0.66,
			r: 0.13,
			holeW: 0.84,
			holeH: 0.52,
			holeR: 0.1,
			depth: 0.07,
			bevel: 0.012,
			z: 0.405,
		},
		screen: { w: 0.86, h: 0.54, bulge: 0.17, power: 0.8, z: 0.41 },
		glow: { z: 0.62, dist: 1.4, decay: 2 },
		halo: { w: 1.55, h: 1.0, z: 0.52 },
		dish: { r: 0.19, squash: 0.42, z: -0.03, sink: 0.012 },
		screw: { rTop: 0.019, rBot: 0.026, h: 0.05, lift: 0.012 },
		antennas: {
			pivotX: 0.05,
			pivotLift: 0.06,
			segR: [0.021, 0.0155, 0.0105],
			segPart: [0.28, 0.33, 0.39],
			segTop: 0.9,
			crimpK: 1.45,
			crimpH: 0.014,
			tipR: 0.027,
			// Длины чуть разные: идеально симметричная пара выглядит технично,
			// а разная — глупо, что нам и нужно.
			arms: [
				{ side: -1, len: 0.56, splay: 0.15, back: -0.09 },
				{ side: 1, len: 0.49, splay: 0.11, back: -0.06 },
			],
		},
		feet: { rTop: 0.03, rBot: 0.026, h: FOOT_H, x: 0.4, z: 0.26, lift: 0.012 },
	},
	lights: {
		hemi: { ground: '#1a1720', day: 2.2, night: 1.5 },
		key: { color: '#ffffff', day: 2.0, night: 1.6, pos: [-1.6, 2.0, 2.4] },
		fill: { intensity: 0.35, pos: [2.0, -0.6, 0.8] },
		rim: { color: '#ffffff', intensity: 0, pos: [0.4, 1.4, -2.2] },
		env: { intensity: 0, top: '#ffffff', bottom: '#3a3540' },
		exposure: 1,
		toneMapping: 'none',
	},
	// Цвета корпуса нарочно одни и те же в светлой и тёмной теме: это игрушка,
	// а игрушка не перекрашивается от системной настройки.
	materials: {
		shell: { color: '#e8543a', roughness: 0.85, metalness: 0.05 }, // тёплый красно-оранжевый
		bezel: { color: '#f6ead3', roughness: 0.9, metalness: 0.05 }, // сливочная рамка
		knob: { color: '#322f38', roughness: 0.8, metalness: 0.05 }, // почти чёрный
		steel: { color: '#b6bcc3', roughness: 0.32, metalness: 0.8 }, // колена антенн и шарики
		metal: { color: '#c08b2a', roughness: 0.34, metalness: 0.85 }, // латунные штыри вилки
		cord: { color: '#322f38', roughness: 0.85, metalness: 0.05 },
		plug: { color: '#2a2830', roughness: 0.85, metalness: 0.05 }, // чёрный корпус вилки
	},
};
