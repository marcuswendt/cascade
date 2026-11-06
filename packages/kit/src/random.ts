// Seeded randomness. Nothing here reads the clock or Math.random: a seed in,
// the same sequence out, in Node, in Studio and in the browser player.
//
// Three generators because sketches already depend on three exact sequences:
//   - `Rng` (sfc32, seeded from a 53-bit integer) is cairn-strata-hd's ribbon
//     and river generator, with numpy-like helpers;
//   - `mulberry32` is the one-line generator most single-file sketches use;
//   - `rngFromString` is cairn-swatch's stone generator (FNV-1a of a name,
//     then mulberry32), so a space's name is its seed.
// `hashParts` reproduces Python's `int(sha1("|".join(parts))[:12], 16)`, which
// is how the strata pipeline keys randomness to event ids.

/** FNV-1a over UTF-16 code units, as an unsigned 32-bit integer. */
export function fnv1a(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32: a fast 32-bit generator returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generator seeded by a string (FNV-1a, then mulberry32). */
export function rngFromString(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return mulberry32(h);
}

/** SHA-1 of a UTF-8 string, lower-case hex. Synchronous and dependency-free. */
export function sha1Hex(text: string): string {
  const msg = new TextEncoder().encode(text);
  const ml = msg.length;
  const len = (((ml + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(len);
  buf.set(msg);
  buf[ml] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(len - 4, (ml * 8) >>> 0);
  dv.setUint32(len - 8, Math.floor((ml * 8) / 0x100000000));
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < len; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

/**
 * Python's `int(hashlib.sha1("|".join(map(str, parts))).hexdigest()[:12], 16)`:
 * a 48-bit integer, exact in a double, identical to the Python reference.
 */
export function hashParts(...parts: (string | number)[]): number {
  return parseInt(sha1Hex(parts.map(String).join('|')).slice(0, 12), 16);
}

/** Python's `%`: the result takes the divisor's sign. */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * sfc32, seeded from an integer up to 2^53. `random()`, `uniform()`,
 * `integers()` and `normal()` mirror numpy's Generator by name; the draws
 * differ from numpy's, the statistics match.
 */
export class Rng {
  private a: number; private b: number; private c: number; private d: number;
  private spare: number | null = null;
  constructor(seed: number) {
    this.a = 0x9e3779b9; this.b = seed >>> 0; this.c = Math.floor(seed / 0x100000000) >>> 0; this.d = 1;
    for (let i = 0; i < 15; i++) this.next();
  }
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }
  random(): number { return this.next(); }
  uniform(lo: number, hi: number): number { return lo + (hi - lo) * this.next(); }
  /** an integer in [lo, hi) */
  integers(lo: number, hi: number): number { return lo + Math.floor(this.next() * (hi - lo)); }
  /** standard normal (Box-Muller, the spare kept for the next call) */
  normal(): number {
    if (this.spare !== null) { const s = this.spare; this.spare = null; return s; }
    let u = 0;
    while (u <= 1e-12) u = this.next();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }
  normals(n: number): Float64Array { const o = new Float64Array(n); for (let i = 0; i < n; i++) o[i] = this.normal(); return o; }
  randoms(n: number): Float64Array { const o = new Float64Array(n); for (let i = 0; i < n; i++) o[i] = this.next(); return o; }
  /** one element, uniformly */
  pick<T>(items: readonly T[]): T { return items[Math.floor(this.next() * items.length)]; }
  /** Fisher-Yates, in place; returns the array */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = items[i]; items[i] = items[j]; items[j] = t;
    }
    return items;
  }
}

/** An `Rng` seeded from any number of parts (strings, ids, integers) via `hashParts`. */
export function rngFor(...parts: (string | number)[]): Rng {
  return new Rng(hashParts(...parts));
}
