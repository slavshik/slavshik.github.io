/*
 * Один запрос на визит: /api/hit.
 *
 * Собирается он здесь, а отправляется в двух местах: этим модулем — сам факт
 * визита, и телевизором — тот же адрес с tex=1, в ответ на который приходит
 * передача. Второй запрос считается не визитом, а событием: их связывает
 * общий одноразовый ключ n.
 *
 * Всё, что можно взять на эдже — страна, сеть, браузер, — здесь не собирается
 * и не отправляется: заголовки запроса и так дойдут. Отсюда уходит только то,
 * чего в них нет: вьюпорт, тема, разметка ссылки — и `x`, причина, по которой
 * телевизора у посетителя не будет. Последнее не про статистику, а про
 * поломки: с эджа не видно разницы между «отказались показывать» и «не
 * смогли», а разница вся.
 *
 * hitQuery — чистая функция без DOM: она и проверяется юнит-тестом.
 */

/** Адрес эндпоинта. Свой домен: ни CORS, ни лишнего рукопожатия. */
export const HIT_URL = '/api/hit';

export interface HitInput {
	/** location.pathname */
	path: string;
	/** location.search — из него забираются utm_* */
	search: string;
	/** document.referrer, пустая строка если переход прямой */
	referrer: string;
	/** Ширина×высота вьюпорта в CSS-пикселях */
	viewport: string;
	/** devicePixelRatio */
	dpr: number;
	/** Тема, которую посетитель видит */
	theme: string;
	/** Одноразовый ключ визита — им склеиваются визит и показ передачи */
	nonce: string;
	/** Наш же origin: реферер с него — это переход внутри сайта, а не источник */
	origin: string;
	/**
	 * Почему телевизора не будет. Пусто — будет (или уже есть). Коды короткие
	 * и закрытые: `dom`, `rm`, `net`, `mem`, `gl`, `err` — см. TV_WHY.
	 */
	why?: string;
}

/**
 * Отчего телевизор не поехал. Список закрытый: это не свободный текст с
 * чужого устройства, а несколько заранее известных причин.
 *
 *   dom — на странице нет места под телевизор
 *   rm  — попросили меньше движения
 *   net — экономия трафика или совсем медленная сеть
 *   mem — меньше двух гигабайт памяти
 *   gl  — нет WebGL2
 *   err — кусок не загрузился или упал при запуске
 *
 * Последний — самый ценный: до него такие поломки были неотличимы от тишины.
 */
export const TV_WHY = ['dom', 'rm', 'net', 'mem', 'gl', 'err'] as const;
export type TvWhy = (typeof TV_WHY)[number];

/** Обрезка: в аналитику не должно уезжать ничего длиннее осмысленного. */
const cut = (s: string, n = 128): string => (s.length > n ? s.slice(0, n) : s);

/**
 * Реферер до origin + путь. Строка запроса отбрасывается нарочно: в ней
 * бывают токены и почта, а для «откуда пришёл» хватает хоста.
 */
function referrerOf(referrer: string, origin: string): string {
	if (!referrer) return '';
	try {
		const u = new URL(referrer);
		if (u.origin === origin) return '';
		return cut(u.origin + (u.pathname === '/' ? '' : u.pathname));
	} catch {
		return '';
	}
}

/** Собрать строку запроса к /api/hit. Начинается с «?». */
export function hitQuery(i: HitInput): string {
	const q = new URLSearchParams();
	q.set('n', i.nonce);
	if (i.path !== '/') q.set('p', cut(i.path));

	const ref = referrerOf(i.referrer, i.origin);
	if (ref) q.set('r', ref);

	// utm_* — на нашем же адресе, так что это разметка ссылки, а не чужие
	// данные. Ключи укорочены: они уезжают в каждый визит.
	const utm = new URLSearchParams(i.search);
	const pairs: [string, string][] = [
		['u', utm.get('utm_source') ?? ''],
		['m', utm.get('utm_medium') ?? ''],
		['c', utm.get('utm_campaign') ?? ''],
	];
	for (const [k, v] of pairs) if (v) q.set(k, cut(v, 64));

	q.set('w', i.viewport);
	if (i.dpr !== 1) q.set('d', String(Math.round(i.dpr * 100) / 100));
	q.set('t', i.theme);
	// Причина уезжает только когда она есть: у большинства визитов телевизор
	// на месте, и лишний пустой параметр им ни к чему.
	if (i.why) q.set('x', i.why);

	return `?${q.toString()}`;
}

/**
 * Тот же визит, но с припиской «телевизор не поехал». Отдельный запрос, а не
 * поле в первом: к моменту, когда это выясняется, первый давно ушёл.
 */
export function withWhy(query: string, why: TvWhy): string {
	return `${query}&x=${why}`;
}

/**
 * Посетитель попросил себя не считать. Do-Not-Track снят в большинстве
 * браузеров, Global Privacy Control жив и юридически значим в паре
 * юрисдикций — уважаем оба.
 */
export function optedOut(nav: Navigator): boolean {
	const n = nav as Navigator & { globalPrivacyControl?: boolean };
	return n.doNotTrack === '1' || n.globalPrivacyControl === true;
}

/** Ключ визита. Не хранится нигде и живёт до перезагрузки страницы. */
export function nonce(): string {
	return Math.random().toString(36).slice(2, 10);
}

/**
 * Отправить визит. sendBeacon не держит страницу и переживает её закрытие;
 * там, где его нет, картинка делает то же самое чуть менее надёжно.
 * Ошибки глотаются: аналитика не повод сломать страницу.
 */
export function sendHit(query: string): void {
	const url = HIT_URL + query;
	try {
		if (navigator.sendBeacon?.(url)) return;
	} catch {
		/* дальше картинкой */
	}
	try {
		new Image().src = url;
	} catch {
		/* значит, не в этот раз */
	}
}
