import {
  canConnectTypes,
  CORE_TYPES as CONTRACT_CORE_TYPES,
  IMPLICIT_TYPE_CONVERSIONS,
  normalizeCascadeType,
  type CascadeType,
  type CoreType,
  type ImageRef,
} from '@cascade/contracts';

export type { CascadeType, CoreType, ImageRef, Mesh, Polyline } from '@cascade/contracts';

/**
 * Cascade's core data types — the vocabulary every node in a geometry and image
 * pipeline can rely on, so that inspecting a node's parameters and outputs is
 * the same act whatever the node does.
 *
 * The set is deliberately small. A type earns its place by needing its own
 * editor, its own port colour, or its own conversion rules; anything else is an
 * `object` with a shape. Special nodes extend by NAMESPACE — `archive.item`
 * — so a project can add what it needs without competing with core for names,
 * and anything unnamespaced is core by definition.
 */

/** Scalars. `float` and `int` are distinct because an int wants a stepper and a
 *  float wants a drag field, and because vec2i exists. */
export const SCALAR_TYPES = ['float', 'int', 'bool', 'string'] as const;

/** Float and integer vectors, GLSL naming. */
export const VECTOR_TYPES = ['vec2', 'vec3', 'vec4', 'vec2i', 'vec3i', 'vec4i'] as const;

/** Column-major, GLSL convention: mat4[0] is the first COLUMN. */
export const MATRIX_TYPES = ['mat2', 'mat3', 'mat4'] as const;

/**
 * Pixels.
 *
 * `image` is file-backed and portable: a descriptor naming a file plus the
 * metadata needed to read it. It crosses the language boundary — Python writes
 * one, a browser node reads it, either can consume the other's.
 *
 * `texture` is a live GPU handle inside one browser session. It exists so a
 * chain of WebGL nodes can hand work along without a file round trip per link;
 * it cannot leave the page, and converting to an image is what makes it durable.
 */
export const IMAGE_TYPES = ['image', 'texture'] as const;

/**
 * Geometry.
 *
 * `points`   — a point set, Nx2 or Nx3.
 * `lines`    — independent segments, pairs of endpoints. Not a chain.
 * `polyline` — connected chains, open or closed. A smoothed curve is one of
 *              these; `curves` is kept as an alias rather than a second type,
 *              because two names for one concept is how mask/field/plane/image
 *              turned into four things that all meant the same.
 * `mesh`     — vertices plus indices, with optional normals and uvs.
 * `rects`    — axis-aligned rectangles, optionally tagged.
 */
export const GEOMETRY_TYPES = ['geometry', 'points', 'lines', 'polyline', 'mesh', 'rects'] as const;

/** Colour is kept apart from vec4: it means something different, it wants a
 *  swatch rather than four number fields, and it carries a colour space. */
export const OTHER_TYPES = ['color', 'camera', 'scene', 'light', 'asset', 'array', 'object', 'any'] as const;

export const CORE_TYPES = CONTRACT_CORE_TYPES;

const CORE_SET = new Set<string>(CORE_TYPES);

export function isCoreType(type: string): type is CoreType {
  return CORE_SET.has(type);
}

/** `archive.item` -> `archive`; a core type has no namespace. */
export function typeNamespace(type: string): string | null {
  const dot = type.indexOf('.');
  return dot > 0 ? type.slice(0, dot) : null;
}

// ---------------------------------------------------------------- structure

/** How many components a vector or matrix carries, for editors and validation. */
export const TYPE_COMPONENTS: Record<string, number> = {
  vec2: 2, vec3: 3, vec4: 4,
  vec2i: 2, vec3i: 3, vec4i: 4,
  mat2: 4, mat3: 9, mat4: 16,
  color: 4,
};

/** Vector and matrix values are plain number arrays — JSON-native, the same
 *  shape on both sides of the language boundary, and directly uploadable as a
 *  uniform. No wrapper objects. */
export function isNumericTuple(type: string): boolean {
  return type in TYPE_COMPONENTS;
}

/** Integer vectors round rather than refuse, so a computed size is usable. */
export function isIntegerType(type: string): boolean {
  return type === 'int' || type.endsWith('i');
}

// ---------------------------------------------------------------- conversion

/**
 * What may flow into what without an explicit conversion node.
 *
 * The rule throughout: widening is implicit, narrowing is not. An int vector
 * feeds a float vector because nothing is lost; the reverse silently discards
 * the fractional part, so it has to be asked for. And `texture` does not
 * implicitly become `image` — that is a GPU readback, which is expensive enough
 * that it should appear in the graph rather than happen invisibly.
 */
