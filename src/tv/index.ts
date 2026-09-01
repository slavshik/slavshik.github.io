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

import { createTuner, type Tuner } from './broadcast.js';
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
import { createLighting } from './lighting.js';
import { LOOK } from './look.js';
import { readPalette, type Palette } from './palette.js';
import {
	Rope,
	anchorAt,
	createBodyState,
	stepWorld,
	wake as wakeState,
	type BodyState,
	type PhysicsEnv,
} from './physics.js';
import { buildTV, shadowTexture, updateRopeMesh, type TvParts } from './scene.js';

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
}

/** Ссылки на внутренности. Стенду — да, продакшену — нет. */
export interface TvInternals {
	params: TvParams;
	state: BodyState;
	env: PhysicsEnv;
	rope: Rope;
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

	const rig = new THREE.Group();
	scene.add(rig);

	const tv = buildTV(pal);
	rig.add(tv.body, tv.ropeMesh, tv.plug);

	// Шнур уходит вниз почти отвесно и на экране шириной в три-четыре
	// пикселя: плитка оплётки ложится на него сильно сжатой по одной оси, и
	// без анизотропии мипмап замывает пунктир в ровную серость. Предел
	// спрашиваем у железа — брать больше нечем, меньше незачем.
	const cordMap = (tv.ropeMesh.material as THREE.MeshPhysicalMaterial).map;
	if (cordMap) cordMap.anisotropy = renderer.capabilities.getMaxAnisotropy();

	const rope = new Rope(ROPE_N, ROPE_SEG);

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

	/* ── Экран: розжиг, срыв кадра, вспышка от удара ────────────────────── */

	let power = 0;
	let flashV = 0;
	let roll = 0;
	let rollV = 0;
	let nextGlitch = 3 + Math.random() * 5;

	/* ── Передача ───────────────────────────────────────────────────────── */

	// texMix ползёт к единице, когда ролик доехал: настройка на канал, а не
	// подмена картинки. В неподвижном режиме передачи нет вовсе — эталоны не
	// имеют права зависеть от сети.
	let tuner: Tuner | null = null;
	let texMix = 0;
	let texWanted = 0;

	/*
	 * Захват синхронизации. Картинка не выцеловывается из шума плавно —
	 * трубка ловит строку рывками: схватила, потеряла, схватила крепче.
	 * Поэтому это ступени с провалами, а не кривая: между ними ничего не
	 * интерполируется, и каждый скачок виден как скачок.
	 *
	 * Длительность взята короткой нарочно. Плавный разгон читался ожиданием,
	 * а рваный обязан быть быстрым — иначе выглядит не захватом, а поломкой.
	 */
	const LOCK_STEPS: readonly { t: number; v: number }[] = [
		{ t: 0.0, v: 0.5 },
		{ t: 0.06, v: 0.05 },
		{ t: 0.12, v: 0.8 },
		{ t: 0.18, v: 0.25 },
		{ t: 0.26, v: 1.0 },
	];
	const LOCK_END = 0.26;

	// lockT < 0 — захват не идёт. Масштаб слегка гуляет, чтобы два соседних
	// приземления не совпадали ступенька в ступеньку.
	let lockT = -1;
	let lockScale = 1;
	let lockStep = -1;

	function startLock(): void {
		texWanted = 1;
		lockT = 0;
		lockScale = 0.85 + Math.random() * 0.3;
		lockStep = -1;
	}

	if (!frozen && opts.broadcastUrl) {
		const url = opts.broadcastUrl;
		tuner = createTuner({
			url,
			onChannel: (texture) => {
				tv.screenMat.uniforms.uTex!.value = texture;
				// В воздухе картинку не показываем даже когда ролик доехал:
				// там положено быть шуму. Включит её касание пола.
				if (S.grounded) startLock();
				else texWanted = 0;
				// Срыв кадра ровно в момент появления картинки — так телевизор
				// ловит канал, а не переключает слайд.
				rollV = 1 / 0.3;
				flashV = Math.max(flashV, 0.35);
				wake();
			},
		});
		tuner.setPlaying(true);
	}

