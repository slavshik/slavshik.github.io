/*
 * Передача: короткий ролик, который приезжает с эндпоинта и играет на экране.
 *
 * Правило здесь одно и оно жёстче обычного: телевизор — украшение, а передача
 * — украшение украшения. Всё, что может не получиться (сети нет, эндпоинт
 * молчит, браузер запретил автоплей, кодек не тот), обязано кончаться одним и
 * тем же — тишиной и снегом на экране, как будто передачи и не ждали.
 *
 * Поэтому здесь нет ни одного throw наружу: startBroadcast всегда
 * возвращает либо готовую текстуру, либо null.
 */

import * as THREE from 'three';

/** Сколько ждём первого кадра, прежде чем махнуть рукой. */
const TIMEOUT_MS = 2500;

export interface Broadcast {
	texture: THREE.VideoTexture;
	/** Пауза вместе с циклом: вкладку спрятали — незачем декодировать. */
	setPlaying: (v: boolean) => void;
	dispose: () => void;
}

/**
 * Видео живёт в DOM, но невидимо. Не `display: none` и не `hidden`: часть
 * браузеров перестаёт декодировать кадры у скрытого элемента, и текстура
 * замирает на первом. Пиксель за краем экрана таких прав не даёт.
 */
function makeVideoEl(): HTMLVideoElement {
	const v = document.createElement('video');
	v.muted = true; // без этого автоплей запрещён везде
	v.defaultMuted = true; // Safari смотрит на атрибут, а не на свойство
	v.playsInline = true; // иначе iOS открывает ролик на весь экран
	v.loop = true;
	v.autoplay = true;
	v.preload = 'auto';
	v.setAttribute('aria-hidden', 'true');
	v.style.cssText =
		'position:fixed;left:-2px;top:-2px;width:1px;height:1px;opacity:0;pointer-events:none';
	return v;
}

/* ── Тюнер ──────────────────────────────────────────────────────────────
 *
 * Переключение канала должно быть мгновенным: пнули телевизор — картинка
 * сменилась в тот же кадр, вместе с помехами. Ждать сеть в этот момент
 * нельзя, поэтому следующий ролик грузится заранее, пока играет текущий.
 *
 * В памяти живут максимум два: тот, что в эфире, и тот, что готовится.
 */

export interface TunerOptions {
	/** Адрес n-го ролика. Нумерация сквозная и растёт до конца жизни страницы. */
	url: (seq: number) => string;
	/** Канал сменился — сюда приезжает новая текстура. */
	onChannel: (texture: THREE.VideoTexture) => void;
}

export interface Tuner {
	/**
	 * Переключить на следующий, если он готов. Возвращает false, когда
	 * следующий ещё едет: помехи в этом случае всё равно идут, а картинка
	 * останется прежней — телевизор дёрнулся, но канал не поймал.
	 */
	tune: () => boolean;
	setPlaying: (v: boolean) => void;
	dispose: () => void;
}

export function createTuner(opts: TunerOptions): Tuner {
	let seq = 0;
	let current: Broadcast | null = null;
	let ready: Broadcast | null = null;
	let loading = false;
	let playing = false;
	let dead = false;
	const abort = new AbortController();

	function preload(): void {
		if (dead || loading || ready) return;
		loading = true;
		void startBroadcast({ url: opts.url(seq++), signal: abort.signal }).then((b) => {
			loading = false;
			if (dead || !b) {
				b?.dispose();
				return;
			}
			ready = b;
			// Первый пойманный ролик выходит в эфир сам: пинка ещё не было.
			if (!current) promote();
		});
	}

	function promote(): boolean {
		if (!ready) return false;
		current?.dispose();
		current = ready;
		ready = null;
		current.setPlaying(playing);
		opts.onChannel(current.texture);
		preload(); // сразу готовим следующий
		return true;
	}

	preload();

	return {
		tune: () => {
			// Даже когда переключать нечего, попытка запускает подгрузку:
			// пинок — это ещё и «принеси следующую».
			const ok = promote();
			if (!ok) preload();
			return ok;
		},
		setPlaying: (v: boolean) => {
			playing = v;
			current?.setPlaying(v);
		},
		dispose: () => {
			dead = true;
			abort.abort();
			current?.dispose();
			ready?.dispose();
			current = null;
			ready = null;
		},
	};
}

export interface BroadcastOptions {
	/** Адрес ролика. Обычно это /api/hit с tex=1. */
	url: string;
	/** Досрочная отмена — телевизор размонтировали, пока мы ждали. */
	signal?: AbortSignal;
}

export function startBroadcast(opts: BroadcastOptions): Promise<Broadcast | null> {
	return new Promise<Broadcast | null>((resolve) => {
		let video: HTMLVideoElement | null = null;
		let timer = 0;
		let settled = false;

		const cleanup = (): void => {
			clearTimeout(timer);
			if (!video) return;
			video.removeAttribute('src');
			try {
				video.load(); // обрывает загрузку, иначе она доедет впустую
			} catch {
				/* уже неважно */
			}
			video.remove();
			video = null;
		};

		// Единственный выход из всех веток. Второй вызов ничего не делает:
		// таймаут и ошибка вполне могут прийти оба.
		const give = (b: Broadcast | null): void => {
			if (settled) return;
			settled = true;
			if (!b) cleanup();
			resolve(b);
		};

		try {
			video = makeVideoEl();
			const el = video;

			if (opts.signal) {
				if (opts.signal.aborted) return give(null);
				opts.signal.addEventListener('abort', () => give(null), { once: true });
			}

			el.addEventListener('error', () => give(null), { once: true });

			// loadeddata — первый кадр уже декодирован. Именно он нужен
			// текстуре: canplay иногда приходит раньше, чем есть что показать.
			el.addEventListener(
				'loadeddata',
				() => {
					if (settled) return;
					const texture = new THREE.VideoTexture(el);
					texture.colorSpace = THREE.SRGBColorSpace;

					// play() возвращает промис и он отклоняется, когда автоплей
					// запрещён (низкий заряд на iOS, настройка браузера). Кадр к
					// этому моменту уже есть, так что даже отклонённый автоплей
					// оставляет на экране стоп-кадр — лучше, чем ничего. Играть
					// попробуем ещё раз по первому касанию страницы.
					void el.play().catch(() => {
						const retry = (): void => void el.play().catch(() => {});
						addEventListener('pointerdown', retry, { once: true, passive: true });
					});

					give({
						texture,
						setPlaying: (v: boolean) => {
							if (v) void el.play().catch(() => {});
							else el.pause();
						},
						dispose: () => {
							texture.dispose();
							cleanup();
						},
					});
				},
				{ once: true },
			);

			timer = window.setTimeout(() => give(null), TIMEOUT_MS);

			document.body.appendChild(el);
			el.src = opts.url;
		} catch {
			give(null);
		}
	});
}
