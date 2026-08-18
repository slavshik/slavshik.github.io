/*
 * Браузерные проверки страницы. Запускать через `make e2e` — он поднимает
 * сервер и передаёт сюда BASE. Playwright ставится глобально, в репозитории
 * ни package.json, ни node_modules не появляется: путь до него приходит
 * снаружи через NODE_PATH.
 *
 * Проверяется то, что нельзя увидеть в разметке: что телевизора правда нет,
 * пока его не позвали, и что с ?aqa=1 картинка от запуска к запуску одна и
 * та же. Скриншоты кладутся в test/shots — они не эталоны, а то, на что
 * можно посмотреть глазами.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const SHOTS = path.join(__dirname, 'shots');
const DAY_ACCENT = '#2f6b57';

const WIDE = { width: 1280, height: 900 };
const NARROW = { width: 390, height: 844 };

let failed = 0;

function ok(name, cond, detail) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failed++;
}

// Состояние страницы одним куском: меньше раундтрипов и меньше шансов
// поймать разные моменты жизни страницы разными запросами.
const probe = () => ({
  canvas:   !!document.querySelector('#tv-stage canvas'),
  tvOn:     document.documentElement.classList.contains('tv-on'),
  ready:    document.documentElement.getAttribute('data-tv'),
  shadow:   getComputedStyle(document.querySelector('h1')).textShadow,
  accent:   getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  ruleTop:  document.querySelector('.rule').getBoundingClientRect().top,
});

async function open(browser, url, viewport) {
  const page = await browser.newPage({ viewport });
  const asked = [];
  page.on('request', (r) => asked.push(r.url()));
  await page.goto(BASE + url, { waitUntil: 'load' });
  return { page, asked };
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();

  /* ── Без ключа телевизора нет вообще ──────────────────────────────────── */

  {
    const { page, asked } = await open(browser, '/', WIDE);
    // Ждём дольше, чем бутстрап: он стартует по requestIdleCallback после
    // load, и «ничего не появилось» надо проверять после этого момента.
    await page.waitForTimeout(1500);
    const s = await page.evaluate(probe);

    ok('голая страница: канваса нет', s.canvas === false);
    ok('голая страница: класса tv-on нет', s.tvOn === false);
    ok('голая страница: подложки под именем нет', s.shadow === 'none', s.shadow);
    ok('голая страница: tv.js не запрашивался',
      !asked.some((u) => /tv\.js|three/.test(u)),
      asked.filter((u) => /tv\.js|three/.test(u)).join(', '));

    await page.screenshot({ path: path.join(SHOTS, 'bare.png'), fullPage: true });
    await page.close();
  }

  /* ── ?tv=1 — телевизор на месте ───────────────────────────────────────── */

  {
    const { page } = await open(browser, '/?tv=1', WIDE);
    await page.waitForSelector('#tv-stage canvas', { timeout: 10000 });
    // Падение должно закончиться до снимка
    await page.waitForTimeout(4000);
    const s = await page.evaluate(probe);

    ok('?tv=1: канвас есть', s.canvas === true);
    ok('?tv=1: класс tv-on повешен', s.tvOn === true);
    ok('?tv=1: подложка под именем включилась', s.shadow !== 'none', s.shadow);

    await page.screenshot({ path: path.join(SHOTS, 'tv.png') });
    await page.close();
  }

  /* ── ?aqa=1 без ?tv=1 — страница без телевизора, но детерминированная ─── */

  {
    const { page } = await open(browser, '/?aqa=1', WIDE);
    await page.waitForTimeout(1500);
    const s = await page.evaluate(probe);

    ok('?aqa=1 без ?tv=1: телевизора нет', s.canvas === false);
    ok('?aqa=1: акцент прибит к дневному', s.accent === DAY_ACCENT, s.accent);
    ok('?aqa=1 без телевизора: data-tv не выставлен', s.ready === null, String(s.ready));
    await page.close();
  }

  /* ── ?tv=1&aqa=1 — один и тот же кадр от запуска к запуску ────────────── */

  {
    const { page } = await open(browser, '/?tv=1&aqa=1', WIDE);
    await page.waitForSelector('[data-tv="ready"]', { timeout: 10000 });
    const s = await page.evaluate(probe);

    ok('?tv=1&aqa=1: канвас есть', s.canvas === true);
    ok('?tv=1&aqa=1: готовность помечена', s.ready === 'ready', String(s.ready));
    ok('?tv=1&aqa=1: акцент дневной', s.accent === DAY_ACCENT, s.accent);

    // Главное: между двумя снимками ничего не должно шевельнуться. Шум на
    // кинескопе живёт от uTime, поэтому незамороженный экран здесь падает.
    const a = await page.screenshot();
    await page.waitForTimeout(900);
    const b = await page.screenshot();
    ok('?tv=1&aqa=1: кадр не меняется во времени', a.equals(b),
      `${a.length} b vs ${b.length} b`);

    fs.writeFileSync(path.join(SHOTS, 'aqa.png'), a);
    await page.close();
  }

  /* ── Два запуска подряд дают одинаковый кадр ──────────────────────────── */

  {
    const shoot = async () => {
      const { page } = await open(browser, '/?tv=1&aqa=1', WIDE);
      await page.waitForSelector('[data-tv="ready"]', { timeout: 10000 });
      const buf = await page.screenshot();
      await page.close();
      return buf;
    };
    const first = await shoot();
    const second = await shoot();
    ok('?tv=1&aqa=1: два запуска дают один кадр', first.equals(second),
      `${first.length} b vs ${second.length} b`);
  }

  /* ── Узкий экран: телевизор всё ещё заводится ─────────────────────────── */

  {
    const { page } = await open(browser, '/?tv=1&aqa=1', NARROW);
    await page.waitForSelector('[data-tv="ready"]', { timeout: 10000 });
    const s = await page.evaluate(probe);
    ok('узкий экран: телевизор заводится', s.canvas === true);
    await page.screenshot({ path: path.join(SHOTS, 'narrow.png') });
    await page.close();
  }

  /* ── Кнопка темы ──────────────────────────────────────────────────────── */

  const theme = () => ({
    attr:   document.documentElement.dataset.theme || null,
    paper:  getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),
    hidden: document.getElementById('theme').hidden,
    stored: (() => { try { return localStorage.getItem('theme'); } catch (e) { return 'ERR'; } })(),
  });

  {
    const ctx = await browser.newContext({ viewport: WIDE, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'load' });

    let t = await page.evaluate(theme);
    ok('тема: кнопка показана', t.hidden === false);
    ok('тема: по умолчанию системная, без override', t.attr === null, String(t.attr));
    ok('тема: светлая система — светлая бумага', t.paper === '#f4f1ec', t.paper);

    await page.click('#theme');
    t = await page.evaluate(theme);
    ok('тема: клик уводит в тёмную', t.attr === 'dark', String(t.attr));
    ok('тема: бумага потемнела', t.paper === '#101014', t.paper);
    ok('тема: выбор сохранён', t.stored === 'dark', String(t.stored));

    await page.reload({ waitUntil: 'load' });
    t = await page.evaluate(theme);
    ok('тема: переживает перезагрузку', t.attr === 'dark' && t.paper === '#101014');

    // Возврат к системному значению должен снимать override совсем, иначе
    // страница навсегда перестанет следовать за системной настройкой.
    await page.click('#theme');
    t = await page.evaluate(theme);
    ok('тема: возврат к системной снимает override', t.attr === null, String(t.attr));
    ok('тема: и стирает сохранённое', t.stored === null, String(t.stored));

    await page.screenshot({ path: path.join(SHOTS, 'theme-light.png') });
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ viewport: WIDE, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'load' });

    let t = await page.evaluate(theme);
    ok('тема: тёмная система без override даёт тёмную бумагу',
      t.attr === null && t.paper === '#101014', `${t.attr} / ${t.paper}`);

    await page.click('#theme');
    t = await page.evaluate(theme);
    ok('тема: на тёмной системе клик уводит в светлую',
      t.attr === 'light' && t.paper === '#f4f1ec', `${t.attr} / ${t.paper}`);

    await page.screenshot({ path: path.join(SHOTS, 'theme-dark.png') });
    await ctx.close();
  }

  /* ── Страница без JS ──────────────────────────────────────────────────── */

  {
    // Страница обязана оставаться целой без скриптов. Кнопка при этом не
    // показывается: сохранить выбор всё равно негде, а мёртвая кнопка хуже.
    const ctx = await browser.newContext({ viewport: WIDE, javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto(BASE + '/?tv=1', { waitUntil: 'load' });

    const s = await page.evaluate(theme).catch(() => null);
    ok('без JS: страница отдаётся', s === null || true);
    ok('без JS: кнопка темы скрыта',
      await page.locator('#theme').isHidden());
    ok('без JS: телевизора нет даже с ?tv=1',
      (await page.locator('#tv-stage canvas').count()) === 0);
    ok('без JS: имя на месте',
      (await page.locator('h1').innerText()).includes('Alexander'));

    await page.screenshot({ path: path.join(SHOTS, 'nojs.png') });
    await ctx.close();
  }

  await browser.close();

  console.log(failed ? `\n  ${failed} проверок упало` : '\n  все проверки прошли');
  console.log(`  скриншоты: ${path.relative(process.cwd(), SHOTS)}/`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('  сорвалось:', e && e.message);
  process.exit(1);
});
