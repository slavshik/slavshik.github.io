/*
 * Габариты, константы физики и значения по умолчанию.
 *
 * Здесь нет ни three, ни DOM — модуль импортируется и стендом, и юнит-тестами.
 */

/* ── Габариты. Пропорции нарочно игрушечные: коробка почти квадратная,
 *    углы крупно скруглены, детали великоваты. ──────────────────────────── */

export const BODY_W = 1.1;
export const BODY_H = 0.88;
export const BODY_D = 0.8;
export const FOOT_H = 0.043825;

export const HALF_H = BODY_H / 2 + FOOT_H; // от центра масс до низа ножек
export const HALF_W = BODY_W / 2;
export const TV_VIS_H = BODY_H + FOOT_H + 0.5; // с антеннами — по этому масштабируем

export const FOV = 30;
export const CAM_DIST = 3.4;

/* Проводок: верле-цепочка, висящая из задней стенки */
export const ROPE_N = 14; // точек в цепочке
export const ROPE_SEG = 0.075; // длина звена
export const ROPE_R = 12; // радиальных сегментов трубки
export const ROPE_RAD = 0.018; // толщина
export const ROPE_Z = -0.34; // плоскость, в которой болтается

// Якорь провода в системе корпуса: низ задней стенки. Поворот корпуса его
// сносит, поэтому провод раскачивается и когда телевизор просто кренится.
export const ANCHOR_X = 0.4;
export const ANCHOR_Y = -0.3;

/* ── Константы физики. Стенд правит их вживую через debug.params ───────── */

export interface TvParams {
	gravity: number;
	homeK: number;
	homeC: number;
	uprightK: number;
	uprightC: number;
	airV: number;
	airW: number;
	rest: number;
	vRest: number;
	friction: number;
	groundDrag: number;
	spinLoss: number;
	kickV: number;
	wheelV: number;
	swipeV: number;
	antK: number;
	antC: number;
	antLever: number;
	ropeG: number;
	ropeDamp: number;
	/* Закрутка вилки: момент от рывка, возврат шнура и вязкость. */
	spinDrive: number;
	spinK: number;
	spinC: number;
	dropY: number;
	homeGap: number;
	floorGap: number;
}

export const DEFAULTS: TvParams = {
	gravity: -22.0, // единиц/с²
	homeK: 7.0, // пружина к домашней позиции по X
	homeC: 2.6, // ζ≈0.49 — возвращается за ~3 с, без долгого дозвона
	uprightK: 26.0, // момент, возвращающий корпус в вертикаль
	uprightC: 3.2,
	airV: 0.5, // затухание скорости в воздухе
	airW: 0.8, // затухание вращения
	rest: 0.42, // коэффициент восстановления при ударе о пол
	vRest: 0.55, // ниже этой скорости удара не отскакиваем, а ложимся
	friction: 0.86, // тангенциальное трение в момент удара
	groundDrag: 3.0, // трение покоя, пока стоит на полу
	spinLoss: 0.7,
	kickV: 7.5, // импульс по клику
	wheelV: 0.012, // чувствительность к колесу
	swipeV: 0.055, // чувствительность к свайпу пальцем по странице
	antK: 58.0, // жёсткость антенн — мягче, чтобы болтались смешнее
	antC: 3.4,
	antLever: 0.55,
	ropeG: 18.0, // гравитация проводка
	ropeDamp: 0.988, // сохранение скорости в верле
	spinDrive: 16.0, // момент закрутки на единицу поперечной скорости вилки
	spinK: 9.0, // с какой силой шнур раскручивается обратно
	spinC: 1.4, // вязкость закрутки
	dropY: 1.6, // высота падения при загрузке, в высотах телевизора
	homeGap: 10.0, // px между правым краем имени и левым бортом корпуса
	floorGap: 0.0, // px, на сколько поднять ножки над низом фамилии;
	// единственный параметр в пикселях — он и меряется от
	// вёрстки, а не от сцены
};

export const FIXED = 1 / 120;
export const MAX_SUB = 5;

// Время, на котором замирает шейдер экрана в неподвижном режиме. Значение
// само по себе ничего не значит — важно, что оно одно и то же всегда.
export const FROZEN_T = 12.5;
// Шагов физики на успокоение провода перед снимком. После rope.reset() он
// собран в точку, и замереть на нём значило бы замереть на комке.
export const FROZEN_SETTLE = 240;
