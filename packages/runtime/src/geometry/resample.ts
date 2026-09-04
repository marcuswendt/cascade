import {
  attributeArray,
  createGeometry,
  isStringAttribute,
  type AnyAttribute,
  type AttributeStorage,
  type Geometry,
} from "@cascade/contracts";

import {
  createStringAttribute,
  geometryError,
  readString,
} from "./attributes.js";
import { groupMask } from "./groups.js";
import {
  arcLengths,
  isBezier,
  isClosed,
  loosePointMask,
  primitivePoints,
} from "./primitives.js";

/**
 * Rewrite each primitive at a uniform arc-length spacing, or at a target
 * vertex count. Most curve operations want a uniformly sampled chain, so this
 * is the prerequisite for the rest of stage 4 and is built early.
 *
 * Two decisions the shape of the data forces:
 *
 * Loose points survive untouched. A point that no primitive references is a
 * dot, `cascade-logo` is half made of them, and an operation on curves has no
 * business deleting them. Points that only the resampled primitives referenced
 * are replaced, since the new chain is the same curve at different stations.
 *
 * The primitive count never changes, so primitive attributes, primitive groups
 * and detail are shared with the input by reference rather than rebuilt. Point
 * and vertex attributes are interpolated linearly along the chain; a string
 * attribute and a group membership take the nearer of the two source elements,
 * because there is no meaningful blend of a tag.
 */
export interface ResampleOptions {
  /** Target arc length between consecutive points. Exclusive with `count`. */
  readonly spacing?: number;
  /** Target points per primitive. Exclusive with `spacing`. */
  readonly count?: number;
  /** Restrict to a primitive group; the rest carry through unchanged. */
  readonly group?: string;
}

interface Sample {
  readonly segment: number;
  readonly u: number;
}