	/*
	 * Пока телевизор в воздухе — белый шум; сел на пол — картинка
	 * калибруется обратно. Полёт ловится не по клику, а по состоянию физики:
	 * подбросить корпус можно и броском, и колесом, и свайпом по странице, и
	 * во всех случаях трубка обязана вести себя одинаково.
	 *
	 * Отскоки после падения — тоже полёты, и шум на них честный: картинка
	 * дёргается, пока корпус скачет, и устаканивается вместе с ним. А вот
	 * канал за один полёт меняется ровно один раз, иначе пара отскоков
	 * пролистала бы половину альбома.
	 */
	let wasGrounded = false;
	let channelPending = false;

	/**
	 * Новый канал заказывает зритель, а не физика: отскок — не повод менять
	 * передачу, иначе одно падение пролистывало по пять роликов и столько же
	 * раз лезло в сеть. Показать заказанное — уже дело пола.
	 */
	function requestChannel(): void {
		channelPending = true;
	}

	function liftOff(): void {
		texWanted = 0;
		lockT = -1;
		rollV = 1 / 0.22;
	}

	function landed(): void {
		rollV = 1 / 0.3;
		// Смена канала — на первом касании пола после полёта. Не доехал
		// следующий ролик — вернётся прежний, и это не беда: телевизор
		// дёрнулся, но канал не поймал.
		if (channelPending) {
			channelPending = false;
			tuner?.tune();
		}
		if (tuner) startLock();
	}

	function flash(amount: number): void {
		flashV = Math.max(flashV, amount);
	}

	function updateScreen(dt: number, t: number): void {
		power = Math.min(1, power + dt / 0.9);
		const ease = 1 - Math.pow(1 - power, 3);
		const screenScale = 0.02 + 0.98 * Math.min(1, ease * 1.06);
		tv.screen.scale.y = screenScale;
		tv.screenGlass.scale.y = screenScale;

		flashV *= Math.exp(-dt / 0.09);

		nextGlitch -= dt;
		if (nextGlitch <= 0) {
			rollV = 1 / 0.25;
			nextGlitch = 4 + Math.random() * 5;
		}
		if (rollV > 0) {
			roll += rollV * dt;
			if (roll >= 1) {
				roll = 0;
				rollV = 0;
			}
		}

		if (texWanted === 0) {
			// В шум — мгновенно, как оно и бывает, когда по телевизору стукнули
			texMix = Math.max(0, texMix - dt / 0.09);
		} else if (lockT >= 0) {
			lockT += dt / lockScale;
			let v = texMix;
			let i = -1;
			for (let k = 0; k < LOCK_STEPS.length; k++) {
				if (lockT >= LOCK_STEPS[k]!.t) {
					v = LOCK_STEPS[k]!.v;
					i = k;
				}
			}
			// Каждый переход на новую ступень рвёт строку: провал в шум сам по
			// себе виден слабо, а вместе со срывом кадра читается разрывом.
			if (i !== lockStep) {
				lockStep = i;
				rollV = Math.max(rollV, 1 / 0.14);
			}
			texMix = v;
			if (lockT >= LOCK_END) {
				texMix = 1;
				lockT = -1;
			}
		}

		const u = tv.screenMat.uniforms;
		u.uTime!.value = t;
		u.uRoll!.value = roll;
		u.uTexMix!.value = texMix;
		u.uIntensity!.value = ease + flashV;
		tv.glow.intensity = (0.5 + flashV * 2.5) * ease;
		// Центр bloom прозрачен: эффект чувствуется в воздухе вокруг трубки, но
		// не поднимает чёрный уровень и не съедает контраст самой передачи.
		tv.bloomMat.opacity = (0.09 + 0.14 * texMix + flashV * 0.24) * ease;
	}

	/* ── Ввод ───────────────────────────────────────────────────────────── */

