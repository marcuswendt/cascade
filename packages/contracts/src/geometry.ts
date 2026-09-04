/**
 * The `geometry` core type: one attribute table with four addressing levels.
 *
 * Houdini's model without the pointers. A geometry holds points, vertices,
 * primitives and one detail record, and every named attribute lives at one of
 * those levels as a flat parallel array. The value of the type is the number of
 * operations that understand it, so it is deliberately one type rather than a
 * family of them: a point cloud is a geometry whose primitive count is zero,
 * and a bundle of strokes is a geometry whose points are covered by primitives.
 * There is nothing to convert between the two.
 *
 * Three forms live here:
 *
 * `Geometry` is the in-memory form over typed arrays. Struct-of-arrays rather
 * than array-of-structs, because the runtime's clone path copies nested plain
 * arrays element by element and passes typed arrays through by reference, and
 * because copy-on-write needs a granularity to share at.
 *
 * `GeometryJson` is the plain-array interchange form, for `.cascade` document
 * literals and the Python bridge. Verbose on purpose and JSON-safe. It is
 * lossless in both directions, including f64 precision, because JSON numbers
 * are doubles and JavaScript prints the shortest round-trippable form.
 *
 * `GeometryFileRef` is the out-of-band form, following `ImageRef`: a path plus
 * the metadata a consumer needs before it opens the file. It exists from day
 * one because it is already in production and undeclared, as the Python
 * stipple stage returns an `.npy` path on a `points`-typed port and the next
 * stage reads it back. Resolving a ref into a `Geometry` needs host IO and so
 * belongs to a host capability, exactly as reading `ImageRef` pixels does;
 * neither contracts nor the runtime does it.
 *
 * ## Immutability
 *
 * A `Geometry` is frozen and every operation returns a new one, sharing the
 * typed arrays it did not touch. `freezeGeometry` freezes the plain objects
 * that hold the structure, and it cannot freeze the arrays themselves:
 * `Object.freeze` on a non-empty typed array throws, because a typed array's
 * elements are not configurable properties.
 *
 * So the copy-on-write guarantee is a convention this module keeps and the
 * language cannot enforce, and there is one live interaction worth knowing
 * about. `cloneValue` in `packages/runtime/src/runtime.ts`, the deep clone
 * behind `snapshot`, returns any non-array object whose prototype is neither
 * `Object.prototype` nor `null` by reference, uncloned and unfrozen. A
 * `Geometry` is a plain object, so a snapshot of one is a fresh outer graph
 * whose typed arrays are still the originals, shared with the value the node
 * emitted. That makes emitting a geometry very cheap and it means the
 * "inspection and output values are immutable snapshots" guarantee in
 * ARCHITECTURE.md holds for the structure and not for the sample data. Nothing
 * here relies on the runtime changing: operations never write into an input's
 * array, and node code should reach for the read helpers and the builder rather
 * than an attribute's `data` directly. Do not write into an array you did not
 * allocate.
 */

/** Position attribute name, by convention rather than by privilege. */
export const POSITION_ATTRIBUTE = "P";

export const ATTRIBUTE_LEVELS = [
  "point",
  "vertex",
  "primitive",
  "detail",
] as const;

/** Where an attribute lives. `detail` holds one value per name, not an array. */
export type AttributeLevel = (typeof ATTRIBUTE_LEVELS)[number];

/** The three levels that are indexed by element number. */
export type ElementLevel = "point" | "vertex" | "primitive";

/**
 * How an attribute's values are stored. `f64` is the default for positions,
 * because the existing Python bridge already writes points as float64 `.npy`
 * and emits full-precision doubles in JSON, while it explicitly casts raster
 * fields to float32. Narrowing positions to f32 would save 1.4 MB on a
 * 170,000-vertex cook and add a lossy step to a boundary that is lossless
 * today.
 */
export type AttributeStorage = "f32" | "f64" | "i32" | "u8";

export type AttributeArray =
  Float64Array | Float32Array | Int32Array | Uint8Array;

/**
 * One numeric attribute: a component count and a flat parallel array of
 * `size * elementCount` values, indexed by element number at its level.
 */
export interface Attribute {
  readonly storage: AttributeStorage;
  /** Components per element. `P` is 2 or 3, `Cd` is 4, `width` is 1. */
  readonly size: number;
  readonly data: AttributeArray;
}

