/**
 * Draw geometry so it can be looked at.
 *
 * A pipeline that ends in marks has stages whose output is a point set or a
 * bundle of polylines, and the viewer could only show images — so the stages
 * that actually make the drawing were the ones you couldn't see. A stipple node
 * reported "7000 points" and showed nothing.
 *
 * The result is a data URL rather than a canvas on purpose: the viewer already
 * has a pan-and-zoom image path with Fit and 1:1, and geometry deserves the same
 * treatment rather than a second, worse viewport of its own.
 *
 * Point sets arrive two ways. Small ones come through as arrays; a stipple pass
 * writes a `.npy` and passes its path, because seven thousand coordinate pairs
 * through JSON on every cook is a cost with nothing to show for it. Both are
 * handled here so a node author can use whichever suits.
 */
import { readNpy } from './npy';
import { coreGeometryView } from './geometryView';

export type GeometryKind = 'geometry' | 'points' | 'lines' | 'polyline' | 'rects';

/** Longest edge of the rendered image. Enough to see structure in a dense
 *  stipple; the viewer scales it from there. */
const MAX_EDGE = 1400;
const MAX_GEOMETRY_ITEMS = 100_000;

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function growBounds(bounds: Bounds, x: number, y: number) {
  if (x < bounds.minX) bounds.minX = x;
  if (y < bounds.minY) bounds.minY = y;
  if (x > bounds.maxX) bounds.maxX = x;
  if (y > bounds.maxY) bounds.maxY = y;
}

function emptyBounds(): Bounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

