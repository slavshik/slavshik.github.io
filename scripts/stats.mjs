/*
 * Читалка визитов. Worker пишет в D1 сырые события — по строке на показ
 * страницы, по строке на каждую просьбу показать передачу, — а свести их в
 * человеческий вид нужно раз в несколько дней и не в браузере. Отсюда
 * скрипт, а не панель: `make stats`, и всё видно в терминале.
 *
 * Ходит одним запросом. Восемь SELECT'ов уезжают в d1 execute за раз — это
 * важно не из-за лимитов, а из-за времени: каждый вызов wrangler стоит
 * несколько секунд, и восемь вызовов превратили бы сводку в ожидание.
 *
 * Что здесь считается и почему именно так:
 *
 *   просмотры — строки с tex=0. Строка с tex=1 — это просьба телевизора
 *     показать ролик, их у одного визита десятки, и складывать их с визитами
 *     значит умножать посещаемость на то, как долго человек смотрел передачу.
 *   люди     — разные дневные хеши. Хеш солится IP и меняется в полночь,
 *     поэтому один и тот же человек назавтра будет другим, а сегодня из двух
 *     сетей — двумя. Это не баг, а цена отсутствия кук.
 *   ошибки   — строки x=err. Это не визит, а доклад: телевизор не загрузился
 *     или упал при запуске. Из просмотров они вычтены.
 *
 * Время везде местное: строки в базе в UTC, сдвиг берётся с этой машины и
 * уезжает в SQL. В ночь перевода часов сутки на границе поедут на час — за
 * такую цену эта сводка честнее, чем в UTC.
 */

import { spawnSync } from 'node:child_process';

const DAYS = Number(process.env['DAYS'] ?? 14);

/* Сдвиг местного времени, минутами: getTimezoneOffset() считает наоборот. */
const OFFSET = -new Date().getTimezoneOffset();
const SHIFT = `'${OFFSET >= 0 ? '+' : '-'}${Math.abs(OFFSET)} minutes'`;

/* Начало периода — местная полночь DAYS-1 дней назад, но в UTC: столбец at
   хранит UTC, и сравнивать надо с ним. */
const from = new Date();
from.setHours(0, 0, 0, 0);
from.setDate(from.getDate() - (DAYS - 1));
const FROM = from.toISOString();

/* Строка — просмотр страницы, а не показ ролика и не доклад о поломке. */
const VIEW = `tex = 0 AND (why IS NULL OR why <> 'err')`;
const PERIOD = `at >= '${FROM}'`;
const TODAY = `date(at, ${SHIFT}) = date('now', ${SHIFT})`;

const SQL = [
	`SELECT date(at, ${SHIFT}) d,
	        COUNT(CASE WHEN ${VIEW} THEN 1 END) views,
	        COUNT(DISTINCT CASE WHEN ${VIEW} THEN visitor END) people,
	        COUNT(CASE WHEN tex = 1 THEN 1 END) tv,
	        COUNT(CASE WHEN why = 'err' THEN 1 END) err
	   FROM visits WHERE ${PERIOD} GROUP BY d ORDER BY d`,

	`SELECT path k, COUNT(*) n, COUNT(DISTINCT visitor) people
	   FROM visits WHERE ${PERIOD} AND ${VIEW} GROUP BY k ORDER BY n DESC`,

	`SELECT COALESCE(country, '??') k, COUNT(*) n, COUNT(DISTINCT visitor) people
	   FROM visits WHERE ${PERIOD} AND ${VIEW} GROUP BY k ORDER BY n DESC LIMIT 12`,

	`SELECT referrer k, COUNT(*) n
	   FROM visits WHERE ${PERIOD} AND ${VIEW} AND referrer IS NOT NULL AND referrer <> ''
	  GROUP BY k ORDER BY n DESC LIMIT 12`,

	`SELECT why k, COUNT(*) n FROM visits
	  WHERE ${PERIOD} AND why IS NOT NULL GROUP BY k ORDER BY n DESC`,

	`SELECT ua k, COALESCE(why, '') w, COUNT(*) n FROM visits
	  WHERE ${PERIOD} AND ${VIEW} GROUP BY k, w ORDER BY n DESC`,

	`SELECT strftime('%H:%M', at, ${SHIFT}) t, country, path, viewport, theme,
	        COALESCE(referrer, '') referrer, ua, visitor
	   FROM visits WHERE ${TODAY} AND ${VIEW} ORDER BY at`,

	`SELECT strftime('%H:%M', at, ${SHIFT}) t, COALESCE(country, '??') country, path, ua
	   FROM visits WHERE ${TODAY} AND why = 'err' ORDER BY at`,
].join(';\n');

/* ─── запрос ──────────────────────────────────────────────────────────── */

