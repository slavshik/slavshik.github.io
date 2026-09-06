import * as THREE from 'three';

import type { ScreenEffectsSpec } from './look.js';

import { BLOOM_BLUR, BLOOM_MIX, FS_VERT } from './shaders.js';

/** Во сколько раз буферы сияния меньше канваса по каждой стороне. */
const DOWN = 4;
const SCREEN_DEPTH_VERT = `void main() {
 gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

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
	apply(spec: ScreenEffectsSpec): void;
	dispose(): void;
}

/*
 * The base scene keeps its direct canvas color-output path. Only emission
 * enters linear targets; each vertical blur encodes its result for the
 * additive canvas overlay. Coverage remains unblurred in a separate target.
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

export function createBloom(renderer: THREE.WebGLRenderer, spec: ScreenEffectsSpec): Bloom {
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
			uBroad: { value: null },
			uCoverage: { value: null },
			uColor: { value: new THREE.Color() },
			uTight: { value: 0 },
			uBroadStrength: { value: 0 },
			uSuppression: { value: 1 },

			uStrength: { value: 1 },
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

	const coverage = target(1, 1);
	coverage.depthBuffer = true;
	coverage.samples = 4;
	const ping = target(1, 1);
	const pong = target(1, 1);
	const broadPing = target(1, 1);
	const broadPong = target(1, 1);
	const black = new THREE.ShaderMaterial({
		vertexShader: SCREEN_DEPTH_VERT,
		fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
	});
	const hidden = new THREE.MeshBasicMaterial({ visible: false });
	let emitter: THREE.Mesh | null = null;
	const corner = new THREE.Vector3();
	const savedScissor = new THREE.Vector4();
	let width = 1,
		height = 1;
	const originals = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
	// Stable callbacks and weak storage: no per-frame arrays or material creation.
	function darken(object: THREE.Object3D): void {
		if (!(object instanceof THREE.Mesh)) return;
		if (object.layers.isEnabled(BLOOM_LAYER)) {
			emitter = object;
			return;
		}
		originals.set(object, object.material);
		const material = object.material;
		object.material =
			!Array.isArray(material) && (material.transparent || !material.visible)
				? hidden
				: black;
	}
	function restore(object: THREE.Object3D): void {
		if (!(object instanceof THREE.Mesh)) return;
		const material = originals.get(object);
		if (material) object.material = material;
	}
	let bw = 1,
		bh = 1,
		ww = 1,
		wh = 1,
		pixelRatio = 1;
	let current = spec;
	function apply(next: ScreenEffectsSpec): void {
		current = next;
		// Composite operates in the canvas output space.
		(mixMat.uniforms.uColor!.value as THREE.Color).set(next.glowColor).convertLinearToSRGB();
		mixMat.uniforms.uTight!.value = next.tightStrength;
		mixMat.uniforms.uBroadStrength!.value = next.broadStrength;
		mixMat.uniforms.uSuppression!.value = next.interiorSuppression;
	}
	apply(spec);

	function draw(mat: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null): void {
		fsMesh.material = mat;
		renderer.setRenderTarget(to);
		renderer.clear();
		renderer.render(fsScene, fsCam);
	}

	return {
		apply,
		setSize(w, h, dpr) {
			width = w;
			height = h;
			const pw = Math.max(1, Math.round(w * dpr));
			const ph = Math.max(1, Math.round(h * dpr));
			bw = Math.max(1, Math.round(pw / DOWN));
			bh = Math.max(1, Math.round(ph / DOWN));
			pixelRatio = dpr;
			ww = Math.max(1, Math.round(pw / 12));
			wh = Math.max(1, Math.round(ph / 12));
			coverage.setSize(bw, bh);
			broadPing.setSize(ww, wh);
			broadPong.setSize(ww, wh);
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
			const autoClear = renderer.autoClear;
			const background = scene.background;
			scene.background = null;
			scene.traverse(darken);
			renderer.setRenderTarget(coverage);
			renderer.clear();
			try {
				renderer.render(scene, camera);
			} finally {
				scene.traverse(restore);
				scene.background = background;
			}

			blurMat.uniforms.uSrc!.value = coverage.texture;
			(blurMat.uniforms.uDir!.value as THREE.Vector2).set(
				(current.tightRadius * pixelRatio) / (bw * DOWN),
				0,
			);
			blurMat.uniforms.uEncode!.value = 0;
			draw(blurMat, pong);
			blurMat.uniforms.uSrc!.value = pong.texture;
			(blurMat.uniforms.uDir!.value as THREE.Vector2).set(
				0,
				(current.tightRadius * pixelRatio) / (bh * DOWN),
			);
			blurMat.uniforms.uEncode!.value = 1;
			draw(blurMat, ping);

			blurMat.uniforms.uSrc!.value = coverage.texture;
			(blurMat.uniforms.uDir!.value as THREE.Vector2).set(
				(current.broadRadius * pixelRatio) / (ww * 12),
				0,
			);
			blurMat.uniforms.uEncode!.value = 0;
			draw(blurMat, broadPong);
			blurMat.uniforms.uSrc!.value = broadPong.texture;
			(blurMat.uniforms.uDir!.value as THREE.Vector2).set(
				0,
				(current.broadRadius * pixelRatio) / (wh * 12),
			);
			blurMat.uniforms.uEncode!.value = 1;
			draw(blurMat, broadPing);

			// 3. Сцена на канвас — как и до всякой пост-обработки
			renderer.setRenderTarget(null);
			renderer.clear();
			renderer.render(scene, camera);

			// 4. Сияние сверху. Очистку выключаем: кадр под ним уже нарисован.
			mixMat.uniforms.uBloom!.value = ping.texture;
			mixMat.uniforms.uBroad!.value = broadPing.texture;
			mixMat.uniforms.uCoverage!.value = coverage.texture;
			// Bound the full-resolution overlay to the screen plus the complete
			// blur kernel. This matters more than blur taps on large canvases.
			renderer.getScissor(savedScissor);
			const scissorTest = renderer.getScissorTest();
			if (emitter) {
				const geometry = emitter.geometry;
				if (!geometry.boundingBox) geometry.computeBoundingBox();
				const box = geometry.boundingBox!;
				let left = Infinity,
					right = -Infinity,
					bottom = Infinity,
					top = -Infinity;
				for (let i = 0; i < 8; i++) {
					corner.set(
						i & 1 ? box.max.x : box.min.x,
						i & 2 ? box.max.y : box.min.y,
						i & 4 ? box.max.z : box.min.z,
					);
					corner.applyMatrix4(emitter.matrixWorld).project(camera);
					left = Math.min(left, corner.x);
					right = Math.max(right, corner.x);
					bottom = Math.min(bottom, corner.y);
					top = Math.max(top, corner.y);
				}
				const margin = 8 * Math.max(current.tightRadius, current.broadRadius) + 4;
				const x = Math.max(0, Math.floor(((left + 1) * width) / 2 - margin));
				const y = Math.max(0, Math.floor(((bottom + 1) * height) / 2 - margin));
				const r = Math.min(width, Math.ceil(((right + 1) * width) / 2 + margin));
				const t = Math.min(height, Math.ceil(((top + 1) * height) / 2 + margin));
				renderer.setScissor(x, y, Math.max(0, r - x), Math.max(0, t - y));
				renderer.setScissorTest(true);
			}
			renderer.autoClear = false;
			fsMesh.material = mixMat;
			renderer.render(fsScene, fsCam);
			renderer.autoClear = autoClear;
			renderer.setScissor(savedScissor);
			renderer.setScissorTest(scissorTest);
		},

		dispose() {
			coverage.dispose();
			broadPing.dispose();
			broadPong.dispose();
			black.dispose();
			hidden.dispose();
			ping.dispose();
			pong.dispose();
			fsGeo.dispose();
			blurMat.dispose();
			mixMat.dispose();
		},
	};
}