/** Coordinate pairs from either shape a node might emit. */
async function toPoints(value: unknown): Promise<number[][]> {
  if (value && typeof value === 'object' && (value as any).kind === 'geometry-file') {
    const ref = value as any;
    if (ref.format !== 'npy' || ref.attribute?.level !== 'point' || ref.attribute?.name !== 'P') return [];
    value = ref.path;
  }
  if (typeof value === 'string') {
    if (!value.endsWith('.npy')) return [];
    const clean = value.replace(/^\.?\//, '');
    const response = await fetch(`/api/media/${clean.split('/').map(encodeURIComponent).join('/')}?raw=1`);
    if (!response.ok) return [];
    const array = readNpy(await response.arrayBuffer());
    const stride = array.shape.length > 1 ? array.shape[1] : 1;
    if (stride < 2) return [];
    const out: number[][] = [];
    for (let i = 0; i + 1 < array.data.length; i += stride) out.push([array.data[i], array.data[i + 1]]);
    return out;
  }
  const values = Array.isArray(value) ? value : (value as any)?.points;
  if (!Array.isArray(values)) return [];
  return values
    .map((entry: any) => (Array.isArray(entry) ? entry : entry?.point ?? entry?.position))
    .filter((pair: any) => Array.isArray(pair) && pair.length >= 2)
    .map((pair: any) => [Number(pair[0]), Number(pair[1])]);
}

/** Chains from a polyline value, which may be bare arrays or objects. */
function toChains(value: unknown): number[][][] {
  const values = Array.isArray(value) ? value : (value as any)?.polylines ?? (value as any)?.paths;
  if (!Array.isArray(values)) return [];
  return values
    .map((entry: any) => {
      const chain = Array.isArray(entry) ? entry : entry?.points ?? entry?.path;
      if (!Array.isArray(chain)) return null;
      return chain
        .filter((pair: any) => Array.isArray(pair) && pair.length >= 2)
        .map((pair: any) => [Number(pair[0]), Number(pair[1])]);
    })
    .filter((chain): chain is number[][] => Boolean(chain && chain.length > 1));
}

/**
 * Segments from a `lines` value. A stipple render emits each mark as a flat
 * `[x1, y1, x2, y2]` rather than a pair of pairs, which is why counting them as
 * chains reported zero.
 */
function toSegments(value: unknown): number[][][] {
  const values = Array.isArray(value) ? value : (value as any)?.segments ?? (value as any)?.lines;
  if (!Array.isArray(values)) return [];
  const out: number[][][] = [];
  for (const entry of values as any[]) {
    if (!Array.isArray(entry)) continue;
    if (entry.length >= 4 && typeof entry[0] === 'number') {
      out.push([[Number(entry[0]), Number(entry[1])], [Number(entry[2]), Number(entry[3])]]);
    } else if (Array.isArray(entry[0]) && entry.length >= 2) {
      out.push(entry.slice(0, 2).map((pair: any) => [Number(pair[0]), Number(pair[1])]));
    }
  }
  return out;
}

export interface GeometryRaster {
  url: string;
  width: number;
  height: number;
  /** What the node actually produced, for the caption. */
  summary: string;
}

export async function rasterizeGeometry(value: unknown, kind: GeometryKind): Promise<GeometryRaster | null> {
  const bounds = emptyBounds();
  const core = kind === 'geometry' ? coreGeometryView(value, MAX_GEOMETRY_ITEMS) : null;

  const points = kind === 'geometry' ? (core?.points ?? []) : kind === 'points' ? await toPoints(value) : [];
  const chains = kind === 'geometry' ? (core?.paths ?? []) : kind === 'polyline' ? toChains(value) : [];
  const segments = kind === 'lines' ? toSegments(value) : [];
  const rectValues = kind === 'rects' ? (Array.isArray(value) ? value : (value as any)?.rects) : [];
  const rects = Array.isArray(rectValues)
    ? rectValues.map(r => Array.isArray(r) ? r : r?.rect ?? [r?.x, r?.y, r?.width, r?.height]).filter(r => Array.isArray(r) && r.length >= 4 && r.every(Number.isFinite))
    : [];

  points.forEach(([x, y]) => growBounds(bounds, x, y));
  chains.forEach(chain => chain.forEach(([x, y]) => growBounds(bounds, x, y)));
  segments.forEach(seg => seg.forEach(([x, y]) => growBounds(bounds, x, y)));
  rects.forEach(([x, y, w, h]) => { growBounds(bounds, x, y); growBounds(bounds, x + w, y + h); });

  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX)) return null;

  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = MAX_EDGE / Math.max(spanX, spanY);
  const width = Math.max(1, Math.round(spanX * scale));
  const height = Math.max(1, Math.round(spanY * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;

  // White ground, black marks — this is plotter output, and looking at it on
  // the paper it will be drawn on is more informative than a dark preview.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  const px = (x: number) => (x - bounds.minX) * scale;
  const py = (y: number) => (kind === 'geometry' ? bounds.maxY - y : y - bounds.minY) * scale;

  context.fillStyle = '#111111';
  context.strokeStyle = '#111111';
  context.lineWidth = 1;

  // A dot per point, sized down as the count rises: at seven thousand marks a
  // 1px dot reads as a field, while at fifty it reads as dust.
  const radius = points.length > 4000 ? 0.6 : points.length > 800 ? 1 : 1.8;
  for (const [x, y] of points) {
    context.beginPath();
    context.arc(px(x), py(y), radius, 0, Math.PI * 2);
    context.fill();
  }

  for (const chain of chains) {
    context.beginPath();
    chain.forEach(([x, y], index) => (index === 0 ? context.moveTo(px(x), py(y)) : context.lineTo(px(x), py(y))));
    context.stroke();
  }

  for (const [a, b] of segments) {
    context.beginPath();
    context.moveTo(px(a[0]), py(a[1]));
    context.lineTo(px(b[0]), py(b[1]));
    context.stroke();
  }

  for (const [x, y, w, h] of rects) {
    context.strokeRect(px(x), py(y), w * scale, h * scale);
  }

  const summary = kind === 'geometry'
    ? core?.summary ?? 'No geometry'
    : kind === 'points'
    ? `${points.length.toLocaleString()} points`
    : kind === 'polyline'
      ? `${chains.length.toLocaleString()} chains · ${chains.reduce((t, c) => t + c.length, 0).toLocaleString()} vertices`
      : kind === 'lines'
        ? `${segments.length.toLocaleString()} segments`
        : `${rects.length.toLocaleString()} rects`;

  if (!points.length && !chains.length && !segments.length && !rects.length) return null;

  return { url: canvas.toDataURL('image/png'), width, height, summary };
}