/**
 * String attributes are a separate shape because a typed array cannot hold
 * strings, and because Houdini's string attributes are indices into a table
 * rather than per-element strings. The table is usually tiny: `cloud-plots`
 * carries tags like `FORM_04` that repeat across a whole set.
 */
export interface StringAttribute {
  readonly storage: "string";
  readonly size: 1;
  readonly table: readonly string[];
  /** Index into `table`, or -1 for the empty string. */
  readonly data: Int32Array;
}

export type AnyAttribute = Attribute | StringAttribute;
export type AttributeSet = Readonly<Record<string, AnyAttribute>>;

/** A detail value. One per name, for bounds, a seed, a page size, a name. */
export type DetailValue = number | string | readonly number[];
export type DetailSet = Readonly<Record<string, DetailValue>>;

export const PRIMITIVE_KINDS = ["poly", "bezier", "mesh", "packed"] as const;

/**
 * Primitive kinds. A kind does not change what a primitive is made of: every
 * primitive is a run of vertices over the same point list. It selects **how
 * that run is interpolated**, which is why curves need no second geometry type
 * and no parallel container, and why an operation that only reads positions
 * keeps working when a curve arrives.
 *
 * Marcus, 2026-09-04, ruling on the plan's open question about curves:
 * *"No, we want curves + polylines; very similar but different
 * interpolations."*
 *
 * `poly` — the run is interpolated linearly. Vertex count is the point count of
 * the outline, and `closed` adds the segment from the last vertex back to the
 * first without repeating a vertex.
 *
 * `bezier` — the run is a chain of cubic Bézier segments in SVG's own order:
 * anchor, handle, handle, anchor, handle, handle, anchor, and so on. An open
 * primitive therefore has `3n + 1` vertices for `n` segments; a closed one has
 * `3n`, its final two handles belonging to the segment that returns to the
 * first anchor. This is the form a print or plotter pipeline actually wants,
 * and it is affine-invariant, so `Transform` and `CopyToPoints` are exactly
 * right on a curve without knowing it is one.
 *
 * `mesh` and `packed` are declared and unused, so that adding them later is a
 * new case in a switch rather than a change to the document format. The list is
 * deliberately open-ended rather than a closed pair: a volume is a primitive
 * kind in Houdini and will be one here, which is the direction the plan records.
 *
 * Operations that measure along a primitive (arc length, resampling) are
 * linear-only today and must refuse a `bezier` rather than read its handles as
 * vertices, which would produce a subtly wrong shape instead of an error.
 */
export type PrimitiveKind = (typeof PRIMITIVE_KINDS)[number];

/** Vertices per cubic Bézier segment after the first anchor. */
export const BEZIER_STRIDE = 3;

/**
 * Primitive topology, CSR-style: `vertexPoints` is the flat vertex-to-point
 * table and `offsets` slices it per primitive. Vertex `v` of primitive `i` is
 * `vertexPoints[offsets[i] + v]`, and `offsets` has `primitiveCount + 1`
 * entries so the last primitive's extent needs no special case. A geometry
 * with no primitives still has a one-entry `offsets` of `[0]`.
 *
 * Keeping vertices as their own addressable level is what makes a per-corner
 * value possible at all: two primitives meeting at a corner share one point and
 * have two vertices, so a discontinuity across the seam is a vertex attribute
 * while the shared position stays a point attribute.
 */
export interface Topology {
  readonly vertexPoints: Int32Array;
  readonly offsets: Int32Array;
  /** Index into `PRIMITIVE_KINDS`, one per primitive. */
  readonly kinds: Uint8Array;
  /**
   * 1 when the primitive's last vertex connects back to its first. Separate
   * from `kinds` because open and closed polygons are the same kind of thing
   * and every 2D operation cares about the difference.
   */
  readonly closed: Uint8Array;
}

/**
 * A named subset at one level, as a bitmask rather than an index list because
 * membership is tested far more often than it is enumerated.
 */
export type Groups = Readonly<Record<string, Uint8Array>>;

export interface Geometry {
  readonly kind: "geometry";
  readonly pointCount: number;
  readonly vertexCount: number;
  readonly primitiveCount: number;
  readonly topology: Topology;
  /** Always contains `P` with a `size` of 2 or 3. */
  readonly point: AttributeSet;
  readonly vertex: AttributeSet;
  readonly primitive: AttributeSet;
  readonly detail: DetailSet;
  readonly pointGroups: Groups;
  readonly primitiveGroups: Groups;
}

