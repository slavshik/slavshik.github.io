/*
 * Свет сцены, собранный по спеке облика.
 *
 * Три постоянных источника плюс контровой и карта среды, которые по
 * умолчанию выключены: спека с нулями обязана давать ровно ту же картинку,
 * что и свет, который раньше жил внутри mount(). Цвета, завязанные на
 * страницу, спеке не принадлежат: небо полусферы — это бумага, заливка —
 * акцент времени суток, и оба приезжают через refresh(pal).
 */

import * as THREE from 'three';

import type { LightSpec } from './look.js';
import type { Palette } from './palette.js';

export interface Lighting {
	hemi: THREE.HemisphereLight;
	key: THREE.DirectionalLight;
	fill: THREE.DirectionalLight;
	rim: THREE.DirectionalLight;
	/** Перечитать спеку целиком — для стенда. */
	apply(spec: LightSpec): void;
	/** Подстроиться под тему и акцент страницы. */
	refresh(pal: Palette): void;
	dispose(): void;
}

const TONE: Record<LightSpec['toneMapping'], THREE.ToneMapping> = {
	none: THREE.NoToneMapping,
	aces: THREE.ACESFilmicToneMapping,
	agx: THREE.AgXToneMapping,
	neutral: THREE.NeutralToneMapping,
};

// Маленькая процедурная студия: градиент задаёт помещение, два мягких окна
// дают пластику и металлу узнаваемые полосы отражений. Это не ассет в чанке,
// а несколько килобайт видеопамяти, созданных один раз при сборке сцены.
function envTexture(top: string, bottom: string): THREE.CanvasTexture {
	const c = document.createElement('canvas');
	c.width = 128;
	c.height = 64;
	const ctx = c.getContext('2d')!;
	const g = ctx.createLinearGradient(0, 0, 0, 64);
	g.addColorStop(0, top);
	g.addColorStop(1, bottom);
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 128, 64);

	const softbox = ctx.createRadialGradient(30, 17, 1, 30, 17, 24);
	softbox.addColorStop(0, 'rgba(255,255,255,0.95)');
	softbox.addColorStop(0.35, 'rgba(255,255,255,0.48)');
	softbox.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = softbox;
	ctx.fillRect(4, 0, 52, 45);

	const rim = ctx.createLinearGradient(92, 0, 118, 0);
	rim.addColorStop(0, 'rgba(255,255,255,0)');
	rim.addColorStop(0.55, 'rgba(255,255,255,0.28)');
	rim.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = rim;
	ctx.fillRect(92, 3, 26, 48);
	const tex = new THREE.CanvasTexture(c);
	tex.mapping = THREE.EquirectangularReflectionMapping;
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

export function createLighting(
	scene: THREE.Scene,
	renderer: THREE.WebGLRenderer,
	pal: Palette,
	spec: LightSpec,
): Lighting {
	let cur = spec;
	let dark = pal.dark;
	let envTex: THREE.CanvasTexture | null = null;

	const hemi = new THREE.HemisphereLight(new THREE.Color(pal.paper), 0x000000, 1);
	const key = new THREE.DirectionalLight(0xffffff, 1);
	const fill = new THREE.DirectionalLight(new THREE.Color(pal.accent), 1);
	const rim = new THREE.DirectionalLight(0xffffff, 0);
	scene.add(hemi, key, fill, rim);

	function apply(next: LightSpec): void {
		cur = next;
		hemi.groundColor.set(cur.hemi.ground);
		hemi.intensity = dark ? cur.hemi.night : cur.hemi.day;
		key.color.set(cur.key.color);
		key.intensity = dark ? cur.key.night : cur.key.day;
		key.position.set(...cur.key.pos);
		fill.intensity = cur.fill.intensity;
		fill.position.set(...cur.fill.pos);
		rim.color.set(cur.rim.color);
		rim.intensity = cur.rim.intensity;
		rim.position.set(...cur.rim.pos);
		renderer.toneMapping = TONE[cur.toneMapping];
		renderer.toneMappingExposure = cur.exposure;
		envTex?.dispose();
		envTex = null;
		if (cur.env.intensity > 0) {
			envTex = envTexture(cur.env.top, cur.env.bottom);
			scene.environment = envTex;
			scene.environmentIntensity = cur.env.intensity;
		} else {
			scene.environment = null;
		}
	}

	function refresh(p: Palette): void {
		dark = p.dark;
		hemi.color.set(p.paper);
		hemi.intensity = dark ? cur.hemi.night : cur.hemi.day;
		key.intensity = dark ? cur.key.night : cur.key.day;
		fill.color.set(p.accent);
	}

	apply(spec);

	return {
		hemi,
		key,
		fill,
		rim,
		apply,
		refresh,
		dispose: () => {
			envTex?.dispose();
			scene.environment = null;
			scene.remove(hemi, key, fill, rim);
		},
	};
}
