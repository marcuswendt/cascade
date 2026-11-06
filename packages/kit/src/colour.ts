// OKLab / OKLCH and the sRGB transfer, with Björn Ottosson's matrices.
//
// Twelve sketches carried a copy of this. The functions here keep the exact
// operation order of those copies (cairn-strata-hd's ribbon, commons'
// plotter-kit, cairn-swatch, rides-atlas), so a sketch that swaps its copy for
// the kit renders the same bytes. Change an expression here and every consumer's
// output moves: the tests pin values to the last bit for that reason.
//
// Conventions: sRGB channels are gamma-encoded 0..1 unless the name says `8`
// (bytes, 0..255). Linear means linear-light sRGB. Hue is in degrees.

export type Vec3 = [number, number, number];

// ------------------------------------------------------------------ transfer

/** sRGB encoded 0..1 to linear light. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear light to sRGB encoded, no clamping (negative stays negative). */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** An sRGB byte to linear light. */
export function srgb8ToLinear(c8: number): number {
  return srgbToLinear(c8 / 255);
}

/** Lookup table: every sRGB byte to linear light. */
export const LINEAR_FROM_SRGB8: Float32Array = Float32Array.from({ length: 256 }, (_, i) => srgb8ToLinear(i));

/** Linear light to an sRGB byte, clamped to 0..1 first and rounded half up. */
export function linearToSrgb8(l: number): number {
  const x = l < 0 ? 0 : l > 1 ? 1 : l;
  return Math.floor(linearToSrgb(x) * 255 + 0.5);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ------------------------------------------------------------------ OKLab

/** Linear sRGB to OKLab. Negative LMS responses are floored at 0. */
export function linearToOklab(r: number, g: number, b: number): Vec3 {
  const l = Math.cbrt(Math.max(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 0));
  const m = Math.cbrt(Math.max(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 0));
  const s = Math.cbrt(Math.max(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b, 0));
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

/** Linear sRGB to OKLab written into `out[o..o+2]`, allocation-free for pixel loops. */
export function linearToOklabInto(r: number, g: number, b: number, out: { [i: number]: number }, o: number): void {
  const l = Math.cbrt(Math.max(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 0));
  const m = Math.cbrt(Math.max(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 0));
  const s = Math.cbrt(Math.max(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b, 0));
  out[o] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  out[o + 1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  out[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
}

/** sRGB encoded 0..1 to OKLab. */
export function srgbToOklab(r: number, g: number, b: number): Vec3 {
  return linearToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
}

/** OKLab to linear sRGB, unclipped: out-of-gamut colours have channels outside 0..1. */
export function oklabToLinear(L: number, a: number, b: number): Vec3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

/** OKLab to linear sRGB with each channel clipped to 0..1. */
export function oklabToLinearClipped(L: number, a: number, b: number): Vec3 {
  const [r, g, bl] = oklabToLinear(L, a, b);
  return [clamp01(r), clamp01(g), clamp01(bl)];
}

/** OKLab to sRGB encoded 0..1, channels clipped. */
export function oklabToSrgb(L: number, a: number, b: number): Vec3 {
  const [r, g, bl] = oklabToLinearClipped(L, a, b);
  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(bl)];
}

// ------------------------------------------------------------------ OKLCH

/** OKLCH (hue in degrees) to OKLab. */
export function oklchToOklab(L: number, C: number, hDeg: number): Vec3 {
  const h = (hDeg * Math.PI) / 180;
  return [L, C * Math.cos(h), C * Math.sin(h)];
}

/** OKLab to OKLCH, hue in degrees 0..360. */
export function oklabToOklch(L: number, a: number, b: number): Vec3 {
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, Math.hypot(a, b), h];
}

const inGamut = (r: number, g: number, b: number) =>
  r >= -1e-4 && g >= -1e-4 && b >= -1e-4 && r <= 1 + 1e-4 && g <= 1 + 1e-4 && b <= 1 + 1e-4;

/**
 * The largest in-gamut chroma at lightness L and hue h (RADIANS), by bisection
 * on [0, 0.4]. Allocation-free: it runs per pixel in the strata ribbon.
 */
export function gamutCmax(L: number, h: number, steps = 14): number {
  let lo = 0, hi = 0.4;
  const ch = Math.cos(h), sh = Math.sin(h);
  const kl = 0.3963377774 * ch + 0.2158037573 * sh, km = -0.1055613458 * ch - 0.0638541728 * sh, ks = -0.0894841775 * ch - 1.2914855480 * sh;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    const l_ = L + kl * mid, m_ = L + km * mid, s_ = L + ks * mid;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    if (inGamut(r, g, b)) lo = mid; else hi = mid;
  }
  return lo;
}

/**
 * How an out-of-gamut OKLCH colour is brought into sRGB:
 * - `clip`: per-channel clipping (hue and lightness can shift).
 * - `bisect`: keep L and h, bisect chroma down to the gamut edge (`steps` halvings).
 * - `shrink`: keep L and h, multiply chroma by 0.75 until it fits (at most `steps` tries, then grey).
 */
export type GamutMode = 'clip' | 'bisect' | 'shrink';

export interface GamutOptions {
  gamut?: GamutMode;
  /** bisection halvings (default 18) or shrink attempts (default 10) */
  steps?: number;
}

/** OKLCH to linear sRGB inside the gamut, by the chosen mapping (default `bisect`). */
export function oklchToLinear(L: number, C: number, hDeg: number, options: GamutOptions = {}): Vec3 {
  const mode = options.gamut ?? 'bisect';
  const h = (hDeg * Math.PI) / 180;
  const at = (c: number) => oklabToLinear(L, c * Math.cos(h), c * Math.sin(h));
  if (mode === 'clip') {
    const [r, g, b] = at(C);
    return [clamp01(r), clamp01(g), clamp01(b)];
  }
  if (mode === 'shrink') {
    const steps = options.steps ?? 10;
    let c = C;
    for (let i = 0; i < steps; i++) {
      const [r, g, b] = at(c);
      if (r >= -1e-4 && r <= 1.0001 && g >= -1e-4 && g <= 1.0001 && b >= -1e-4 && b <= 1.0001) return [clamp01(r), clamp01(g), clamp01(b)];
      c *= 0.75;
    }
    const [r, g, b] = oklabToLinear(L, 0, 0);
    return [clamp01(r), clamp01(g), clamp01(b)];
  }
  let lin = at(C);
  if (!inGamut(lin[0], lin[1], lin[2])) {
    const steps = options.steps ?? 18;
    let lo = 0, hi = C;
    for (let i = 0; i < steps; i++) {
      const mid = (lo + hi) / 2;
      const t = at(mid);
      if (inGamut(t[0], t[1], t[2])) lo = mid; else hi = mid;
    }
    lin = at(lo);
  }
  return [clamp01(lin[0]), clamp01(lin[1]), clamp01(lin[2])];
}

/** OKLCH to sRGB encoded 0..1 (default gamut mapping `bisect`). */
export function oklchToSrgb(L: number, C: number, hDeg: number, options: GamutOptions = {}): Vec3 {
  const [r, g, b] = oklchToLinear(L, C, hDeg, options);
  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(b)];
}