export const IMPLICIT_CONVERSIONS = IMPLICIT_TYPE_CONVERSIONS;

/** Compatibility name retained for the Studio code while contracts owns the rule. */
export const normalizeType = normalizeCascadeType;

export function canConnect(fromType: string, toType: string): boolean {
  return canConnectTypes(fromType, toType);
}

// ------------------------------------------------------------------- colours

/**
 * One colour per family, not per type.
 *
 * A reader should be able to tell a vector from an image at a glance without
 * learning twelve hues, and the port label carries the precision.
 *
 * These are token references, not hex. The values live in `theme.css`, once per
 * theme, because the palette was chosen against a black canvas and the same
 * saturated tones are nearly invisible on a light ground — `#FFD700` sits at
 * 1.3:1 on white. A colour written here would be one the theme cannot reach.
 *
 * The consequence for callers: these strings are `var(...)`, so they are only
 * valid where CSS resolves them — an inline `style`, not an SVG presentation
 * attribute, and never `ctx.fillStyle`. See Canvas.svelte's connection paths,
 * which set `style="stroke: ..."` for exactly this reason.
 */
export const TYPE_COLORS: Record<string, string> = {
  float: 'var(--type-number)',
  int: 'var(--type-number)',
  bool: 'var(--type-bool)',
  string: 'var(--type-string)',

  vec2: 'var(--type-vector)', vec3: 'var(--type-vector)', vec4: 'var(--type-vector)',
  vec2i: 'var(--type-vector)', vec3i: 'var(--type-vector)', vec4i: 'var(--type-vector)',

  mat2: 'var(--type-matrix)', mat3: 'var(--type-matrix)', mat4: 'var(--type-matrix)',

  // Its own family rather than a matrix: what travels on the port is a lens and
  // a transform, and the matrix is one of several things derived from it.
  camera: 'var(--type-camera)',

  image: 'var(--type-image)',
  texture: 'var(--type-texture)',
  asset: 'var(--type-image)',

  points: 'var(--type-geometry)', lines: 'var(--type-geometry)', polyline: 'var(--type-geometry)',
  mesh: 'var(--type-mesh)', rects: 'var(--type-geometry)', curves: 'var(--type-geometry)',

  color: 'var(--type-color)',
  array: 'var(--type-array)',
  object: 'var(--type-object)',
  any: 'var(--type-any)',
};

/**
 * Project types get a colour derived from their namespace, so every
 * `archive.*` port reads as one family without core knowing about it.
 *
 * Only the hue is computed. How saturated and how light it lands is the
 * theme's business, so those two come from tokens — otherwise every project
 * type would keep its dark-canvas lightness on a white one.
 */
export function typeColor(type: string | undefined): string {
  if (!type) return TYPE_COLORS.any;
  if (TYPE_COLORS[type]) return TYPE_COLORS[type];
  const namespace = typeNamespace(type);
  if (!namespace) return TYPE_COLORS.any;
  let hash = 0;
  for (let i = 0; i < namespace.length; i++) hash = (hash * 31 + namespace.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, var(--type-derived-saturation), var(--type-derived-lightness))`;
}

// -------------------------------------------------------------------- images

export type ImageChannels = ImageRef['channels'];
export type ImageDepth = ImageRef['depth'];
export type ColorSpace = ImageRef['space'];

/**
 * The value on an `image` port. Pixels stay in a file; this is the reference
 * plus what a reader needs to interpret it without opening it.
 *
 * A mask is an image: `{ channels: 'a', depth: 'f32' }`. So is a density field
 * or a height field. There is no separate field type, which is what stops the
 * mask/field/plane/image family from splitting into four near-identical things.
 */
export const CHANNEL_COUNT: Record<ImageChannels, number> = {
  r: 1, a: 1, rg: 2, rgb: 3, rgba: 4,
};

export function isImageRef(value: unknown): value is ImageRef {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as ImageRef).path === 'string' &&
    Array.isArray((value as ImageRef).size)
  );
}

/**
 * Accept a bare path where an image is expected. Nodes written before the
 * descriptor existed emit a plain string, and refusing those would mean
 * migrating every node in one commit — the metadata is filled in by the reader
 * instead, which knows the file.
 */
export function coerceImageRef(value: unknown): ImageRef | null {
  if (isImageRef(value)) return value;
  if (typeof value !== 'string' || !value) return null;
  const float = value.endsWith('.npy');
  return {
    path: value,
    size: [0, 0],
    channels: float ? 'a' : 'rgb',
    depth: float ? 'f32' : 'u8',
    space: float ? 'linear' : 'srgb',
  };
}
