/*
 * Маленький ЭЛТ-телевизор в верхней части страницы.
 *
 * Правила, которые задают всю конструкцию:
 *   — модуль грузится лениво, после первой отрисовки, и только если WebGL есть
 *     и посетитель не просил убрать анимацию. Страница обязана быть полностью
 *     рабочей без него;
 *   — никаких внешних запросов: three собирается в наш же бандл, версия
 *     зафиксирована. Геометрия целиком процедурная, файлов моделей нет;
 *   — канвас не перехватывает ввод. Попадания по корпусу считаются рейкастом,
 *     всё остальное уходит странице, поэтому ссылки и выделение текста живы.
 *
 * mount(el) → { destroy(), internals }. internals нужен стенду /lab/tv.html
 * и больше никому: пульт собирается из него в ./lab.ts, чтобы код стенда не
 * уезжал в тот кусок, который скачивают посетители.
 */

import * as THREE from 'three';

import {
	CAM_DIST,
	DEFAULTS,
	FIXED,
	FOV,
	FROZEN_SETTLE,
	FROZEN_T,
	HALF_H,
	MAX_SUB,
	ROPE_N,
	ROPE_SEG,
	ROPE_Z,
	TV_VIS_H,
	type TvParams,
} from './constants.js';
import { createInput } from './input.js';
import { createLayout } from './layout.js';
import { createBloom } from './bloom.js';
import { createLighting } from './lighting.js';
import { LOOK } from './look.js';
import { readPalette, type Palette } from './palette.js';
import {
	Rope,
	anchorAt,
	createBodyState,
	createPlugHold,
	Twist,
	stepWorld,
	wake as wakeState,
	type BodyState,
	type PhysicsEnv,
	type PlugHold,
} from './physics.js';
import { updateRopeMesh } from './rope-view.js';
import { buildTV, shadowTexture, type TvParts } from './scene.js';
import { createScreenController } from './screen.js';

export interface MountOptions {
	params?: Partial<TvParams>;
	frozen?: boolean;
	forceDark?: boolean | null;
	/**
	 * Адрес n-го ролика для экрана. Функция, а не строка: по каждому пинку
	 * телевизор просит следующий, и как из номера получается адрес — дело
	 * страницы. Телевизор не знает, что этим же запросом считается визит:
	 * аналитика собирается снаружи. Пусто или неудача — на экране снег.
	 */
	broadcastUrl?: ((seq: number) => string) | null;
	/**
	 * Неподвижный кадр на экран вместо передачи. Только для скриншотных
	 * тестов: настоящая передача — это видео с эндпоинта, а видео в снимке
	 * недетерминировано (кодек, момент декодирования, кадр). Картинка же
	 * ложится в ту же uTex при uTexMix = 1, то есть проверяется ровно тот
	 * путь шейдера, по которому идёт живая передача.
	 */
	stillClip?: TexImageSource | null;
}

/** Ссылки на внутренности. Стенду — да, продакшену — нет. */
export interface TvInternals {
	params: TvParams;
	state: BodyState;
	env: PhysicsEnv;
	rope: Rope;
	/** Стенду — чтобы дёрнуть за вилку без мыши. */
	plugHold: PlugHold;
	renderer: THREE.WebGLRenderer;
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	rig: THREE.Group;
	parts: TvParts;
	wake: () => void;
	flash: (amount: number) => void;
	wheel: (deltaY: number) => void;
	swipeImpulse: (vx: number, vy: number) => void;
	refreshTheme: () => void;
	relayout: () => void;
	setPaused: (v: boolean) => void;
	setForceDark: (v: boolean | null) => void;
	resetScreen: () => void;
	syncPrev: () => void;
	resetRope: () => void;
}

export interface TvInstance {
	destroy: () => void;
	internals: TvInternals;
}