/** The plain-array attribute forms used by `GeometryJson`. */
export interface NumericAttributeJson {
  readonly storage: AttributeStorage;
  readonly size: number;
  readonly data: readonly number[];
}
export interface StringAttributeJson {
  readonly storage: "string";
  readonly size?: 1;
  readonly table: readonly string[];
  readonly data: readonly number[];
}
export type AttributeJson = NumericAttributeJson | StringAttributeJson;
export type AttributeSetJson = Readonly<Record<string, AttributeJson>>;

export interface TopologyJson {
  readonly vertexPoints: readonly number[];
  readonly offsets: readonly number[];
  /** Omitted when every primitive is a `poly`. */
  readonly kinds?: readonly number[];
  /** Omitted when no primitive is closed. */
  readonly closed?: readonly number[];
}

/**
 * The wire and document form. Plain arrays, JSON-safe, lossless. Verbose by
 * design: a `.cascade` literal is authored by hand or by a small generator, and
 * human-readable beats compact at that size. Groups are index lists here rather
 * than masks, because a mask spelled out as JSON is mostly zeroes. Bulk
 * geometry belongs in a `GeometryFileRef` instead.
 */
export interface GeometryJson {
  readonly kind: "geometry";
  /** Required, because a geometry may carry points that no attribute sizes. */
  readonly pointCount: number;
  readonly point?: AttributeSetJson;
  readonly vertex?: AttributeSetJson;
  readonly primitive?: AttributeSetJson;
  readonly detail?: Readonly<Record<string, DetailValue>>;
  readonly topology?: TopologyJson;
  readonly pointGroups?: Readonly<Record<string, readonly number[]>>;
  readonly primitiveGroups?: Readonly<Record<string, readonly number[]>>;
}

/**
 * An out-of-band geometry, referenced the way `ImageRef` references pixels.
 * `attribute` describes what a bare array file carries, and it is never
 * inferred: a three-component `.npy` means `(x, y, radius)` in `cloud-plots`
 * and would mean `(x, y, z)` under a 3D reading, and nothing in the file
 * distinguishes them.
 */
export interface GeometryFileRef {
  readonly kind: "geometry-file";
  readonly path: string;
  readonly format: "npy" | "json";
  readonly attribute?: {
    readonly level: ElementLevel;
    readonly name: string;
    readonly size: number;
    readonly storage: AttributeStorage;
  };
  readonly pointCount?: number;
  readonly primitiveCount?: number;
}

/** What a `geometry`-typed default, document literal, or bridge value may be. */
export type GeometrySerialized = GeometryJson | GeometryFileRef;

const STORAGES = new Set<string>(["f32", "f64", "i32", "u8"]);
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_NAMES = new Set(["__proto__", "prototype", "constructor"]);
function fail(code: string, message: string): never {
  throw new TypeError(`geometry/${code}: ${message}`);
}

function emptyTopology(): Topology {
  return {
    vertexPoints: new Int32Array(0),
    offsets: Int32Array.of(0),
    kinds: new Uint8Array(0),
    closed: new Uint8Array(0),
  };
}

function arrayType(storage: AttributeStorage) {
  if (storage === "f64") return Float64Array;
  if (storage === "f32") return Float32Array;
  if (storage === "i32") return Int32Array;
  return Uint8Array;
}

function validStoredNumber(storage: AttributeStorage, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (storage === "f64" || storage === "f32") return true;
  if (!Number.isInteger(value)) return false;
  return storage === "u8"
    ? value >= 0 && value <= 255
    : value >= -2147483648 && value <= 2147483647;
}

/** Allocate a zeroed array for a storage kind. */
export function attributeArray(
  storage: AttributeStorage,
  length: number,
): AttributeArray {
  if (!Number.isSafeInteger(length) || length < 0)
    fail("attribute-length", "attribute array length must be a non-negative safe integer");
  if (storage === "f64") return new Float64Array(length);
  if (storage === "f32") return new Float32Array(length);
  if (storage === "i32") return new Int32Array(length);
  return new Uint8Array(length);
}

