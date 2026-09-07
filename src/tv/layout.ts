/*
 * Раскладка: размер игрушки, её домашнее место и границы сцены.
 *
 * Всё считается от вёрстки страницы, а не долями от канваса — телевизор
 * стоит рядом с именем, и знать, где кончаются буквы, может только вёрстка.
 */

import * as THREE from 'three';

import { CAM_DIST, FOV, HALF_W, TV_VIS_H, type TvParams } from './constants.js';
import { clamp, type BodyState, type PhysicsEnv } from './physics.js';

export interface LayoutDeps {
	el: HTMLElement;
	renderer: THREE.WebGLRenderer;
	camera: THREE.PerspectiveCamera;
	rig: THREE.Group;
	params: TvParams;
	state: BodyState;
	/** Границы сцены, которые раскладка обязана держать в актуальном виде. */
	env: PhysicsEnv;
	/** Буфер пересоздан — надо синхронно нарисовать кадр по свежему состоянию. */
	onResized: () => void;
	/** Раскладка всегда будит физику: границы поехали, спать на старых нельзя. */
	onApplied: () => void;
}

export interface Layout {
	apply: () => void;
}

export function createLayout(deps: LayoutDeps): Layout {
	const { el, renderer, camera, rig, params, state, env } = deps;

	let lastW = 0;
	let lastH = 0;
	let lastDpr = 0;

	function apply(): void {
		const w = el.clientWidth || 1;
		const h = el.clientHeight || 1;
		// DPR считаем здесь же: переезд окна на другой монитор его меняет
		const dpr = Math.min(window.devicePixelRatio || 1, 2);

		// ResizeObserver дёргается пачками, а каждый setSize пересоздаёт буфер и
		// очищает канвас. Трогаем рендерер только когда размер правда изменился.
		const resized = w !== lastW || h !== lastH || dpr !== lastDpr;
		if (resized) {
			renderer.setPixelRatio(dpr);
			renderer.setSize(w, h, false);
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
			lastW = w;
			lastH = h;
			lastDpr = dpr;
		}

		const worldH = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAM_DIST;
		const worldW = worldH * (w / h);

		const narrow = w < 680;

		// Канвас во весь вьюпорт, но размер телевизора и его место в кадре
		// считаются от «сцены» — прямоугольника прежних габаритов у заголовка.
		// Иначе на высоком окне игрушку раздувало бы заодно с канвасом.
		const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
		const stageH = Math.min(h * 0.58, rem * 28);

		const targetPx = clamp(stageH * (narrow ? 0.3 : 0.36), 96, 250);
		const s = (targetPx * (worldH / h)) / TV_VIS_H;
		rig.scale.setScalar(s);

		// halfW от высоты окна не зависит: targetPx считается от stageH, и высота
		// из формулы сокращается. Поэтому разъезд по горизонтали остался прежним,
		// а halfH вырос вместе с канвасом — это и есть «летать по всему вьюпорту».
		const halfW = worldW / 2 / s;
		env.halfH = worldH / 2 / s;

		// Пол ставим от заголовка, а не от края окна: main центрируется по
		// вертикали, и на высоком экране телевизор иначе отрывается от композиции
		// и висит сам по себе. Коэффициент разный по ширине, потому что от неё
		// зависит и расположение: на широком телевизор стоит справа от текста и
		// низу можно заходить на имя — там ножки и провод; на узком он висит прямо
		// над колонкой, и на буквы заходить не должен.
		// Заголовок скрыт или его нет (стенд с выключенным текстом) — считаем
		// от центра сцены, как было раньше.
		const heading = document.querySelector('h1');
		const hr = heading ? heading.getBoundingClientRect() : null;

		// Пол — по низу фамилии, одинаково на широком и узком. Раньше широкий
		// считал от волосяной линии, а узкий подвешивал телевизор над заголовком
		// долей от stageH; и то и другое ни к чему в вёрстке не привязано, а
		// просили ровно одного: чтобы ножки стояли на нижнем крае второй строки
		// имени. У h1 line-height 0.95, поэтому низ его бокса и есть этот край.
		// floorGap приподнимает игрушку над ним — на случай подгонки.
		const floorPx =
			hr && hr.height > 0
				? hr.bottom - params.floorGap
				: stageH * 0.5 * (1 + (narrow ? 0.02 : 0.34));

		rig.position.y = (h / 2 - floorPx) * (worldH / h);

		// Телевизор стоит сразу за именем: левый борт корпуса — у правого края
		// текста заголовка, с зазором homeGap. Считается от вёрстки, а не долей
		// от halfW: доля не знает, где на самом деле кончаются буквы.
		//
		// Край берётся у Range по содержимому, а не у бокса h1. Бокс блочный и
		// растянут во всю колонку — по нему телевизор встал бы далеко правее
		// букв, с дырой посередине. Range даёт объединение строк, то есть правый
		// край длинной из двух: имени.
		//
		// Если справа не хватает места, игрушка уезжает за край — так и просили:
		// сначала имя и фамилия, телевизор следом и пусть будет обрезан.
		const pxToLocal = worldH / h / s;
		let textRight = w / 2;
		if (heading) {
			const range = document.createRange();
			range.selectNodeContents(heading);
			const tr = range.getBoundingClientRect();
			if (tr.width > 0) textRight = tr.right;
		}
		// Правый борт — у правого края колонки, там же, где кончается волосяная
		// линия: справа от имени обычно остаётся место, и прижимать игрушку
		// вплотную к буквам значит это место выбросить. h1 блочный, поэтому его
		// бокс и есть колонка.
		//
		// Но ближе homeGap к буквам корпус не подходит. Если имя длинное и места
		// не остаётся, эта граница побеждает, и телевизор уезжает за правый край
		// экрана — сначала имя и фамилия, телевизор следом и пусть обрезан.
		const colRight = hr && hr.width > 0 ? hr.right : w / 2;
		const tvW = (2 * HALF_W) / pxToLocal;
		const rightPx = Math.max(colRight, textRight + params.homeGap + tvW);
		env.homeX = (rightPx - w / 2) * pxToLocal - HALF_W;

		// Стены не должны спорить с домашней позицией: если дом оказался за краем
		// канваса, предел раздвигается. Иначе пружина тянет влево, стенка толкает
		// вправо, и телевизор дрожит на границе, никогда не засыпая.
		env.limX = Math.max(halfW - HALF_W * 0.9, Math.abs(env.homeX) + HALF_W * 0.2);

		if (state.sleeping) state.x = env.homeX;

		// Свежий буфер пуст, а спящий цикл рисует через кадр — вот в этот зазор и
		// проваливалась картинка при перетаскивании окна. Рисуем кадр сразу же и
		// по актуальному состоянию, чтобы пустого канваса не увидел никто.
		if (resized) deps.onResized();

		deps.onApplied();
	}

	return { apply };
}
