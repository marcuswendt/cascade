// Pen and plotter output, for a 0.1 mm pen by default.
//
// Two halves:
//   - geometry in millimetres -> a plot document (SVG in mm, numbered Inkscape
//     layers, round caps, no fill), the shape cloud-plots' `plotdoc.write_svg`
//     settled on for NextDraw/AxiDraw: layer `7 ink` plots, a `%` layer never does;
//   - a raster pen preview (`inkShade`): pen coverage rewritten as ink with
//     bleed, dry tooth and edge darkening, from commons' plotter.
//
// Pure functions, no file access: write the returned string where you like.

import { hexToSrgb } from './colour.js';
import { fbm2, smoothstep, valueNoise2 } from './noise.js';
import type { PixelContext } from './paper.js';

export type Point = [number, number];
/** An open polyline in millimetres; repeat the first point to close it. */
export type Polyline = Point[];

export const DEFAULT_PEN_MM = 0.1;

export interface PenLayer {
  /** NextDraw/AxiDraw layer number; plotted in ascending order */
  number: number;
  name: string;
  paths: Polyline[];
  /** a guide layer (written as `%name`), shown in Inkscape and never plotted */
  guide?: boolean;
  /** stroke colour for the preview only (default black) */
  stroke?: string;
}

export interface PlotDocument {
  /** page size in millimetres */
  page: [number, number];
  layers: PenLayer[];
  /** pen width in millimetres (default 0.1) */
  penMm?: number;
  title?: string;
  description?: string;
}

export interface PlotManifest {
  layers: { number: number; name: string; paths: number; drawMm: number; travelMm: number }[];
  /** [minX, minY, maxX, maxY] of everything drawn, mm */
  bounds: [number, number, number, number] | null;
  penMm: number;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f3 = (v: number) => {
  const s = v.toFixed(3);
  return s.replace(/\.?0+$/, '') || '0';
};

/** Length of a polyline in mm. */
export function pathLength(path: Polyline): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return s;
}

/** Pen-up travel through `paths` in order, starting from `start` (default the origin). */
export function travelLength(paths: Polyline[], start: Point = [0, 0]): number {
  let at = start, s = 0;
  for (const p of paths) {
    if (!p.length) continue;
    s += Math.hypot(p[0][0] - at[0], p[0][1] - at[1]);
    at = p[p.length - 1];
  }
  return s;
}

/**
 * Reorder (and where it helps, reverse) paths to cut pen-up travel: greedy
 * nearest neighbour from `start`. Deterministic; O(n²), fine for tens of
 * thousands of paths. Returns new arrays, never mutates the input.
 */
export function orderPaths(paths: Polyline[], start: Point = [0, 0], allowReverse = true): Polyline[] {
  const todo = paths.filter((p) => p.length > 0);
  const used = new Uint8Array(todo.length);
  const out: Polyline[] = [];
  let at = start;
  for (let n = 0; n < todo.length; n++) {
    let best = -1, bestD = Infinity, flip = false;
    for (let i = 0; i < todo.length; i++) {
      if (used[i]) continue;
      const p = todo[i];
      const d0 = (p[0][0] - at[0]) ** 2 + (p[0][1] - at[1]) ** 2;
      if (d0 < bestD) { bestD = d0; best = i; flip = false; }
      if (allowReverse) {
        const e = p[p.length - 1];
        const d1 = (e[0] - at[0]) ** 2 + (e[1] - at[1]) ** 2;
        if (d1 < bestD) { bestD = d1; best = i; flip = true; }
      }
    }
    used[best] = 1;
    const p = flip ? [...todo[best]].reverse() : todo[best].slice();
    out.push(p);
    at = p[p.length - 1];
  }
  return out;
}

/**
 * A dot as pen geometry. At or below the pen width it is a point: a two-vertex,
 * zero-length path, which NextDraw lowers and raises in place (the nib's own
 * disc is the mark). Larger dots are a filled disc: an Archimedean spiral at
 * `pitch` pen widths per turn, closed by the rim circle, in one pen-down.
 */
