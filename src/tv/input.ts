/*
 * Ввод: перетаскивание, тычок, колесо, свайп по странице и наклон устройства.
 *
 * Канвас не перехватывает ввод. Попадания по корпусу считаются рейкастом,
 * всё остальное уходит странице, поэтому ссылки и выделение текста живы.
 *
 * Целей две, и они не равны: корпус и вилка на конце шнура. Вилка проверяется
 * первой — она мельче, висит отдельно и промахнуться по ней легче; за корпус
 * же попасть просто, и уступить ему первенство значило бы иногда хватать
 * телевизор вместо того, за чем тянулись.
 */

import * as THREE from 'three';

import { HALF_W, ROPE_Z, type TvParams } from './constants.js';
import {
	clamp,
	type BodyState,
	type DragState,
	type PhysicsEnv,
	type PlugHold,
} from './physics.js';

interface DragTracking extends DragState {
	id: number;
	dx: number;
	dy: number;
	t0: number;
	x0: number;
	y0: number;
	hist: { t: number; x: number; y: number }[];
}

export interface InputDeps {
	el: HTMLElement;
	camera: THREE.PerspectiveCamera;
	rig: THREE.Group;
	proxy: THREE.Object3D;
	/** Сама вилка: её положение в координатах rig — начало отсчёта для захвата. */
	plugObject: THREE.Object3D;
	/** Мишень на вилке. Живёт в группе вилки и ездит вместе с ней. */
	plugProxy: THREE.Object3D;
	/** Куда тянут вилку. Пишем сюда, читает физика. */
	plug: PlugHold;
	params: TvParams;
	state: BodyState;
	env: PhysicsEnv;
	onWake: () => void;
	onFlash: (amount: number) => void;
	/**
	 * Зритель тронул телевизор: тык, бросок, колесо или свайп по странице.
	 * Отскоки сюда не попадают, и в этом весь смысл — новый канал заказывает
	 * человек, а не физика.
	 */
	onImpulse: () => void;
}

export interface Input {
	drag: DragState;
	attach: () => void;
	detach: () => void;
	/** Колесо и свайп дёргает ещё и стенд — жест иначе не проверить без телефона. */
	wheel: (deltaY: number) => void;
	swipeImpulse: (vx: number, vy: number) => void;
}

