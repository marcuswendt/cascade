/**
 * Expression math utilities.
 *
 * Pure functions, no ambient state, deterministic for a given input — the same
 * contract the rest of the runtime holds. `noise` and `random` are seeded
 * closed forms rather than anything drawn from process state.
 */

/** Remap a value from one range to another. */
export function fit(
  value: number,
  oldMin: number,
  oldMax: number,
  newMin: number,
  newMax: number
): number {
  if (oldMax === oldMin) return newMin;
  const t = (value - oldMin) / (oldMax - oldMin);
  return newMin + t * (newMax - newMin);
}

/** Remap a 0..1 value into a new range. */
export function fit01(value: number, newMin: number, newMax: number): number {
  return newMin + value * (newMax - newMin);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth hermite interpolation (smoothstep). */
export function smooth(value: number, min: number, max: number): number {
  if (value <= min) return 0;
  if (value >= max) return 1;
  const t = (value - min) / (max - min);
  return t * t * (3 - 2 * t);
}

/**
 * Perlin-like noise in -1..1. Not true Perlin — a deterministic sum of sines.
 */
export function noise(...coords: number[]): number {
  if (coords.length === 0) return 0;

  let result = 0;
  const frequencies = [1, 2.3, 4.7, 8.1];
  const amplitudes = [1, 0.5, 0.25, 0.125];

  for (let i = 0; i < frequencies.length; i++) {
    let sum = 0;
    for (let j = 0; j < coords.length; j++) {
      sum += Math.sin(coords[j] * frequencies[i] * (j + 1) * 1.7 + j * 3.14159);
    }
    result += sum * amplitudes[i];
  }

  return Math.sin(result * 0.5);
}

/** Deterministic random in 0..1 from a seed. */
export function random(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Zero-pad a number to a given number of digits. */
export function padzero(digits: number, value: number): string {
  return String(Math.floor(value)).padStart(digits, "0");
}
