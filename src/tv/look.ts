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
		/** Тёмная внутренняя ступень между рамкой и стеклом. */
		lipW: number;
		lipH: number;
		lipR: number;
		lipDepth: number;
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
	details: {
		/** Паз между передней и задней половинами корпуса. */
		seamZ: number;
		seamWidth: number;
		/** Пять прорезей на крышке; шаг и размер заданы отдельно. */
		ventW: number;
		ventD: number;
		ventGap: number;
		ventZ: number;
	};
}

/**
 * Оплётка шнура: тканевый рукав, а не гладкая резина.
 *
 * Рисунок процедурный — квадратная плитка, которая размножается по длине и
 * по окружности трубки. Штрихи сидят по центрам клеток в шахматном порядке
 * и за края клетки не выходят, поэтому плитка стыкуется сама с собой без
 * шва, каким бы ни был repeat.
 *
 * Зачем вообще: чёрный шнур на тёмной теме сливался с фоном. Пунктир
 * поднимает среднюю светлоту нити до середины между бумагой и темнотой, и
 * шнур виден на обоих фонах, оставаясь при этом тёмным на просвет.
 */
export interface CordSpec {
	/** Цвет нити между штрихами. */
	base: string;
	/** Цвет пунктира. */
	fleck: string;
	/** Клеток по стороне плитки; шахматка выбирает половину из них. */
	cells: number;
	/** Длина штриха в долях клетки. Больше 1 — штрихи полезут за край и шов станет виден. */
	dash: number;
	/** Толщина штриха в долях стороны плитки. */
	width: number;
	/** Наклон штриха, радианы. */
	skew: number;
	/** Повторов плитки по окружности и по длине шнура. */
	repeat: [number, number];
}

/**
 * Шероховатость корпуса — карта нормалей, посчитанная процедурно.
 *
 * Готовую картинку сюда класть нельзя: в репозитории нет ни одного файла с
 * текстурой, всё рисуется кодом (оплётка шнура, тень, карта среды), и
 * скачанная карта на пару сотен килобайт снесла бы бюджет чанка ради того,
 * что считается полусотней строк.
 *
 * Считается так: поле высот из клеточного шума (Вороного) двух масштабов
 * плюс попиксельный шум, затем нормали конечными разностями по нему. Решётка
 * замкнута по модулю, поэтому плитка сходится сама с собой без шва.
 *
 * Клеточный, а не сглаженный значения-шум: у второго нет граней, нормаль по
 * нему меняется плавно, и блик не дробится, а размазывается — поверхность
 * выходит мутной. Резкие складки там, где точки равноудалены, и дают зерно.
 */
export interface GrainSpec {
	/** Сторона плитки в текселях. */
	size: number;
	/**
	 * Ячеек на сторону плитки: чем больше, тем мельче зерно в самой плитке.
	 *
	 * Мельчить зерно надо не этим числом, а repeat. Здесь мельче — значит
	 * меньше текселей на ячейку в самой картинке: при 512 и 56 их девять,
	 * а вдвое больше ячеек оставит четыре, и складки клеточного шума
	 * начнут ступенчато рваться. Плитка обязана оставаться резкой.
	 */
	cells: number;
	/** Крутизна склонов в поле высот — «глубина» шероховатости. */
	relief: number;
	/**
	 * Во сколько раз плитка повторяется по грани корпуса — вот чем меняется
	 * размер зерна на экране. Плитка при этом не трогается: она бесшовна по
	 * модулю, и ячейки в ней остаются такими же резкими.
	 *
	 * Предел здесь не в плитке, а в грани. cells·repeat — это ячеек на грань,
	 * и когда их становится больше, чем у грани пикселей, мипмап усредняет
	 * рельеф в гладь. Считать надо по самой узкой грани, а не по фасаду: на
	 * развороте в три четверти бок сжат до ~60 px против ~200 у фасада,
	 * и пропадает он первым. При 56×2 бок держится только на анизотропии —
	 * без неё он вылизывается в пластик, см. cabinet.ts.
	 */
	repeat: number;
	/** Сила рельефа в материале. Ноль — гладкий корпус, как было. */
	scale: number;
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
	cord: CordSpec;
	grain: GrainSpec;
}

