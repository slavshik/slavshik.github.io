import { expect, test } from '@playwright/test';

import type { TvInstance } from '../../src/tv/index.js';

/* Стенд кладёт телевизор в window — только он, и только для консоли и вот
   таких проверок. В продакшене этого нет. */
declare global {
	interface Window {
		tv: TvInstance;
	}
}

/*
 * Стенд легко сломать незаметно: на него никто не смотрит, пока он не
 * понадобился, а он единственный, кто дёргает src/tv/lab.ts. Проверка
 * простая — открылся, собрал ползунки из параметров, нарисовал кадр и не
 * насыпал ошибок в консоль.
 */

test('стенд телевизора живой', async ({ page }) => {
	const errors: string[] = [];
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	page.on('pageerror', (e) => errors.push(String(e)));

	await page.goto('/lab/tv.html');
	await page.waitForSelector('#tv-stage canvas');

	// Ползунки строятся из объекта параметров, а он один и тот же с продом:
	// если их нет, значит пульт не собрался.
	const sliders = page.locator('input[type="range"]');
	expect(await sliders.count()).toBeGreaterThan(10);

	// Стенд ловит собственные ошибки в этот блок — он обязан быть пустым.
	await expect(page.locator('#err')).toHaveText('');
	expect(errors).toEqual([]);
});

test('кнопки стенда дёргают телевизор, а не падают', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(String(e)));

	await page.goto('/lab/tv.html');
	await page.waitForSelector('#tv-stage canvas');

	for (const label of ['kick', 'wheelUp', 'wheelDown', 'swipeUp', 'swipeSide', 'tug', 'reset']) {
		const btn = page.locator(`[data-act="${label}"]`);
		if (await btn.count()) await btn.first().click();
	}

	expect(errors).toEqual([]);
});

test('за шнур телевизор поднимается в воздух', async ({ page }) => {
	// Тест ждёт физику, а не разметку: успокоиться, подняться, упасть обратно.
	// В CI всё это идёт втрое медленнее, и тридцати секунд по умолчанию не
	// хватает с запасом, достаточным, чтобы не мигать красным на ровном месте.
	test.setTimeout(60_000);

	/*
	 * Мышью это проверяется только там, где вилка видна на экране, а её место
	 * зависит и от вёрстки, и от того, где остановилась физика. Кнопка стенда
	 * берёт вилку программно, и проверить можно главное: натянутый шнур
	 * двигает корпус, а не только болтается сам.
	 *
	 * Вверх, а не вбок: вбок телевизор упирается в стенку сцены, и на широком
	 * окне он уже стоит у неё вплотную — тянуть некуда, и тест провалился бы
	 * на одном desktop из трёх раскладок, ничего не говоря о физике.
	 *
	 * Меряется пик, а не мгновение. Натяжение живёт ровно до тех пор, пока
	 * корпус не подтянулся к пальцу: дальше шнур провисает и сила честно
	 * падает в ноль. Один замер «после паузы» ловит то момент рывка, то этот
	 * ноль — в зависимости от того, как быстро идёт кадр.
	 *
	 * И кнопка нажимается изнутри страницы, а не через page.click(). Клик
	 * снаружи идёт с непредсказуемой задержкой — проверки доступности,
	 * прокрутка, ожидание кадра, — а натяжение живёт первые доли секунды.
	 * В CI, где всё втрое медленнее, замер успевал закончиться раньше, чем
	 * клик доезжал: сначала пик натяжения выходил нулём, потом телевизор
	 * не успевал подняться. Здесь замер уже стоит, когда кнопка нажата, и
	 * заканчивается сам — когда вилку отпустили, а не по будильнику.
	 */
	await page.goto('/lab/tv.html');
	await page.waitForSelector('#tv-stage canvas');
	await page.waitForTimeout(2500); // упасть и успокоиться

	const before = await page.evaluate(() => window.tv.internals.state.y);
	const peak = await page.evaluate(
		() =>
			new Promise<{ y: number; tension: number; flew: boolean }>((done) => {
				const I = window.tv.internals;
				const p = { y: -Infinity, tension: 0, flew: false };
				const deadline = Date.now() + 15000; // чтобы тест не завис молча
				const t = setInterval(() => {
					p.y = Math.max(p.y, I.state.y);
					p.tension = Math.max(p.tension, I.plugHold.tension);
					if (!I.state.grounded) p.flew = true;
					if ((p.tension > 0 && !I.plugHold.active) || Date.now() > deadline) {
						clearInterval(t);
						done(p);
					}
				}, 16);
				document.querySelector<HTMLButtonElement>('[data-act="tug"]')!.click();
			}),
	);

	expect(peak.tension).toBeGreaterThan(0);
	expect(peak.y).toBeGreaterThan(before + 0.3);
	expect(peak.flew).toBe(true);

	/*
	 * Отпустили — телевизор падает обратно на пол. Ждём этого опросом, а не
	 * паузой: секунда на стене — не секунда в физике. Цикл берёт не больше
	 * MAX_SUB шагов на кадр, поэтому на медленной машине время идёт медленнее
	 * реального, и вдобавок падение кончается не сразу — корпус ещё скачет.
	 * Фиксированные три секунды проходили локально и не проходили в CI, где
	 * телевизор к этому моменту был ещё в воздухе на четверть своей высоты.
	 */
	await expect
		.poll(
			() =>
				page.evaluate((y0) => {
					const s = window.tv.internals.state;
					return s.grounded ? Math.abs(s.y - y0) : Infinity;
				}, before),
			{ timeout: 20000 },
		)
		.toBeLessThan(0.2);
});
