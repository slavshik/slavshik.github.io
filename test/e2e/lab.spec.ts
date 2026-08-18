import { expect, test } from '@playwright/test';

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

  for (const label of ['kick', 'wheelUp', 'wheelDown', 'swipeUp', 'swipeSide', 'reset']) {
    const btn = page.locator(`[data-act="${label}"]`);
    if (await btn.count()) await btn.first().click();
  }

  expect(errors).toEqual([]);
});
