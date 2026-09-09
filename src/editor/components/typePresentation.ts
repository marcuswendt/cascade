import { coerceImageRef, isImageRef } from '@/types/coreTypes';
import { coreGeometryView } from '@/utils/geometryView';

export type PresentationMode = 'compact' | 'inspect' | 'view';
export type Point2 = [number, number];

export interface GeometryPresentation {
  countLabel: string;
  bounds: { min: Point2; max: Point2 } | null;
  points: Point2[];
  paths: Point2[][];
  rects: Array<{ x: number; y: number; width: number; height: number }>;
}

const IMAGE_PATH = /\.(png|jpe?g|webp|gif|tiff?|avif|svg|npy)$/i;
const MAX_GEOMETRY_ITEMS = 1200;

export function inferCascadeType(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'string') return IMAGE_PATH.test(value) ? 'image' : 'string';
  if (isImageRef(value)) return 'image';
  if (value !== null && typeof value === 'object' && (value as { kind?: unknown }).kind === 'geometry') return 'geometry';
  if (Array.isArray(value)) {
    if (value.every(item => typeof item === 'number')) {
      if (value.length === 2) return 'vec2';
      if (value.length === 3) return 'vec3';
      if (value.length === 4) return 'vec4';
      if (value.length === 9) return 'mat3';
      if (value.length === 16) return 'mat4';
    }
    return 'array';
  }
  if (value !== null && typeof value === 'object') return 'object';
  return 'any';
}

export function mediaUrl(path: string, options: { width?: number; raw?: boolean; version?: number } = {}): string {
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  const clean = path.replace(/^\.?\//, '');
  const encoded = clean.split('/').map(encodeURIComponent).join('/');
  const params = new URLSearchParams();
  if (options.raw || /\.svg$/i.test(clean)) params.set('raw', '1');
  else if (options.width) params.set('w', String(options.width));
  if (options.version) params.set('v', String(options.version));
  const query = params.toString();
  return `/api/media/${encoded}${query ? `?${query}` : ''}`;
}

function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value: unknown, fallback = 0): number {
  return Math.max(0, Math.min(1, finite(value, fallback)));
}

export function normalizeColorTuple(value: unknown): [number, number, number, number] {
  if (Array.isArray(value)) {
    return [clamp01(value[0]), clamp01(value[1]), clamp01(value[2]), clamp01(value[3], 1)];
  }
  if (value && typeof value === 'object') {
    const color = value as Record<string, unknown>;
    return [clamp01(color.r), clamp01(color.g), clamp01(color.b), clamp01(color.a, 1)];
  }
  if (typeof value === 'string') {
    const match = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(value.trim());
    if (match) {
      const rgb = match[1];
      return [
        parseInt(rgb.slice(0, 2), 16) / 255,
        parseInt(rgb.slice(2, 4), 16) / 255,
        parseInt(rgb.slice(4, 6), 16) / 255,
        match[2] ? parseInt(match[2], 16) / 255 : 1,
      ];
    }
  }
  return [0, 0, 0, 1];
}

