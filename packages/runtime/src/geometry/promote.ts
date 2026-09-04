import {
  attributeArray,
  isStringAttribute,
  levelCount,
  POSITION_ATTRIBUTE,
  type AnyAttribute,
  type Attribute,
  type AttributeLevel,
  type DetailValue,
  type ElementLevel,
  type Geometry,
} from "@cascade/contracts";

import {
  createStringAttribute,
  geometryError,
  readString,
  removeAttribute,
  removeDetail,
  setAttribute,
  setDetail,
} from "./attributes.js";

/**
 * Moving an attribute between levels, and copying one between geometries.
 *
 * The reduction is always explicit. Houdini has per-node defaults here and I do
 * not trust anyone's memory of what they are; a silent one would be the wrong
 * thing to inherit anyway, because "the mean of the tag" and "the first tag"
 * are different answers and only the author knows which was meant.
 */
export type AttributeReduction =
  | "first"
  | "last"
  | "mean"
  | "min"
  | "max"
  | "sum";

export interface PromoteOptions {
  readonly name: string;
  readonly from: AttributeLevel;
  readonly to: AttributeLevel;
  /** Required, including for one-to-one moves, so a change of mind is visible. */
  readonly reduction: AttributeReduction;
  /** Rename on the way, when the source name should survive. */
  readonly as?: string;
  /** Keep the source attribute in place. Off by default, as Houdini has it. */
  readonly keepSource?: boolean;
}

/**
 * Which source elements feed each target element. This one table is the whole
 * operation: every level pair is a fan-in or a fan-out over the CSR topology,
 * and once the table exists the reduction is the same three lines for all of
 * them.
 */
function sourceIndices(
  geometry: Geometry,
  from: AttributeLevel,
  to: AttributeLevel,
): number[][] {
  const { vertexPoints, offsets } = geometry.topology;
  const targets = levelCount(geometry, to);
  const table: number[][] = Array.from({ length: targets }, () => []);
  if (from === to) {
    for (let index = 0; index < targets; index += 1) table[index].push(index);
    return table;
  }
  if (from === "detail") {
    for (let index = 0; index < targets; index += 1) table[index].push(0);
    return table;
  }
  if (to === "detail") {
    const sources = levelCount(geometry, from);
    for (let index = 0; index < sources; index += 1) table[0].push(index);
    return table;
  }
  if (from === "point" && to === "vertex") {
    for (let vertex = 0; vertex < targets; vertex += 1)
      table[vertex].push(vertexPoints[vertex]);
    return table;
  }
  if (from === "vertex" && to === "point") {
    for (let vertex = 0; vertex < geometry.vertexCount; vertex += 1)
      table[vertexPoints[vertex]].push(vertex);
    return table;
  }
  if (from === "vertex" && to === "primitive") {
    for (let primitive = 0; primitive < targets; primitive += 1)
      for (let vertex = offsets[primitive]; vertex < offsets[primitive + 1]; vertex += 1)
        table[primitive].push(vertex);
    return table;
  }
  if (from === "primitive" && to === "vertex") {
    for (let primitive = 0; primitive < geometry.primitiveCount; primitive += 1)
      for (let vertex = offsets[primitive]; vertex < offsets[primitive + 1]; vertex += 1)
        table[vertex].push(primitive);
    return table;
  }
  if (from === "point" && to === "primitive") {
    for (let primitive = 0; primitive < targets; primitive += 1)
      for (let vertex = offsets[primitive]; vertex < offsets[primitive + 1]; vertex += 1)
        table[primitive].push(vertexPoints[vertex]);
    return table;
  }
  // primitive to point: a point may belong to several primitives, or to none.
  for (let primitive = 0; primitive < geometry.primitiveCount; primitive += 1)
    for (let vertex = offsets[primitive]; vertex < offsets[primitive + 1]; vertex += 1)
      table[vertexPoints[vertex]].push(primitive);
  return table;
}

function reduce(
  values: readonly number[],
  reduction: AttributeReduction,
): number {
  if (values.length === 0) return 0;
  if (reduction === "first") return values[0];
  if (reduction === "last") return values[values.length - 1];
  if (reduction === "min") return Math.min(...values);
  if (reduction === "max") return Math.max(...values);
  let total = 0;
  for (const value of values) total += value;
  return reduction === "sum" ? total : total / values.length;
}

function detailAsAttribute(
  value: DetailValue,
  count: number,
): AnyAttribute {
  if (typeof value === "string")
    return createStringAttribute(new Array<string>(count).fill(value));
  const values = typeof value === "number" ? [value] : value;
  const size = Math.max(values.length, 1);
  const data = attributeArray("f64", size * count);
  for (let index = 0; index < count; index += 1)
    for (let component = 0; component < size; component += 1)
      data[index * size + component] = values[component] ?? 0;
  return { storage: "f64", size, data };
}

/**
 * Move an attribute from one level to another. Fan-in reduces with the stated
 * reduction; fan-out copies. A string attribute only accepts `first` or `last`,
 * because the mean of a tag is not a tag.
 */
