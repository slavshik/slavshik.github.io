import './styles.css';

import { HIT_URL, hitQuery, nonce, optedOut, sendHit, withWhy } from './analytics.js';
import type { TvWhy } from './analytics.js';

/* ── Акцент ─────────────────────────────────────────────────────────────
 * Меняется по местному времени посетителя: рассвет, день, закат, ночь.
 * Единственная «живая» деталь страницы — и она честная: никаких выдуманных
 * статусов и фейковых данных, только время у того, кто смотрит.
 * Без JS страница остаётся полностью рабочей с дневным акцентом.
 */
{
	// ?aqa=1 — прогон скриншотных тестов. Время суток там сломало бы эталоны:
	// один и тот же коммит давал бы четыре разные картинки за сутки. Акцент
	// фиксируется дневным — ровно по той же причине он намертво зашит в
	// og.png и favicon.svg, куда время суток тоже не передать.
	const h = new URLSearchParams(location.search).get('aqa') === '1' ? 12 : new Date().getHours();
	const accent =
		h >= 5 && h < 9
			? '#c2643f' // рассвет — терракота
			: h >= 9 && h < 17
				? '#2f6b57' // день — глубокий зелёный
				: h >= 17 && h < 21
					? '#b07d2b' // закат — охра
					: '#6f86c9'; // ночь — индиго
	document.documentElement.style.setProperty('--accent', accent);
}

/* ── Переключатель темы ─────────────────────────────────────────────────
 * По умолчанию тема системная, и кнопка её только перебивает. Если выбранное
 * совпало с системным, override снимается совсем — иначе страница навсегда
 * перестала бы следовать за системой, хотя посетитель ничего такого не просил.
 */
{
	const btn = document.getElementById('theme');
	if (btn) {
		const root = document.documentElement;
		const sysDark = matchMedia('(prefers-color-scheme: dark)');

		// Цвет адресной строки на мобильных задан двумя мета-тегами через media.
		// Пока тема системная, пусть каждый остаётся при своём; как только выбор
		// сделан руками, обоим проставляется один цвет — media их больше не
		// разводит, потому что выбор сильнее системы.
		const paintMeta = (forced: string | null): void => {
			for (const m of document.querySelectorAll<HTMLMetaElement>(
				'meta[name="theme-color"]',
			)) {
				m.setAttribute(
					'content',
					forced
						? forced === 'dark'
							? '#101014'
							: '#f4f1ec'
						: /dark/.test(m.media)
							? '#101014'
							: '#f4f1ec',
				);
			}
		};

		const effective = (): string => root.dataset.theme || (sysDark.matches ? 'dark' : 'light');

		const apply = (mode: string): void => {
			if (mode === (sysDark.matches ? 'dark' : 'light')) {
				delete root.dataset.theme;
				try {
					localStorage.removeItem('theme');
				} catch {
					/* приватный режим — просто не запоминаем */
				}
			} else {
				root.dataset.theme = mode;
				try {
					localStorage.setItem('theme', mode);
				} catch {
					/* приватный режим — просто не запоминаем */
				}
			}
			paintMeta(root.dataset.theme || null);
		};

		paintMeta(root.dataset.theme || null);
		(btn as HTMLButtonElement).hidden = false;
		btn.addEventListener('click', () => {
			apply(effective() === 'dark' ? 'light' : 'dark');
		});
	}
}

