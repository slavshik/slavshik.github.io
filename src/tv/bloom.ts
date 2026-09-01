/*
 * Сияние экрана: маленький пост-процесс на четыре прохода.
 *
 * Что было раньше: перед трубкой висел плоский меш с нарисованным на канвасе
 * радиальным градиентом. Он не знал про картинку вообще — светился одинаково
 * и на снеге, и на тёмном кадре, и на лице, — а на его пологом градиенте в
 * восьми битах шли кольца, которые видно на светлом фоне страницы.
 *
 * Что вместо: сцена уходит в буфер, из буфера берётся то, что ярче порога,
 * размывается и складывается обратно. Форма сияния теперь и есть картинка на
 * экране, размытая: тёмный кадр почти не светит, снег светит ровно, яркое
 * пятно в кадре даёт яркое пятно в воздухе. Ничего не надо подгонять руками —
 * оно так получается.
 *
 * Почему не UnrealBloomPass из three/addons: он тянет за собой EffectComposer,
 * RenderPass, ShaderPass, CopyShader и LuminosityHighPassShader и строит пять
 * уровней мипов. Это пять пар буферов и лишние килобайты в чанке, которому и
 * так осталось восемь до потолка. Здесь один уровень, четыре прохода и три
 * шейдера на полсотни строк.
 *
 * Дешевизна — не про красоту, а про то, что телевизор занимает четверть
 * экрана и рисуется только когда шевелится. Буферы вчетверо меньше канваса:
 * сияние всё равно размыто, и разрешение ему не нужно.
 */

import * as THREE from 'three';

import { BLOOM_BLUR, BLOOM_MIX, FS_VERT } from './shaders.js';

/** Во сколько раз буферы сияния меньше канваса по каждой стороне. */
const DOWN = 6;

/**
 * Слой, на котором лежит то, что светится. Сейчас там ровно один объект —
 * люминофор трубки.
 *
 * Слой, а не яркостный порог. Порог пробовался первым и провалился: ключевой
 * свет у нас жёлтый и сильный, сливочная рамка и оранжевый корпус под ним
 * ярче, чем снег на экране, и светился весь телевизор целиком — как
 * раскалённый. Никакой порог не разделит их по яркости, потому что они и не
 * различаются по яркости; различаются они тем, что одно — источник света, а
 * другое — освещённая поверхность. Это знание в кадре не записано, а в слое
 * записано.
 */
export const BLOOM_LAYER = 1;

export interface Bloom {
	/** Нарисовать сцену с сиянием. Заменяет собой renderer.render(). */
	render(scene: THREE.Scene, camera: THREE.Camera): void;
	setSize(w: number, h: number, dpr: number): void;
	/**
	 * Общая яркость сияния на этом кадре: розжиг, вспышка от удара, срыв
	 * кадра. Форма сияния берётся из картинки и сюда не приходит.
	 */
	setFlicker(v: number): void;
	setStrength(v: number): void;
	dispose(): void;
}

/*
 * Буферы линейные, и перевод в sRGB делает композит — руками.
 *
 * Three кодирует кадр в sRGB только когда рисует на канвас; в буфер он
 * уходит линейным. Первый композит писал линейное прямо на канвас, тот читал
 * как sRGB — корпус становился бурым, а рамка ядовито-жёлтой. Похоже на
 * пересвет от сияния, но проверка с нулевой его силой дала ту же картинку:
 * (190,184,146) → (100,92,20), синий канал раздавлен. Сияние ни при чём.
 *
 * Пометить буфер как SRGBColorSpace не помогло — картинка не изменилась ни
 * на пиксель, поэтому перевод живёт в шейдере композита. Так даже вернее:
 * размытие и сложение идут в линейном свете, где складывать яркости и
 * положено, и только результат уходит в sRGB.
 */
function target(w: number, h: number): THREE.WebGLRenderTarget {
	const t = new THREE.WebGLRenderTarget(w, h, {
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		// Прозрачность канваса держится на альфе, поэтому формат обязан её
		// нести до самого конца, включая промежуточные буферы размытия.
		format: THREE.RGBAFormat,
		type: THREE.UnsignedByteType,
		depthBuffer: false,
		stencilBuffer: false,
	});
	return t;
}

