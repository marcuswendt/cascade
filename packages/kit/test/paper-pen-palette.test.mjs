import assert from 'node:assert/strict';
import test from 'node:test';
import { paperPixels, paperSheet } from '../dist/paper.js';
import { DEFAULT_PEN_MM, dot, hatch, inkShade, orderPaths, pathLength, plotSvg, travelLength } from '../dist/pen.js';
import { kmeans3, paletteFromPixels } from '../dist/palette.js';
import { fbm2, valueNoise2 } from '../dist/noise.js';
import { hexToSrgb } from '../dist/colour.js';

/** A minimal 2D context over a byte buffer, like @napi-rs/canvas's. */
function fakeContext(W, H) {
  let buf = new Uint8ClampedArray(W * H * 4);
  return {
    get data() { return buf; },
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    getImageData: () => ({ data: buf.slice() }),
    putImageData: (img) => { buf = img.data; },
  };
}

// ---- commons lib/plotter-kit.ts paperSheet, verbatim (with its noise via the kit, pinned equal in random-noise.test)
function commonsPaper(g, W, H, colour, grain, offset = 0) {
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const base = hexToSrgb(colour);
  const img = g.createImageData(W, H);
  const d = img.data;
  const off = offset % 997;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gx = x + 0.5 + off, gy = y + 0.5 + off * 1.3;
    const mottle = fbm2(gx * 0.012, gy * 0.012, 4), fine = valueNoise2(gx * 0.85, gy * 0.85);
    const cx = (x + 0.5) / W - 0.5, cy = (y + 0.5) / H - 0.5, vig = 1 - (cx * cx + cy * cy) * 0.18;
    const k = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) d[k + c] = clamp01((base[c] * (0.965 + 0.06 * mottle) - (fine - 0.5) * 0.05 * grain) * vig) * 255;
    d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

test('paper is the commons paper, byte for byte', () => {
  const a = fakeContext(97, 61), b = fakeContext(97, 61);
  paperSheet(a, 97, 61, '#f3efe6', 0.8, 1234);
  commonsPaper(b, 97, 61, '#f3efe6', 0.8, 1234);
  assert.deepEqual(a.data, b.data);
  const raw = new Uint8ClampedArray(10 * 10 * 4);
  paperPixels(raw, 10, 10, { colour: '#ffffff', grain: 0 });
  assert.ok(raw.every((v, i) => (i % 4 === 3 ? v === 255 : v > 200)));
});

test('plot document: mm units, numbered layers, guide layers, manifest', () => {
  const square = [[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]];
  const { svg, manifest } = plotSvg({
    page: [210, 297], title: 'Test & plate',
    layers: [{ number: 7, name: 'ink', paths: [square] }, { number: 1, name: 'trim', guide: true, paths: [[[0, 0], [210, 0]]] }],
  });
  assert.match(svg, /width="210mm" height="297mm" viewBox="0 0 210 297"/);
  assert.match(svg, /inkscape:label="7 ink"/);
  assert.match(svg, /inkscape:label="%1 trim"/);
  assert.match(svg, /stroke-width="0.1"/);
  assert.match(svg, /<title>Test &amp; plate<\/title>/);
  assert.match(svg, /d="M10,10 L20,10 L20,20 L10,20 L10,10"/);
  assert.ok(svg.indexOf('%1 trim') < svg.indexOf('7 ink'), 'layers in plotting order');
  assert.equal(manifest.layers.find((l) => l.number === 7).drawMm, 40);
  assert.deepEqual(manifest.bounds, [10, 10, 20, 20]);
  assert.equal(manifest.penMm, DEFAULT_PEN_MM);
});

test('dots, hatching and path order', () => {
  assert.deepEqual(dot([5, 5]), [[5, 5], [5, 5]]);
  const disc = dot([0, 0], 1);
  assert.ok(disc.length > 24 && disc.every(([x, y]) => Math.hypot(x, y) <= 0.45 + 1e-9));
  const lines = hatch([[[0, 0], [10, 0], [10, 10], [0, 10]]], 1);
  assert.equal(lines.length, 10);
  assert.ok(lines.every((l) => Math.abs(pathLength(l) - 10) < 1e-9));
  assert.ok(lines[0][0][0] < lines[0][1][0] && lines[1][0][0] > lines[1][1][0], 'zig-zag');
  const holes = hatch([[[0, 0], [10, 0], [10, 10], [0, 10]], [[3, 3], [7, 3], [7, 7], [3, 7]]], 1);
  assert.ok(holes.length > lines.length, 'a hole splits the rows');
  const scattered = [[[9, 9], [9, 8]], [[0, 1], [0, 0]], [[5, 5], [5, 6]]];
  const ordered = orderPaths(scattered);
  assert.ok(travelLength(ordered) < travelLength(scattered));
  assert.deepEqual(ordered[0], [[0, 0], [0, 1]], 'reversed when the far end is nearer');
});

test('inkShade turns coverage into ink without touching empty paper', () => {
  const g = fakeContext(32, 32);
  for (let y = 12; y < 20; y++) for (let x = 4; x < 28; x++) g.data[(y * 32 + x) * 4 + 3] = 255;
  inkShade(g, 32, 32, { ink: '#203040', bleed: 0.3, tooth: 0.4, offset: 5 });
  assert.equal(g.data[3], 0, 'far corner stays empty');
  assert.ok(g.data[(16 * 32 + 16) * 4 + 3] > 100, 'the stroke is inked');
});

test('k-means palette: deterministic, finds the colours there are', () => {
  const px = new Uint8ClampedArray(400 * 4);
  for (let i = 0; i < 400; i++) {
    const [r, g, b] = i < 300 ? [230, 40, 30] : [20, 60, 200];
    px.set([r, g, b, 255], i * 4);
  }
  const p = paletteFromPixels(px, 2, { seed: 3 });
  assert.equal(p.length, 2);
  assert.ok(Math.abs(p[0].weight - 0.75) < 1e-9);
  assert.ok(Math.abs(p[0].srgb[0] - 230 / 255) < 1e-6);
  assert.deepEqual(paletteFromPixels(px, 2, { seed: 3 }), p);
  const one = kmeans3([0, 0, 0, 0, 0, 0], 3);
  assert.equal(one.centres.length, 1, 'never more centres than distinct points');
});
