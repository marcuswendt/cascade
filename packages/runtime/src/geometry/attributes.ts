import {
  attributeArray,
  attributeArrayFrom,
  createGeometry,
  isStringAttribute,
  levelCount,
  POSITION_ATTRIBUTE,
  type AnyAttribute,
  type Attribute,
  type AttributeLevel,
  type AttributeSet,
  type AttributeStorage,
  type DetailValue,
  type ElementLevel,
  type Geometry,
  type StringAttribute,
} from "@cascade/contracts";

/**
 * Attribute reads and writes. Every write returns a new `Geometry` and shares
 * the arrays it did not touch, which is the whole reason the format is
 * struct-of-arrays: with array-of-structs there is no granularity to share at.
 *
 * Node code should stay on this surface rather than reaching into an
 * attribute's `data`, because nothing in the language stops a write into a
 * shared array and everything downstream would then see it. See the immutability
 * note at the top of `packages/contracts/src/geometry.ts`.
 */

export function geometryError(code: string, message: string): never {
  throw new TypeError(`geometry/${code}: ${message}`);
}

/** The attribute set at an element level. */
export function attributeSet(
  geometry: Geometry,
  level: ElementLevel,
): AttributeSet {
  return geometry[level];
}

export function getAttribute(
  geometry: Geometry,
  level: ElementLevel,
  name: string,
): AnyAttribute | undefined {
  return geometry[level][name];
}

export function hasAttribute(
  geometry: Geometry,
  level: ElementLevel,
  name: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(geometry[level], name);
}

/** Names at a level, in insertion order. */
export function attributeNames(
  geometry: Geometry,
  level: ElementLevel,
): readonly string[] {
  return Object.keys(geometry[level]);
}

export function requireAttribute(
  geometry: Geometry,
  level: ElementLevel,
  name: string,
): AnyAttribute {
  const attribute = geometry[level][name];
  if (attribute === undefined)
    geometryError("missing-attribute", `${level}.${name} is not present`);
  return attribute;
}

/** A numeric attribute when present, with consumer-specific arity validation. */
export function numericAttribute(
  attribute: AnyAttribute | undefined,
  path: string,
  sizes?: readonly number[],
): Attribute | undefined {
  if (attribute === undefined) return undefined;
  if (isStringAttribute(attribute))
    geometryError("attribute-storage", `${path} must be numeric`);
  if (sizes !== undefined && !sizes.includes(attribute.size))
    geometryError(
      "attribute-size",
      `${path} has size ${attribute.size}; expected ${sizes.join(" or ")}`,
    );
  return attribute;
}

/** One component of one element. */
export function readComponent(
  attribute: Attribute,
  index: number,
  component = 0,
): number {
  return attribute.data[index * attribute.size + component];
}

/** Every component of one element, as a plain array. */
export function readElement(attribute: Attribute, index: number): number[] {
  const values = new Array<number>(attribute.size);
  for (let component = 0; component < attribute.size; component += 1)
    values[component] = attribute.data[index * attribute.size + component];
  return values;
}

/** One element of a string attribute. Out-of-table indices read as empty. */
export function readString(attribute: StringAttribute, index: number): string {
  const slot = attribute.data[index];
  return slot < 0 ? "" : (attribute.table[slot] ?? "");
}

/** A whole element without knowing which kind of attribute it is. */
export function readAttribute(
  attribute: AnyAttribute,
  index: number,
): number | number[] | string {
  if (isStringAttribute(attribute)) return readString(attribute, index);
  return attribute.size === 1
    ? readComponent(attribute, index)
    : readElement(attribute, index);
}

/** Declared position width: 2 or 3. */
export function positionSize(geometry: Geometry): number {
  return (geometry.point[POSITION_ATTRIBUTE] as Attribute).size;
}

export function positionAttribute(geometry: Geometry): Attribute {
  return geometry.point[POSITION_ATTRIBUTE] as Attribute;
}

export function getPosition(geometry: Geometry, index: number): number[] {
  return readElement(positionAttribute(geometry), index);
}

/** A zeroed numeric attribute for `count` elements. */
export function createAttribute(
  count: number,
  size: number,
  storage: AttributeStorage = "f64",
  fill?: readonly number[] | number,
): Attribute {
  const data = attributeArray(storage, size * count);
  if (fill !== undefined) {
    const values = typeof fill === "number" ? [fill] : fill;
    for (let index = 0; index < count; index += 1)
      for (let component = 0; component < size; component += 1)
        data[index * size + component] =
          values[component % Math.max(values.length, 1)] ?? 0;
  }
  return { storage, size, data };
}

