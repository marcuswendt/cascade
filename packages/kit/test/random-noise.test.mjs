import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fnv1a, hashParts, mod, mulberry32, Rng, rngFor, rngFromString, sha1Hex } from '../dist/random.js';
import { fbm2, hash1, hash2, seededNoise2, smoothstep, valueNoise1, valueNoise2 } from '../dist/noise.js';

// ---- cairn-swatch lib/stone.ts, verbatim
function swatchRng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- commons lib/plotter-kit.ts noise, verbatim
const ref = {
  hash1(n) { const s = Math.sin(n) * 43758.5453123; return s - Math.floor(s); },
  vnoise1(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return ref.hash1(i) * (1 - u) + ref.hash1(i + 1) * u; },
  hash2(x, y) { const fract = (v) => v - Math.floor(v); let px = fract(x * 123.34), py = fract(y * 456.21); const d = px * (px + 45.32) + py * (py + 45.32); px += d; py += d; return fract(px * py); },
  vn(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = ref.hash2(ix, iy), b = ref.hash2(ix + 1, iy), c = ref.hash2(ix, iy + 1), d = ref.hash2(ix + 1, iy + 1);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  },
  fbm(x, y, oct = 5) { let s = 0, a = 0.5; for (let i = 0; i < oct; i++) { s += a * ref.vn(x, y); x *= 2.03; y *= 2.03; a *= 0.5; } return s; },
};

test('sha1Hex and hashParts agree with node:crypto and Python', () => {
  for (const s of ['', 'abc', 'é and ✓', 'x'.repeat(1000)]) assert.equal(sha1Hex(s), createHash('sha1').update(s).digest('hex'));
  const py = parseInt(createHash('sha1').update('FIELD|2026-11-03|7').digest('hex').slice(0, 12), 16);
  assert.equal(hashParts('FIELD', '2026-11-03', 7), py);
});

test('Rng (sfc32) is the strata generator: fixed sequence and numpy-like helpers', () => {
  const a = new Rng(hashParts('meander', 'FIELD')), b = new Rng(hashParts('meander', 'FIELD'));
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  // pinned from cairn-strata-hd lib/ribbon/num.ts: a change here changes every strata render
  const r = new Rng(42);
  assert.deepEqual(Array.from(r.randoms(3)).map((v) => v.toFixed(12)), ['0.904073109385', '0.274076540256', '0.380135309184']);
  assert.equal(hashParts('FIELD', '2026-11-03', 7), 126965348734181);
  const n = new Rng(7).normals(20000);
  const mean = n.reduce((s, v) => s + v, 0) / n.length;
  const sd = Math.sqrt(n.reduce((s, v) => s + (v - mean) ** 2, 0) / n.length);
  assert.ok(Math.abs(mean) < 0.03 && Math.abs(sd - 1) < 0.03);
  const ints = new Rng(3);
  for (let i = 0; i < 1000; i++) { const k = ints.integers(2, 5); assert.ok(k >= 2 && k < 5 && Number.isInteger(k)); }
  assert.deepEqual(rngFor('x', 1).randoms(2), new Rng(hashParts('x', 1)).randoms(2));
  assert.deepEqual(new Rng(1).shuffle([1, 2, 3, 4, 5]).sort(), [1, 2, 3, 4, 5]);
  assert.equal(mod(-1, 5), 4);
});

test('rngFromString is cairn-swatch stone rng; mulberry32 is standard', () => {
  for (const seed of ['FIELD', 'Cairn', 'Family', '', 'ünïcode']) {
    const a = rngFromString(seed), b = swatchRng(seed);
    for (let i = 0; i < 500; i++) assert.equal(a(), b());
  }
  const m = mulberry32(1);
  assert.equal(m().toFixed(10), '0.6270739406');
  assert.equal(fnv1a('a'), 0xe40c292c);
});

test('noise is commons plotter-kit noise, bit for bit', () => {
  for (let x = -20; x < 20; x += 0.37) {
    assert.ok(Object.is(hash1(x), ref.hash1(x)));
    assert.ok(Object.is(valueNoise1(x), ref.vnoise1(x)));
    for (let y = -5; y < 5; y += 0.91) {
      assert.ok(Object.is(hash2(x, y), ref.hash2(x, y)));
      assert.ok(Object.is(valueNoise2(x, y), ref.vn(x, y)));
      assert.ok(Object.is(fbm2(x, y), ref.fbm(x, y)));
      assert.ok(Object.is(fbm2(x, y, 4), ref.fbm(x, y, 4)));
    }
  }
  const s1 = seededNoise2(1), s2 = seededNoise2(2);
  assert.notEqual(s1(0.5, 0.5), s2(0.5, 0.5));
  assert.equal(s1(3.3, 4.4), seededNoise2(1)(3.3, 4.4));
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  assert.equal(smoothstep(0, 1, -2), 0);
});