export function promoteAttribute(
  geometry: Geometry,
  options: PromoteOptions,
): Geometry {
  const { name, from, to, reduction } = options;
  const target = options.as ?? name;
  if (from === "point" && name === POSITION_ATTRIBUTE && !options.keepSource)
    geometryError("remove-position", "point.P cannot be promoted away; pass keepSource");
  const source: AnyAttribute | DetailValue | undefined =
    from === "detail" ? geometry.detail[name] : geometry[from][name];
  if (source === undefined)
    geometryError("missing-attribute", `${from}.${name} is not present`);

  const table = sourceIndices(geometry, from, to);

  if (to === "detail") {
    const value = detailFrom(source, table[0] ?? [], reduction);
    const promoted = setDetail(geometry, target, value);
    return from === "detail" || options.keepSource
      ? promoted
      : removeAttribute(promoted, from as ElementLevel, name);
  }

  const attribute =
    from === "detail"
      ? detailAsAttribute(source as DetailValue, levelCount(geometry, to))
      : gather(source as AnyAttribute, table, reduction);
  const promoted = setAttribute(geometry, to as ElementLevel, target, attribute);
  if (from === "detail")
    return options.keepSource ? promoted : removeDetail(promoted, name);
  return options.keepSource
    ? promoted
    : removeAttribute(promoted, from as ElementLevel, name);
}

function detailFrom(
  source: AnyAttribute | DetailValue,
  indices: readonly number[],
  reduction: AttributeReduction,
): DetailValue {
  if (typeof source === "number" || typeof source === "string") return source;
  if (Array.isArray(source)) return [...(source as readonly number[])];
  const attribute = source as AnyAttribute;
  if (isStringAttribute(attribute)) {
    if (reduction !== "first" && reduction !== "last")
      geometryError(
        "string-reduction",
        "a string attribute reduces only with first or last",
      );
    if (indices.length === 0) return "";
    const index = reduction === "first" ? indices[0] : indices[indices.length - 1];
    return readString(attribute, index);
  }
  const values: number[] = [];
  for (let component = 0; component < attribute.size; component += 1) {
    const column = indices.map(
      (index) => attribute.data[index * attribute.size + component],
    );
    values.push(reduce(column, reduction));
  }
  return attribute.size === 1 ? values[0] : values;
}

function gather(
  attribute: AnyAttribute,
  table: readonly number[][],
  reduction: AttributeReduction,
): AnyAttribute {
  if (isStringAttribute(attribute)) {
    if (reduction !== "first" && reduction !== "last")
      geometryError(
        "string-reduction",
        "a string attribute reduces only with first or last",
      );
    const values = table.map((indices) => {
      if (indices.length === 0) return "";
      const index =
        reduction === "first" ? indices[0] : indices[indices.length - 1];
      return readString(attribute, index);
    });
    return createStringAttribute(values);
  }
  const numeric = attribute as Attribute;
  const size = numeric.size;
  const data = attributeArray(
    reduction === "mean" && numeric.storage !== "f64" ? "f64" : numeric.storage,
    size * table.length,
  );
  for (let target = 0; target < table.length; target += 1) {
    const indices = table[target];
    for (let component = 0; component < size; component += 1) {
      const column = indices.map(
        (index) => numeric.data[index * size + component],
      );
      data[target * size + component] = reduce(column, reduction);
    }
  }
  return {
    storage: reduction === "mean" && numeric.storage !== "f64" ? "f64" : numeric.storage,
    size,
    data,
  };
}

export interface CopyAttributeOptions {
  readonly name: string;
  readonly level: ElementLevel;
  /** Name on the target, when it differs. */
  readonly as?: string;
}

/**
 * Copy one attribute from another geometry, by element index. Index copying is
 * the honest v1: nearest-point copying needs a spatial hash and is a different
 * operation with a different failure mode.
 *
 * When the target has more elements than the source, the surplus is zero-filled
 * rather than wrapped or clamped, because both of those invent values that look
 * like data.
 */
export function copyAttribute(
  target: Geometry,
  source: Geometry,
  options: CopyAttributeOptions,
): Geometry {
  const { name, level } = options;
  const attribute = source[level][name];
  if (attribute === undefined)
    geometryError("missing-attribute", `${level}.${name} is not present on the source`);
  const count = levelCount(target, level);
  const available = Math.min(count, levelCount(source, level));
  if (isStringAttribute(attribute)) {
    const values = new Array<string>(count).fill("");
    for (let index = 0; index < available; index += 1)
      values[index] = readString(attribute, index);
    return setAttribute(target, level, options.as ?? name, createStringAttribute(values));
  }
  const size = attribute.size;
  const data = attributeArray(attribute.storage, size * count);
  for (let index = 0; index < available; index += 1)
    for (let component = 0; component < size; component += 1)
      data[index * size + component] = attribute.data[index * size + component];
  return setAttribute(target, level, options.as ?? name, {
    storage: attribute.storage,
    size,
    data,
  });
}
