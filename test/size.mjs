/*
 * Бюджет веса. Проверяет ровно две вещи:
 *
 *   — страница БЕЗ телевизора должна быть крошечной. Её скачивает каждый, и
 *     это тот вес, который имеет смысл держать в узде. Считается вместе с
 *     разметкой: index.html дольше всех не попадал в бюджет и однажды
 *     оказался тяжелее всего JS с CSS вместе взятых — сплошь на
 *     комментариях, которые с тех пор в dist не уезжают;
 *   — кусок с телевизором меряется и не должен неожиданно распухать. Его
 *     размер задаёт three, а не мы, поэтому потолка в килобайтах нет — есть
 *     запрет на рост больше чем на 10% от записанного.
 *
 * `node test/size.mjs` — проверить, `node test/size.mjs --update` — записать
 * текущие значения в test/size-budget.json.
 */

import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const BUDGET_FILE = 'test/size-budget.json';
const PAGE_LIMIT = 10 * 1024; // страница без телевизора, gzip, HTML + JS + CSS
const TV_GROWTH = 1.1; // насколько куску с телевизором позволено вырасти

const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(2)} kB`;

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const pageAssets = [...html.matchAll(/\/assets\/([\w.-]+\.(?:js|css))/g)].map((m) => m[1]);
if (pageAssets.length === 0) {
	console.error('в dist/index.html нет ссылок на assets — сборка сломана?');
	process.exit(1);
}

const assets = readdirSync(join(DIST, 'assets'));
const tvAsset = assets.find((f) => /^tv-.*\.js$/.test(f));
if (!tvAsset) {
	console.error('в dist/assets нет куска tv-*.js — телевизор перестал грузиться лениво?');
	process.exit(1);
}

const page =
	gz(join(DIST, 'index.html')) +
	pageAssets.reduce((sum, f) => sum + gz(join(DIST, 'assets', f)), 0);
const tv = gz(join(DIST, 'assets', tvAsset));

if (process.argv.includes('--update')) {
	writeFileSync(BUDGET_FILE, `${JSON.stringify({ tv }, null, 2)}\n`);
	console.log(`записано: телевизор ${kb(tv)} (gzip)`);
	process.exit(0);
}

const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
const tvLimit = Math.round(budget.tv * TV_GROWTH);

let failed = 0;
const check = (name, value, limit) => {
	const ok = value <= limit;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}: ${kb(value)} (потолок ${kb(limit)})`);
	if (!ok) failed++;
};

console.log('вес, gzip:');
check(`страница без телевизора (index.html, ${pageAssets.join(', ')})`, page, PAGE_LIMIT);
check(`кусок с телевизором (${tvAsset})`, tv, tvLimit);

if (failed) {
	console.error(
		'\nвес вырос. Если это осознанно — `node test/size.mjs --update` и коммит нового бюджета.',
	);
	process.exit(1);
}
