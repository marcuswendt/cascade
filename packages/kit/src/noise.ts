// Value noise and fractal noise, the shader kind.
//
// The hashes are the classic GLSL ones (`fract(sin(n) * 43758.5453)` and the
// `fract(p * vec2(123.34, 456.21))` dot trick), ported 1:1 so a canvas sketch
// and its fragment shader draw the same grain. They are deterministic but not
// seeded: move the sample point (an offset per sheet, per frame) to get a new
// field. `seededNoise2` wraps them with an integer seed when that is wanted.

const fract = (x: number) => x - Math.floor(x);

/** GLSL `fract(sin(n) * 43758.5453123)`. */
export function hash1(n: number): number {
  const s = Math.sin(n) * 43758.5453123;
  return s - Math.floor(s);
}

/** 1D value noise, smoothstep-interpolated, 0..1. */
export function valueNoise1(x: number): number {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash1(i) * (1 - u) + hash1(i + 1) * u;
}

/** A 2D lattice hash, 0..1. */
export function hash2(x: number, y: number): number {
  let px = fract(x * 123.34), py = fract(y * 456.21);
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d; py += d;
  return fract(px * py);
}

/** 2D value noise, smoothstep-interpolated, 0..1. */
export function valueNoise2(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** Fractal Brownian motion over `valueNoise2`: lacunarity 2.03, gain 0.5. Range about 0..1. */
export function fbm2(x: number, y: number, octaves = 5): number {
  let s = 0, a = 0.5;
  for (let i = 0; i < octaves; i++) { s += a * valueNoise2(x, y); x *= 2.03; y *= 2.03; a *= 0.5; }
  return s;
}

/** `valueNoise2` with an integer seed: each seed reads a different, distant part of the field. */
export function seededNoise2(seed: number): (x: number, y: number) => number {
  const ox = ((seed * 7919) % 10007) + 0.5, oy = ((seed * 104729) % 10009) + 0.25;
  return (x, y) => valueNoise2(x + ox, y + oy);
}

/** Hermite smoothstep of x between edges a and b. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
