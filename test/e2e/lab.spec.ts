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
	 */
	await page.goto('/lab/tv.html');
	await page.waitForSelector('#tv-stage canvas');
	await page.waitForTimeout(2500); // упасть и успокоиться

	const before = await page.evaluate(() => window.tv.internals.state.y);
	await page.evaluate(() => {
		const w = window as unknown as { __peak: { y: number; tension: number; flew: boolean } };
		w.__peak = { y: -Infinity, tension: 0, flew: false };
		const I = window.tv.internals;
		const t = setInterval(() => {
			w.__peak.y = Math.max(w.__peak.y, I.state.y);
			w.__peak.tension = Math.max(w.__peak.tension, I.plugHold.tension);
			if (!I.state.grounded) w.__peak.flew = true;
		}, 30);
		setTimeout(() => clearInterval(t), 1500);
	});

	await page.locator('[data-act="tug"]').click();
	await page.waitForTimeout(1600);

	const peak = await page.evaluate(
		() =>
			(window as unknown as { __peak: { y: number; tension: number; flew: boolean } }).__peak,
	);
	expect(peak.tension).toBeGreaterThan(0);
	expect(peak.y).toBeGreaterThan(before + 0.3);
	expect(peak.flew).toBe(true);

	// Отпустили — телевизор падает обратно на пол.
	await page.waitForTimeout(3000);
	const after = await page.evaluate(() => window.tv.internals.state.y);
	expect(Math.abs(after - before)).toBeLessThan(0.2);
});
