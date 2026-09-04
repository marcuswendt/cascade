import type { Geometry, PrimitiveKind } from "@cascade/contracts";
import { PRIMITIVE_KINDS } from "@cascade/contracts";

import { positionAttribute, positionSize } from "./attributes.js";

/** Topology and measurement reads that the operations share. */

export function primitiveKind(
  geometry: Geometry,
  primitive: number,
): PrimitiveKind {
  return PRIMITIVE_KINDS[geometry.topology.kinds[primitive]] ?? "poly";
}

export function isClosed(geometry: Geometry, primitive: number): boolean {
  return geometry.topology.closed[primitive] === 1;
}

/** Half-open vertex range `[start, end)` of one primitive. */
export function vertexRange(
  geometry: Geometry,
  primitive: number,
): readonly [number, number] {
  return [
    geometry.topology.offsets[primitive],
    geometry.topology.offsets[primitive + 1],
  ];
}

export function vertexCountOf(geometry: Geometry, primitive: number): number {
  const [start, end] = vertexRange(geometry, primitive);
  return end - start;
}

/** The point indices a primitive's vertices reference, in vertex order. */
export function primitivePoints(
  geometry: Geometry,
  primitive: number,
): number[] {
  const [start, end] = vertexRange(geometry, primitive);
  const points = new Array<number>(end - start);
  for (let vertex = start; vertex < end; vertex += 1)
    points[vertex - start] = geometry.topology.vertexPoints[vertex];
  return points;
}

/** A mask of the points no primitive references: the loose points, the dots. */
export function loosePointMask(geometry: Geometry): Uint8Array {
  const used = new Uint8Array(geometry.pointCount);
  for (const point of geometry.topology.vertexPoints) used[point] = 1;
  const loose = new Uint8Array(geometry.pointCount);
  for (let index = 0; index < loose.length; index += 1)
    loose[index] = used[index] ? 0 : 1;
  return loose;
}

export function distance(
  positions: ArrayLike<number>,
  size: number,
  a: number,
  b: number,
): number {
  let total = 0;
  for (let component = 0; component < size; component += 1) {
    const delta = positions[b * size + component] - positions[a * size + component];
    total += delta * delta;
  }
  return Math.sqrt(total);
}

/**
 * Cumulative arc lengths along one primitive, one entry per segment. A closed
 * primitive has one more segment than an open one, the one that returns to its
 * first point.
 */
export function arcLengths(geometry: Geometry, primitive: number): number[] {
  const position = positionAttribute(geometry);
  const size = position.size;
  const points = primitivePoints(geometry, primitive);
  const closed = isClosed(geometry, primitive);
  const segments = points.length < 2 ? 0 : closed ? points.length : points.length - 1;
  const cumulative = new Array<number>(segments);
  let total = 0;
  for (let segment = 0; segment < segments; segment += 1) {
    const from = points[segment];
    const to = points[(segment + 1) % points.length];
    total += distance(position.data, size, from, to);
    cumulative[segment] = total;
  }
  return cumulative;
}

export function primitiveLength(geometry: Geometry, primitive: number): number {
  const cumulative = arcLengths(geometry, primitive);
  return cumulative.length === 0 ? 0 : cumulative[cumulative.length - 1];
}

export function geometryLength(geometry: Geometry): number {
  let total = 0;
  for (let primitive = 0; primitive < geometry.primitiveCount; primitive += 1)
    total += primitiveLength(geometry, primitive);
  return total;
}

export interface Bounds {
  readonly min: readonly number[];
  readonly max: readonly number[];
}

/** Axis-aligned bounds over every point, or undefined for an empty geometry. */
export function geometryBounds(geometry: Geometry): Bounds | undefined {
  if (geometry.pointCount === 0) return undefined;
  const position = positionAttribute(geometry);
  const size = positionSize(geometry);
  const min = new Array<number>(size).fill(Number.POSITIVE_INFINITY);
  const max = new Array<number>(size).fill(Number.NEGATIVE_INFINITY);
  for (let point = 0; point < geometry.pointCount; point += 1)
    for (let component = 0; component < size; component += 1) {
      const value = position.data[point * size + component];
      if (value < min[component]) min[component] = value;
      if (value > max[component]) max[component] = value;
    }
  return { min, max };
}
