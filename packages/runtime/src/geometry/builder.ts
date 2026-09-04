import {
  attributeArrayFrom,
  createGeometry,
  emptyGeometry,
  POSITION_ATTRIBUTE,
  PRIMITIVE_KINDS,
  type AnyAttribute,
  type AttributeStorage,
  type DetailValue,
  type ElementLevel,
  type Geometry,
  type PrimitiveKind,
} from "@cascade/contracts";

import { createStringAttribute, geometryError } from "./attributes.js";

export { emptyGeometry };

export interface GeometryBuilderOptions {
  /** 2 by default: the reference workloads are two-component. */
  readonly positionSize?: 2 | 3;
  readonly positionStorage?: "f32" | "f64";
}

export interface AddPrimitiveOptions {
  readonly closed?: boolean;
  readonly kind?: PrimitiveKind;
}

/**
 * The accumulating constructor. Points and primitives go in one at a time and
 * `build` produces the frozen struct-of-arrays form once, so a generator does
 * not have to know the final counts up front or touch a typed array.
 *
 * Attributes are set after the elements exist, by name and level, because the
 * builder does not know which attributes a generator will invent and should not
 * have to.
 */
export class GeometryBuilder {
  private readonly positions: number[] = [];
  private readonly size: number;
  private readonly storage: AttributeStorage;
  private readonly vertexPoints: number[] = [];
  private readonly offsets: number[] = [0];
  private readonly kinds: number[] = [];
  private readonly closed: number[] = [];
  private readonly attributes: Record<
    ElementLevel,
    Record<string, AnyAttribute>
  > = { point: {}, vertex: {}, primitive: {} };
  private readonly detail: Record<string, DetailValue> = {};
  private readonly pointGroups = new Map<string, Set<number>>();
  private readonly primitiveGroups = new Map<string, Set<number>>();

  constructor(options: GeometryBuilderOptions = {}) {
    this.size = options.positionSize ?? 2;
    this.storage = options.positionStorage ?? "f64";
  }

  get pointCount(): number {
    return this.positions.length / this.size;
  }

  get vertexCount(): number {
    return this.vertexPoints.length;
  }

  get primitiveCount(): number {
    return this.offsets.length - 1;
  }

  /** Append one point and return its index. */
  addPoint(x: number, y: number, z = 0): number {
    const index = this.pointCount;
    this.positions.push(x, y);
    if (this.size === 3) this.positions.push(z);
    return index;
  }

  /** Append points from a flat array of `positionSize`-wide entries. */
  addPoints(flat: ArrayLike<number>): number {
    if (flat.length % this.size !== 0)
      geometryError(
        "point-stride",
        `${flat.length} values is not a multiple of the position size ${this.size}`,
      );
    const first = this.pointCount;
    for (let index = 0; index < flat.length; index += 1)
      this.positions.push(flat[index]);
    return first;
  }

  /**
   * Append one primitive over existing point indices and return its index. A
   * closed primitive does not repeat its first point: `closed` is topology, not
   * a duplicated vertex.
   */
  addPrimitive(
    points: readonly number[],
    options: AddPrimitiveOptions = {},
  ): number {
    const index = this.primitiveCount;
    for (const point of points) {
      if (!Number.isInteger(point) || point < 0 || point >= this.pointCount)
        geometryError(
          "vertex-point",
          `primitive ${index} references point ${point} of ${this.pointCount}`,
        );
      this.vertexPoints.push(point);
    }
    this.offsets.push(this.vertexPoints.length);
    this.kinds.push(PRIMITIVE_KINDS.indexOf(options.kind ?? "poly"));
    this.closed.push(options.closed ? 1 : 0);
    return index;
  }

  /** Append points and one primitive over them, the common generator case. */
  addPolygon(
    flat: ArrayLike<number>,
    options: AddPrimitiveOptions = {},
  ): number {
    const first = this.addPoints(flat);
    const points: number[] = [];
    for (let index = first; index < this.pointCount; index += 1)
      points.push(index);
    return this.addPrimitive(points, options);
  }

  setAttribute(
    level: ElementLevel,
    name: string,
    attribute: AnyAttribute,
  ): this {
    if (level === "point" && name === POSITION_ATTRIBUTE)
      geometryError(
        "set-position",
        "point.P is owned by the builder; use addPoint",
      );
    this.attributes[level][name] = attribute;
    return this;
  }

  setNumericAttribute(
    level: ElementLevel,
    name: string,
    values: ArrayLike<number>,
    size = 1,
    storage: AttributeStorage = "f64",
  ): this {
    return this.setAttribute(level, name, {
      storage,
      size,
      data: attributeArrayFrom(storage, values),
    });
  }

  setStringAttribute(
    level: ElementLevel,
    name: string,
    values: readonly string[],
  ): this {
    return this.setAttribute(level, name, createStringAttribute(values));
  }

  setDetail(name: string, value: DetailValue): this {
    this.detail[name] = value;
    return this;
  }

  addToPointGroup(name: string, index: number): this {
    const members = this.pointGroups.get(name) ?? new Set<number>();
    members.add(index);
    this.pointGroups.set(name, members);
    return this;
  }

  addToPrimitiveGroup(name: string, index: number): this {
    const members = this.primitiveGroups.get(name) ?? new Set<number>();
    members.add(index);
    this.primitiveGroups.set(name, members);
    return this;
  }

  build(): Geometry {
    const pointCount = this.pointCount;
    const pointGroups: Record<string, Uint8Array> = {};
    for (const [name, members] of this.pointGroups)
      pointGroups[name] = mask(members, pointCount);
    const primitiveGroups: Record<string, Uint8Array> = {};
    for (const [name, members] of this.primitiveGroups)
      primitiveGroups[name] = mask(members, this.primitiveCount);
    return createGeometry({
      pointCount,
      point: {
        ...this.attributes.point,
        [POSITION_ATTRIBUTE]: {
          storage: this.storage,
          size: this.size,
          data: attributeArrayFrom(this.storage, this.positions),
        },
      },
      vertex: this.attributes.vertex,
      primitive: this.attributes.primitive,
      detail: this.detail,
      topology: {
        vertexPoints: Int32Array.from(this.vertexPoints),
        offsets: Int32Array.from(this.offsets),
        kinds: Uint8Array.from(this.kinds),
        closed: Uint8Array.from(this.closed),
      },
      pointGroups,
      primitiveGroups,
    });
  }
}

function mask(members: ReadonlySet<number>, count: number): Uint8Array {
  const result = new Uint8Array(count);
  for (const member of members) {
    if (!Number.isInteger(member) || member < 0 || member >= count)
      geometryError("group-indices", `group references element ${member}`);
    result[member] = 1;
  }
  return result;
}