export function createBloom(renderer: THREE.WebGLRenderer): Bloom {
	// Сцена под полноэкранный треугольник: одна на все три прохода, материал
	// подменяется. Камера ортографическая и ничего не делает — вершинный
	// шейдер и так пишет в клип-пространство напрямую.
	const fsScene = new THREE.Scene();
	const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	const fsGeo = new THREE.BufferGeometry();
	fsGeo.setAttribute(
		'position',
		new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
	);
	fsGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));

	const blurMat = new THREE.ShaderMaterial({
		vertexShader: FS_VERT,
		fragmentShader: BLOOM_BLUR,
		uniforms: {
			uSrc: { value: null },
			uDir: { value: new THREE.Vector2() },
			uEncode: { value: 0 },
		},
		depthTest: false,
		depthWrite: false,
		/* NoBlending обязателен, и это стоило долгих поисков. Без него проход
		   размытия смешивается с пустым буфером по обычным правилам, и альфа
		   выходит src.a², а цвет — src.rgb·src.a. За два прохода альфа
		   съедается в труху. Цвет при этом остаётся на вид приличным, поэтому
		   в буфере всё выглядело правильно; невидимым сияние становилось уже
		   на канвасе, потому что тот premultiplied и цвет без альфы не
		   показывает. Проход, который вычисляет, а не рисует поверх, обязан
		   писать ровно то, что посчитал. */
		blending: THREE.NoBlending,
	});
	const mixMat = new THREE.ShaderMaterial({
		vertexShader: FS_VERT,
		fragmentShader: BLOOM_MIX,
		uniforms: {
			uBloom: { value: null },
			uStrength: { value: 0.24 },
			uFlicker: { value: 0 },
		},
		depthTest: false,
		depthWrite: false,
		transparent: true,
		/* Складывать надо и цвет, и альфу, и обе — с множителем «единица на
		   единицу». AdditiveBlending тут не годится: он прибавляет альфу
		   источника без разбора, и весь канвас стал бы непрозрачным, а
		   страница за телевизором пропала бы. */
		blending: THREE.CustomBlending,
		blendSrc: THREE.OneFactor,
		blendDst: THREE.OneFactor,
		blendSrcAlpha: THREE.OneFactor,
		blendDstAlpha: THREE.OneFactor,
	});

	const fsMesh = new THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>(fsGeo, blurMat);
	fsMesh.frustumCulled = false;
	fsScene.add(fsMesh);

	const ping = target(1, 1);
	const pong = target(1, 1);
	let bw = 1;
	let bh = 1;

	function draw(mat: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null): void {
		fsMesh.material = mat;
		renderer.setRenderTarget(to);
		renderer.clear();
		renderer.render(fsScene, fsCam);
	}

	return {
		setSize(w, h, dpr) {
			const pw = Math.max(1, Math.round(w * dpr));
			const ph = Math.max(1, Math.round(h * dpr));
			bw = Math.max(1, Math.round(pw / DOWN));
			bh = Math.max(1, Math.round(ph / DOWN));
			ping.setSize(bw, bh);
			pong.setSize(bw, bh);
		},

		setFlicker(v) {
			mixMat.uniforms.uFlicker!.value = v;
		},

		setStrength(v) {
			mixMat.uniforms.uStrength!.value = v;
		},

		render(scene, camera) {
			// 1. Только светящееся, сразу в маленький буфер: камера
			//    переключается на слой сияния, и в кадр не попадает ничего,
			//    кроме люминофора.
			camera.layers.set(BLOOM_LAYER);
			renderer.setRenderTarget(ping);
			renderer.clear();
			renderer.render(scene, camera);
			camera.layers.set(0);

			// 2. Два прохода размытия, по оси за проход
			blurMat.uniforms.uSrc!.value = ping.texture;
			(blurMat.uniforms.uDir!.value as THREE.Vector2).set(1 / bw, 0);
			blurMat.uniforms.uEncode!.value = 0;
			draw(blurMat, pong);
			blurMat.uniforms.uSrc!.value = pong.texture;
			(blurMat.uniforms.uDir!.value as THREE.Vector2).set(0, 1 / bh);
			blurMat.uniforms.uEncode!.value = 1;
			draw(blurMat, ping);

			// 3. Сцена на канвас — как и до всякой пост-обработки
			renderer.setRenderTarget(null);
			renderer.clear();
			renderer.render(scene, camera);

			// 4. Сияние сверху. Очистку выключаем: кадр под ним уже нарисован.
			mixMat.uniforms.uBloom!.value = ping.texture;
			renderer.autoClear = false;
			fsMesh.material = mixMat;
			renderer.render(fsScene, fsCam);
			renderer.autoClear = true;
		},

		dispose() {
			ping.dispose();
			pong.dispose();
			fsGeo.dispose();
			blurMat.dispose();
			mixMat.dispose();
		},
	};
}
