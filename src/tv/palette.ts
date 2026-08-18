/*
 * Тема берётся из CSS-переменных страницы, а не задаётся здесь.
 *
 * Модуль знает про DOM, но не про three: возвращает строки цветов.
 */

export interface Palette {
	dark: boolean;
	accent: string;
	paper: string;
	shell: string;
	bezel: string;
	knob: string;
	steel: string;
	metal: string;
	cord: string;
	plug: string;
}

/** Ключи палитры, которыми красятся материалы корпуса. */
export type PaletteRole = Exclude<keyof Palette, 'dark'>;

function cssVar(name: string, fallback: string): string {
	const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return v || fallback;
}

// Цвета корпуса нарочно одни и те же в светлой и тёмной теме: это игрушка,
// а игрушка не перекрашивается от системной настройки. Под тему подстраивается
// только свет. Со страницей телевизор связан через --accent — им светится
// кинескоп, поэтому время суток он всё равно отыгрывает.
// Кнопка темы на странице ставит data-theme на <html>. Телевизор про кнопку
// не знает и знать не должен: он смотрит на атрибут, а системную настройку
// спрашивает только когда выбора не сделано.
export function pageDark(): boolean {
	const t = document.documentElement.dataset.theme;
	if (t === 'dark') return true;
	if (t === 'light') return false;
	return matchMedia('(prefers-color-scheme: dark)').matches;
}

export function readPalette(forceDark: boolean | null | undefined): Palette {
	const dark = forceDark === null || forceDark === undefined ? pageDark() : !!forceDark;
	return {
		dark,
		accent: cssVar('--accent', '#2f6b57'),
		paper: cssVar('--paper', dark ? '#101014' : '#f4f1ec'),
		shell: '#e8543a', // тёплый красно-оранжевый
		bezel: '#f6ead3', // сливочная рамка
		knob: '#322f38', // почти чёрный
		steel: '#b6bcc3', // телескопические колена антенн и шарики
		metal: '#c08b2a', // латунные штыри вилки
		cord: '#322f38',
		plug: '#2a2830', // чёрный корпус вилки
	};
}