export const LOOK: LookSpec = {
	shape: {
		// Углы скруглены крупно — главный приём игрушечного силуэта
		body: { w: BODY_W, h: BODY_H, d: BODY_D, round: 0.15, roundSegs: 8 },
		taper: { min: 0.93625, start: -0.5, end: 0.34 },
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
			lipW: 0.8,
			lipH: 0.48,
			lipR: 0.085,
			lipDepth: 0.018,
		},
		screen: {
			w: 0.86,
			h: 0.54,
			bulge: 0.075,
			power: 0.8,
			z: 0.385,
			glassOffset: 0.006,
			glassColor: '#c9e1df',
			glassRoughness: 0.12,
			glassOpacity: 0.16,
			glassIor: 1.52,
		},
		glow: { z: 1, dist: 0.907, decay: 0.58 },
		dish: { r: 0.19, squash: 0.42, z: -0.03, sink: 0.012 },
		screw: { rTop: 0.019, rBot: 0.026, h: 0.05, lift: 0.012 },
		antennas: {
			pivotX: 0.0855,
			pivotLift: 0.031,
			segR: [0.018125, 0.0155, 0.0105],
			segPart: [0.28, 0.33, 0.39],
			segTop: 1,
			crimpK: 1.29625,
			crimpH: 0.014,
			tipR: 0.015125,
			// Длины чуть разные: идеально симметричная пара выглядит технично,
			// а разная — глупо, что нам и нужно.
			arms: [
				{ side: -1, len: 0.494, splay: 0.37, back: -0.09 },
				{ side: 1, len: 0.49, splay: 0.33125, back: -0.06 },
			],
		},
		feet: { rTop: 0.0387, rBot: 0.015775, h: FOOT_H, x: 0.4075, z: 0.26, lift: 0.0139 },
		details: {
			seamZ: -0.22,
			seamWidth: 0.008,
			ventW: 0.18,
			ventD: 0.012,
			ventGap: 0.055,
			ventZ: -0.16,
		},
	},
	lights: {
		hemi: { ground: '#17130f', day: 1.65, night: 2.1 },
		key: { color: '#fff4df', day: 2.15, night: 1.05, pos: [-3.2, 2.4, 2.8] },
		fill: { intensity: 0.48, pos: [1.8, -0.1, 2.2] },
		rim: { color: '#d8e5ff', intensity: 0.72, pos: [1.8, 2.2, -2.8] },
		env: { intensity: 0.62, top: '#f5eadb', bottom: '#26201c' },
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
			// Белый — не цвет шнура, а отсутствие подкраски: цвет несёт
			// текстура оплётки (LOOK.cord), а three домножает её на color.
			// Любой другой оттенок здесь перекрасил бы и нить, и пунктир разом.
			color: '#ffffff',
			roughness: 0.86,
			metalness: 0,
			clearcoat: 0,
			clearcoatRoughness: 0,
			specularIntensity: 0.22,
		}, // тканевая оплётка
		plug: {
			color: '#e7dfc6',
			roughness: 0.52,
			metalness: 0,
			clearcoat: 0.14,
			clearcoatRoughness: 0.58,
			specularIntensity: 0.52,
		}, // кремовый карболит
	},
	// Шероховатость крашеного бакелита: мелкая, почти на пределе видимости.
	// Её задача — сбить пластиковую гладкость бликов, а не превратить корпус
	// в апельсиновую корку.
	//
	// 56 ячеек на плитку, две плитки на грань — 112 ячеек на фасад шириной
	// ~200 px при dpr 2. При dpr 1 телевизор вдвое мельче и зерно уходит в
	// намёк; это осознанно, вернуть его там можно только загрубив зерно
	// везде.
	grain: {
		size: 512,
		cells: 56,
		relief: 2.6,
		repeat: 2,
		scale: 0.75,
	},
	// Оплётка: чёрная нить в жёлтую крапину, как у довоенного шнура.
	//
	// Числа подобраны под размер шнура на экране, а не под красоту плитки в
	// отрыве от него: он там ~85 px в длину и ~4 px в ширину. Пять повторов
	// по четыре клетки дают штрих 2.5×1.1 px — это видно; вдвое мельче
	// мипмап усредняет в ровную заливку, и плетение пропадает.
	//
	// Второе ограничение — яркость. Усреднение идёт в линейном свете, где
	// светлый пунктир весит непропорционально много: при 10% площади и
	// пунктире #d9c88c шнур вдали выцветает в хаки #524b3c. Поэтому пунктир
	// приглушён до #b09a5e — вдали шнур остаётся тёмным #443c31, а вблизи
	// штрихи всё равно читаются.
	cord: {
		base: '#232028',
		fleck: '#b09a5e',
		cells: 4,
		dash: 0.6,
		width: 0.062,
		skew: -0.85,
		repeat: [1, 5],
	},
};
