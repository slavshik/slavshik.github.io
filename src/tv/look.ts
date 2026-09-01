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
	/** Лак поверх краски или полированного пластика. */
	clearcoat: number;
	clearcoatRoughness: number;
	/** Сила диэлектрического блика; на металлы почти не влияет. */
	specularIntensity: number;
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
	screen: {
		w: number;
		h: number;
		bulge: number;
		power: number;
		z: number;
		/** Второй купол над люминофором: настоящее отражающее стекло. */
		glassOffset: number;
		glassColor: string;
		glassRoughness: number;
		glassOpacity: number;
		glassIor: number;
	};
	/** Свет трубки внутри корпуса. */
	glow: { z: number; dist: number; decay: number };
	/** Широкий bloom вокруг трубки; центр прозрачен и картинку не засвечивает. */
	bloom: { w: number; h: number; z: number };
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
		screen: {
			w: 0.86,
			h: 0.54,
			bulge: 0.075,
			power: 0.8,
			z: 0.41,
			glassOffset: 0.006,
			glassColor: '#c9e1df',
			glassRoughness: 0.12,
			glassOpacity: 0.16,
			glassIor: 1.52,
		},
		glow: { z: 0.62, dist: 1.4, decay: 2 },
		bloom: { w: 2.25, h: 1.45, z: 0.515 },
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
		hemi: { ground: '#211b2b', day: 1.35, night: 0.85 },
		key: { color: '#fff1dc', day: 2.35, night: 1.7, pos: [-1.8, 2.4, 2.6] },
		fill: { intensity: 0.22, pos: [2.2, -0.4, 1.1] },
		rim: { color: '#b8d8ff', intensity: 0.48, pos: [0.7, 1.6, -2.4] },
		env: { intensity: 0.9, top: '#fff0d7', bottom: '#24222b' },
		exposure: 1.02,
		toneMapping: 'agx',
	},
	// Цвета корпуса нарочно одни и те же в светлой и тёмной теме: это игрушка,
	// а игрушка не перекрашивается от системной настройки.
	materials: {
		shell: {
			color: '#d94d32',
			roughness: 0.43,
			metalness: 0,
			clearcoat: 0.48,
			clearcoatRoughness: 0.32,
			specularIntensity: 0.78,
		}, // окрашенный бакелит
		bezel: {
			color: '#eedbbd',
			roughness: 0.44,
			metalness: 0,
			clearcoat: 0.24,
			clearcoatRoughness: 0.48,
			specularIntensity: 0.68,
		}, // сливочная рамка
		knob: {
			color: '#292631',
			roughness: 0.52,
			metalness: 0,
			clearcoat: 0.18,
			clearcoatRoughness: 0.46,
			specularIntensity: 0.56,
		}, // почти чёрный пластик
		steel: {
			color: '#b6bcc3',
			roughness: 0.27,
			metalness: 0.9,
			clearcoat: 0,
			clearcoatRoughness: 0,
			specularIntensity: 1,
		}, // хром антенн
		metal: {
			color: '#b97d24',
			roughness: 0.36,
			metalness: 0.86,
			clearcoat: 0,
			clearcoatRoughness: 0,
			specularIntensity: 1,
		}, // латунные штыри вилки
		cord: {
			color: '#292631',
			roughness: 0.9,
			metalness: 0,
			clearcoat: 0,
			clearcoatRoughness: 0,
			specularIntensity: 0.28,
		},
		plug: {
			color: '#24222b',
			roughness: 0.6,
			metalness: 0,
			clearcoat: 0.08,
			clearcoatRoughness: 0.65,
			specularIntensity: 0.45,
		}, // чёрный корпус вилки
	},
};
