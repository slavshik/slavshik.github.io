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

test('локальное фото переживает настройку и возвращается к снегу', async ({ page }) => {
	await page.goto('/lab/look.html?aqa=1');
	const canvas = page.locator('#stage canvas');
	await expect(canvas).toBeVisible();
	const capture = () =>
		canvas.screenshot({
			style: '#panel, #hud, #toggle, #err { visibility: hidden !important; }',
		});
	await expect(page.locator('#stage')).toHaveAttribute('data-preview', 'snow');
	const renderedFrames = await page.locator('#stage').getAttribute('data-frames');
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				requestAnimationFrame(() =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				);
			}),
	);
	await expect(page.locator('#stage')).toHaveAttribute('data-frames', renderedFrames!);
	const snow = await capture();
	await page.getByLabel('Локальное фото').setInputFiles('test/e2e/fixtures/clip.png');
	await expect(page.locator('#stage')).toHaveAttribute('data-preview', 'image', {
		timeout: 15000,
	});
	expect((await capture()).equals(snow)).toBe(false);
	await page.locator('.row', { hasText: 'экспозиция фото' }).locator('input').fill('1.15');
	await page.getByRole('button', { name: 'Снег', exact: true }).click();
	await expect(page.locator('#stage')).toHaveAttribute('data-preview', 'snow');
	expect((await capture()).equals(snow)).toBe(true);
	await expect(page.locator('#err')).toHaveText('');
});
