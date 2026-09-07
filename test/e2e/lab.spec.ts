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
	// Тест ждёт физику, а не разметку, и в CI она идёт куда медленнее
	// реального времени: цикл берёт не больше MAX_SUB шагов на кадр и остаток
	// выбрасывает, так что на медленной машине это прямая замедленная съёмка —
	// при 5 кадрах в секунду модельное время идёт впятеро медленнее живого.
	// Числа ниже поэтому не мера физики, а страховка от зависания, и держать
	// их надо с запасом: на desktop бюджет в 30 с уже сжигался целиком.
	test.setTimeout(180_000);

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
	await expect.poll(asleep, { timeout: 60_000 }).toBe(true);

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
	await expect.poll(asleep, { timeout: 60_000 }).toBe(true);
	const after = await page.evaluate(() => window.tv.internals.state.y);
	expect(Math.abs(after - before)).toBeLessThan(0.05);
});

test('экран декодирует видео как sRGB и сохраняет снег через сутки', async ({ page }) => {
	await page.goto('/lab/tv.html');
	await page.waitForSelector('#tv-stage canvas');
	const result = await page.evaluate(() => {
		const I = window.tv.internals;
		I.setPaused(true);
		I.parts.body.position.set(I.env.homeX, 0.5, 0);
		I.parts.body.rotation.z = 0;
		const u = I.parts.screenMat.uniforms;
		const original = u.uTex!.value as import('three').DataTexture;
		const Texture = original.constructor as typeof import('three').DataTexture;
		const pixels = new Uint8Array([128, 96, 64, 255]);
		const still = new Texture(pixels, 1, 1);
		still.colorSpace = 'srgb';
		still.needsUpdate = true;
		const video = new Texture(pixels, 1, 1);
		video.needsUpdate = true;
		const gl = I.renderer.getContext();
		const capture = (): Uint8Array => {
			I.bloom.setFlicker(1);
			I.bloom.render(I.scene, I.camera);
			const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
			gl.readPixels(
				0,
				0,
				gl.drawingBufferWidth,
				gl.drawingBufferHeight,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				data,
			);
			return data;
		};
		u.uIntensity!.value = 1;
		u.uRoll!.value = 0;
		u.uTexMix!.value = 1;
		u.uTex!.value = still;
		u.uVideo!.value = false;
		const a = capture();
		u.uTex!.value = video;
		u.uVideo!.value = true;
		const b = capture();
		let difference = 0;
		for (let i = 0; i < a.length; i++)
			difference = Math.max(difference, Math.abs(a[i]! - b[i]!));
		u.uTexMix!.value = 0;
		u.uTime!.value = 86400;
		const snow = capture();
		const repeated = capture();
		let frozenDifference = 0;
		for (let i = 0; i < snow.length; i++)
			frozenDifference = Math.max(frozenDifference, Math.abs(snow[i]! - repeated[i]!));
		u.uTime!.value = 86400 + 1 / 30;
		const next = capture();
		let changed = 0;
		for (let i = 0; i < snow.length; i += 4) if (Math.abs(snow[i]! - next[i]!) > 20) changed++;
		u.uTex!.value = original;
		u.uVideo!.value = false;
		still.dispose();
		video.dispose();
		return { difference, changed, frozenDifference };
	});
	expect(result.difference).toBeLessThanOrEqual(2);
	expect(result.changed).toBeGreaterThan(100);
	expect(result.frozenDifference).toBe(0);
});