export function dot(centre: Point, diameterMm = 0, penMm = DEFAULT_PEN_MM, pitch = 0.8): Polyline {
  const [cx, cy] = centre;
  const R = diameterMm / 2 - penMm / 2;
  if (R <= 0) return [[cx, cy], [cx, cy]];
  const step = pitch * penMm;
  const turns = R / step;
  const out: Polyline = [];
  const segs = Math.max(12, Math.ceil(turns * 24));
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, a = t * turns * Math.PI * 2, r = t * R;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  const a0 = turns * Math.PI * 2, rim = Math.max(24, Math.ceil((2 * Math.PI * R) / (penMm * 2)));
  for (let i = 1; i <= rim; i++) {
    const a = a0 + (i / rim) * Math.PI * 2;
    out.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  return out;
}

/**
 * Hatch-fill a closed polygon (mm) with parallel strokes `spacingMm` apart at
 * `angleDeg`, alternating direction so the pen zig-zags. Even-odd rule, so a
 * polygon list with holes works. The default spacing is 0.8 pen widths: solid
 * ink for a 0.1 mm pen.
 */
export function hatch(polygons: Polyline[], spacingMm = 0.8 * DEFAULT_PEN_MM, angleDeg = 0): Polyline[] {
  const a = (angleDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  // rotate into a frame where hatch lines are horizontal
  const rot = polygons.map((poly) => poly.map(([x, y]) => [x * ca + y * sa, -x * sa + y * ca] as Point));
  let minY = Infinity, maxY = -Infinity;
  for (const p of rot) for (const [, y] of p) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const out: Polyline[] = [];
  if (!(maxY > minY)) return out;
  let row = 0;
  for (let y = minY + spacingMm / 2; y < maxY; y += spacingMm, row++) {
    const xs: number[] = [];
    for (const p of rot) {
      for (let i = 0; i < p.length; i++) {
        const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
      }
    }
    xs.sort((m, n) => m - n);
    const segs: Polyline[] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const back = (x: number): Point => [x * ca - y * sa, x * sa + y * ca];
      segs.push([back(xs[i]), back(xs[i + 1])]);
    }
    if (row % 2) { segs.reverse(); for (const s of segs) s.reverse(); }
    out.push(...segs);
  }
  return out;
}

function pathData(path: Polyline): string {
  if (!path.length) return '';
  return 'M' + path.map(([x, y]) => `${f3(x)},${f3(y)}`).join(' L');
}

/** Write a plot document: SVG in millimetres, one Inkscape layer per pen layer. */
export function plotSvg(doc: PlotDocument): { svg: string; manifest: PlotManifest } {
  const pen = doc.penMm ?? DEFAULT_PEN_MM;
  const [w, h] = doc.page;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
    `width="${f3(w)}mm" height="${f3(h)}mm" viewBox="0 0 ${f3(w)} ${f3(h)}">`,
  ];
  if (doc.title) parts.push(`<title>${xml(doc.title)}</title>`);
  parts.push(`<desc>${xml(`Page ${f3(w)} x ${f3(h)} mm. Pen ${pen} mm.${doc.description ? ' ' + doc.description : ''}`)}</desc>`);
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const manifest: PlotManifest = { layers: [], bounds: null, penMm: pen };
  const layers = [...doc.layers].sort((a, b) => a.number - b.number);
  for (const layer of layers) {
    const label = `${layer.guide ? '%' : ''}${layer.number} ${layer.name}`;
    parts.push(`<g inkscape:groupmode="layer" id="layer${layer.number}${layer.guide ? 'g' : ''}" inkscape:label="${xml(label)}" ` +
      `fill="none" stroke="${xml(layer.stroke ?? 'black')}" stroke-width="${pen}" stroke-linecap="round" stroke-linejoin="round">`);
    let draw = 0;
    for (const p of layer.paths) {
      if (p.length < 2) continue;
      parts.push(`<path d="${pathData(p)}"/>`);
      draw += pathLength(p);
      if (!layer.guide) for (const [x, y] of p) {
        if (x < bounds[0]) bounds[0] = x; if (y < bounds[1]) bounds[1] = y;
        if (x > bounds[2]) bounds[2] = x; if (y > bounds[3]) bounds[3] = y;
      }
    }
    parts.push('</g>');
    manifest.layers.push({ number: layer.number, name: layer.name, paths: layer.paths.filter((p) => p.length >= 2).length, drawMm: draw, travelMm: travelLength(layer.paths) });
  }
  parts.push('</svg>');
  manifest.bounds = Number.isFinite(bounds[0]) ? bounds : null;
  return { svg: parts.join('\n') + '\n', manifest };
}