const run = spawnSync(
	'npx',
	[
		'wrangler',
		'd1',
		'execute',
		'tvset-events',
		'--remote',
		'--config',
		'worker/wrangler.jsonc',
		'--json',
		'--command',
		SQL,
	],
	{ encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
);

if (run.status !== 0) {
	process.stderr.write(run.stderr || run.stdout || 'wrangler молчит\n');
	process.exit(1);
}

/* Wrangler печатает в stdout не только JSON: интересен последний массив. */
let answer;
try {
	const start = run.stdout.indexOf('[\n');
	answer = JSON.parse(start === -1 ? run.stdout : run.stdout.slice(start));
} catch {
	process.stderr.write(`не разобрать ответ wrangler:\n${run.stdout}\n`);
	process.exit(1);
}

const [days, paths, countries, referrers, whys, uas, today, errors] = answer.map(
	(r) => r.results ?? [],
);

/* ─── вывод ───────────────────────────────────────────────────────────── */

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
const plural = (n, one, few, many) => {
	const a = Math.abs(n) % 100;
	const b = a % 10;
	if (a > 10 && a < 20) return many;
	if (b > 1 && b < 5) return few;
	return b === 1 ? one : many;
};

/* Из UA нужен браузер и система, а не строка на двести знаков. */
function browser(ua) {
	if (!ua) return 'без UA';
	if (/bot|crawl|spider|headless|preview/i.test(ua)) return 'робот';
	const name = /Edg\//.test(ua)
		? 'Edge'
		: /OPR\//.test(ua)
			? 'Opera'
			: /Firefox\//.test(ua)
				? 'Firefox'
				: /Chrome\//.test(ua)
					? 'Chrome'
					: /Safari\//.test(ua)
						? 'Safari'
						: 'браузер';
	const os = /iPhone|iPad/.test(ua)
		? 'iOS'
		: /Android/.test(ua)
			? 'Android'
			: /Mac OS X/.test(ua)
				? 'macOS'
				: /Windows/.test(ua)
					? 'Windows'
					: /Linux/.test(ua)
						? 'Linux'
						: '';
	const v = /Version\/(\d+)/.exec(ua)?.[1] ?? /(?:Edg|OPR|Firefox|Chrome)\/(\d+)/.exec(ua)?.[1];
	return `${name}${v ? ' ' + v : ''}${os ? ' / ' + os : ''}`;
}

/*
 * Похоже на робота. Признак не в UA — его пишут какой угодно, — а в
 * противоречии: браузер называется свежим Chrome или Firefox и при этом
 * сообщает, что WebGL2 у него нет. Chrome умеет WebGL2 с 56-й версии,
 * Firefox с 51-й; настоящий десктопный Chrome 148 без WebGL2 не бывает.
 * Отсюда и берутся дни, когда «людей» вдруг втрое больше обычного.
 */
function suspect(ua, why) {
	if (why !== 'gl') return false;
	const v = /(?:Chrome|Firefox)\/(\d+)/.exec(ua ?? '');
	return !!v && Number(v[1]) >= 60;
}

/* Список «ключ — сколько», выровненный по самому длинному ключу. */
function list(title, rows, extra) {
	if (!rows.length) return;
	const w = Math.min(48, Math.max(...rows.map((r) => String(r.k).length)));
	console.log(`\n  ${title}`);
	for (const r of rows) {
		const tail = extra ? extra(r) : '';
		console.log(`    ${pad(String(r.k).slice(0, w), w)}  ${num(r.n, 5)}${tail}`.trimEnd());
	}
}

const zone = `UTC${OFFSET >= 0 ? '+' : '-'}${Math.abs(OFFSET) / 60}`;
console.log(
	`\nslavshik.me — ${DAYS} ${plural(DAYS, 'день', 'дня', 'дней')}, ` +
		`с ${from.toLocaleDateString('ru-RU')}, время местное (${zone})`,
);

/* Шапка и строки печатаются одной функцией — иначе они разъезжаются при
   первой же правке ширины. */
const day = (a, b, c, d, e) =>
	`    ${pad(a, 8)}${num(b, 10)}${num(c, 7)}${num(d, 11)}${num(e, 9)}`.trimEnd();

console.log('\n' + day('день', 'просмотры', 'люди', 'передача', 'ошибки'));
let totalViews = 0;
for (const r of days) {
	totalViews += r.views;
	const date = new Date(r.d + 'T12:00:00').toLocaleDateString('ru-RU', {
		day: '2-digit',
		month: '2-digit',
	});
	console.log(day(date, r.views, r.people, r.tv, r.err || '—'));
}
console.log(day('всего', totalViews, '', '', ''));

list(
	'страницы',
	paths,
	(r) => `  ${num(r.people, 4)} ${plural(r.people, 'человек', 'человека', 'человек')}`,
);
list('страны', countries);
list('откуда пришли', referrers);
list(
	'браузеры',
	Object.entries(
		uas.reduce((acc, r) => ((acc[browser(r.k)] = (acc[browser(r.k)] ?? 0) + r.n), acc), {}),
	)
		.map(([k, n]) => ({ k, n }))
		.sort((a, b) => b.n - a.n),
);
list('без телевизора', whys);

const bots = uas.reduce((n, r) => n + (suspect(r.k, r.w) ? r.n : 0), 0);
if (bots) {
	console.log(
		`    ${pad('из них похоже на роботов', 20)}  ${num(bots, 5)}` +
			`  — WebGL2 нет там, где он обязан быть`,
	);
}

/* Сегодня — построчно: на таком трафике это и есть самое полезное. */
const people = new Set(today.map((r) => r.visitor)).size;
console.log(
	`\n  сегодня — ${today.length} ${plural(today.length, 'просмотр', 'просмотра', 'просмотров')}, ` +
		`${people} ${plural(people, 'человек', 'человека', 'человек')}`,
);
for (const r of today) {
	console.log(
		(
			`    ${r.t}  ${pad(r.country ?? '??', 3)} ${pad(r.path, 10)} ` +
			`${pad(browser(r.ua), 22)} ${pad(r.viewport ?? '', 10)} ` +
			`${pad(r.theme ?? '', 6)} ${r.referrer || 'прямой'}`
		).trimEnd(),
	);
}

if (errors.length) {
	console.log(`\n  телевизор не поехал (x=err):`);
	for (const r of errors) {
		console.log(`    ${r.t}  ${pad(r.country, 3)} ${pad(r.path, 10)} ${browser(r.ua)}`);
	}
}
console.log('');
