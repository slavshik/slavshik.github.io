/*
 * Разберётся ли собранное там, где мы обещали работать.
 *
 * Проверка появилась после iPhone на iOS 16.3: three объявляет свои классы
 * через `static {}`, WebKit научился этому только в 16.4, и кусок с
 * телевизором не разбирался целиком. Ошибка разбора — это не упавший вызов,
 * а мёртвый файл: import() отлетал, .catch() глотал, страница оставалась
 * целой и молчала. Ни типы, ни линтер, ни скриншоты такого не видят —
 * собирается-то оно у нас, а ломается у посетителя.
 *
 * Способ простой: esbuild разбирает файл дважды — как есть и с целевым
 * браузером. Если он что-то понизил, значит в файле был синтаксис новее
 * обещанного.
 *
 * `node test/syntax.mjs` — проверить.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { transformSync } from 'esbuild';

const DIST = 'dist/assets';

/*
 * Обещание, а не настройка сборки. Как его выполнить — дело vite
 * (build.target в vite.config.ts); здесь написано, что именно он должен
 * выполнить. Списки нарочно разные: стоит сборке стать мягче обещания, и
 * развалится ровно эта проверка, а не чей-то телефон.
 *
 * Почему 16, а не 15: WebGL2 в iOS приехал в 15, но опускать до него поля
 * классов — это +29% к весу куска ради устройств, которым телевизор всё
 * равно не потянуть.
 */
const TARGET = 'safari16';

/** Чем новее браузер, тем меньше приходится понижать. Для доклада. */
const LADDER = ['safari16', 'safari16.4', 'safari17', 'safari18', 'safari26'];

/** Тот же файл, но разобранный без оглядки на браузеры. */
const plain = (code) => transformSync(code, { format: 'esm' }).code;

/** Понижает ли esbuild этот файл ради target. */
function needsLowering(code, target) {
	try {
		return transformSync(code, { format: 'esm', target }).code !== plain(code);
	} catch {
		return true; // не смог даже понизить — тем более не разберётся
	}
}

/** Самый старый браузер из лестницы, которому файл достаётся как есть. */
function oldestOk(code) {
	return LADDER.find((t) => !needsLowering(code, t)) ?? 'новее всего, что здесь перечислено';
}

const files = readdirSync(DIST).filter((f) => f.endsWith('.js'));
if (files.length === 0) {
	console.error(`в ${DIST} нет ни одного .js — сборка сломана?`);
	process.exit(1);
}

console.log(`синтаксис, обещано ${TARGET}:`);

let failed = 0;
for (const file of files.sort()) {
	const code = readFileSync(join(DIST, file), 'utf8');
	const ok = !needsLowering(code, TARGET);
	console.log(
		`  ${ok ? 'ok  ' : 'FAIL'}  ${file}${ok ? '' : ` — разберётся только с ${oldestOk(code)}`}`,
	);
	if (!ok) failed++;
}

if (failed) {
	console.error(
		`\nсинтаксис новее обещанного: ${failed} шт.\n` +
			`почини build.target в vite.config.ts — не эту проверку.`,
	);
	process.exit(1);
}
