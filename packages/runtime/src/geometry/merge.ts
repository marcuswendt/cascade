import {
  attributeArray,
  createGeometry,
  emptyGeometry,
  isStringAttribute,
  levelCount,
  type AnyAttribute,
  type Attribute,
  type AttributeSet,
  type AttributeStorage,
  type DetailSet,
  type DetailValue,
  type ElementLevel,
  type Geometry,
  type Groups,
} from "@cascade/contracts";

import { createStringAttribute, geometryError, readString } from "./attributes.js";

/**
 * Merge concatenates geometries and renumbers points, vertices and primitives.
 *
 * It is the operation that proves the format composes, so the attribute rule is
 * the interesting part: the result carries the *union* of the attribute names on
 * its inputs, and an attribute present on one side and absent on the other is
 * zero-filled over the range that lacked it rather than dropped. That is the
 * whole argument for a generic attribute table. The two live bugs in
 * `cloud-plots` are both an operation dropping an attribute it had never heard
 * of, and an operation that copies the whole set cannot make that mistake.
 *
 * Three conflicts have to be resolved rather than avoided:
 *
 * A differing component count widens to the largest and zero-fills the missing
 * components. This is how a 2-component `P` and a 3-component `P` merge into a
 * 3-component one with z = 0, which is the case that actually occurs.
 *
 * A differing storage widens to whichever holds both exactly, so an `i32`
 * meeting an `f32` becomes `f64` rather than silently losing large integers.
 *
 * A name that is a string attribute on one side and numeric on the other is an
 * error, because either coercion would be a guess.
 *
 * Detail is first-wins, so merging into a geometry keeps the document facts of
 * the first input. Houdini's Merge does the same and the alternative, last-wins,
 * makes the result depend on wiring order in a way nobody can see.
 */
export function mergeGeometry(...inputs: readonly Geometry[]): Geometry {
  return mergeGeometries(inputs);
}

export function mergeGeometries(inputs: readonly Geometry[]): Geometry {
  if (inputs.length === 0) return emptyGeometry(2);
  if (inputs.length === 1) return inputs[0];

  const pointCount = sum(inputs, (input) => input.pointCount);
  const vertexCount = sum(inputs, (input) => input.vertexCount);
  const primitiveCount = sum(inputs, (input) => input.primitiveCount);

  const vertexPoints = new Int32Array(vertexCount);
  const offsets = new Int32Array(primitiveCount + 1);
  const kinds = new Uint8Array(primitiveCount);
  const closed = new Uint8Array(primitiveCount);
  let pointBase = 0;
  let vertexBase = 0;
  let primitiveBase = 0;
  for (const input of inputs) {
    for (let vertex = 0; vertex < input.vertexCount; vertex += 1)
      vertexPoints[vertexBase + vertex] =
        input.topology.vertexPoints[vertex] + pointBase;
    for (let primitive = 0; primitive < input.primitiveCount; primitive += 1) {
      offsets[primitiveBase + primitive] =
        input.topology.offsets[primitive] + vertexBase;
      kinds[primitiveBase + primitive] = input.topology.kinds[primitive];
      closed[primitiveBase + primitive] = input.topology.closed[primitive];
    }
    pointBase += input.pointCount;
    vertexBase += input.vertexCount;
    primitiveBase += input.primitiveCount;
  }
  offsets[primitiveCount] = vertexCount;

  const detail: Record<string, DetailValue> = {};
  for (const input of inputs)
    for (const [name, value] of Object.entries(input.detail as DetailSet))
      if (!Object.prototype.hasOwnProperty.call(detail, name))
        detail[name] = value;

  return createGeometry({
    pointCount,
    point: mergeLevel(inputs, "point"),
    vertex: mergeLevel(inputs, "vertex"),
    primitive: mergeLevel(inputs, "primitive"),
    detail,
    topology: { vertexPoints, offsets, kinds, closed },
    pointGroups: mergeGroups(inputs, "point"),
    primitiveGroups: mergeGroups(inputs, "primitive"),
  });
}

