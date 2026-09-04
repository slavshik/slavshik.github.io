/*
 * Экран: розжиг, срыв строки, захват канала и реакция на полёт.
 *
 * Это один автомат, поэтому всё его изменяемое состояние живёт здесь,
 * а mount() знает только его события. Фабрика, а не базовый класс: наследовать
 * тут нечего, а замыкание не выпускает внутренние флаги наружу.
 */

import * as THREE from 'three';

import type { Bloom } from './bloom.js';
import { createTuner, type Tuner } from './broadcast.js';
import type { BodyState, PlugHold } from './physics.js';
import type { TvParts } from './scene.js';

const LOCK_STEPS: readonly { t: number; v: number }[] = [
	{ t: 0, v: 0.5 },
	{ t: 0.06, v: 0.05 },
	{ t: 0.12, v: 0.8 },
	{ t: 0.18, v: 0.25 },
	{ t: 0.26, v: 1 },
];
const LOCK_END = 0.26;

export interface ScreenController {
	flash(amount: number): void;
	requestChannel(): void;
	afterPhysics(impact: number, plug: PlugHold): void;
	update(dt: number, time: number): void;
	setPlaying(playing: boolean): void;
	setStill(source: TexImageSource): void;
	freeze(): void;
	reset(): void;
	dispose(): void;
}

export interface ScreenOptions {
	parts: TvParts;
	bloom: Bloom;
	state: BodyState;
	wake(): void;
	broadcastUrl?: ((seq: number) => string) | null | undefined;
	frozen: boolean;
}

export function createScreenController(opts: ScreenOptions): ScreenController {
	const { parts, bloom, state, wake } = opts;
	let power = 0;
	let flashV = 0;
	let roll = 0;
	let rollV = 0;
	let nextGlitch = 3 + Math.random() * 5;
	let texMix = 0;
	let texWanted = 0;
	let lockT = -1;
	let lockScale = 1;
	let lockStep = -1;
	let wasGrounded = false;
	let channelPending = false;
	let prevTension = 0;
	let tuner: Tuner | null = null;

	function startLock(): void {
		texWanted = 1;
		lockT = 0;
		lockScale = 0.85 + Math.random() * 0.3;
		lockStep = -1;
	}

	if (!opts.frozen && opts.broadcastUrl) {
		tuner = createTuner({
			url: opts.broadcastUrl,
			onChannel: (texture) => {
				parts.screenMat.uniforms.uTex!.value = texture;
				if (state.grounded) startLock();
				else texWanted = 0;
				rollV = 1 / 0.3;
				flashV = Math.max(flashV, 0.35);
				wake();
			},
		});
		tuner.setPlaying(true);
	}

	function flash(amount: number): void {
		flashV = Math.max(flashV, amount);
	}

	function requestChannel(): void {
		channelPending = true;
	}

	function afterPhysics(impact: number, plug: PlugHold): void {
		if (impact > 2.2) flash(Math.min(impact * 0.22, 0.9));

		// Важна скорость нарастания натяжения, а не сама сила:
		// плавно держать шнур натянутым можно сколь угодно.
		const jerk = plug.tension - prevTension;
		prevTension = plug.tension;
		if (jerk > 26) {
			flash(Math.min(0.3 + jerk / 160, 0.75));
			rollV = Math.max(rollV, 1 / 0.3);
			requestChannel();
		}

		if (!tuner || state.grounded === wasGrounded) return;
		if (state.grounded) {
			rollV = 1 / 0.3;
			if (channelPending) {
				channelPending = false;
				tuner.tune();
			}
			startLock();
		} else {
			texWanted = 0;
			lockT = -1;
			rollV = 1 / 0.22;
		}
		wasGrounded = state.grounded;
	}

	function update(dt: number, time: number): void {
		power = Math.min(1, power + dt / 0.9);
		const ease = 1 - Math.pow(1 - power, 3);
		const scale = 0.02 + 0.98 * Math.min(1, ease * 1.06);
		parts.screen.scale.y = scale;
		parts.screenGlass.scale.y = scale;
		flashV *= Math.exp(-dt / 0.09);

		nextGlitch -= dt;
		if (nextGlitch <= 0) {
			rollV = 1 / 0.25;
			nextGlitch = 4 + Math.random() * 5;
		}
		if (rollV > 0) {
			roll += rollV * dt;
			if (roll >= 1) {
				roll = 0;
				rollV = 0;
			}
		}

		if (texWanted === 0) {
			texMix = Math.max(0, texMix - dt / 0.09);
		} else if (lockT >= 0) {
			lockT += dt / lockScale;
			let value = texMix;
			let step = -1;
			for (let i = 0; i < LOCK_STEPS.length; i++) {
				if (lockT >= LOCK_STEPS[i]!.t) {
					value = LOCK_STEPS[i]!.v;
					step = i;
				}
			}
			if (step !== lockStep) {
				lockStep = step;
				rollV = Math.max(rollV, 1 / 0.14);
			}
			texMix = value;
			if (lockT >= LOCK_END) {
				texMix = 1;
				lockT = -1;
			}
		}

		const uniforms = parts.screenMat.uniforms;
		uniforms.uTime!.value = time;
		uniforms.uRoll!.value = roll;
		uniforms.uTexMix!.value = texMix;
		uniforms.uIntensity!.value = ease + flashV;
		parts.glow.intensity = (0.5 + flashV * 2.5) * ease;
		bloom.setFlicker((0.55 + 0.45 * texMix + flashV * 1.7) * ease);
	}

	return {
		flash,
		requestChannel,
		afterPhysics,
		update,
		setPlaying: (playing) => tuner?.setPlaying(playing),
		setStill(source) {
			const texture = new THREE.Texture(source);
			texture.colorSpace = THREE.SRGBColorSpace;
			texture.needsUpdate = true;
			parts.screenMat.uniforms.uTex!.value = texture;
			parts.disposables.push(texture);
			texWanted = texMix = 1;
			lockT = -1;
		},
		freeze() {
			nextGlitch = Infinity;
			power = 1;
		},
		reset() {
			power = flashV = roll = rollV = 0;
		},
		dispose() {
			tuner?.dispose();
			tuner = null;
		},
	};
}