/** A string attribute from per-element strings, tabled and deduplicated. */
export function createStringAttribute(
  values: readonly string[],
): StringAttribute {
  const table: string[] = [];
  const slots = new Map<string, number>();
  const data = new Int32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    let slot = slots.get(value);
    if (slot === undefined) {
      slot = table.length;
      table.push(value);
      slots.set(value, slot);
    }
    data[index] = slot;
  }
  return { storage: "string", size: 1, table, data };
}

/** Replace one level's attribute set, sharing every other array. */
export function withAttributeSet(
  geometry: Geometry,
  level: ElementLevel,
  set: AttributeSet,
): Geometry {
  return createGeometry({
    pointCount: geometry.pointCount,
    point: level === "point" ? set : geometry.point,
    vertex: level === "vertex" ? set : geometry.vertex,
    primitive: level === "primitive" ? set : geometry.primitive,
    detail: geometry.detail,
    topology: geometry.topology,
    pointGroups: geometry.pointGroups,
    primitiveGroups: geometry.primitiveGroups,
  });
}

/** Add or replace one attribute. Copy-on-write at attribute granularity. */
export function setAttribute(
  geometry: Geometry,
  level: ElementLevel,
  name: string,
  attribute: AnyAttribute,
): Geometry {
  return withAttributeSet(geometry, level, {
    ...geometry[level],
    [name]: attribute,
  });
}

export function removeAttribute(
  geometry: Geometry,
  level: ElementLevel,
  name: string,
): Geometry {
  if (level === "point" && name === POSITION_ATTRIBUTE)
    geometryError("remove-position", "point.P cannot be removed");
  if (!hasAttribute(geometry, level, name)) return geometry;
  const set: Record<string, AnyAttribute> = { ...geometry[level] };
  delete set[name];
  return withAttributeSet(geometry, level, set);
}

/** Replace the detail record, sharing every array. */
export function setDetail(
  geometry: Geometry,
  name: string,
  value: DetailValue,
): Geometry {
  return createGeometry({
    pointCount: geometry.pointCount,
    point: geometry.point,
    vertex: geometry.vertex,
    primitive: geometry.primitive,
    detail: { ...geometry.detail, [name]: value },
    topology: geometry.topology,
    pointGroups: geometry.pointGroups,
    primitiveGroups: geometry.primitiveGroups,
  });
}

/** Drop one detail value, sharing every array. */
export function removeDetail(geometry: Geometry, name: string): Geometry {
  if (!Object.prototype.hasOwnProperty.call(geometry.detail, name))
    return geometry;
  const detail: Record<string, DetailValue> = { ...geometry.detail };
  delete detail[name];
  return createGeometry({
    pointCount: geometry.pointCount,
    point: geometry.point,
    vertex: geometry.vertex,
    primitive: geometry.primitive,
    detail,
    topology: geometry.topology,
    pointGroups: geometry.pointGroups,
    primitiveGroups: geometry.primitiveGroups,
  });
}

export interface AttributeCreateOptions {
  readonly level: AttributeLevel;
  readonly name: string;
  /** A constant for every element at the level, or the detail value. */
  readonly value: number | readonly number[] | string;
  /** Ignored for a string value; defaults to `f64`. */
  readonly storage?: AttributeStorage;
}

/**
 * The Attribute Create operation: one named attribute at one level, filled with
 * a constant. This is the operation that makes the four-level model visible
 * rather than an implementation detail, and it is the one that stops the
 * `cloud-plots` class of bug, where every hand-rolled per-primitive value had
 * to be remembered by name in every operation that touched the geometry.
 */
export function attributeCreate(
  geometry: Geometry,
  options: AttributeCreateOptions,
): Geometry {
  const { level, name, value } = options;
  if (level === "detail")
    return setDetail(
      geometry,
      name,
      typeof value === "number" || typeof value === "string"
        ? value
        : [...value],
    );
  const count = levelCount(geometry, level);
  if (typeof value === "string")
    return setAttribute(
      geometry,
      level,
      name,
      createStringAttribute(new Array<string>(count).fill(value)),
    );
  const values = typeof value === "number" ? [value] : value;
  if (values.length === 0)
    geometryError("attribute-size", `${level}.${name} needs at least one component`);
  const storage = options.storage ?? "f64";
  const data = attributeArray(storage, values.length * count);
  for (let index = 0; index < count; index += 1)
    for (let component = 0; component < values.length; component += 1)
      data[index * values.length + component] = values[component];
  return setAttribute(geometry, level, name, {
    storage,
    size: values.length,
    data,
  });
}

/** A same-storage copy of an attribute's array, for a write-in-place pass. */
export function copyAttributeArray(attribute: Attribute) {
  return attributeArrayFrom(attribute.storage, attribute.data);
}
