// The kit replaces copies in the sketches, so it has to give their exact bits.
// Each reference below is the consumer's code, copied verbatim on 2026-11-06.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contrastRatio, deltaE, gamutCmax, hexToSrgb, LINEAR_FROM_SRGB8, linearToOklab, linearToOklabInto, linearToSrgb,
  linearToSrgb8, mixOklch, oklabToLinear, oklabToLinearClipped, oklabToOklch, oklchToOklab, oklchToSrgb,
  oklchToSrgb8, srgb8ToLinear, srgbToHex, srgbToLinear, srgbToOklab,
} from '../dist/colour.js';

const same = (a, b, what) => {
  assert.equal(a.length, b.length, what);
  for (let i = 0; i < a.length; i++) assert.ok(Object.is(a[i], b[i]), `${what}[${i}]: ${a[i]} !== ${b[i]}`);
};

// ---- cairn-strata-hd lib/ribbon/colour.ts
const strata = {
  srgbToLin(c8) { const c = c8 / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; },
  linToSrgb8(l) { const x = l < 0 ? 0 : l > 1 ? 1 : l; return Math.floor((x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) * 255 + 0.5); },
  linToOklab(r, g, b, out, o) {
    const l = Math.cbrt(Math.max(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 0));
    const m = Math.cbrt(Math.max(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 0));
    const s = Math.cbrt(Math.max(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b, 0));
    out[o] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    out[o + 1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    out[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  },
  oklabToLinRaw(L, a, b) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  },
  oklabToLin(L, a, b) { return strata.oklabToLinRaw(L, a, b).map((v) => (v < 0 ? 0 : v > 1 ? 1 : v)); },
  oklchToSrgb8(L, C, hDeg) { const h = (hDeg * Math.PI) / 180; const [r, g, b] = strata.oklabToLin(L, C * Math.cos(h), C * Math.sin(h)); return [strata.linToSrgb8(r), strata.linToSrgb8(g), strata.linToSrgb8(b)]; },
  gamutCmax(L, h) {
    let lo = 0, hi = 0.4;
    const ch = Math.cos(h), sh = Math.sin(h);
    const kl = 0.3963377774 * ch + 0.2158037573 * sh, km = -0.1055613458 * ch - 0.0638541728 * sh, ks = -0.0894841775 * ch - 1.2914855480 * sh;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      const l_ = L + kl * mid, m_ = L + km * mid, s_ = L + ks * mid;
      const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
      const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
      const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
      const b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
      if (r >= -1e-4 && g >= -1e-4 && b >= -1e-4 && r <= 1 + 1e-4 && g <= 1 + 1e-4 && b <= 1 + 1e-4) lo = mid; else hi = mid;
    }
    return lo;
  },
};

// ---- commons lib/plotter-kit.ts
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const commons = {
  hex(h) { const s = (h || '#000').replace('#', ''); const v = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.padEnd(6, '0'); return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255]; },
  srgbToOklab(r, g, b) {
    r = toLin(r); g = toLin(g); b = toLin(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  },
  oklabToLinear(L, a, b) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  },
  oklch(L, Cc, hDeg) {
    const fits = (v) => v >= -1e-4 && v <= 1.0001;
    const out3 = (r, g, b) => [toGam(Math.min(1, Math.max(0, r))), toGam(Math.min(1, Math.max(0, g))), toGam(Math.min(1, Math.max(0, b)))];
    const h = (hDeg * Math.PI) / 180;
    L = Math.min(1, Math.max(0, L));
    let c = Cc;
    for (let i = 0; i < 10; i++) {
      const [r, g, b] = commons.oklabToLinear(L, c * Math.cos(h), c * Math.sin(h));
      if (fits(r) && fits(g) && fits(b)) return out3(r, g, b);
      c *= 0.75;
    }
    const [r, g, b] = commons.oklabToLinear(L, 0, 0);
    return out3(r, g, b);
  },
};

