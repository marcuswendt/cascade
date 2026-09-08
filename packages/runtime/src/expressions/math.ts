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

// ============ Bare maths, as Houdini exposes it ============
//
// An expression language whose users write `sin($T)` and get "sin is not
// defined" is one they stop trusting. Houdini exposes the whole maths library
// bare, and so do we.
//
// Angles are RADIANS, unlike Houdini's degrees. Two reasons, and the second is
// the deciding one. `$T` in radians oscillates over 2pi seconds, which is a
// usable animation period, where in degrees `sin($T)` would take six minutes to
// come round. And `Math` is also in scope, so a degree-based `sin()` would
// disagree with `Math.sin()` inside the same expression — a trap far worse than
// having to type `radians()`. The `sind`/`cosd`/`tand` trio is there for anyone
// carrying a formula over from Houdini.

/** Degrees to radians. */
export function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Radians to degrees. */
export function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Sine of an angle in degrees — Houdini's `sin()`. */
export function sind(degrees: number): number {
  return Math.sin(radians(degrees));
}

/** Cosine of an angle in degrees — Houdini's `cos()`. */
export function cosd(degrees: number): number {
  return Math.cos(radians(degrees));
}

/** Tangent of an angle in degrees — Houdini's `tan()`. */
export function tand(degrees: number): number {
  return Math.tan(radians(degrees));
}

/**
 * The bare maths names available to every expression. Spread into the
 * evaluation scope; kept as one object so adding a function is a one-line
 * change here rather than a change in two files.
 */
export const MATH_SCOPE = {
  // Trigonometry, in radians
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,

  // Trigonometry, in degrees, for formulae carried over from Houdini
  sind,
  cosd,
  tand,
  radians,
  degrees,

  // Powers and logs
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  pow: Math.pow,
  exp: Math.exp,
  log: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  hypot: Math.hypot,

  // Rounding and sign
  abs: Math.abs,
  sign: Math.sign,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  trunc: Math.trunc,
  min: Math.min,
  max: Math.max,

  // Constants
  PI: Math.PI,
  TAU: Math.PI * 2,
  E: Math.E
} as const;