export function colorCss(value: unknown): string {
  const [r, g, b, a] = normalizeColorTuple(value);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${Number(a.toFixed(3))})`;
}

export function colorHex(value: unknown): string {
  const [r, g, b] = normalizeColorTuple(value);
  const channel = (component: number) => Math.round(component * 255).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function summarizeValue(value: unknown, type: string): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';

  const image = coerceImageRef(value);
  if (type === 'image' && image) {
    const [width, height] = image.size;
    return `${width || '?'}×${height || '?'} · ${image.channels} · ${image.depth} · ${image.space}`;
  }
  if (type === 'texture' && typeof value === 'object') {
    const texture = value as Record<string, any>;
    const size = texture.size ?? [texture.width, texture.height];
    const dimensions = Array.isArray(size) ? `${size[0] ?? '?'}×${size[1] ?? '?'}` : '?×?';
    const format = texture.format ?? (texture.float ? 'float' : 'GPU texture');
    return `${dimensions} · ${format} · browser session`;
  }
  if (['geometry', 'points', 'lines', 'polyline', 'mesh', 'rects'].includes(type)) {
    return geometryPresentation(value, type).countLabel;
  }
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return `{${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''}}`;
  }
  const text = String(value);
  return text.length > 100 ? `${text.slice(0, 97)}…` : text;
}

function point(value: unknown): Point2 | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function pointList(value: unknown): Point2[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_GEOMETRY_ITEMS).map(point).filter((item): item is Point2 => Boolean(item));
}

function closePath(points: Point2[], closed: boolean): Point2[] {
  return closed && points.length > 1 ? [...points, points[0]] : points;
}

export function geometryPresentation(value: unknown, type: string): GeometryPresentation {
  const result: GeometryPresentation = { countLabel: 'No geometry', bounds: null, points: [], paths: [], rects: [] };
  const data = value as any;

  if (type === 'geometry') {
    const view = coreGeometryView(value, MAX_GEOMETRY_ITEMS);
    if (!view) return result;
    result.points = view.points;
    result.paths = view.paths;
    result.bounds = view.bounds;
    result.countLabel = view.summary;
    return result;
  } else if (type === 'points') {
    result.points = pointList(Array.isArray(data) ? data : data?.points);
    result.countLabel = `${result.points.length} ${result.points.length === 1 ? 'point' : 'points'}`;
  } else if (type === 'lines') {
    const lines = Array.isArray(data) ? data : data?.lines;
    if (Array.isArray(lines)) {
      result.paths = lines.slice(0, MAX_GEOMETRY_ITEMS).map((line: any) => pointList(line)).filter((line: Point2[]) => line.length >= 2);
    }
    result.countLabel = `${result.paths.length} ${result.paths.length === 1 ? 'segment' : 'segments'}`;
  } else if (type === 'polyline') {
    const chains = Array.isArray(data) && point(data[0])
      ? [{ points: data }]
      : Array.isArray(data)
        ? data
        : [data];
    result.paths = chains.slice(0, MAX_GEOMETRY_ITEMS).map((chain: any) => {
      const points = pointList(chain?.points ?? chain);
      return closePath(points, Boolean(chain?.closed));
    }).filter((line: Point2[]) => line.length > 0);
    const vertices = result.paths.reduce((sum, path) => sum + path.length, 0);
    result.countLabel = `${result.paths.length} ${result.paths.length === 1 ? 'chain' : 'chains'} · ${vertices} vertices`;
  } else if (type === 'mesh') {
    const positions = Array.isArray(data?.positions) ? data.positions : [];
    const vertices: Point2[] = [];
    for (let index = 0; index + 1 < positions.length && vertices.length < MAX_GEOMETRY_ITEMS; index += 3) {
      const candidate = point([positions[index], positions[index + 1]]);
      if (candidate) vertices.push(candidate);
    }
    const indices = Array.isArray(data?.indices) ? data.indices : [];
    for (let index = 0; index + 2 < indices.length && result.paths.length < MAX_GEOMETRY_ITEMS; index += 3) {
      const triangle = [vertices[indices[index]], vertices[indices[index + 1]], vertices[indices[index + 2]]];
      if (triangle.every(Boolean)) result.paths.push([...triangle, triangle[0]] as Point2[]);
    }
    result.points = vertices;
    result.countLabel = `${Math.floor(positions.length / 3)} vertices · ${Math.floor(indices.length / 3)} ${indices.length === 3 ? 'triangle' : 'triangles'}`;
  } else if (type === 'rects') {
    const rects = Array.isArray(data) ? data : data?.rects;
    if (Array.isArray(rects)) {
      result.rects = rects.slice(0, MAX_GEOMETRY_ITEMS).map((rect: any) => ({
        x: finite(Array.isArray(rect) ? rect[0] : rect?.x),
        y: finite(Array.isArray(rect) ? rect[1] : rect?.y),
        width: finite(Array.isArray(rect) ? rect[2] : rect?.width),
        height: finite(Array.isArray(rect) ? rect[3] : rect?.height),
      }));
    }
    result.countLabel = `${result.rects.length} ${result.rects.length === 1 ? 'rect' : 'rects'}`;
  }

  const allPoints = [
    ...result.points,
    ...result.paths.flat(),
    ...result.rects.flatMap(rect => [
      [rect.x, rect.y] as Point2,
      [rect.x + rect.width, rect.y + rect.height] as Point2,
    ]),
  ];
  if (allPoints.length > 0) {
    result.bounds = {
      min: [Math.min(...allPoints.map(item => item[0])), Math.min(...allPoints.map(item => item[1]))],
      max: [Math.max(...allPoints.map(item => item[0])), Math.max(...allPoints.map(item => item[1]))],
    };
  }
  return result;
}

/**
 * What a geometry actually is, for a hover.
 *
 * Marcus, 2026-09-09: *"when the output of a node is geometry, i need a way to
 * see what exactly that is - add this to the mouseover mode."*
 *
 * The counts are the obvious half and the **attributes are the useful half.**
 * A port that says "2,500 points" tells you the shape of the data; a port that
 * says it carries `P v age life id Cd` tells you whether the node you are
 * about to wire it into will work. Every failure in a day of building the
 * particle set was an attribute that was absent or the wrong size — a solver
 * refusing a geometry with no `id`, a trail with no colour to promote, a `Cd`
 * that was three components — and none of them was visible without cooking.
 *
 * Grouped by level and named in declaration order rather than sorted, because
 * the order a node writes its attributes in is information: `P` first is the
 * position, and what follows is what that node added.
 */
export function geometryFacts(value: unknown): string[] {
  const data = value as {
    kind?: string;
    pointCount?: number;
    vertexCount?: number;
    primitiveCount?: number;
    point?: Record<string, unknown>;
    vertex?: Record<string, unknown>;
    primitive?: Record<string, unknown>;
    detail?: Record<string, unknown>;
    pointGroups?: Record<string, unknown>;
    primitiveGroups?: Record<string, unknown>;
  } | null;
  if (!data || typeof data !== 'object' || data.kind !== 'geometry') return [];

  const facts: string[] = [];
  const counts = [
    data.pointCount ? `${data.pointCount.toLocaleString()} points` : null,
    data.primitiveCount ? `${data.primitiveCount.toLocaleString()} prims` : null,
    // Vertices only when they differ from points: for a point cloud they are
    // the same number and saying it twice is noise.
    data.vertexCount && data.vertexCount !== data.pointCount
      ? `${data.vertexCount.toLocaleString()} verts`
      : null,
  ].filter(Boolean);
  if (counts.length > 0) facts.push(counts.join(' · '));

  for (const [level, set] of [
    ['point', data.point],
    ['vertex', data.vertex],
    ['prim', data.primitive],
  ] as const) {
    const names = set ? Object.keys(set) : [];
    if (names.length > 0) facts.push(`${level}: ${names.join(' ')}`);
  }

  // Detail carries values rather than arrays, so the value is short enough to
  // show — and `nextid` at a glance is what tells you a particle system has
  // been stepped rather than merely built.
  const detail = data.detail ? Object.entries(data.detail) : [];
  if (detail.length > 0) {
    facts.push(`detail: ${detail.map(([name, held]) =>
      typeof held === 'number' || typeof held === 'string' ? `${name}=${held}` : name,
    ).join(' ')}`);
  }

  const groups = [
    ...Object.keys(data.pointGroups ?? {}).map((name) => `@${name}`),
    ...Object.keys(data.primitiveGroups ?? {}).map((name) => `@${name}`),
  ];
  if (groups.length > 0) facts.push(`groups: ${groups.join(' ')}`);

  return facts;
}
