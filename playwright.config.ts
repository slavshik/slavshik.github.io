import { defineConfig, devices } from '@playwright/test';

/*
 * Скриншотные тесты гоняются по собранному сайту, а не по dev-серверу:
 * проверять надо то, что уедет на Pages.
 *
 * Эталоны сняты в официальном контейнере Playwright и в нём же сравниваются —
 * см. `make e2e`. Локальная macOS и Linux в CI рисуют шрифты и WebGL
 * по-разному, и эталон, снятый не там, где сравнивается, не значит ничего.
 */

const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
	testDir: 'test/e2e',
	snapshotPathTemplate: 'test/e2e/__screenshots__/{projectName}/{arg}{ext}',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: process.env.CI ? [['github'], ['list']] : [['list']],

	use: {
		baseURL: BASE,
		// Ни времени суток, ни случайных срывов кадра: один коммит — одна картинка.
		// Ключ ?aqa=1 ставит каждый тест сам, здесь только общий адрес.
	},

	expect: {
		toHaveScreenshot: {
			// Ноль — не идеализм: эталоны сняты со страницы ДО переезда на
			// TypeScript и Vite, и порт совпал с ними попиксельно, все девять
			// снимков. Контейнер закреплён по версии, значит совпадать обязано и
			// дальше. Разошлось — это не шум сглаживания, а повод разобраться.
			maxDiffPixels: 0,
			animations: 'disabled',
		},
	},

	projects: [
		{
			name: 'desktop',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
		},
		{
			name: 'tablet',
			use: { ...devices['Desktop Chrome'], viewport: { width: 834, height: 1112 } },
		},
		{
			name: 'mobile',
			use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
		},
	],

	webServer: {
		// --host обязателен: без него vite слушает localhost, а в контейнере это
		// сначала ::1, и опрос по 127.0.0.1 не достучится.
		command: `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
		url: BASE,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	},
});
