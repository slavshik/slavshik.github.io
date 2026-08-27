import { expect, test } from '@playwright/test';

/*
 * Стенд облика — единственное место, где src/tv/cabinet.ts и lighting.ts
 * собираются без mount(): без физики, ввода и вещания. Сломать его можно
 * незаметно, поменяв спеку и не заглянув сюда, поэтому проверяем не только
 * «открылся», но и что ползунок доходит до геометрии.
 */

test('стенд облика живой', async ({ page }) => {
	const errors: string[] = [];
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	page.on('pageerror', (e) => errors.push(String(e)));

	await page.goto('/lab/look.html');
	await page.waitForSelector('#stage canvas');

	// Ползунки строятся из схемы над спекой: нет их — не собралась панель
	expect(await page.locator('input[type="range"]').count()).toBeGreaterThan(50);
	expect(await page.locator('input[type="color"]').count()).toBeGreaterThan(5);

	await expect(page.locator('#err')).toHaveText('');
	expect(errors).toEqual([]);
});

test('ползунок формы пересобирает модель', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(String(e)));

	await page.goto('/lab/look.html');
	await page.waitForSelector('#stage canvas');

	// Телеметрия печатает число треугольников — по нему и видно пересборку
	const tris = async (): Promise<number> => {
		const text = (await page.locator('#hud').textContent()) ?? '';
		return Number(/tris (\d+)/.exec(text)?.[1] ?? 0);
	};

	await expect.poll(tris).toBeGreaterThan(0);
	const before = await tris();

	// Сегменты скругления корпуса: их рост обязан добавить треугольников
	const seg = page.locator('.row', { hasText: 'сегменты' }).locator('input[type="range"]');
	await seg.fill('14');

	await expect.poll(tris).toBeGreaterThan(before);
	expect(errors).toEqual([]);
});
