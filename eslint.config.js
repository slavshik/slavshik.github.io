import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{ ignores: ['dist', 'node_modules', 'test/shots', 'test-results', 'playwright-report'] },
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
		// Тесты и конфиги живут в node, но page.evaluate() исполняется в
		// браузере — и пишется прямо здесь, поэтому глобали нужны обе.
		files: ['test/**/*.{ts,mjs}', '*.config.{ts,js}'],
		languageOptions: {
			globals: { ...globals.node, ...globals.browser },
		},
	},
);