function sum(
  inputs: readonly Geometry[],
  read: (input: Geometry) => number,
): number {
  let total = 0;
  for (const input of inputs) total += read(input);
  return total;
}

const STORAGE_RANK: Record<AttributeStorage, number> = {
  u8: 0,
  i32: 1,
  f32: 2,
  f64: 3,
};

/** The narrowest storage that holds both operands' values exactly. */
export function widerStorage(
  a: AttributeStorage,
  b: AttributeStorage,
): AttributeStorage {
  if (a === b) return a;
  if (a === "f64" || b === "f64") return "f64";
  // f32 has 24 bits of mantissa, so it cannot hold every i32 exactly.
  if ((a === "i32" && b === "f32") || (a === "f32" && b === "i32")) return "f64";
  return STORAGE_RANK[a] > STORAGE_RANK[b] ? a : b;
}

function mergeLevel(
  inputs: readonly Geometry[],
  level: ElementLevel,
): AttributeSet {
  const names: string[] = [];
  for (const input of inputs)
    for (const name of Object.keys(input[level]))
      if (!names.includes(name)) names.push(name);
  const total = sum(inputs, (input) => levelCount(input, level));
  const result: Record<string, AnyAttribute> = {};
  for (const name of names) {
    const present = inputs
      .map((input) => input[level][name])
      .filter((attribute): attribute is AnyAttribute => attribute !== undefined);
    const strings = present.filter(isStringAttribute).length;
    if (strings !== 0 && strings !== present.length)
      geometryError(
        "attribute-conflict",
        `${level}.${name} is a string attribute on one input and numeric on another`,
      );
    result[name] =
      strings === present.length
        ? mergeStringAttribute(inputs, level, name, total)
        : mergeNumericAttribute(inputs, level, name, total);
  }
  return result;
}

function mergeNumericAttribute(
  inputs: readonly Geometry[],
  level: ElementLevel,
  name: string,
  total: number,
): Attribute {
  let size = 1;
  let storage: AttributeStorage | undefined;
  for (const input of inputs) {
    const attribute = input[level][name];
    if (attribute === undefined || isStringAttribute(attribute)) continue;
    size = Math.max(size, attribute.size);
    storage = storage === undefined ? attribute.storage : widerStorage(storage, attribute.storage);
  }
  const data = attributeArray(storage ?? "f64", size * total);
  let base = 0;
  for (const input of inputs) {
    const count = levelCount(input, level);
    const attribute = input[level][name];
    if (attribute !== undefined && !isStringAttribute(attribute))
      for (let index = 0; index < count; index += 1)
        for (let component = 0; component < attribute.size; component += 1)
          data[(base + index) * size + component] =
            attribute.data[index * attribute.size + component];
    base += count;
  }
  return { storage: storage ?? "f64", size, data };
}

function mergeStringAttribute(
  inputs: readonly Geometry[],
  level: ElementLevel,
  name: string,
  total: number,
) {
  const values = new Array<string>(total).fill("");
  let base = 0;
  for (const input of inputs) {
    const count = levelCount(input, level);
    const attribute = input[level][name];
    if (attribute !== undefined && isStringAttribute(attribute))
      for (let index = 0; index < count; index += 1)
        values[base + index] = readString(attribute, index);
    base += count;
  }
  return createStringAttribute(values);
}

function mergeGroups(
  inputs: readonly Geometry[],
  level: "point" | "primitive",
): Groups {
  const key = level === "point" ? "pointGroups" : "primitiveGroups";
  const names: string[] = [];
  for (const input of inputs)
    for (const name of Object.keys(input[key]))
      if (!names.includes(name)) names.push(name);
  const total = sum(inputs, (input) => levelCount(input, level));
  const result: Record<string, Uint8Array> = {};
  for (const name of names) {
    const mask = new Uint8Array(total);
    let base = 0;
    for (const input of inputs) {
      const count = levelCount(input, level);
      const source = input[key][name];
      if (source !== undefined)
        for (let index = 0; index < count; index += 1)
          mask[base + index] = source[index];
      base += count;
    }
    result[name] = mask;
  }
  return result;
}
