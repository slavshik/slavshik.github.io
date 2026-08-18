import { expect, test, type Page } from '@playwright/test';

/*
 * Проверяется то, чего не видно в разметке: что телевизор приходит сам и
 * уходит, когда его просят не двигаться, что страница цела без JS, и что с
 * ?aqa=1 картинка от запуска к запуску одна и та же.
 */

const DAY_ACCENT = '#2f6b57';

/** Страница без телевизора: бутстрап стартует по requestIdleCallback. */
async function settle(page: Page): Promise<void> {
	await page.waitForLoadState('load');
	await page.evaluate(
		() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
	);
}

test.describe('страница', () => {
	test('при prefers-reduced-motion телевизора нет вовсе', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/?aqa=1');
		await settle(page);
		await page.waitForTimeout(1500); // дольше, чем бутстрап

		// Статичная картинка телевизора была бы хуже, чем его отсутствие,
		// поэтому модуль даже не скачивается.
		await expect(page.locator('#tv-stage canvas')).toHaveCount(0);
		await expect(page.locator('html')).not.toHaveClass(/tv-on/);
	});

	test('с ?aqa=1 акцент дневной — иначе эталоны жили бы по часам', async ({ page }) => {
		await page.goto('/?aqa=1');
		await settle(page);

		const accent = await page.evaluate(() =>
			getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
		);
		expect(accent).toBe(DAY_ACCENT);
	});

	test('ничего не тянется со стороны', async ({ page }) => {
		const external: string[] = [];
		page.on('request', (r) => {
			const url = new URL(r.url());
			if (url.hostname !== '127.0.0.1' && url.protocol !== 'data:') external.push(r.url());
		});

		await page.goto('/?aqa=1');
		await page.waitForSelector('html[data-tv="ready"]');

		expect(external).toEqual([]);
	});

	test('кнопка темы появляется только с JS', async ({ page }) => {
		await page.goto('/?aqa=1');
		await settle(page);
		await expect(page.locator('#theme')).toBeVisible();
	});

	test('ссылки на месте и кликабельны', async ({ page }) => {
		await page.goto('/?aqa=1');
		await settle(page);

		const hrefs = await page
			.locator('nav a')
			.evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));
		expect(hrefs).toEqual([
			'https://github.com/slavshik',
			'https://www.linkedin.com/in/slavshik',
			'https://instagram.com/slavshik',
			'mailto:slavshik@me.com',
		]);
	});
});

test.describe('телевизор', () => {
	test('приходит сам, без ключей, и докладывает о готовности', async ({ page }) => {
		await page.goto('/?aqa=1');
		await page.waitForSelector('html[data-tv="ready"]');

		await expect(page.locator('#tv-stage canvas')).toHaveCount(1);
		await expect(page.locator('html')).toHaveClass(/tv-on/);
	});

	test('канвас не перехватывает клики по ссылкам', async ({ page }) => {
		await page.goto('/?aqa=1');
		await page.waitForSelector('html[data-tv="ready"]');

		const stage = page.locator('#tv-stage');
		await expect(stage).toHaveCSS('pointer-events', 'none');
	});
});

test.describe('снимки', () => {
	// Эталон снят ещё до того, как телевизор включили всем, и остаётся верным:
	// при prefers-reduced-motion страница выглядит ровно так же, как выглядела
	// без ключа ?tv=1.
	test('страница без телевизора', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/?aqa=1');
		await settle(page);
		await expect(page).toHaveScreenshot('page.png', { fullPage: true });
	});

	test('страница с телевизором', async ({ page }) => {
		await page.goto('/?aqa=1');
		await page.waitForSelector('html[data-tv="ready"]');
		await expect(page).toHaveScreenshot('page-tv.png', { fullPage: true });
	});

	test('страница с телевизором в тёмной теме', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.goto('/?aqa=1');
		await page.waitForSelector('html[data-tv="ready"]');
		await expect(page).toHaveScreenshot('page-tv-dark.png', { fullPage: true });
	});
});