/** Copy values into a fresh array of a storage kind. */
export function attributeArrayFrom(
  storage: AttributeStorage,
  values: ArrayLike<number>,
): AttributeArray {
  const array = attributeArray(storage, values.length);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (!validStoredNumber(storage, value))
      fail(
        "attribute-value",
        `${String(value)} cannot be represented as ${storage}`,
      );
    array[index] = value;
    if (!Number.isFinite(array[index]))
      fail("attribute-value", `${String(value)} overflows ${storage}`);
  }
  return array;
}

/** A plain-number copy of an attribute array, for the interchange form. */
export function attributeNumbers(data: AttributeArray): number[] {
  const result = new Array<number>(data.length);
  for (let index = 0; index < data.length; index += 1)
    result[index] = data[index]!;
  return result;
}

export function isStringAttribute(
  attribute: AnyAttribute,
): attribute is StringAttribute {
  return attribute.storage === "string";
}

/** How many elements an attribute covers, from its own arrays alone. */
export function attributeElementCount(attribute: AnyAttribute): number {
  return isStringAttribute(attribute)
    ? attribute.data.length
    : attribute.data.length / attribute.size;
}

/** The number of elements at a level, or 1 for `detail`. */
export function levelCount(geometry: Geometry, level: AttributeLevel): number {
  if (level === "point") return geometry.pointCount;
  if (level === "vertex") return geometry.vertexCount;
  if (level === "primitive") return geometry.primitiveCount;
  return 1;
}

function checkName(name: string, path: string): void {
  if (!NAME.test(name) || RESERVED_NAMES.has(name))
    fail("invalid-name", `${path}.${name} is not a valid attribute name`);
}

function checkAttributeSet(
  set: AttributeSet,
  count: number,
  level: ElementLevel,
): void {
  for (const [name, attribute] of Object.entries(set)) {
    checkName(name, level);
    if (isStringAttribute(attribute)) {
      if (!(attribute.data instanceof Int32Array))
        fail("attribute-storage", `${level}.${name} string indices must be Int32Array`);
      if (attribute.size !== 1)
        fail("string-size", `${level}.${name} string attributes have size 1`);
      if (attribute.data.length !== count)
        fail(
          "attribute-length",
          `${level}.${name} has ${attribute.data.length} entries for ${count} elements`,
        );
      for (const index of attribute.data)
        if (index < -1 || index >= attribute.table.length)
          fail(
            "string-index",
            `${level}.${name} references table entry ${index}`,
          );
      if (!Array.isArray(attribute.table) || attribute.table.some((item) => typeof item !== "string"))
        fail("string-table", `${level}.${name} needs a string table`);
      continue;
    }
    if (!Number.isInteger(attribute.size) || attribute.size < 1)
      fail("attribute-size", `${level}.${name} needs a size of at least 1`);
    if (!STORAGES.has(attribute.storage))
      fail(
        "attribute-storage",
        `${level}.${name} has an unknown storage ${String(attribute.storage)}`,
      );
    if (!(attribute.data instanceof arrayType(attribute.storage)))
      fail(
        "attribute-storage",
        `${level}.${name} declares ${attribute.storage} but uses ${attribute.data?.constructor?.name ?? "unknown storage"}`,
      );
    if (attribute.data.length !== attribute.size * count)
      fail(
        "attribute-length",
        `${level}.${name} has ${attribute.data.length} values for ${count} elements of size ${attribute.size}`,
      );
    for (const value of attribute.data)
      if (!Number.isFinite(value))
        fail("non-finite", `${level}.${name} contains ${String(value)}`);
  }
}

function checkGroups(groups: Groups, count: number, level: string): void {
  for (const [name, mask] of Object.entries(groups)) {
    checkName(name, level);
    if (mask.length !== count)
      fail(
        "group-length",
        `${level}.${name} covers ${mask.length} of ${count} elements`,
      );
    for (const member of mask)
      if (member !== 0 && member !== 1)
        fail("group-mask", `${level}.${name} contains ${member}; masks contain only 0 or 1`);
  }
}

export interface GeometryParts {
  readonly pointCount: number;
  readonly point: AttributeSet;
  readonly vertex?: AttributeSet;
  readonly primitive?: AttributeSet;
  readonly detail?: DetailSet;
  readonly topology?: Topology;
  readonly pointGroups?: Groups;
  readonly primitiveGroups?: Groups;
}

/**
 * The validating constructor. Every invariant the operations rely on is checked
 * here once, so that no operation has to defend against a malformed input, and
 * the result is frozen.
 *
 * This is the one piece of logic contracts owns for this type, because the
 * codec below has to build a `Geometry` and a type whose invariants are
 * enforced somewhere else is a type whose invariants are optional.
 */