export function mount(el: HTMLElement, opts: MountOptions = {}): TvInstance {
	const params: TvParams = Object.assign({}, DEFAULTS, opts.params);
	// Неподвижный режим: один кадр и никакого цикла. Нужен скриншотным тестам,
	// которым важно, чтобы один и тот же коммит давал одну и ту же картинку.
	const frozen = !!opts.frozen;
	let forceDark: boolean | null = opts.forceDark === undefined ? null : opts.forceDark;
	let pal: Palette = readPalette(forceDark);

	// MSAA включён всегда. Раньше он выключался на плотных экранах в расчёте
	// на то, что пиксели там и так мелкие, — но канвас маленький, силуэт у
	// игрушки почти весь из наклонных рёбер, и лесенка на них видна на любом
	// DPR. Игрушка занимает четверть экрана и рисуется по кадру только когда
	// шевелится, так что платить за MSAA есть чем.
	const renderer = new THREE.WebGLRenderer({
		antialias: true,
		alpha: true,
		powerPreference: 'low-power',
	});
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	el.appendChild(renderer.domElement);

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20);
	camera.position.set(0, 0, CAM_DIST);

	const lighting = createLighting(scene, renderer, pal, LOOK.lights);

	/* Сияние трубки — пост-обработкой, а не мешем перед экраном. Форма его
	   берётся из уже нарисованного кадра, поэтому оно само следует за
	   картинкой: тёмный кадр почти не светит, снег светит ровно. Мигает им
	   uFlicker — розжиг, вспышка от удара, срыв кадра. */
	const bloom = createBloom(renderer);

	const rig = new THREE.Group();
	scene.add(rig);

	// Заготовки под ориентацию вилки: считается каждый кадр, аллокаций быть
	// не должно.
	const PLUG_AXIS = new THREE.Vector3(0, -1, 0);
	const plugDir = new THREE.Vector3();
	const plugQ = new THREE.Quaternion();
	const plugTwistQ = new THREE.Quaternion();

	const tv = buildTV(pal);
	rig.add(tv.body, tv.ropeMesh, tv.plug);

	// Шнур уходит вниз почти отвесно и на экране шириной в три-четыре
	// пикселя: плитка оплётки ложится на него сильно сжатой по одной оси, и
	// без анизотропии мипмап замывает пунктир в ровную серость. Предел
	// спрашиваем у железа — брать больше нечем, меньше незачем.
	const cordMap = (tv.ropeMesh.material as THREE.MeshPhysicalMaterial).map;
	if (cordMap) cordMap.anisotropy = renderer.capabilities.getMaxAnisotropy();

	const rope = new Rope(ROPE_N, ROPE_SEG);
	const twist = new Twist(ROPE_N);
	const plugHold = createPlugHold();

	const shadowTex = shadowTexture();
	const shadowMat = new THREE.MeshBasicMaterial({
		map: shadowTex,
		transparent: true,
		depthWrite: false,
		opacity: 0.5,
	});
	// Камера смотрит строго в лоб, поэтому «тень на полу» была бы видна с
	// ребра — тонкой полоской. Вместо неё мягкое пятно в плоскости кадра,
	// прижатое к ножкам: в такой проекции это читается как контактная тень.
	const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), shadowMat);
	shadow.position.z = -0.5;
	rig.add(shadow);

	/* ── Состояние физики ───────────────────────────────────────────────── */

	const S = createBodyState();
	let prev = { x: S.x, y: S.y, th: S.th };
	const env: PhysicsEnv = { tiltG: 0, homeX: 0, halfH: 1, limX: 1 };

	function wake(): void {
		wakeState(S);
	}

	const screen = createScreenController({
		parts: tv,
		bloom,
		state: S,
		wake,
		broadcastUrl: opts.broadcastUrl,
		frozen,
	});

	/* ── Ввод ───────────────────────────────────────────────────────────── */

	const input = createInput({
		el,
		camera,
		rig,
		proxy: tv.proxy,
		plugObject: tv.plug,
		plugProxy: tv.plugProxy,
		plug: plugHold,
		params,
		state: S,
		env,
		onWake: wake,
		onFlash: screen.flash,
		onImpulse: screen.requestChannel,
	});

	/* ── Шаг физики ─────────────────────────────────────────────────────── */

	const world = {
		state: S,
		params,
		env,
		drag: input.drag,
		plug: plugHold,
		antennas: tv.antennas,
		rope,
		twist,
	};

	function physicsStep(dt: number): void {
		const impact = stepWorld(world, dt);
		screen.afterPhysics(impact, plugHold);
	}

	/* ── Раскладка ──────────────────────────────────────────────────────── */

	const layout = createLayout({
		el,
		renderer,
		camera,
		rig,
		params,
		state: S,
		env,
		onResize: (w, h, dpr) => bloom.setSize(w, h, dpr),
		onResized: () => {
			syncMeshes(1);
			bloom.render(scene, camera);
		},
		onApplied: wake,
	});

	/* ── Тема ───────────────────────────────────────────────────────────── */

	function refreshTheme(): void {
		pal = readPalette(forceDark);
		const accent = new THREE.Color(pal.accent);
		(tv.screenMat.uniforms.uAccent!.value as THREE.Color).copy(accent);
		tv.glow.color.copy(accent);
		lighting.refresh(pal);
		tv.body.traverse((o) => {
			const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
			if (!(o as THREE.Mesh).isMesh || !m || !m.color) return;
			const role = m.userData.role as keyof Palette | undefined;
			if (role) m.color.set(pal[role] as string);
		});
		shadowMat.opacity = pal.dark ? 0.32 : 0.5;
	}

	/* ── Цикл ───────────────────────────────────────────────────────────── */

	let raf = 0;
	let last = 0;
	let acc = 0;
	let clock = 0;
	let parity = 0;
	let visible = true;
	let onScreen = true;
	let running = false;
	let paused = false;

	// Перенос состояния физики в меши. Вынесено из frame(), потому что то же
	// самое нужно раскладке: она после пересоздания буфера рисует кадр
	// синхронно, и рисовать этот кадр надо по свежему состоянию, а не по
	// позапрошлому. a — доля интерполяции между prev и текущим шагом.
	function syncMeshes(a: number): void {
		tv.body.position.x = prev.x + (S.x - prev.x) * a;
		tv.body.position.y = prev.y + (S.y - prev.y) * a;
		tv.body.rotation.z = prev.th + (S.th - prev.th) * a;
		for (const ant of tv.antennas) ant.pivot.rotation.z = ant.a;

		updateRopeMesh(tv.ropeGeo, rope, twist);

		// Вилка садится на последнюю точку. Ориентация — уже не один угол:
		// провод трёхмерный, и вилку надо и повернуть по последнему звену, и
		// довернуть вокруг него на собственное кручение провода. Кватернион
		// из двух поворотов делает это без блокировки осей.
		const tail = (ROPE_N - 1) * 3;
		const dx = rope.p[tail]! - rope.p[tail - 3]!;
		const dy = rope.p[tail + 1]! - rope.p[tail - 2]!;
		const dz = rope.p[tail + 2]! - rope.p[tail - 1]!;
		tv.plug.position.set(rope.p[tail]!, rope.p[tail + 1]!, rope.p[tail + 2]!);
		// Своя ось вилки — вниз: провод входит сверху, штыри смотрят вниз.
		plugDir.set(dx, dy, dz).normalize();
		plugQ.setFromUnitVectors(PLUG_AXIS, plugDir);
		/* Кручение на экране преувеличено, и это сознательно — как и сама
		   вилка, которая крупнее натуральной в полтора раза.

		   Физика под этим настоящая: провод трёхмерный, у него своя кривизна
		   покоя, вдоль него идёт крутильная волна, защемлённая в корпусе, и
		   вилка на конце отзывается с запаздыванием. Но её угол физически
		   ограничен: у стержня, защемлённого с одного конца и свободного с
		   другого, без внешнего момента угол в равновесии однороден, то есть
		   свободный конец просто повторяет защемление. А защемление — это
		   доля крена корпуса, приходящаяся на ось провода, около 0.15 от него.
		   Крен в сорок градусов даёт на вилке шесть, и это не лечится ни
		   жёсткостью, ни вязкостью, ни инерцией: замер даёт те же 0.107 рад
		   при любых. Шесть градусов на вилке в три десятка пикселей не видно
		   вовсе.

		   Поэтому угол умножается на twistGain. Множитель врёт про величину и
		   только про неё: знак, задержка волны, звон и то, когда именно вилку
		   поведёт, остаются посчитанными. */
		plugTwistQ.setFromAxisAngle(plugDir, twist.tail * params.twistGain);
		tv.plug.quaternion.copy(plugTwistQ.multiply(plugQ));

		// Чем выше корпус, тем шире и бледнее пятно
		const lift = Math.max(0, tv.body.position.y - HALF_H);
		const k = 1 / (1 + lift * 1.1);
		shadow.position.x = tv.body.position.x;
		shadow.position.y = 0.02;
		shadow.scale.set(0.85 + (1 - k) * 0.5, 0.2 + (1 - k) * 0.12, 1);
		shadowMat.opacity = (pal.dark ? 0.3 : 0.42) * k;
	}

	function frame(now: number): void {
		raf = requestAnimationFrame(frame);
		const dtReal = last ? Math.min((now - last) / 1000, 0.25) : 1 / 60;
		last = now;
		clock += dtReal;

		if (!paused) {
			if (S.sleeping) {
				// Физика спит — шум продолжает жить, но рендерим через кадр
				acc = 0;
				prev.x = S.x;
				prev.y = S.y;
				prev.th = S.th;
			} else {
				acc += dtReal;
				let n = 0;
				while (acc >= FIXED && n < MAX_SUB) {
					prev.x = S.x;
					prev.y = S.y;
					prev.th = S.th;
					physicsStep(FIXED);
					acc -= FIXED;
					n++;
				}
				if (n === MAX_SUB) acc = 0;
			}
		}

		if (S.sleeping && !paused && (parity ^= 1)) return;

		syncMeshes(S.sleeping ? 1 : acc / FIXED);
		screen.update(dtReal, clock);
		bloom.render(scene, camera);
	}

	function start(): void {
		if (frozen || running || !visible || !onScreen) return;
		running = true;
		last = 0;
		acc = 0;
		screen.setPlaying(true);
		raf = requestAnimationFrame(frame);
	}
	function stop(): void {
		running = false;
		// Вкладку спрятали или телевизор уехал за экран — декодировать видео
		// незачем. Цикл встал, и текстура всё равно никуда не попадает.
		screen.setPlaying(false);
		cancelAnimationFrame(raf);
		raf = 0;
	}

	/* ── Подписки ───────────────────────────────────────────────────────── */

	const ro = new ResizeObserver(() => layout.apply());
	ro.observe(el);

	const io = new IntersectionObserver(
		(entries) => {
			onScreen = entries[entries.length - 1]!.isIntersecting;
			if (onScreen) start();
			else stop();
		},
		{ threshold: 0 },
	);
	io.observe(el);

	const onVis = (): void => {
		visible = !document.hidden;
		if (visible) start();
		else stop();
	};
	const darkMq = matchMedia('(prefers-color-scheme: dark)');
	const onScheme = (): void => refreshTheme();

	// Смена темы кнопкой — это смена атрибута, события от matchMedia при ней
	// не будет. Поэтому за атрибутом следим отдельно.
	const themeMo = new MutationObserver(() => refreshTheme());
	themeMo.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['data-theme'],
	});

	// Потеря контекста — молча исчезаем. Восстанавливать нечего: страница
	// без телевизора и есть штатное состояние.
	const onContextLost = (e: Event): void => {
		e.preventDefault();
		stop();
		el.style.display = 'none';
	};
	renderer.domElement.addEventListener('webglcontextlost', onContextLost);

	document.addEventListener('visibilitychange', onVis);
	input.attach();
	darkMq.addEventListener('change', onScheme);

	layout.apply();
	refreshTheme();
	S.x = env.homeX;

	// Телевизор приезжает падением. Высота задана в его собственных высотах:
	// размер игрушки считается от stageH, поэтому в высотах корпуса падение
	// выглядит одинаково и на ноутбуке, и на большом мониторе. Потолок сцены
	// всё равно уважаем — иначе на низком окне вместо падения будет отскок
	// от верхнего края.
	if (!frozen) {
		S.y = Math.min(HALF_H + params.dropY * TV_VIS_H, env.halfH - HALF_H * 0.4);
		S.grounded = false;
	}
	prev.x = S.x;
	prev.y = S.y;
	prev.th = S.th;
	{
		const a = anchorAt(S.x, S.y, S.th);
		rope.reset(a.x, a.y, ROPE_Z);
		twist.reset();
	}

	/* Неподвижный кадр для снимков: подставляется прямо в uTex и включает
	   передачу на полную, минуя тюнер и его ступени захвата. */
	if (opts.stillClip) screen.setStill(opts.stillClip);

	if (frozen) {
		// Снимок должен совпадать от запуска к запуску: падения нет, случайные
		// срывы кадра выключены, шум прибит к постоянному времени, экран сразу
		// разожжён. Провод перед этим успокаиваем фиксированным числом шагов —
		// в физике случайностей нет, значит результат воспроизводим.
		screen.freeze();
		for (let i = 0; i < FROZEN_SETTLE; i++) physicsStep(FIXED);
		prev.x = S.x;
		prev.y = S.y;
		prev.th = S.th;
		syncMeshes(1);
		screen.update(0, FROZEN_T);
		bloom.render(scene, camera);
	} else {
		start();
	}

	/* ── Публичный интерфейс ────────────────────────────────────────────── */

	function destroy(): void {
		stop();
		// Отменяет и ожидание ролика, если он ещё не доехал
		screen.dispose();
		ro.disconnect();
		io.disconnect();
		document.removeEventListener('visibilitychange', onVis);
		input.detach();
		darkMq.removeEventListener('change', onScheme);
		themeMo.disconnect();
		renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
		for (const d of tv.disposables) d.dispose();
		lighting.dispose();
		bloom.dispose();
		tv.ropeGeo.dispose();
		shadow.geometry.dispose();
		shadowMat.dispose();
		shadowTex.dispose();
		renderer.dispose();
		renderer.domElement.remove();
	}

	const internals: TvInternals = {
		params,
		state: S,
		env,
		rope,
		plugHold,
		renderer,
		scene,
		camera,
		rig,
		parts: tv,
		wake,
		flash: screen.flash,
		wheel: input.wheel,
		swipeImpulse: input.swipeImpulse,
		refreshTheme,
		relayout: () => layout.apply(),
		setPaused: (v) => {
			paused = !!v;
			if (!v) {
				last = 0;
				acc = 0;
			}
			wake();
		},
		setForceDark: (v) => {
			forceDark = v;
			refreshTheme();
		},
		resetScreen: screen.reset,
		syncPrev: () => {
			prev = { x: S.x, y: S.y, th: S.th };
		},
		resetRope: () => {
			const a = anchorAt(S.x, S.y, S.th);
			rope.reset(a.x, a.y, ROPE_Z);
			twist.reset();
			plugHold.active = false;
			plugHold.tension = 0;
		},
	};

	return { destroy, internals };
}
