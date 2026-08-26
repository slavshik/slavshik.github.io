import { readFileSync, readdirSync } from 'node:fs';

import { defineConfig, type Plugin } from 'vitest/config';

/*
 * Мок эндпоинта /api/hit на время разработки.
 *
 * Настоящий живёт не здесь и вообще не в этом репозитории: он собирает визит
 * и отдаёт ролик из курируемого альбома. Странице для работы достаточно
 * контракта, и вот он: без параметров — прозрачный GIF (пиксель работает и
 * без JS), с tex=1 — короткое видео.
 *
 * Range обслуживается нарочно, хотя в моке проще было бы всегда отдавать
 * целиком: Safari грузит медиа только диапазонами, и эндпоинт, который этого
 * не умеет, ломается ровно там, где это труднее всего заметить.
 */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/*
 * Откуда берутся ролики. test/fixtures/local — свои кадры: репозиторий
 * публичный, поэтому эта папка под .gitignore, и мок предпочитает её, если
 * она не пуста. Без неё крутится синтетика, которая в git и лежит.
 */
const CLIP_DIRS = ['test/fixtures/local', 'test/fixtures'];

function clips(): string[] {
	for (const dir of CLIP_DIRS) {
		try {
			const found = readdirSync(dir)
				.filter((f) => f.endsWith('.mp4'))
				.sort()
				.map((f) => `${dir}/${f}`);
			if (found.length) return found;
		} catch {
			/* нет такой папки — идём к следующей */
		}
	}
	return [];
}

let lastClip = '';

function hitMock(): Plugin {
	return {
		name: 'hit-mock',
		configureServer(server) {
			server.middlewares.use('/api/hit', (req, res) => {
				const q = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');

				if (q.get('tex') !== '1') {
					// В консоли dev-сервера видно ровно то, что уедет в аналитику
					console.log('[hit]', Object.fromEntries(q));
					res.setHeader('content-type', 'image/gif');
					res.setHeader('cache-control', 'no-store');
					res.end(PIXEL);
					return;
				}

				// Какой ролик показать — решает эндпоинт, а не страница: seq в
				// запросе только просит следующий. Здесь он выбирается
				// случайно, но никогда не повторяет предыдущий — иначе смена
				// канала иногда выглядела бы поломкой.
				const list = clips();
				if (!list.length) {
					res.statusCode = 404;
					res.end();
					return;
				}
				let pick = list[Math.floor(Math.random() * list.length)]!;
				if (pick === lastClip && list.length > 1) {
					pick = list[(list.indexOf(pick) + 1) % list.length]!;
				}
				lastClip = pick;
				const clip = readFileSync(pick);
				res.setHeader('content-type', 'video/mp4');
				res.setHeader('cache-control', 'no-store');
				res.setHeader('accept-ranges', 'bytes');

				const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
				if (range) {
					const start = Number(range[1] || 0);
					const end = range[2] ? Number(range[2]) : clip.length - 1;
					res.statusCode = 206;
					res.setHeader('content-range', `bytes ${start}-${end}/${clip.length}`);
					res.end(clip.subarray(start, end + 1));
					return;
				}
				res.end(clip);
			});
		},
	};
}

// Три входа: сама страница и два стенда. Стенды собираются вместе с сайтом
// нарочно — так они не могут разойтись с продакшеном, а lab/tv.html
// импортирует ровно тот же исходник телевизора, что и главная.
export default defineConfig({
	base: '/',
	plugins: [hitMock()],
	build: {
		// es2022 сам по себе — не про браузеры, а про год, и Safari до 16.4
		// от него отваливался целиком: three объявляет свои классы через
		// `static {}`, статические блоки приехали в WebKit только в 16.4, а
		// синтаксис — это ошибка разбора всего куска, а не одного вызова.
		// Кусок с телевизором просто не парсился, import() отлетал, и
		// страница молча оставалась без телевизора. Поэтому рядом с годом
		// стоит браузер: safari16 заставляет esbuild опустить статические
		// блоки, и это стоит десяток лишних байт после gzip.
		target: ['es2022', 'safari16'],
		modulePreload: { polyfill: false },
		rollupOptions: {
			input: {
				index: 'index.html',
				lab: 'lab/tv.html',
				og: 'lab/og.html',
			},
		},
	},
	test: {
		include: ['test/unit/**/*.test.ts'],
		environment: 'node',
	},
});
