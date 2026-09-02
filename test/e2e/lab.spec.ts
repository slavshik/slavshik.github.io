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
	// Тест ждёт физику, а не разметку, и в CI она идёт втрое медленнее
	// реального времени: цикл берёт не больше MAX_SUB шагов на кадр.
	test.setTimeout(90_000);

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
	 * Ни одной паузы по часам во всём тесте, и это выстрадано. Секунда на
	 * стене — не секунда в физике, а «успокоился» — это состояние, а не
	 * длительность. Фиксированные ожидания здесь провалились трижды подряд и
	 * каждый раз в новом месте: сначала замер закрывался раньше, чем доезжал
	 * клик; потом телевизор не успевал упасть за отведённые три секунды;
	 * потом оказалось, что и точка отсчёта бралась на лету — за отведённые
	 * две с половиной секунды он не успевал даже доехать до пола после
	 * въездного падения, и «вернулся на место» сравнивалось с высотой посреди
	 * отскока.
	 *
	 * Поэтому обе точки покоя ждутся по sleeping — это и есть слово
	 * телевизора о том, что он остановился, — а рывок начинается кнопкой,
	 * нажатой изнутри страницы: клик снаружи идёт с непредсказуемой
	 * задержкой, а натяжение живёт первые доли секунды.
	 */
	await page.goto('/lab/tv.html');
	await page.waitForSelector('#tv-stage canvas');

	// Сброс вместо ожидания въездного падения: оно длинное, со скачками, и
	// ждать его целиком — то же ожидание по часам, только длиннее.
	await page.locator('[data-act="reset"]').click();
	const asleep = (): Promise<boolean> => page.evaluate(() => window.tv.internals.state.sleeping);
	await expect.poll(asleep, { timeout: 30_000 }).toBe(true);

	const before = await page.evaluate(() => window.tv.internals.state.y);
	const peak = await page.evaluate(
		() =>
			new Promise<{ y: number; tension: number; flew: boolean }>((done) => {
				const I = window.tv.internals;
				const p = { y: -Infinity, tension: 0, flew: false };
				const deadline = Date.now() + 30_000; // чтобы тест не завис молча
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

	// Отпустили — телевизор падает обратно и снова засыпает там, где стоял.
	await expect.poll(asleep, { timeout: 30_000 }).toBe(true);
	const after = await page.evaluate(() => window.tv.internals.state.y);
	expect(Math.abs(after - before)).toBeLessThan(0.05);
});