// ---- rides-atlas / race-story-frame / tmr-2026-preview lib/oklch.ts (oklchToRgb, before its byte rounding)
// cairn-swatch's labToRgb bisects too, but from a hue recomputed through atan2,
// so it differs from these in the last bits; it is not a kit mapping.
const rides = {
  toLinear([L, C, h]) {
    const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
    return commons.oklabToLinear(L, a, b);
  },
  oklchToRgb01(c) {
    const inGamut = (c) => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
    const enc = (v) => { v = Math.min(1, Math.max(0, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
    let lin = rides.toLinear(c);
    if (!inGamut(lin)) {
      let lo = 0, hi = c[1];
      for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (inGamut(rides.toLinear([c[0], mid, c[2]]))) lo = mid; else hi = mid; }
      lin = rides.toLinear([c[0], lo, c[2]]);
    }
    return lin.map(enc);
  },
};

const grid = [];
for (let L = 0; L <= 1.0001; L += 0.0625) for (let C = 0; C <= 0.4; C += 0.05) for (let h = 0; h < 360; h += 22.5) grid.push([L, C, h]);

test('transfer functions match the strata ribbon', () => {
  for (let i = 0; i < 256; i++) {
    assert.ok(Object.is(srgb8ToLinear(i), strata.srgbToLin(i)));
    assert.ok(Object.is(LINEAR_FROM_SRGB8[i], Math.fround(strata.srgbToLin(i))));
  }
  for (let v = -0.1; v <= 1.1; v += 0.0037) assert.equal(linearToSrgb8(v), strata.linToSrgb8(v));
  assert.equal(linearToSrgb(srgbToLinear(0.5)).toFixed(12), '0.500000000000');
});

test('OKLab conversions match the strata ribbon and commons bit for bit', () => {
  const out = new Float64Array(3), ref = new Float64Array(3);
  for (let r = 0; r <= 1; r += 0.125) for (let g = 0; g <= 1; g += 0.125) for (let b = 0; b <= 1; b += 0.125) {
    linearToOklabInto(r, g, b, out, 0); strata.linToOklab(r, g, b, ref, 0);
    same(out, ref, 'linearToOklabInto');
    same(linearToOklab(r, g, b), ref, 'linearToOklab');
    same(srgbToOklab(r, g, b), commons.srgbToOklab(r, g, b), 'srgbToOklab');
  }
  for (const [L, C, h] of grid) {
    const [, a, b] = oklchToOklab(L, C, h);
    same(oklabToLinear(L, a, b), strata.oklabToLinRaw(L, a, b), 'oklabToLinear');
    same(oklabToLinear(L, a, b), commons.oklabToLinear(L, a, b), 'oklabToLinear commons');
    same(oklabToLinearClipped(L, a, b), strata.oklabToLin(L, a, b), 'oklabToLinearClipped');
  }
});

test('gamut mappings reproduce each sketch', () => {
  for (const [L, C, h] of grid) {
    same(oklchToSrgb8(L, C, h, { gamut: 'clip' }), strata.oklchToSrgb8(L, C, h), `clip ${L} ${C} ${h}`);
    same(oklchToSrgb(L, C, h, { gamut: 'shrink' }), commons.oklch(L, C, h), `shrink ${L} ${C} ${h}`);
    same(oklchToSrgb(L, C, h, { steps: 20 }), rides.oklchToRgb01([L, C, h]), `bisect ${L} ${C} ${h}`);
    assert.ok(Object.is(gamutCmax(L, (h * Math.PI) / 180), strata.gamutCmax(L, (h * Math.PI) / 180)));
  }
});

test('hex, hue mixing, OKLCH round trip, contrast', () => {
  for (const h of ['#fff', '#000', '#1a2b3c', '', '#ab', '#B8B4AC']) same(hexToSrgb(h), commons.hex(h), h);
  assert.equal(srgbToHex(hexToSrgb('#1a2b3c')), '#1a2b3c');
  assert.deepEqual(mixOklch([0.5, 0.1, 350], [0.5, 0.1, 10], 0.5), [0.5, 0.1, 360]);
  const lab = srgbToOklab(0.2, 0.5, 0.8);
  const lch = oklabToOklch(...lab);
  assert.ok(deltaE(oklchToOklab(...lch), lab) < 1e-12);
  assert.ok(Math.abs(contrastRatio([1, 1, 1], [0, 0, 0]) - 21) < 1e-9);
  // white in OKLab is L = 1, a = b = 0
  const w = srgbToOklab(1, 1, 1);
  assert.ok(Math.abs(w[0] - 1) < 1e-4 && Math.abs(w[1]) < 1e-4 && Math.abs(w[2]) < 1e-4);
});
