/*
 * Снимает эталоны со страницы ДО рефакторинга.
 *
 * Смысл ровно один: порт телевизора обязан быть попиксельно тем же самым, а
 * доказать это может только картинка, снятая со старого кода. Скрипт поднимает
 * статический сервер над распакованным коммитом и складывает снимки туда, где
 * их ждёт Playwright.
 *
 * Запускать через `make baselines` — он делает это в том же контейнере, в
 * котором эталоны потом сравниваются.
 */

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

import { chromium } from '@playwright/test';

const SITE = process.env.SITE || '/pristine';
const OUT = process.env.OUT || 'test/e2e/__screenshots__';
const PORT = 8099;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let file = join(SITE, normalize(decodeURIComponent(url.pathname)));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(SITE) || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

// Виды и сценарии обязаны совпадать с playwright.config.ts и page.spec.ts —
// иначе сравнивать будет нечего.
const PROJECTS = {
  desktop: { width: 1280, height: 900 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
};

const SHOTS = [
  { name: 'page.png', url: '/?aqa=1', tv: false, dark: false },
  { name: 'page-tv.png', url: '/?tv=1&aqa=1', tv: true, dark: false },
  { name: 'page-tv-dark.png', url: '/?tv=1&aqa=1', tv: true, dark: true },
];

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch();
let n = 0;

for (const [project, viewport] of Object.entries(PROJECTS)) {
  mkdirSync(join(OUT, project), { recursive: true });
  for (const shot of SHOTS) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    if (shot.dark) await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`http://127.0.0.1:${PORT}${shot.url}`, { waitUntil: 'load' });
    if (shot.tv) {
      await page.waitForSelector('html[data-tv="ready"]');
    } else {
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
    }
    await page.screenshot({
      path: join(OUT, project, shot.name),
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    });
    await page.close();
    n++;
    console.log(`  ${project}/${shot.name}`);
  }
}

await browser.close();
server.close();
console.log(`снято эталонов: ${n}`);