export interface InkOptions {
  /** ink colour `#rrggbb` */
  ink: string;
  /** how far ink creeps past the stroke, 0..1 */
  bleed: number;
  /** dry-paper tooth that breaks up the stroke, 0..1 */
  tooth: number;
  /** slides the tooth and ink noise: a fresh sheet per boiled frame */
  offset?: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The plotter's ink shader, monochrome: reads the context's alpha as pen
 * coverage and rewrites it as ink with bleed, dry tooth and edge darkening.
 * Draw strokes (any colour, opaque) into a transparent context, then call this.
 */
export function inkShade(g: PixelContext, W: number, H: number, o: InkOptions): void {
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const A = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) A[i] = d[i * 4 + 3] / 255;
  const a = (x: number, y: number) => { x = x < 0 ? 0 : x > W - 1 ? W - 1 : x; y = y < 0 ? 0 : y > H - 1 ? H - 1 : y; return A[y * W + x]; };
  const bil = (x: number, y: number) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    return (a(x0, y0) * (1 - fx) + a(x0 + 1, y0) * fx) * (1 - fy) + (a(x0, y0 + 1) * (1 - fx) + a(x0 + 1, y0 + 1) * fx) * fy;
  };
  const ink = hexToSrgb(o.ink), off = (o.offset ?? 0) % 997;
  const r = 1 + o.bleed * 2.5;
  const out = g.createImageData(W, H);
  const p = out.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let m = A[i];
    const near = m > 0 || a(x + 3, y) > 0 || a(x - 3, y) > 0 || a(x, y + 3) > 0 || a(x, y - 3) > 0;
    if (!near) continue;
    if (o.bleed > 0.001) m = Math.max(m, bil(x + r, y) * 0.85, bil(x - r, y) * 0.85, bil(x, y + r) * 0.82, bil(x, y - r) * 0.82, bil(x + r, y + r) * 0.72, bil(x - r, y - r) * 0.72);
    const edge = Math.min(1, (Math.abs(a(x + 1, y) - a(x - 1, y)) + Math.abs(a(x, y + 1) - a(x, y - 1))) * 0.9);
    if (m <= 0 && edge <= 0) continue;
    const gx = x + 0.5 + off, gy = y + 0.5 + off * 0.7;
    const tooth = 1 - o.tooth * smoothstep(0.25, 0.85, valueNoise2(gx * 0.6, gy * 0.6));
    const coverage = clamp01(m * tooth + edge * 0.35);
    if (coverage <= 0) continue;
    const n = (fbm2(gx * 0.09 + 19, gy * 0.09 + 19) - 0.5) * 0.06 - edge * 0.22;
    const k = i * 4;
    p[k] = clamp01(ink[0] + n) * 255; p[k + 1] = clamp01(ink[1] + n) * 255; p[k + 2] = clamp01(ink[2] + n) * 255; p[k + 3] = coverage * 255;
  }
  g.putImageData(out, 0, 0);
}