test('ореол выключен: яркий экран не добавляет размытия и сохраняет полутона', async ({ page }) => {
	await page.goto('/lab/tv.html');
	await page.waitForSelector('#tv-stage canvas');
	const result = await page.evaluate(() => {
		const I = window.tv.internals;
		I.setPaused(true);
		I.parts.body.position.set(I.env.homeX, 0.5, 0);
		I.parts.body.rotation.z = 0;
		const u = I.parts.screenMat.uniforms;
		const original = u.uTex!.value as import('three').DataTexture;
		const Texture = original.constructor as typeof import('three').DataTexture;
		const pixels = new Uint8Array([0, 0, 0, 255]);
		const tex = new Texture(pixels, 1, 1);
		tex.colorSpace = 'srgb';
		u.uTex!.value = tex;
		u.uVideo!.value = false;
		u.uTexMix!.value = 1;
		u.uIntensity!.value = 1;
		u.uRoll!.value = 0;
		I.parts.screen.scale.y = 1;
		I.parts.screenGlass.scale.y = 1;
		I.bloom.setFlicker(1);
		const gl = I.renderer.getContext();
		const capture = (strength: number): Uint8Array => {
			I.bloom.setStrength(strength);
			I.bloom.render(I.scene, I.camera);
			const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
			gl.readPixels(
				0,
				0,
				gl.drawingBufferWidth,
				gl.drawingBufferHeight,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				data,
			);
			return data;
		};
		const difference = (a: Uint8Array, b: Uint8Array): number => {
			let sum = 0;
			for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
			return sum;
		};
		tex.needsUpdate = true;
		const black = difference(capture(0), capture(1));
		const steps: number[] = [];
		let whiteGlow = 0;
		let interiorDelta = 0,
			interiorPixels = 0;
		for (const value of [0, 32, 96, 160, 208, 232, 248, 255]) {
			pixels.fill(value, 0, 3);
			tex.needsUpdate = true;
			const data = capture(1);
			let sum = 0;
			for (let i = 0; i < data.length; i += 4) sum += data[i]! + data[i + 1]! + data[i + 2]!;
			steps.push(sum);
			if (value === 255) {
				const off = capture(0);
				whiteGlow = difference(data, off);
				const w = gl.drawingBufferWidth,
					h = gl.drawingBufferHeight;
				const bright = (x: number, y: number): boolean => {
					const i = (y * w + x) * 4;
					return off[i]! > 210 && off[i + 1]! > 210 && off[i + 2]! > 210;
				};
				// Only picture pixels at least ten pixels from its bright boundary.
				for (let y = 10; y < h - 10; y++)
					for (let x = 10; x < w - 10; x++) {
						if (
							!bright(x, y) ||
							!bright(x - 10, y - 10) ||
							!bright(x + 10, y - 10) ||
							!bright(x - 10, y + 10) ||
							!bright(x + 10, y + 10)
						)
							continue;
						interiorPixels++;
						const i = (y * w + x) * 4;
						for (let c = 0; c < 3; c++)
							interiorDelta = Math.max(
								interiorDelta,
								Math.abs(data[i + c]! - off[i + c]!),
							);
					}
			}
		}
		const scissor = I.renderer.setScissorTest;
		const unclipped: number[] = [];
		const angle = I.parts.tilt.rotation.y;
		for (const yaw of [angle, 0.8, -1.3]) {
			I.parts.tilt.rotation.y = yaw;
			const bounded = capture(1);
			I.renderer.setScissorTest = () => {};
			const full = capture(1);
			I.renderer.setScissorTest = scissor;
			unclipped.push(difference(bounded, full));
		}
		I.parts.tilt.rotation.y = angle + Math.PI;
		const rear = difference(capture(0), capture(1));
		u.uTex!.value = original;
		tex.dispose();
		return { black, whiteGlow, steps, rear, unclipped, interiorDelta, interiorPixels };
	});
	expect(result.black).toBe(0);
	expect(result.whiteGlow).toBe(0);
	expect(result.interiorPixels).toBeGreaterThan(50);
	expect(result.interiorDelta).toBeLessThanOrEqual(2);
	expect(result.rear).toBe(0);
	expect(result.unclipped).toEqual([0, 0, 0]);
	for (let i = 1; i < result.steps.length; i++)
		expect(result.steps[i]!).toBeGreaterThan(result.steps[i - 1]!);
});
