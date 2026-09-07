import { fileURLToPath } from 'node:url';

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
		// Статичная картинка телевизора была бы хуже, чем его отсутствие,
		// поэтому модуль даже не скачивается — и вот это как раз проверяется,
		// а не подразумевается: канваса нет и в том случае, когда кусок
		// приехал и упал на монтировании.
		const fetched: string[] = [];
		page.on('request', (r) => {
			if (/\/assets\/tv-.*\.js$/.test(new URL(r.url()).pathname)) fetched.push(r.url());
		});

		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/?aqa=1');
		await settle(page);
		// Не сон по часам, а та же очередь, в которую встаёт бутстрап: он
		// заказывает простой на событии load, и колбэки простоя идут по
		// порядку. Дождались своего — значит, чужой уже сработал бы.
		await page.evaluate(
			() =>
				new Promise<void>((done) => {
					(window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 300)))(() => {
						done();
					});
				}),
		);

		expect(fetched).toEqual([]);
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
		// CV лежит на своём же домене, и ссылка на него относительная —
		// проверяем её разрешённой, чтобы «/cv» не уехало однажды на чужой хост.
		const origin = new URL(page.url()).origin;
		expect(hrefs).toEqual([
			'https://www.linkedin.com/in/slavshik',
			`${origin}/cv`,
			'https://github.com/slavshik',
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

// Тег @shot отбирает эти тесты в три оконных проекта; всё остальное
// прогоняется один раз — см. playwright.config.ts.
test.describe('снимки', { tag: '@shot' }, () => {
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

	/*
	 * Экран с передачей, а не со снегом.
	 *
	 * Снимки выше ловят только шум: в режиме ?aqa=1 передачи нет, и весь путь
	 * шейдера при uTexMix = 1 — контраст, насыщение, строчная развёртка поверх
	 * картинки, свечение от неё — не проверялся ничем. Ровно там и жил муар
	 * развёртки, который на снегу не виден, потому что снег сам себе шум.
	 *
	 * На экране испытательная таблица, а не фотография, и это нарочно. Живая
	 * передача — видео с эндпоинта, и в снимке она недетерминирована: кодек,
	 * момент декодирования, номер кадра. Таблица же и детерминирована, и
	 * показывает больше: клин из линий с падающим шагом говорит, какую деталь
	 * съедает развёртка, а ступени яркости — что выбивает свечение.
	 *
	 * Наружу при этом ничего не уходит: адрес локальный и его подменяет сам
	 * тест, а на живом сайте по нему ничего не лежит.
	 */
	test('на экране передача, а не снег', async ({ page }) => {
		await page.route('**/aqa-clip.png', (route) =>
			route.fulfill({ path: fileURLToPath(new URL('fixtures/clip.png', import.meta.url)) }),
		);
		await page.goto('/?aqa=1&clip=1');
		await page.waitForSelector('html[data-tv="ready"]');
		await expect(page).toHaveScreenshot('page-tv-clip.png', { fullPage: true });
	});
});
