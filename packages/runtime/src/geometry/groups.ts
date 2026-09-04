import { createGeometry, levelCount, type Geometry } from "@cascade/contracts";

import { geometryError } from "./attributes.js";

/**
 * Groups are named subsets, stored as one byte per element. A mask is the right
 * shape because membership is tested far more often than it is enumerated, and
 * because it is what lets a subset be named without duplicating the geometry:
 * `cloud-plots` copies 5.8 MB of geometry per cook to express what a 39 KB mask
 * says, purely because there is no way to say "this subset of primitives".
 */

export type GroupLevel = "point" | "primitive";

const KEYS = {
  point: "pointGroups",
  primitive: "primitiveGroups",
} as const;

export function groupMask(
  geometry: Geometry,
  level: GroupLevel,
  name: string,
): Uint8Array | undefined {
  return geometry[KEYS[level]][name];
}

export function inGroup(mask: Uint8Array, index: number): boolean {
  return mask[index] === 1;
}

/** The members of a mask, ascending. Enumerate only when you must. */
export function groupIndices(mask: Uint8Array): number[] {
  const indices: number[] = [];
  for (let index = 0; index < mask.length; index += 1)
    if (mask[index]) indices.push(index);
  return indices;
}

export function groupNames(
  geometry: Geometry,
  level: GroupLevel,
): readonly string[] {
  return Object.keys(geometry[KEYS[level]]);
}

/** Add or replace one named subset, from a mask or a list of indices. */
export function setGroup(
  geometry: Geometry,
  level: GroupLevel,
  name: string,
  members: Uint8Array | readonly number[],
): Geometry {
  const count = levelCount(geometry, level);
  let mask: Uint8Array;
  if (members instanceof Uint8Array) {
    if (members.length !== count)
      geometryError(
        "group-length",
        `${name} covers ${members.length} of ${count} elements`,
      );
    mask = members;
  } else {
    mask = new Uint8Array(count);
    for (const member of members) {
      if (!Number.isInteger(member) || member < 0 || member >= count)
        geometryError("group-indices", `${name} references element ${member}`);
      mask[member] = 1;
    }
  }
  const groups = { ...geometry[KEYS[level]], [name]: mask };
  return createGeometry({
    pointCount: geometry.pointCount,
    point: geometry.point,
    vertex: geometry.vertex,
    primitive: geometry.primitive,
    detail: geometry.detail,
    topology: geometry.topology,
    pointGroups: level === "point" ? groups : geometry.pointGroups,
    primitiveGroups: level === "primitive" ? groups : geometry.primitiveGroups,
  });
}

export function removeGroup(
  geometry: Geometry,
  level: GroupLevel,
  name: string,
): Geometry {
  if (groupMask(geometry, level, name) === undefined) return geometry;
  const groups: Record<string, Uint8Array> = { ...geometry[KEYS[level]] };
  delete groups[name];
  return createGeometry({
    pointCount: geometry.pointCount,
    point: geometry.point,
    vertex: geometry.vertex,
    primitive: geometry.primitive,
    detail: geometry.detail,
    topology: geometry.topology,
    pointGroups: level === "point" ? groups : geometry.pointGroups,
    primitiveGroups: level === "primitive" ? groups : geometry.primitiveGroups,
  });
}
