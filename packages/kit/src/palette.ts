// A palette from pixels: k-means in OKLab, seeded, so the same image and seed
// give the same palette on every host. The Python stages in cloud-volumes,
// field-rocks and pebble-set each run their own k-means over OKLab for this.

import { LINEAR_FROM_SRGB8, linearToOklab, oklabToOklch, oklabToSrgb, type Vec3 } from './colour.js';
import { Rng } from './random.js';

export interface KmeansOptions {
  /** seed for the k-means++ start (default 1) */
  seed?: number;
  /** Lloyd iterations at most (default 24); stops early when nothing moves */
  iterations?: number;
}

export interface KmeansResult {
  centres: Vec3[];
  /** cluster index per point */
  labels: Int32Array;
  /** points per cluster */
  counts: number[];
}

/** k-means on 3D points (a flat [x0, y0, z0, x1, …] array), k-means++ initialisation. */
export function kmeans3(points: ArrayLike<number>, k: number, options: KmeansOptions = {}): KmeansResult {
  const n = Math.floor(points.length / 3);
  const labels = new Int32Array(n);
  if (n === 0 || k <= 0) return { centres: [], labels, counts: [] };
  k = Math.min(k, n);
  const rng = new Rng(options.seed ?? 1);
  const d2 = (i: number, c: Vec3) => (points[i * 3] - c[0]) ** 2 + (points[i * 3 + 1] - c[1]) ** 2 + (points[i * 3 + 2] - c[2]) ** 2;
  const at = (i: number): Vec3 => [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
  const centres: Vec3[] = [at(rng.integers(0, n))];
  const best = new Float64Array(n).fill(Infinity);
  while (centres.length < k) {
    const c = centres[centres.length - 1];
    let total = 0;
    for (let i = 0; i < n; i++) { const d = d2(i, c); if (d < best[i]) best[i] = d; total += best[i]; }
    if (total <= 0) break; // fewer distinct colours than k
    let pick = rng.random() * total, chosen = n - 1;
    for (let i = 0; i < n; i++) { pick -= best[i]; if (pick <= 0) { chosen = i; break; } }
    centres.push(at(chosen));
  }
  const iterations = options.iterations ?? 24;
  const counts = new Array<number>(centres.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let bi = 0, bd = Infinity;
      for (let j = 0; j < centres.length; j++) { const d = d2(i, centres[j]); if (d < bd) { bd = d; bi = j; } }
      if (labels[i] !== bi || it === 0) { moved++; labels[i] = bi; }
    }
    const sums = centres.map(() => [0, 0, 0]);
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const s = sums[labels[i]];
      s[0] += points[i * 3]; s[1] += points[i * 3 + 1]; s[2] += points[i * 3 + 2];
      counts[labels[i]]++;
    }
    for (let j = 0; j < centres.length; j++) {
      if (counts[j]) centres[j] = [sums[j][0] / counts[j], sums[j][1] / counts[j], sums[j][2] / counts[j]];
    }
    if (it > 0 && moved === 0) break;
  }
  return { centres, labels, counts };
}

export interface PaletteOptions extends KmeansOptions {
  /** at most this many pixels are clustered, sampled with the seed (default 8192) */
  sample?: number;
  /** pixels with alpha below this byte are ignored (default 128) */
  minAlpha?: number;
}

export interface PaletteColour {
  oklab: Vec3;
  oklch: Vec3;
  /** sRGB encoded 0..1 */
  srgb: Vec3;
  /** share of the clustered pixels, 0..1 */
  weight: number;
}

/** The `k` dominant colours of an RGBA byte buffer, heaviest first. */
export function paletteFromPixels(rgba: ArrayLike<number>, k: number, options: PaletteOptions = {}): PaletteColour[] {
  const total = Math.floor(rgba.length / 4);
  const minAlpha = options.minAlpha ?? 128;
  const opaque: number[] = [];
  for (let i = 0; i < total; i++) if (rgba[i * 4 + 3] >= minAlpha) opaque.push(i);
  const sample = options.sample ?? 8192;
  const rng = new Rng((options.seed ?? 1) + 0x5bd1e995);
  const chosen = opaque.length > sample ? rng.shuffle(opaque).slice(0, sample).sort((a, b) => a - b) : opaque;
  const lab = new Float64Array(chosen.length * 3);
  chosen.forEach((p, i) => {
    const [L, a, b] = linearToOklab(LINEAR_FROM_SRGB8[rgba[p * 4]], LINEAR_FROM_SRGB8[rgba[p * 4 + 1]], LINEAR_FROM_SRGB8[rgba[p * 4 + 2]]);
    lab[i * 3] = L; lab[i * 3 + 1] = a; lab[i * 3 + 2] = b;
  });
  const { centres, counts } = kmeans3(lab, k, options);
  const n = chosen.length || 1;
  return centres
    .map((c, j) => ({ oklab: c, oklch: oklabToOklch(c[0], c[1], c[2]), srgb: oklabToSrgb(c[0], c[1], c[2]), weight: counts[j] / n }))
    .sort((a, b) => b.weight - a.weight || a.oklab[0] - b.oklab[0]);
}
