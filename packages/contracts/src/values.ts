import type { Camera } from "./camera.js";
import type { Color } from "./color.js";
import type { Light, Scene } from "./scene.js";
import type {
  Geometry,
  GeometryFileRef,
  GeometryJson,
  GeometrySerialized,
} from "./geometry.js";

export const CORE_TYPES = [
  "float",
  "int",
  "bool",
  "string",
  "vec2",
  "vec3",
  "vec4",
  "vec2i",
  "vec3i",
  "vec4i",
  "mat2",
  "mat3",
  "mat4",
  "image",
  "texture",
  "geometry",
  "points",
  "lines",
  "polyline",
  "mesh",
  "rects",
  "color",
  "camera",
  "scene",
  "light",
  "asset",
  "array",
  "object",
  "any",
] as const;

export type CoreType = (typeof CORE_TYPES)[number];
export type NamespacedType = `${string}.${string}`;
export type CascadeType = CoreType | NamespacedType;

const TYPE_ALIASES: Readonly<Record<string, CoreType>> = {
  number: "float",
  boolean: "bool",
  curves: "polyline",
};

export const IMPLICIT_TYPE_CONVERSIONS: Readonly<Record<string, readonly string[]>> = {
  int: ["float", "string"],
  float: ["string"],
  bool: ["int", "float", "string"],
  vec2i: ["vec2"],
  vec3i: ["vec3"],
  vec4i: ["vec4"],
  /**
   * A geometry *is* a scene — one with the viewport's own camera and no lights.
   * So the wire is legal and nothing is lost, which is the widening rule this
   * table already follows. Every consumer of a `scene` input reads it through
   * `asScene`, which performs the promotion; see `scene.ts`.
   */
  geometry: ["scene"],
  vec4: ["color"],
  color: ["vec4"],
};

/** Canonicalize compatibility spellings before validation or connection checks. */
export function normalizeCascadeType(type: string | undefined): string {
  if (!type) return "any";
  return TYPE_ALIASES[type] ?? type;
}

/** Shared widening rules for Studio, headless runtimes, and graph tooling. */
export function canConnectTypes(source: string, target: string): boolean {
  const from = normalizeCascadeType(source);
  const to = normalizeCascadeType(target);
  return (
    from === to ||
    from === "any" ||
    to === "any" ||
    (IMPLICIT_TYPE_CONVERSIONS[from]?.includes(to) ?? false)
  );
}
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[];
export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Vec4 = readonly [number, number, number, number];
export type Vec2i = Vec2;
export type Vec3i = Vec3;
export type Vec4i = Vec4;
export type Mat2 = readonly [number, number, number, number];
export type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export type Mat4 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface ImageRef {
  readonly path: string;
  readonly size: Vec2i;
  readonly channels: "r" | "a" | "rg" | "rgb" | "rgba";
  readonly depth: "u8" | "u16" | "f16" | "f32";
  readonly space: "srgb" | "linear";
}

declare const textureHandleBrand: unique symbol;
export interface TextureHandle {
  readonly [textureHandleBrand]: true;
}
export type Point =
  readonly [number, number] | readonly [number, number, number];
export interface PointSet {
  readonly points: readonly Point[];
}
export type LineSegment = readonly [Point, Point];
export interface LineSegments {
  readonly segments: readonly LineSegment[];
}
export interface Polyline {
  readonly points: readonly Point[];
  readonly closed?: boolean;
  readonly weight?: number;
}
export interface Mesh {
  readonly positions: readonly number[];
  readonly indices: readonly number[];
  readonly normals?: readonly number[];
  readonly uvs?: readonly number[];
}
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly tag?: string;
}
export interface Rects {
  readonly rects: readonly Rect[];
}
export interface AssetRef {
  readonly path: string;
  readonly mediaType?: string;
}
export type SerializableValue =
  JsonValue | AssetRef | ImageRef | GeometryJson | GeometryFileRef;

export type ValueForType<T extends CascadeType> = T extends "float" | "int"
  ? number
  : T extends "bool"
    ? boolean
    : T extends "string"
      ? string
      : T extends "vec2"
        ? Vec2
        : T extends "vec3"
          ? Vec3
          : T extends "vec4"
            ? Vec4
            : T extends "vec2i"
              ? Vec2i
              : T extends "vec3i"
                ? Vec3i
                : T extends "vec4i"
                  ? Vec4i
                  : T extends "mat2"
                    ? Mat2
                    : T extends "mat3"
                      ? Mat3
                      : T extends "mat4"
                        ? Mat4
                        : T extends "color"
                          ? Color
                          : T extends "camera"
                            ? Camera
                          : T extends "scene"
                            ? Scene
                          : T extends "light"
                            ? Light
                          : T extends "image"
                            ? ImageRef
                            : T extends "texture"
                              ? TextureHandle
                              : T extends "geometry"
                                ? Geometry
                                : T extends "points"
                                  ? PointSet
                                  : T extends "lines"
                                    ? LineSegments
                                    : T extends "polyline"
                                      ? Polyline
                                      : T extends "mesh"
                                        ? Mesh
                                        : T extends "rects"
                                          ? Rects
                                          : T extends "asset"
                                            ? AssetRef
                                            : T extends "array"
                                              ? readonly unknown[]
                                              : T extends "object"
                                                ? Readonly<
                                                    Record<string, unknown>
                                                  >
                                                : unknown;

export type SerializableValueForType<T extends CascadeType> =
  T extends "texture"
    ? never
    : T extends "geometry"
      ? GeometrySerialized
      : T extends "array"
        ? readonly JsonValue[]
        : T extends "object"
          ? Readonly<Record<string, JsonValue>>
          : T extends "any" | NamespacedType
            ? JsonValue
            : ValueForType<T>;
