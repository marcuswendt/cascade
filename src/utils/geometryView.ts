export type GeometryPoint = [number, number];

const BEZIER_KIND = 1;
const MAX_PREVIEW_ITEMS = 100_000;

export interface CoreGeometryView {
  bounds: { min: GeometryPoint; max: GeometryPoint } | null;
  points: GeometryPoint[];
  paths: GeometryPoint[][];
  summary: string;
}

interface NumericArrayLike {
  readonly length: number;
  readonly [index: number]: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function numbers(value: unknown): NumericArrayLike | null {
  if (Array.isArray(value)) return value.every(Number.isFinite) ? value : null;
  if (!ArrayBuffer.isView(value) || value instanceof DataView) return null;
  return value as unknown as NumericArrayLike;
}

function pointAt(data: NumericArrayLike, size: number, index: number): GeometryPoint | null {
  const x = data[index * size];
  const y = data[index * size + 1];
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function cubic(
  a: GeometryPoint,
  b: GeometryPoint,
  c: GeometryPoint,
  d: GeometryPoint,
  t: number,
): GeometryPoint {
  const u = 1 - t;
  const aa = u * u * u;
  const bb = 3 * u * u * t;
  const cc = 3 * u * t * t;
  const dd = t * t * t;
  return [
    aa * a[0] + bb * b[0] + cc * c[0] + dd * d[0],
    aa * a[1] + bb * b[1] + cc * c[1] + dd * d[1],
  ];
}

/** A bounded, DOM-free view of the core geometry contract for Studio previews. */
export function coreGeometryView(value: unknown, limit = 1200): CoreGeometryView | null {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PREVIEW_ITEMS) return null;
  const geometry = record(value);
  const pointCount = geometry?.pointCount;
  const primitiveCount = geometry?.primitiveCount;
  if (
    geometry?.kind !== 'geometry' ||
    typeof pointCount !== 'number' ||
    !Number.isSafeInteger(pointCount) ||
    pointCount < 0 ||
    typeof primitiveCount !== 'number' ||
    !Number.isSafeInteger(primitiveCount) ||
    primitiveCount < 0
  )
    return null;
  const position = record(record(geometry.point)?.P);
  const size = position?.size;
  const data = numbers(position?.data);
  if ((size !== 2 && size !== 3) || !data || data.length !== pointCount * size)
    return null;

  let bounds: CoreGeometryView['bounds'] = null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < pointCount; index += 1) {
    const point = pointAt(data, size, index);
    if (!point) return null;
    const [x, y] = point;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (pointCount > 0)
    bounds = { min: [minX, minY], max: [maxX, maxY] };
  const at = (index: number) => pointAt(data, size, index);

  const topology = record(geometry.topology);
  const vertexPoints = numbers(topology?.vertexPoints);
  const offsets = numbers(topology?.offsets);
  const kinds = numbers(topology?.kinds);
  const closed = numbers(topology?.closed);
  if (
    !vertexPoints ||
    !offsets ||
    !kinds ||
    !closed ||
    offsets.length !== primitiveCount + 1 ||
    kinds.length !== primitiveCount ||
    closed.length !== primitiveCount ||
    offsets[0] !== 0 ||
    offsets[offsets.length - 1] !== vertexPoints.length
  ) return null;

  const used = new Uint8Array(pointCount);
  for (let index = 0; index < vertexPoints.length; index += 1) {
    const point = vertexPoints[index];
    if (!Number.isSafeInteger(point) || point < 0 || point >= pointCount) return null;
    used[point] = 1;
  }

  const paths: GeometryPoint[][] = [];
  const pathBudget = Math.max(1, Math.floor(limit / Math.max(primitiveCount, 1)));
  for (let primitive = 0; primitive < primitiveCount && paths.length < limit; primitive += 1) {
    const start = offsets[primitive];
    const end = offsets[primitive + 1];
    const kind = kinds[primitive];
    const isClosed = closed[primitive];
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > vertexPoints.length ||
      !Number.isSafeInteger(kind) ||
      kind < 0 ||
      kind > 3 ||
      (isClosed !== 0 && isClosed !== 1)
    )
      return null;
    const length = end - start;
    const pointAtVertex = (index: number) => at(vertexPoints[start + index]!);
    let path: GeometryPoint[];
    if (kind === BEZIER_KIND) {
      const segments = isClosed ? length / 3 : (length - 1) / 3;
      if (!Number.isSafeInteger(segments) || segments < 1) return null;
      path = [];
      for (let segment = 0; segment < segments; segment += 1) {
        const base = segment * 3;
        const control = [
          pointAtVertex(base),
          pointAtVertex(base + 1),
          pointAtVertex(base + 2),
          pointAtVertex((base + 3) % length),
        ];
        if (control.some((point) => !point)) return null;
        const steps = Math.max(2, Math.min(16, Math.floor(pathBudget / Math.max(segments, 1))));
        for (let step = segment === 0 ? 0 : 1; step <= steps; step += 1)
          path.push(cubic(control[0]!, control[1]!, control[2]!, control[3]!, step / steps));
      }
    } else {
      const sampleCount = Math.min(length, pathBudget);
      path = [];
      for (let index = 0; index < sampleCount; index += 1) {
        const point = pointAtVertex(Math.floor(index * length / sampleCount));
        if (!point) return null;
        path.push(point);
      }
      if (isClosed === 1 && path.length > 1) path.push(path[0]!);
    }
    if (path.length > 0) paths.push(path);
  }

  const loose: GeometryPoint[] = [];
  const looseLimit = Math.max(0, Math.floor(limit));
  if (looseLimit > 0) {
    const looseCount = pointCount - used.reduce((sum, item) => sum + item, 0);
    const stride = Math.max(1, looseCount / looseLimit);
    let seen = 0;
    let next = 0;
    for (let index = 0; index < pointCount && loose.length < looseLimit; index += 1) {
      if (used[index]) continue;
      if (seen >= next) {
        const point = at(index);
        if (point) loose.push(point);
        next += stride;
      }
      seen += 1;
    }
  }
  return {
    bounds,
    points: loose,
    paths,
    summary: `${pointCount} ${pointCount === 1 ? 'point' : 'points'} · ${primitiveCount} ${primitiveCount === 1 ? 'primitive' : 'primitives'}`,
  };
}