export function resampleGeometry(
  geometry: Geometry,
  options: ResampleOptions,
): Geometry {
  const bySpacing = options.spacing !== undefined;
  const byCount = options.count !== undefined;
  if (bySpacing === byCount)
    geometryError("resample-options", "resample takes either spacing or count");
  if (bySpacing && !(options.spacing! > 0))
    geometryError("resample-options", "spacing must be greater than zero");
  if (byCount && !(options.count! >= 2))
    geometryError("resample-options", "count must be at least 2");
  if (geometry.primitiveCount === 0) return geometry;

  const selected =
    options.group === undefined
      ? undefined
      : (groupMask(geometry, "primitive", options.group) ??
        geometryError(
          "missing-group",
          `primitive group ${options.group} is not present`,
        ));

  const plans = new Array<Sample[] | undefined>(geometry.primitiveCount);
  let resampled = 0;
  for (let primitive = 0; primitive < geometry.primitiveCount; primitive += 1) {
    if (selected !== undefined && selected[primitive] !== 1) continue;
    // Resample is the explicit "make this a polyline" operation, and the one it
    // cannot yet perform is the interesting one: flattening a cubic chain needs
    // a subdivision and an arc-length table over the curve rather than over its
    // control polygon. Refusing is the only honest answer, because reading the
    // handles as vertices returns a plausible shape that is the wrong shape.
    if (isBezier(geometry, primitive))
      geometryError(
        "curve-resample",
        `primitive ${primitive} is a bezier; resampling a curve is not implemented`,
      );
    const points = primitivePoints(geometry, primitive);
    if (points.length < 2) continue;
    const cumulative = arcLengths(geometry, primitive);
    const total = cumulative[cumulative.length - 1];
    if (!(total > 0)) continue;
    const closed = isClosed(geometry, primitive);
    const target = byCount
      ? Math.max(closed ? 3 : 2, Math.floor(options.count!))
      : closed
        ? Math.max(3, Math.round(total / options.spacing!))
        : Math.max(2, Math.round(total / options.spacing!) + 1);
    plans[primitive] = stations(cumulative, total, target, closed);
    resampled += 1;
  }
  if (resampled === 0) return geometry;

  // Points a carried primitive still references, plus every loose point.
  const loose = loosePointMask(geometry);
  const keep = new Uint8Array(geometry.pointCount);
  for (let index = 0; index < keep.length; index += 1) keep[index] = loose[index];
  for (let primitive = 0; primitive < geometry.primitiveCount; primitive += 1)
    if (plans[primitive] === undefined)
      for (const point of primitivePoints(geometry, primitive)) keep[point] = 1;

  const pointMap = new Int32Array(geometry.pointCount).fill(-1);
  let newPointCount = 0;
  for (let index = 0; index < keep.length; index += 1)
    if (keep[index]) pointMap[index] = newPointCount++;

  // One entry per new point: either a kept source point, or a station on a
  // primitive expressed as its two source points and a parameter.
  interface PointSource {
    readonly a: number;
    readonly b: number;
    readonly u: number;
  }
  const pointSources: PointSource[] = [];
  for (let index = 0; index < keep.length; index += 1)
    if (keep[index]) pointSources.push({ a: index, b: index, u: 0 });

  interface VertexSource {
    readonly a: number;
    readonly b: number;
    readonly u: number;
  }
  const vertexSources: VertexSource[] = [];
  const vertexPoints: number[] = [];
  const offsets: number[] = [0];
  for (let primitive = 0; primitive < geometry.primitiveCount; primitive += 1) {
    const plan = plans[primitive];
    const points = primitivePoints(geometry, primitive);
    const start = geometry.topology.offsets[primitive];
    if (plan === undefined) {
      for (let local = 0; local < points.length; local += 1) {
        vertexPoints.push(pointMap[points[local]]);
        vertexSources.push({ a: start + local, b: start + local, u: 0 });
      }
      offsets.push(vertexPoints.length);
      continue;
    }
    for (const sample of plan) {
      const next = (sample.segment + 1) % points.length;
      pointSources.push({
        a: points[sample.segment],
        b: points[next],
        u: sample.u,
      });
      vertexSources.push({
        a: start + sample.segment,
        b: start + next,
        u: sample.u,
      });
      vertexPoints.push(newPointCount++);
    }
    offsets.push(vertexPoints.length);
  }

  const point: Record<string, AnyAttribute> = {};
  for (const [name, attribute] of Object.entries(geometry.point))
    point[name] = interpolate(attribute, pointSources);
  const vertex: Record<string, AnyAttribute> = {};
  for (const [name, attribute] of Object.entries(geometry.vertex))
    vertex[name] = interpolate(attribute, vertexSources);

  const pointGroups: Record<string, Uint8Array> = {};
  for (const [name, mask] of Object.entries(geometry.pointGroups)) {
    const next = new Uint8Array(pointSources.length);
    for (let index = 0; index < pointSources.length; index += 1) {
      const source = pointSources[index];
      next[index] = mask[source.u < 0.5 ? source.a : source.b];
    }
    pointGroups[name] = next;
  }

  return createGeometry({
    pointCount: pointSources.length,
    point,
    vertex,
    primitive: geometry.primitive,
    detail: geometry.detail,
    topology: {
      vertexPoints: Int32Array.from(vertexPoints),
      offsets: Int32Array.from(offsets),
      kinds: geometry.topology.kinds,
      closed: geometry.topology.closed,
    },
    pointGroups,
    primitiveGroups: geometry.primitiveGroups,
  });
}

/** Arc-length stations along one primitive, as segment plus local parameter. */
function stations(
  cumulative: readonly number[],
  total: number,
  target: number,
  closed: boolean,
): Sample[] {
  const samples: Sample[] = [];
  let segment = 0;
  for (let index = 0; index < target; index += 1) {
    const distance = closed
      ? (total * index) / target
      : (total * index) / (target - 1);
    while (segment < cumulative.length - 1 && cumulative[segment] < distance)
      segment += 1;
    const before = segment === 0 ? 0 : cumulative[segment - 1];
    const span = cumulative[segment] - before;
    const u = span > 0 ? Math.min(1, Math.max(0, (distance - before) / span)) : 0;
    samples.push({ segment, u });
  }
  return samples;
}

const INTEGER_STORAGE = new Set<AttributeStorage>(["i32", "u8"]);

function interpolate(
  attribute: AnyAttribute,
  sources: readonly { a: number; b: number; u: number }[],
): AnyAttribute {
  if (isStringAttribute(attribute))
    return createStringAttribute(
      sources.map((source) =>
        readString(attribute, source.u < 0.5 ? source.a : source.b),
      ),
    );
  const size = attribute.size;
  const data = attributeArray(attribute.storage, size * sources.length);
  const rounds = INTEGER_STORAGE.has(attribute.storage);
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    for (let component = 0; component < size; component += 1) {
      const from = attribute.data[source.a * size + component];
      const to = attribute.data[source.b * size + component];
      const value = from + (to - from) * source.u;
      data[index * size + component] = rounds ? Math.round(value) : value;
    }
  }
  return { storage: attribute.storage, size, data };
}