/** OKLCH to sRGB bytes (default gamut mapping `bisect`). */
export function oklchToSrgb8(L: number, C: number, hDeg: number, options: GamutOptions = {}): Vec3 {
  const [r, g, b] = oklchToLinear(L, C, hDeg, options);
  return [linearToSrgb8(r), linearToSrgb8(g), linearToSrgb8(b)];
}

/** Interpolate two OKLCH colours, hue the short way round. */
export function mixOklch(a: Vec3, b: Vec3, t: number): Vec3 {
  let dh = b[2] - a[2];
  if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + dh * t];
}

/** Interpolate two OKLab colours. */
export function mixOklab(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Euclidean distance in OKLab (ΔE OK). */
export function deltaE(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// ------------------------------------------------------------------ hex and CSS

/** `#rgb` or `#rrggbb` to sRGB encoded 0..1. A short or empty string pads with zeros. */
export function hexToSrgb(h: string): Vec3 {
  const s = (h || '#000').replace('#', '');
  const v = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.padEnd(6, '0');
  return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255];
}

/** sRGB encoded 0..1 to `#rrggbb`. */
export function srgbToHex(rgb: Vec3): string {
  return '#' + rgb.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');
}

/** A CSS `rgb()`/`rgba()` string for an OKLCH colour (default gamut mapping `bisect`). */
export function oklchCss(L: number, C: number, hDeg: number, alpha = 1, options: GamutOptions = {}): string {
  const [r, g, b] = oklchToSrgb8(L, C, hDeg, options);
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

/** WCAG relative luminance of an sRGB encoded colour. */
export function relativeLuminance(rgb: Vec3): number {
  return 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]);
}

/** WCAG contrast ratio of two sRGB encoded colours, 1..21. */
export function contrastRatio(a: Vec3, b: Vec3): number {
  const x = relativeLuminance(a), y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