export function createInput(deps: InputDeps): Input {
	const { el, camera, rig, proxy, plugObject, plugProxy, plug, params, state: S, env } = deps;
	const { onWake, onFlash, onImpulse } = deps;

	const raycaster = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	const hitPoint = new THREE.Vector3();
	const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
	const ropePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

	/** Палец, держащий вилку. -1 — не держат. */
	let plugId = -1;
	let plugDx = 0;
	let plugDy = 0;

	const drag: DragTracking = {
		active: false,
		id: -1,
		tx: 0,
		ty: 0,
		dx: 0,
		dy: 0,
		t0: 0,
		x0: 0,
		y0: 0,
		hist: [],
	};

	function toNdc(e: { clientX: number; clientY: number }): DOMRect {
		const r = el.getBoundingClientRect();
		ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
		ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
		return r;
	}

	// Точка курсора, спроецированная на плоскость z=0, в координатах rig
	function pointerWorld(e: { clientX: number; clientY: number }): THREE.Vector3 {
		toNdc(e);
		raycaster.setFromCamera(ndc, camera);
		raycaster.ray.intersectPlane(plane, hitPoint);
		rig.worldToLocal(hitPoint);
		return hitPoint;
	}

	/*
	 * То же самое, но на плоскости шнура, а не корпуса.
	 *
	 * Отдельная плоскость нужна из-за перспективы: шнур живёт на треть
	 * единицы позади центра корпуса, и точка, снятая с плоскости корпуса,
	 * уехала бы от курсора тем сильнее, чем дальше вилка от середины кадра.
	 * Она читается как «вилка не слушается руки».
	 *
	 * Rig только двигают и масштабируют, поворотов у него нет, поэтому мировая
	 * глубина плоскости считается одним умножением.
	 */
	function pointerOnRopePlane(e: { clientX: number; clientY: number }): THREE.Vector3 {
		toNdc(e);
		raycaster.setFromCamera(ndc, camera);
		ropePlane.constant = -(ROPE_Z * rig.scale.z + rig.position.z);
		raycaster.ray.intersectPlane(ropePlane, hitPoint);
		rig.worldToLocal(hitPoint);
		return hitPoint;
	}

	function hitPlug(e: { clientX: number; clientY: number }): boolean {
		const under = document.elementFromPoint(e.clientX, e.clientY);
		if (under && under.closest('a, button, input, textarea, select, label')) return false;
		toNdc(e);
		if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return false;
		raycaster.setFromCamera(ndc, camera);
		return raycaster.intersectObject(plugProxy, false).length > 0;
	}

	function hitTV(e: { clientX: number; clientY: number }): boolean {
		// Канвас с pointer-events:none, поэтому под курсором виден реальный
		// элемент страницы. Если это ссылка — телевизор молчит, клик её.
		const under = document.elementFromPoint(e.clientX, e.clientY);
		if (under && under.closest('a, button, input, textarea, select, label')) return false;
		toNdc(e);
		if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return false;
		raycaster.setFromCamera(ndc, camera);
		return raycaster.intersectObject(proxy, false).length > 0;
	}

	let hovering = false;
	let hoverThrottle = 0;

	function onPointerDown(e: PointerEvent): void {
		if (e.button !== undefined && e.button !== 0) return;
		if (plugId < 0 && hitPlug(e)) {
			const p = pointerOnRopePlane(e);
			plugId = e.pointerId;
			// Смещение от точки касания до самой вилки: без него она прыгает
			// центром под палец, а держат её за то место, куда ткнули.
			plugDx = plugObject.position.x - p.x;
			plugDy = plugObject.position.y - p.y;
			plug.active = true;
			plug.tx = p.x + plugDx;
			plug.ty = p.y + plugDy;
			plug.tz = ROPE_Z;
			document.body.style.userSelect = 'none';
			document.body.style.cursor = 'grabbing';
			onWake();
			e.preventDefault();
			return;
		}
		if (!hitTV(e)) return;
		const p = pointerWorld(e);
		drag.active = true;
		drag.id = e.pointerId;
		drag.dx = S.x - p.x;
		drag.dy = S.y - p.y;
		drag.tx = S.x;
		drag.ty = S.y;
		drag.t0 = performance.now();
		drag.x0 = e.clientX;
		drag.y0 = e.clientY;
		drag.hist.length = 0;
		document.body.style.userSelect = 'none';
		document.body.style.cursor = 'grabbing';
		onWake();
		e.preventDefault();
	}

	function onPointerMove(e: PointerEvent): void {
		if (plug.active && e.pointerId === plugId) {
			const p = pointerOnRopePlane(e);
			plug.tx = p.x + plugDx;
			plug.ty = p.y + plugDy;
			onWake();
			return;
		}
		if (drag.active && e.pointerId === drag.id) {
			const p = pointerWorld(e);
			drag.tx = p.x + drag.dx;
			drag.ty = p.y + drag.dy;
			drag.hist.push({ t: performance.now(), x: drag.tx, y: drag.ty });
			if (drag.hist.length > 5) drag.hist.shift();
			onWake();
			return;
		}
		const now = performance.now();
		if (now - hoverThrottle < 33) return;
		hoverThrottle = now;
		const over = hitPlug(e) || hitTV(e);
		if (over !== hovering) {
			hovering = over;
			document.body.style.cursor = over ? 'grab' : '';
		}
	}

	function onPointerUp(e: PointerEvent): void {
		if (plug.active && e.pointerId === plugId) {
			// Отпустили — и всё. Скорость вилке отдавать не надо: верле хранит
			// её разностью соседних кадров, и рука уже записала туда свой жест.
			plug.active = false;
			plug.tension = 0;
			plugId = -1;
			document.body.style.userSelect = '';
			document.body.style.cursor = hovering ? 'grab' : '';
			onWake();
			return;
		}
		if (!drag.active || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
		drag.active = false;
		document.body.style.userSelect = '';
		document.body.style.cursor = hovering ? 'grab' : '';

		const moved = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
		const held = performance.now() - drag.t0;

		if (moved < 6 && held < 250) {
			// Короткий тык — подскок. Клик по краю закручивает сильнее, чем по центру.
			const off = clamp((pointerWorld(e).x - S.x) / HALF_W, -1, 1);
			S.vy += params.kickV + Math.random() * 1.5;
			S.vx += off * 2.0;
			S.om -= off * 14.0;
			onFlash(0.6);
			onImpulse();
		} else if (drag.hist.length > 1) {
			// Бросок: скорость считаем по последним кадрам жеста
			const a = drag.hist[0]!;
			const b = drag.hist[drag.hist.length - 1]!;
			const dt = Math.max((b.t - a.t) / 1000, 1 / 120);
			S.vx = clamp(((b.x - a.x) / dt) * 1.1, -14, 14);
			S.vy = clamp(((b.y - a.y) / dt) * 1.1, -14, 14);
			S.om += clamp(-S.vx * 1.2, -10, 10);
			onImpulse();
		}
		onWake();
	}

	// Страница одноэкранная и не скроллится, поэтому колесо — просто импульс.
	// passive и без preventDefault: Ctrl+колесо (зум браузера) не ломаем.
	function wheel(deltaY: number): void {
		const d = clamp(deltaY, -110, 110);
		if (!d) return;
		S.vx += d * params.wheelV;
		S.om -= d * params.wheelV * 0.33;
		S.vy += Math.abs(d) * params.wheelV * 0.85;
		onImpulse();
		onWake();
	}

	function onWheel(e: WheelEvent): void {
		wheel(e.deltaY);
	}

	/* ── Свайп ──────────────────────────────────────────────────────────────
	 * Страница одноэкранная, и на iOS вертикальный жест по ней уходит в
	 * резинку. Подавлять это не хочется: жест штатный, привычный и приятный —
	 * поэтому он не гасится, а используется. Свайп мимо корпуса качает страницу
	 * как обычно и заодно подбрасывает телевизор.
	 *
	 * Слушаем touchmove, а не scroll: страница нескроллируемая, и событие
	 * scroll на резинке в разных версиях Safari приходит по-разному или не
	 * приходит вовсе, а координаты пальца есть всегда. Всё passive и без
	 * preventDefault — ни скролл, ни резинка не трогаются.
	 *
	 * Палец, начавший жест на корпусе, — это перетаскивание, и оно тут не
	 * участвует: свайп смотрит только на жесты мимо телевизора.
	 */
	const swipe = { x: 0, y: 0, t: 0, id: null as number | null, cool: 0 };

	function onTouchStart(e: TouchEvent): void {
		if (drag.active || plug.active) return;
		const t = e.changedTouches[0];
		if (!t) return;
		swipe.id = t.identifier;
		swipe.x = t.clientX;
		swipe.y = t.clientY;
		swipe.t = performance.now();
	}

	function onTouchMove(e: TouchEvent): void {
		if (drag.active || plug.active || swipe.id === null) return;
		let t: Touch | null = null;
		for (const c of e.changedTouches) {
			if (c.identifier === swipe.id) {
				t = c;
				break;
			}
		}
		if (!t) return;

		const now = performance.now();
		const dt = Math.max((now - swipe.t) / 1000, 1 / 120);
		const dx = t.clientX - swipe.x;
		const dy = t.clientY - swipe.y;
		swipe.x = t.clientX;
		swipe.y = t.clientY;
		swipe.t = now;

		// Скорость жеста в px/с. Порог отсекает медленное ведение пальцем:
		// подпрыгивать должен именно бросок, а не любое касание.
		const vy = dy / dt;
		const vx = dx / dt;
		if (Math.hypot(vx, vy) < 900 || now < swipe.cool) return;

		// Один свайп — один прыжок: без паузы длинный жест сыпал бы импульсами
		// каждый кадр, и телевизор улетал бы в потолок.
		swipe.cool = now + 420;
		swipeImpulse(vx, vy);
	}

	// Скорость жеста в px/с → импульс. Отдельно от обработчика, потому что то
	// же самое дёргает стенд кнопкой: жест иначе не проверить без телефона.
	function swipeImpulse(vx: number, vy: number): void {
		// Подбрасывает любой резкий жест, вверх или вниз: подпрыгнуть от тряски
		// страницы честнее, чем угадывать намерение по знаку. Горизонталь идёт
		// вбок и в закрутку — та же логика, что у колеса.
		const k = clamp(Math.hypot(vx, vy) / 1000, 0, 3.2);
		const side = clamp(vx / 1000, -2, 2);
		S.vy += k * params.swipeV * 34;
		S.vx += side * params.swipeV * 26;
		S.om -= side * params.swipeV * 90;
		onFlash(0.45);
		onImpulse();
		onWake();
	}

	function onTouchEnd(e: TouchEvent): void {
		for (const c of e.changedTouches) {
			if (c.identifier === swipe.id) {
				swipe.id = null;
				return;
			}
		}
	}

	function onOrient(e: DeviceOrientationEvent): void {
		if (e.gamma === null || e.gamma === undefined) return;
		env.tiltG = clamp(e.gamma / 45, -1, 1) * 0.45;
		if (Math.abs(env.tiltG) > 0.05) onWake();
	}

	function attach(): void {
		window.addEventListener('pointerdown', onPointerDown, { passive: false });
		window.addEventListener('pointermove', onPointerMove, { passive: true });
		window.addEventListener('pointerup', onPointerUp, { passive: true });
		window.addEventListener('pointercancel', onPointerUp, { passive: true });
		window.addEventListener('wheel', onWheel, { passive: true });
		window.addEventListener('touchstart', onTouchStart, { passive: true });
		window.addEventListener('touchmove', onTouchMove, { passive: true });
		window.addEventListener('touchend', onTouchEnd, { passive: true });
		window.addEventListener('touchcancel', onTouchEnd, { passive: true });
		window.addEventListener('deviceorientation', onOrient, { passive: true });
	}

	function detach(): void {
		plug.active = false;
		plugId = -1;
		window.removeEventListener('pointerdown', onPointerDown);
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', onPointerUp);
		window.removeEventListener('pointercancel', onPointerUp);
		window.removeEventListener('wheel', onWheel);
		window.removeEventListener('touchstart', onTouchStart);
		window.removeEventListener('touchmove', onTouchMove);
		window.removeEventListener('touchend', onTouchEnd);
		window.removeEventListener('touchcancel', onTouchEnd);
		window.removeEventListener('deviceorientation', onOrient);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
	}

	return { drag, attach, detach, wheel, swipeImpulse };
}