export function createGeometry(parts: GeometryParts): Geometry {
  const pointCount = parts.pointCount;
  if (!Number.isSafeInteger(pointCount) || pointCount < 0)
    fail("point-count", "pointCount must be a non-negative safe integer");
  const topology = parts.topology ?? emptyTopology();
  if (
    !(topology.vertexPoints instanceof Int32Array) ||
    !(topology.offsets instanceof Int32Array) ||
    !(topology.kinds instanceof Uint8Array) ||
    !(topology.closed instanceof Uint8Array)
  )
    fail("topology-storage", "topology uses Int32Array indices and Uint8Array flags");
  const primitiveCount = topology.offsets.length - 1;
  if (primitiveCount < 0)
    fail("offsets", "topology.offsets needs primitiveCount + 1 entries");
  if (topology.offsets[0] !== 0)
    fail("offsets", "topology.offsets starts at 0");
  for (let index = 1; index <= primitiveCount; index += 1)
    if (topology.offsets[index]! < topology.offsets[index - 1]!)
      fail("offsets", "topology.offsets must not decrease");
  const vertexCount = topology.offsets[primitiveCount]!;
  if (vertexCount !== topology.vertexPoints.length)
    fail(
      "offsets",
      `topology.offsets ends at ${vertexCount} for ${topology.vertexPoints.length} vertices`,
    );
  if (
    topology.kinds.length !== primitiveCount ||
    topology.closed.length !== primitiveCount
  )
    fail(
      "topology-length",
      `topology.kinds and topology.closed need ${primitiveCount} entries`,
    );
  for (const point of topology.vertexPoints)
    if (point < 0 || point >= pointCount)
      fail("vertex-point", `vertex references point ${point}`);
  for (const kind of topology.kinds)
    if (kind >= PRIMITIVE_KINDS.length)
      fail("primitive-kind", `unknown primitive kind ${kind}`);
  for (const closed of topology.closed)
    if (closed !== 0 && closed !== 1)
      fail("closed-mask", `topology.closed contains ${closed}; flags contain only 0 or 1`);
  // A Bézier chain's vertex count is not free: the handles are vertices too, so
  // an arity mistake here is a malformed curve that every later operation would
  // read as a valid one.
  const bezier = PRIMITIVE_KINDS.indexOf("bezier");
  for (let index = 0; index < primitiveCount; index += 1) {
    if (topology.kinds[index] !== bezier) continue;
    const count = topology.offsets[index + 1]! - topology.offsets[index]!;
    const closed = topology.closed[index] === 1;
    const minimum = closed ? BEZIER_STRIDE : BEZIER_STRIDE + 1;
    if (count < minimum || (count - (closed ? 0 : 1)) % BEZIER_STRIDE !== 0)
      fail(
        "bezier-arity",
        `primitive ${index} has ${count} vertices, and a ${closed ? "closed" : "open"} bezier needs ${closed ? "3n" : "3n + 1"}`,
      );
  }

  const point = parts.point;
  const position = point[POSITION_ATTRIBUTE];
  if (position === undefined)
    fail("missing-position", "point.P is required on every geometry");
  if (isStringAttribute(position))
    fail("position-storage", "point.P must be a numeric attribute");
  if (position.size !== 2 && position.size !== 3)
    fail("position-size", "point.P must have a size of 2 or 3");

  checkAttributeSet(point, pointCount, "point");
  const vertex = parts.vertex ?? {};
  checkAttributeSet(vertex, vertexCount, "vertex");
  const primitive = parts.primitive ?? {};
  checkAttributeSet(primitive, primitiveCount, "primitive");
  const pointGroups = parts.pointGroups ?? {};
  checkGroups(pointGroups, pointCount, "pointGroups");
  const primitiveGroups = parts.primitiveGroups ?? {};
  checkGroups(primitiveGroups, primitiveCount, "primitiveGroups");
  const detail = parts.detail ?? {};
  for (const [name, value] of Object.entries(detail)) {
    checkName(name, "detail");
    if (typeof value === "number") {
      if (!Number.isFinite(value))
        fail("non-finite", `detail.${name} contains ${String(value)}`);
    } else if (typeof value !== "string") {
      if (!Array.isArray(value) || value.some((item) => !Number.isFinite(item)))
        fail("detail-value", `detail.${name} must be a finite number, string, or finite number array`);
    }
  }

  return freezeGeometry({
    kind: "geometry",
    pointCount,
    vertexCount,
    primitiveCount,
    topology,
    point,
    vertex,
    primitive,
    detail,
    pointGroups,
    primitiveGroups,
  });
}

