/*
 * /api/hit — единственная ручка сайта.
 *
 * Она делает две вещи сразу, и это не экономия, а весь замысел: запрос за
 * картинкой для экрана телевизора он же и есть событие аналитики. Отдельного
 * трекера нет, поэтому нечего блокировать — это свой домен и это контент.
 *
 * Что отдаётся:
 *   GET /api/hit           → прозрачный GIF 43 байта. Работает без JS, и его
 *                            видят все, включая тех, кому телевизор не
 *                            показывают вовсе.
 *   GET /api/hit?tex=1     → ролик из альбома, video/mp4.
 *
 * Что принимается (только со своим токеном, ходит tvcast с NAS):
 *   GET    /api/cast/list      → что уже лежит, чтобы не заливать заново
 *   PUT    /api/cast/clip/<id> → положить ролик
 *   DELETE /api/cast/clip/<id> → убрать
 *
 * Ключевое ограничение, из которого следует остальное: у KV на бесплатном
 * тарифе тысяча записей в сутки. Значит на запрос писать в KV нельзя — ни
 * счётчиком, ни курсором. Поэтому какой ролик показать, вычисляется из самого
 * запроса, а не из состояния на сервере.
 */

export interface Env {
	/** Ролики: ключ clip:<id>, значение — сам mp4. */
	TVSET: KVNamespace;
	/** Токен для ручек /api/cast. Ставится через `wrangler secret put`. */
	CAST_TOKEN?: string;
	/** Соль для дневного хеша посетителя. Тоже секрет. */
	VISITOR_SALT?: string;
	/** События. Пока не заведено — аналитика молча не пишется. */
	EVENTS?: D1Database;
}

const PIXEL = Uint8Array.from(
	atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
	(c) => c.charCodeAt(0),
);

const CLIP_PREFIX = 'clip:';

/** Ответы этой ручки нельзя кешировать: иначе визиты перестанут доходить. */
const NO_STORE = {
	'cache-control': 'no-store, no-cache, must-revalidate',
	'x-robots-tag': 'noindex',
};

/*
 * Список роликов меняется раз в сутки, а читается на каждый визит, поэтому он
 * держится в памяти изолята. Изолят живёт своей жизнью и может исчезнуть в
 * любой момент — это кеш, а не состояние: потеряется, перечитаем.
 */
let cachedIds: string[] | null = null;
let cachedAt = 0;
const CACHE_MS = 60_000;

async function clipIds(env: Env): Promise<string[]> {
	const now = Date.now();
	if (cachedIds && now - cachedAt < CACHE_MS) return cachedIds;
	const list = await env.TVSET.list({ prefix: CLIP_PREFIX });
	cachedIds = list.keys.map((k) => k.name.slice(CLIP_PREFIX.length)).sort();
	cachedAt = now;
	return cachedIds;
}

