/*
 * Строка визита. Проверяется здесь, потому что hitQuery — чистая функция без
 * DOM: всё, что уезжает в аналитику, видно прямо в ожиданиях теста, и любая
 * новая мелочь в запросе обязана сначала появиться тут.
 */

import { describe, expect, it } from 'vitest';

import { hitQuery, withWhy, type HitInput } from '../../src/analytics.js';

const base: HitInput = {
	path: '/',
	search: '',
	referrer: '',
	viewport: '414x715',
	dpr: 1,
	theme: 'auto',
	nonce: 'abc12345',
	origin: 'https://slavshik.me',
};

const params = (i: Partial<HitInput> = {}): URLSearchParams =>
	new URLSearchParams(hitQuery({ ...base, ...i }));

describe('строка визита', () => {
	it('несёт ключ, вьюпорт и тему', () => {
		const q = params();
		expect(q.get('n')).toBe('abc12345');
		expect(q.get('w')).toBe('414x715');
		expect(q.get('t')).toBe('auto');
	});

	it('молчит о том, чего нет: корень пути, единичный dpr, прямой заход', () => {
		const q = params();
		expect(q.has('p')).toBe(false);
		expect(q.has('d')).toBe(false);
		expect(q.has('r')).toBe(false);
	});

	it('реферер обрезается до origin и пути, свой origin не считается', () => {
		expect(params({ referrer: 'https://news.ycombinator.com/item?id=1&u=a' }).get('r')).toBe(
			'https://news.ycombinator.com/item',
		);
		expect(params({ referrer: 'https://slavshik.me/lab/tv.html' }).has('r')).toBe(false);
	});

	it('причина уезжает только когда телевизора не будет', () => {
		expect(params().has('x')).toBe(false);
		expect(params({ why: 'gl' }).get('x')).toBe('gl');
	});

	it('поломка — приписка к тому же визиту, а не новый ключ', () => {
		const query = hitQuery(base);
		const q = new URLSearchParams(withWhy(query, 'err'));
		expect(q.get('x')).toBe('err');
		expect(q.get('n')).toBe('abc12345');
	});
});