/* ── Телевизор ──────────────────────────────────────────────────────────
 * Необязательная деталь. Грузится только после того, как страница отрисована,
 * и только туда, где ему рады. Всё, что он умеет сломать в худшем случае —
 * это не появиться.
 */
{
	const stage = document.getElementById('tv-stage');

	// ?aqa=1 — ключ для скриншотных тестов: он не включает телевизор, а
	// запрещает всему двигаться. Страницу без телевизора эталонам теперь даёт
	// prefers-reduced-motion, а не отдельный ключ.
	const q = new URLSearchParams(location.search);
	const aqa = q.get('aqa') === '1';

	// Экономия трафика и совсем слабые машины — мимо
	const nav = navigator as Navigator & {
		connection?: { saveData?: boolean; effectiveType?: string };
		deviceMemory?: number;
	};
	const net = nav.connection;

	// Не «да/нет», а «почему нет»: причина уезжает вместе с визитом. Со
	// стороны отказ по делу и поломка выглядят одинаково — страницей без
	// телевизора, — и различить их можно только отсюда.
	function tvWhy(): TvWhy | '' {
		if (!stage) return 'dom';
		// Просили меньше движения — значит, никакого телевизора. Показывать
		// вместо него статичную картинку было бы хуже, чем не показывать ничего.
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 'rm';
		if (net && (net.saveData || /(^|-)2g$/.test(net.effectiveType || ''))) return 'net';
		if (nav.deviceMemory !== undefined && nav.deviceMemory < 2) return 'mem';
		if (!hasWebgl2()) return 'gl';
		return '';
	}

	const why = tvWhy();
	const wanted = !why;

	// WebGL2 проверяем до импорта: не тянуть три четверти мегабайта туда,
	// где нечем рисовать. С r163 three умеет только WebGL2.
	function hasWebgl2(): boolean {
		try {
			return !!document.createElement('canvas').getContext('webgl2');
		} catch {
			return false;
		}
	}

	// Один запрос на визит и он же — источник картинки для экрана. В
	// неподвижном режиме не шлётся вовсе: эталоны не ходят в сеть.
	// Посетителя, попросившего себя не считать, не считаем и передачу ему не
	// показываем — второй запрос был бы тем же самым событием.
	let broadcastUrl: ((seq: number) => string) | null = null;
	// Доложить, что телевизор не завёлся. Пока визит не отправлен — докладывать
	// некуда и незачем.
	let reportFailure: (() => void) | null = null;
	if (!aqa && !optedOut(navigator)) {
		const query = hitQuery({
			path: location.pathname,
			search: location.search,
			referrer: document.referrer,
			viewport: `${innerWidth}x${innerHeight}`,
			dpr: devicePixelRatio || 1,
			theme: document.documentElement.dataset.theme ?? 'auto',
			nonce: nonce(),
			origin: location.origin,
			why,
		});
		sendHit(query);
		reportFailure = () => {
			sendHit(withWhy(query, 'err'));
		};
		// Один и тот же ключ визита во всех кадрах: на той стороне это один
		// визит с несколькими показами, а не десяток визитов от человека,
		// которому понравилось пинать телевизор.
		broadcastUrl = (seq: number) => `${HIT_URL}${query}&tex=1&seq=${seq}`;
	}

	/* ?aqa=1&clip=1 — снимок с картинкой на экране вместо снега.
	   Только для тестов: адрес фиксированный и локальный, на живом сайте по
	   нему ничего не лежит, а перехватывает его сам тест. Кадр обязан быть
	   раскодирован до монтирования, иначе замороженный рендер успеет
	   нарисоваться по пустой текстуре. */
	const clipShot = aqa && q.get('clip') === '1';

	if (wanted && stage) {
		const boot = (): void => {
			const still = clipShot
				? new Promise<HTMLImageElement | null>((res) => {
						const img = new Image();
						img.onload = () => res(img);
						img.onerror = () => res(null);
						img.src = '/aqa-clip.png';
					})
				: Promise.resolve(null);
			Promise.all([import('./tv/index.js'), still])
				.then(([m, stillClip]) => {
					m.mount(stage, { frozen: aqa, broadcastUrl, stillClip });
					// Класс — только после удачного монтирования: подложка под именем
					// нужна ровно тогда, когда за именем правда что-то летает.
					document.documentElement.classList.add('tv-on');
					// Неподвижный кадр рисуется синхронно внутри mount(), так что к
					// этой строке он уже на экране. Плейврайту достаточно дождаться
					// селектора — ни инъекций, ни сна на удачу.
					if (aqa) document.documentElement.setAttribute('data-tv', 'ready');
				})
				.catch(() => {
					// Тихо для посетителя: страница и без него целая. Но не тихо
					// для нас — иначе браузер, в котором кусок не разбирается,
					// снова полгода будет выглядеть как «ну не показалось».
					reportFailure?.();
				});
		};
		const idle: (f: () => void) => void =
			window.requestIdleCallback ??
			((f) => {
				setTimeout(f, 200);
			});
		if (document.readyState === 'complete') idle(boot);
		else addEventListener('load', () => idle(boot), { once: true });
	}
}