/** Небольшой строковый хеш. Криптостойкость тут не нужна: это выбор канала. */
function hash32(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/**
 * Кто посетитель — считается, но не запоминается: sha256 от дневной соли, IP
 * и браузера, обрезанный до восьми байт. Сам IP никуда не пишется, а соль
 * меняется в полночь, поэтому склеить визиты между сутками нельзя даже нам.
 */
async function visitorId(request: Request, env: Env, day: string): Promise<string> {
	const ip = request.headers.get('cf-connecting-ip') ?? '';
	const ua = request.headers.get('user-agent') ?? '';
	const data = new TextEncoder().encode(`${env.VISITOR_SALT ?? 'соль'}|${day}|${ip}|${ua}`);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return [...new Uint8Array(digest).slice(0, 8)]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

async function recordVisit(request: Request, env: Env, q: URLSearchParams): Promise<void> {
	if (!env.EVENTS) return; // база ещё не заведена — молча мимо
	const day = new Date().toISOString().slice(0, 10);
	const cf = request.cf as { country?: string; asn?: number; city?: string } | undefined;
	try {
		await env.EVENTS.prepare(
			`INSERT INTO visits
			   (at, visitor, country, asn, ua, referrer, path, utm_source, utm_medium,
			    utm_campaign, viewport, dpr, theme, tex)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		)
			.bind(
				new Date().toISOString(),
				await visitorId(request, env, day),
				cf?.country ?? null,
				cf?.asn ?? null,
				request.headers.get('user-agent'),
				q.get('r'),
				q.get('p') ?? '/',
				q.get('u'),
				q.get('m'),
				q.get('c'),
				q.get('w'),
				q.get('d'),
				q.get('t'),
				q.get('tex') === '1' ? 1 : 0,
			)
			.run();
	} catch {
		/* аналитика не повод ронять ответ */
	}
}

/** Ролик целиком или кусок: Safari грузит медиа только диапазонами. */
function clipResponse(body: ArrayBuffer, range: string | null): Response {
	const total = body.byteLength;
	const headers: Record<string, string> = {
		...NO_STORE,
		'content-type': 'video/mp4',
		'accept-ranges': 'bytes',
	};

	const m = /bytes=(\d*)-(\d*)/.exec(range ?? '');
	if (m) {
		const start = m[1] ? Number(m[1]) : 0;
		const end = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
		if (start >= total || start > end) {
			return new Response(null, {
				status: 416,
				headers: { ...headers, 'content-range': `bytes */${total}` },
			});
		}
		return new Response(body.slice(start, end + 1), {
			status: 206,
			headers: { ...headers, 'content-range': `bytes ${start}-${end}/${total}` },
		});
	}
	return new Response(body, { headers });
}

function authorized(request: Request, env: Env): boolean {
	const token = env.CAST_TOKEN;
	if (!token) return false; // секрет не поставлен — ручка закрыта наглухо
	return request.headers.get('authorization') === `Bearer ${token}`;
}

async function handleCast(request: Request, env: Env, path: string): Promise<Response> {
	if (!authorized(request, env)) return new Response('нет', { status: 401 });

	if (path === '/api/cast/list' && request.method === 'GET') {
		const list = await env.TVSET.list({ prefix: CLIP_PREFIX });
		return Response.json(
			list.keys.map((k) => ({ id: k.name.slice(CLIP_PREFIX.length), meta: k.metadata })),
			{ headers: NO_STORE },
		);
	}

	const clip = /^\/api\/cast\/clip\/([\w.-]{1,80})$/.exec(path);
	if (clip) {
		const key = CLIP_PREFIX + clip[1]!;
		if (request.method === 'PUT') {
			const body = await request.arrayBuffer();
			if (!body.byteLength) return new Response('пусто', { status: 400 });
			// Метаданные — контрольная сумма исходника: по ней tvcast понимает,
			// что кадр не менялся, и не заливает его снова.
			const checksum = request.headers.get('x-checksum') ?? '';
			await env.TVSET.put(key, body, { metadata: { checksum, size: body.byteLength } });
			cachedIds = null;
			return Response.json({ ok: true, id: clip[1], size: body.byteLength });
		}
		if (request.method === 'DELETE') {
			await env.TVSET.delete(key);
			cachedIds = null;
			return Response.json({ ok: true, deleted: clip[1] });
		}
	}

	return new Response('не туда', { status: 404 });
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (path.startsWith('/api/cast/')) return handleCast(request, env, path);
		if (path !== '/api/hit') return new Response('не туда', { status: 404 });

		const q = url.searchParams;

		// Считаются начала, а не байты. Браузер тянет медиа диапазонами, и один
		// ролик приезжает несколькими запросами; засчитывать каждый значит
		// умножать показы на прихоть проигрывателя. Продолжение — это Range не
		// с нуля, и оно не событие.
		const range = request.headers.get('range');
		const continuation = !!range && !/^bytes=0-/.test(range.trim());
		if (!continuation) ctx.waitUntil(recordVisit(request, env, q));

		if (q.get('tex') !== '1') {
			return new Response(PIXEL, {
				headers: { ...NO_STORE, 'content-type': 'image/gif' },
			});
		}

		const ids = await clipIds(env);
		if (!ids.length) return new Response(null, { status: 204, headers: NO_STORE });

		// Какой ролик — решает эндпоинт, но без единой записи в KV: номер
		// выводится из ключа визита и порядкового номера просьбы. Соседние
		// просьбы одного визита всегда дают разные ролики, а два визита не
		// сговариваются между собой.
		const seq = Number(q.get('seq') ?? 0);
		const base = hash32(q.get('n') ?? 'без ключа');
		const idx = (base + (Number.isFinite(seq) ? Math.trunc(seq) : 0)) % ids.length;
		const id = ids[((idx % ids.length) + ids.length) % ids.length]!;

		const body = await env.TVSET.get(CLIP_PREFIX + id, 'arrayBuffer');
		if (!body) {
			cachedIds = null; // список разъехался с содержимым — перечитаем
			return new Response(null, { status: 204, headers: NO_STORE });
		}
		return clipResponse(body, request.headers.get('range'));
	},
} satisfies ExportedHandler<Env>;