/**
 * Freeze the plain objects that describe a geometry. The typed arrays are left
 * alone because `Object.freeze` throws on a non-empty array buffer view, which
 * is why the copy-on-write rule above is a convention rather than a guarantee.
 */
export function freezeGeometry(geometry: Geometry): Geometry {
  for (const level of ["point", "vertex", "primitive"] as const) {
    const set = geometry[level];
    for (const attribute of Object.values(set)) {
      if (isStringAttribute(attribute)) Object.freeze(attribute.table);
      Object.freeze(attribute);
    }
    Object.freeze(set);
  }
  Object.freeze(geometry.topology);
  for (const value of Object.values(geometry.detail))
    if (Array.isArray(value)) Object.freeze(value);
  Object.freeze(geometry.detail);
  Object.freeze(geometry.pointGroups);
  Object.freeze(geometry.primitiveGroups);
  return Object.freeze(geometry);
}

/** An empty geometry with a declared position width and no points. */
export function emptyGeometry(positionSize: 2 | 3 = 2): Geometry {
  return createGeometry({
    pointCount: 0,
    point: {
      [POSITION_ATTRIBUTE]: {
        storage: "f64",
        size: positionSize,
        data: new Float64Array(0),
      },
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumbers(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function toJsonAttribute(attribute: AnyAttribute): AttributeJson {
  if (isStringAttribute(attribute))
    return {
      storage: "string",
      size: 1,
      table: [...attribute.table],
      data: Array.from(attribute.data),
    };
  const data = attributeNumbers(attribute.data);
  for (const item of data)
    if (!Number.isFinite(item))
      fail("non-finite", "geometry attribute values must be finite");
  return { storage: attribute.storage, size: attribute.size, data };
}

function toJsonAttributeSet(set: AttributeSet): AttributeSetJson | undefined {
  const names = Object.keys(set);
  if (names.length === 0) return undefined;
  const result: Record<string, AttributeJson> = {};
  for (const name of names) result[name] = toJsonAttribute(set[name]!);
  return result;
}

function groupsToJson(
  groups: Groups,
): Readonly<Record<string, readonly number[]>> | undefined {
  const names = Object.keys(groups);
  if (names.length === 0) return undefined;
  const result: Record<string, readonly number[]> = {};
  for (const name of names) {
    const mask = groups[name]!;
    const indices: number[] = [];
    for (let index = 0; index < mask.length; index += 1)
      if (mask[index]) indices.push(index);
    result[name] = indices;
  }
  return result;
}

/** In-memory to interchange. Lossless, and JSON-safe. */
export function geometryToJson(geometry: Geometry): GeometryJson {
  const json: {
    kind: "geometry";
    pointCount: number;
    point?: AttributeSetJson;
    vertex?: AttributeSetJson;
    primitive?: AttributeSetJson;
    detail?: Readonly<Record<string, DetailValue>>;
    topology?: TopologyJson;
    pointGroups?: Readonly<Record<string, readonly number[]>>;
    primitiveGroups?: Readonly<Record<string, readonly number[]>>;
  } = { kind: "geometry", pointCount: geometry.pointCount };
  const point = toJsonAttributeSet(geometry.point);
  if (point) json.point = point;
  const vertex = toJsonAttributeSet(geometry.vertex);
  if (vertex) json.vertex = vertex;
  const primitive = toJsonAttributeSet(geometry.primitive);
  if (primitive) json.primitive = primitive;
  if (Object.keys(geometry.detail).length > 0) {
    const detail: Record<string, DetailValue> = {};
    for (const [name, value] of Object.entries(geometry.detail))
      detail[name] = Array.isArray(value) ? [...value] : value;
    json.detail = detail;
  }
  if (geometry.primitiveCount > 0) {
    const topology: {
      vertexPoints: readonly number[];
      offsets: readonly number[];
      kinds?: readonly number[];
      closed?: readonly number[];
    } = {
      vertexPoints: Array.from(geometry.topology.vertexPoints),
      offsets: Array.from(geometry.topology.offsets),
    };
    if (geometry.topology.kinds.some((kind) => kind !== 0))
      topology.kinds = Array.from(geometry.topology.kinds);
    if (geometry.topology.closed.some((closed) => closed !== 0))
      topology.closed = Array.from(geometry.topology.closed);
    json.topology = topology;
  }
  const pointGroups = groupsToJson(geometry.pointGroups);
  if (pointGroups) json.pointGroups = pointGroups;
  const primitiveGroups = groupsToJson(geometry.primitiveGroups);
  if (primitiveGroups) json.primitiveGroups = primitiveGroups;
  return json;
}

function fromJsonAttributeSet(
  raw: AttributeSetJson | undefined,
  level: ElementLevel,
): AttributeSet {
  if (raw === undefined) return {};
  const result: Record<string, AnyAttribute> = {};
  for (const [name, attribute] of Object.entries(raw)) {
    if (!isRecord(attribute))
      fail("attribute-shape", `${level}.${name} must be an object`);
    if (attribute.storage === "string") {
      const table = attribute.table;
      if (
        !Array.isArray(table) ||
        table.some((item) => typeof item !== "string")
      )
        fail("string-table", `${level}.${name} needs a string table`);
      if (!int32Numbers(attribute.data))
        fail("attribute-data", `${level}.${name} needs 32-bit integer indices`);
      result[name] = {
        storage: "string",
        size: 1,
        table: [...(table as readonly string[])],
        data: Int32Array.from(attribute.data),
      };
      continue;
    }
    if (
      typeof attribute.storage !== "string" ||
      !STORAGES.has(attribute.storage)
    )
      fail(
        "attribute-storage",
        `${level}.${name} has an unknown storage ${String(attribute.storage)}`,
      );
    if (!finiteNumbers(attribute.data))
      fail("attribute-data", `${level}.${name} needs finite numeric data`);
    const size = attribute.size;
    if (typeof size !== "number" || !Number.isInteger(size) || size < 1)
      fail("attribute-size", `${level}.${name} needs a size of at least 1`);
    result[name] = {
      storage: attribute.storage as AttributeStorage,
      size,
      data: attributeArrayFrom(
        attribute.storage as AttributeStorage,
        attribute.data,
      ),
    };
  }
  return result;
}

function groupsFromJson(
  raw: Readonly<Record<string, readonly number[]>> | undefined,
  count: number,
  level: string,
): Groups {
  if (raw === undefined) return {};
  const result: Record<string, Uint8Array> = {};
  for (const [name, indices] of Object.entries(raw)) {
    if (!finiteNumbers(indices))
      fail("group-indices", `${level}.${name} must be a list of indices`);
    const mask = new Uint8Array(count);
    for (const index of indices) {
      if (!Number.isInteger(index) || index < 0 || index >= count)
        fail("group-indices", `${level}.${name} references element ${index}`);
      mask[index] = 1;
    }
    result[name] = mask;
  }
  return result;
}

/** Interchange to in-memory. Throws a `geometry/*` TypeError on bad input. */
export function geometryFromJson(value: GeometryJson): Geometry {
  if (!isRecord(value) || value.kind !== "geometry")
    fail("not-geometry", "a geometry literal needs kind: 'geometry'");
  const pointCount = value.pointCount;
  if (!Number.isSafeInteger(pointCount) || pointCount < 0)
    fail("point-count", "pointCount must be a non-negative safe integer");
  const rawTopology = value.topology;
  let topology = emptyTopology();
  if (rawTopology !== undefined) {
    if (!isRecord(rawTopology))
      fail("topology-shape", "topology must be an object");
    if (
      !int32Numbers(rawTopology.vertexPoints) ||
      !int32Numbers(rawTopology.offsets)
    )
      fail("topology-shape", "topology needs vertexPoints and offsets");
    const primitiveCount = rawTopology.offsets.length - 1;
    if (primitiveCount < 0)
      fail("offsets", "topology.offsets needs primitiveCount + 1 entries");
    const kinds = rawTopology.kinds;
    const closed = rawTopology.closed;
    if (kinds !== undefined && !byteNumbers(kinds))
      fail("topology-shape", "topology.kinds must be numeric");
    if (closed !== undefined && (!byteNumbers(closed) || closed.some((item) => item !== 0 && item !== 1)))
      fail("topology-shape", "topology.closed must be numeric");
    topology = {
      vertexPoints: Int32Array.from(rawTopology.vertexPoints),
      offsets: Int32Array.from(rawTopology.offsets),
      kinds:
        kinds === undefined
          ? new Uint8Array(primitiveCount)
          : Uint8Array.from(kinds),
      closed:
        closed === undefined
          ? new Uint8Array(primitiveCount)
          : Uint8Array.from(closed),
    };
  }
  const detail: Record<string, DetailValue> = {};
  for (const [name, item] of Object.entries(value.detail ?? {})) {
    if (typeof item === "number" || typeof item === "string")
      detail[name] = item;
    else if (finiteNumbers(item)) detail[name] = [...item];
    else
      fail(
        "detail-value",
        `detail.${name} must be a number, string, or number array`,
      );
  }
  return createGeometry({
    pointCount,
    point: fromJsonAttributeSet(value.point, "point"),
    vertex: fromJsonAttributeSet(value.vertex, "vertex"),
    primitive: fromJsonAttributeSet(value.primitive, "primitive"),
    detail,
    topology,
    pointGroups: groupsFromJson(value.pointGroups, pointCount, "pointGroups"),
    primitiveGroups: groupsFromJson(
      value.primitiveGroups,
      topology.offsets.length - 1,
      "primitiveGroups",
    ),
  });
}

/**
 * Validate an interchange value against the same constructor used to decode it.
 * Keeping a second structural validator here previously accepted bad attribute
 * lengths, fractional topology indices and out-of-range groups.
 */
export function isGeometryJson(value: unknown): value is GeometryJson {
  try {
    geometryFromJson(value as GeometryJson);
    return true;
  } catch {
    return false;
  }
}

export function isGeometryFileRef(value: unknown): value is GeometryFileRef {
  if (!isRecord(value) || value.kind !== "geometry-file") return false;
  if (typeof value.path !== "string" || value.path.length === 0) return false;
  if (value.format !== "npy" && value.format !== "json") return false;
  if (value.format === "npy" && value.attribute === undefined) return false;
  if (value.attribute !== undefined) {
    const attribute = value.attribute;
    if (!isRecord(attribute)) return false;
    if (
      attribute.level !== "point" &&
      attribute.level !== "vertex" &&
      attribute.level !== "primitive"
    )
      return false;
    if (
      typeof attribute.name !== "string" ||
      !NAME.test(attribute.name) ||
      RESERVED_NAMES.has(attribute.name)
    )
      return false;
    if (
      typeof attribute.size !== "number" ||
      !Number.isInteger(attribute.size) ||
      attribute.size < 1
    )
      return false;
    if (
      typeof attribute.storage !== "string" ||
      !STORAGES.has(attribute.storage)
    )
      return false;
  }
  for (const key of ["pointCount", "primitiveCount"] as const) {
    const count = value[key];
    if (
      count !== undefined &&
      (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)
    )
      return false;
  }
  return true;
}

/** Either serialized form is a valid `geometry` document value or default. */
export function isGeometrySerialized(
  value: unknown,
): value is GeometrySerialized {
  return isGeometryJson(value) || isGeometryFileRef(value);
}

/**
 * Lift a bare path into a declared reference. The Python bridge returns a path
 * string today, and this is the one place that knows how to read an extension;
 * `attribute` is never guessed, because the third component of a points file
 * means radius in one project and z in another.
 */
export function geometryFileRefFromPath(
  path: string,
  options: Omit<GeometryFileRef, "kind" | "path" | "format"> = {},
): GeometryFileRef {
  const lower = path.toLowerCase();
  const format = lower.endsWith(".npy")
    ? "npy"
    : lower.endsWith(".json")
      ? "json"
      : fail("unknown-format", `cannot tell a geometry format from ${path}`);
  const ref = { kind: "geometry-file", path, format, ...options } as GeometryFileRef;
  if (!isGeometryFileRef(ref))
    fail("file-reference", `${format} geometry reference is missing or has invalid metadata`);
  return ref;
}

function integerNumbers(value: unknown): value is readonly number[] {
  return finiteNumbers(value) && value.every(Number.isSafeInteger);
}

function int32Numbers(value: unknown): value is readonly number[] {
  return integerNumbers(value) && value.every((item) => item >= -2147483648 && item <= 2147483647);
}

function byteNumbers(value: unknown): value is readonly number[] {
  return integerNumbers(value) && value.every((item) => item >= 0 && item <= 255);
}
