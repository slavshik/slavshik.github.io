import { defineConfig } from 'vitest/config';

// Три входа: сама страница и два стенда. Стенды собираются вместе с сайтом
// нарочно — так они не могут разойтись с продакшеном, а lab/tv.html
// импортирует ровно тот же исходник телевизора, что и главная.
export default defineConfig({
  base: '/',
  build: {
    target: 'es2022',
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        index: 'index.html',
        lab: 'lab/tv.html',
        og: 'lab/og.html',
      },
    },
  },
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
  },
});