	const input = createInput({
		el,
		camera,
		rig,
		proxy: tv.proxy,
		params,
		state: S,
		env,
		onWake: wake,
		onFlash: flash,
		onImpulse: requestChannel,
	});

	/* ── Шаг физики ─────────────────────────────────────────────────────── */

	const world = { state: S, params, env, drag: input.drag, antennas: tv.antennas, rope };

	function physicsStep(dt: number): void {
		const impact = stepWorld(world, dt);
		if (impact > 2.2) flash(Math.min(impact * 0.22, 0.9));

		if (tuner) {
			if (S.grounded !== wasGrounded) {
				if (S.grounded) landed();
				else liftOff();
				wasGrounded = S.grounded;
			}
		}
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
		onResized: () => {
			syncMeshes(1);
			renderer.render(scene, camera);
		},
		onApplied: wake,
	});

	/* ── Тема ───────────────────────────────────────────────────────────── */

	function refreshTheme(): void {
		pal = readPalette(forceDark);
		const accent = new THREE.Color(pal.accent);
		(tv.screenMat.uniforms.uAccent!.value as THREE.Color).copy(accent);
		tv.glow.color.copy(accent);
		tv.bloomMat.color.copy(accent).lerp(new THREE.Color(0xffffff), 0.62);
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

		updateRopeMesh(tv.ropeGeo, rope);

		// Вилка садится на последнюю точку и разворачивается по последнему звену
		const tail = (ROPE_N - 1) * 2;
		const dx = rope.p[tail]! - rope.p[tail - 2]!;
		const dy = rope.p[tail + 1]! - rope.p[tail - 1]!;
		tv.plug.position.set(rope.p[tail]!, rope.p[tail + 1]!, ROPE_Z);
		tv.plug.rotation.z = Math.atan2(dy, dx) + Math.PI / 2;

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
		updateScreen(dtReal, clock);
		renderer.render(scene, camera);
	}

	function start(): void {
		if (frozen || running || !visible || !onScreen) return;
		running = true;
		last = 0;
		acc = 0;
		tuner?.setPlaying(true);
		raf = requestAnimationFrame(frame);
	}
	function stop(): void {
		running = false;
		// Вкладку спрятали или телевизор уехал за экран — декодировать видео
		// незачем. Цикл встал, и текстура всё равно никуда не попадает.
		tuner?.setPlaying(false);
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
		rope.reset(a.x, a.y);
	}

	if (frozen) {
		// Снимок должен совпадать от запуска к запуску: падения нет, случайные
		// срывы кадра выключены, шум прибит к постоянному времени, экран сразу
		// разожжён. Провод перед этим успокаиваем фиксированным числом шагов —
		// в физике случайностей нет, значит результат воспроизводим.
		nextGlitch = Infinity;
		for (let i = 0; i < FROZEN_SETTLE; i++) physicsStep(FIXED);
		prev.x = S.x;
		prev.y = S.y;
		prev.th = S.th;
		power = 1;
		syncMeshes(1);
		updateScreen(0, FROZEN_T);
		renderer.render(scene, camera);
	} else {
		start();
	}

	/* ── Публичный интерфейс ────────────────────────────────────────────── */

	function destroy(): void {
		stop();
		// Отменяет и ожидание ролика, если он ещё не доехал
		tuner?.dispose();
		tuner = null;
		ro.disconnect();
		io.disconnect();
		document.removeEventListener('visibilitychange', onVis);
		input.detach();
		darkMq.removeEventListener('change', onScheme);
		themeMo.disconnect();
		renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
		for (const d of tv.disposables) d.dispose();
		lighting.dispose();
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
		renderer,
		scene,
		camera,
		rig,
		parts: tv,
		wake,
		flash,
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
		resetScreen: () => {
			power = 0;
			flashV = 0;
			roll = 0;
			rollV = 0;
		},
		syncPrev: () => {
			prev = { x: S.x, y: S.y, th: S.th };
		},
		resetRope: () => {
			const a = anchorAt(S.x, S.y, S.th);
			rope.reset(a.x, a.y);
		},
	};

	return { destroy, internals };
}
