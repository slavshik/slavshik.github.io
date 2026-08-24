import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	// .claude — агентские скиллы: чужой вендоренный код и питонский venv,
	// к сайту отношения не имеющие.
	{
		ignores: [
			'dist',
			'node_modules',
			'test/shots',
			'test-results',
			'playwright-report',
			'.claude',
		],
	},
	js.configs.recommended,
	tseslint.configs.recommended,
	{
		// Всё в src уезжает в браузер: node-глобалей тут быть не должно.
		files: ['src/**/*.ts'],
		languageOptions: {
			globals: { ...globals.browser },
		},
	},
	{
		// Worker: ни DOM, ни node. Глобали у него свои — их приносит
		// @cloudflare/workers-types, а линтеру достаточно знать, что они есть.
		files: ['worker/**/*.ts'],
		languageOptions: {
			globals: { ...globals.serviceworker, ...globals.browser },
		},
	},
	{
		// Тесты и конфиги живут в node, но page.evaluate() исполняется в
		// браузере — и пишется прямо здесь, поэтому глобали нужны обе.
		files: ['test/**/*.{ts,mjs}', '*.config.{ts,js}'],
		languageOptions: {
			globals: { ...globals.node, ...globals.browser },
		},
	},
);
