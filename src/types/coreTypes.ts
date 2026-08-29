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
export const GEOMETRY_TYPES = ['points', 'lines', 'polyline', 'mesh', 'rects'] as const;

/** Colour is kept apart from vec4: it means something different, it wants a
 *  swatch rather than four number fields, and it carries a colour space. */
export const OTHER_TYPES = ['color', 'asset', 'array', 'object', 'any'] as const;

export const CORE_TYPES = [
  ...SCALAR_TYPES,
  ...VECTOR_TYPES,
  ...MATRIX_TYPES,
  ...IMAGE_TYPES,
  ...GEOMETRY_TYPES,
  ...OTHER_TYPES,
] as const;

export type CoreType = (typeof CORE_TYPES)[number];
/** A core type, or a namespaced project type like `archive.item`. */
export type CascadeType = CoreType | (string & {});

const CORE_SET = new Set<string>(CORE_TYPES);

export function isCoreType(type: string): boolean {
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
export const IMPLICIT_CONVERSIONS: Record<string, readonly string[]> = {
  int: ['float', 'string'],
  float: ['string'],
  bool: ['int', 'float', 'string'],
  vec2i: ['vec2'],
  vec3i: ['vec3'],
  vec4i: ['vec4'],
  vec4: ['color'],
  color: ['vec4'],
};

/**
 * Fold the pre-core spellings onto their core names. `number` and `boolean` are
 * all over the existing nodes and every saved graph; renaming them on disk would
 * break files for no gain, so they are normalised on the way into a comparison
 * instead.
 */
export function normalizeType(type: string | undefined): string {
  if (!type) return 'any';
  if (type === 'number') return 'float';
  if (type === 'boolean') return 'bool';
  // `curves` was the name before `polyline`; the data is identical, so it folds
  // rather than becoming a near-duplicate type.
  if (type === 'curves') return 'polyline';
  return type;
}

export function canConnect(fromType: string, toType: string): boolean {
  if (!fromType || !toType) return true;
  if (fromType === 'any' || toType === 'any') return true;
  if (fromType === toType) return true;
  return IMPLICIT_CONVERSIONS[fromType]?.includes(toType) ?? false;
}

// ------------------------------------------------------------------- colours

/**
 * One colour per family, not per type. A reader should be able to tell a vector
 * from an image at a glance without learning twelve hues, and the port label
 * carries the precision.
 */
export const TYPE_COLORS: Record<string, string> = {
  float: '#4A9EFF',
  int: '#4A9EFF',
  bool: '#F472B6',
  string: '#A78BFA',

  vec2: '#38BDF8', vec3: '#38BDF8', vec4: '#38BDF8',
  vec2i: '#38BDF8', vec3i: '#38BDF8', vec4i: '#38BDF8',

  mat2: '#818CF8', mat3: '#818CF8', mat4: '#818CF8',

  image: '#FFD700',
  texture: '#FB7185',
  asset: '#FFD700',

  points: '#4ADE80', lines: '#4ADE80', polyline: '#4ADE80',
  mesh: '#22C55E', rects: '#4ADE80', curves: '#4ADE80',

  color: '#EC4899',
  array: '#F87171',
  object: '#FB923C',
  any: '#9CA3AF',
};

/** Project types get a colour derived from their namespace, so every
 *  `archive.*` port reads as one family without core knowing about it. */
export function typeColor(type: string | undefined): string {
  if (!type) return TYPE_COLORS.any;
  if (TYPE_COLORS[type]) return TYPE_COLORS[type];
  const namespace = typeNamespace(type);
  if (!namespace) return TYPE_COLORS.any;
  let hash = 0;
  for (let i = 0; i < namespace.length; i++) hash = (hash * 31 + namespace.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 65%, 62%)`;
}

// -------------------------------------------------------------------- images

export type ImageChannels = 'r' | 'a' | 'rg' | 'rgb' | 'rgba';
export type ImageDepth = 'u8' | 'u16' | 'f16' | 'f32';
export type ColorSpace = 'srgb' | 'linear';

/**
 * The value on an `image` port. Pixels stay in a file; this is the reference
 * plus what a reader needs to interpret it without opening it.
 *
 * A mask is an image: `{ channels: 'a', depth: 'f32' }`. So is a density field
 * or a height field. There is no separate field type, which is what stops the
 * mask/field/plane/image family from splitting into four near-identical things.
 */
export interface ImageRef {
  /** Project-relative. PNG for integer depths, .npy for float. */
  path: string;
  /** [width, height] — a vec2i. */
  size: [number, number];
  channels: ImageChannels;
  depth: ImageDepth;
  space: ColorSpace;
}

export const CHANNEL_COUNT: Record<ImageChannels, number> = {
  r: 1, a: 1, rg: 2, rgb: 3, rgba: 4,
};

// ------------------------------------------------------------------ geometry

/** Connected chains. `closed` distinguishes a loop from an open stroke. */
export interface Polyline {
  points: number[][];
  closed?: boolean;
  /** Optional per-chain weight, which the plotter uses for stroke duplication. */
  weight?: number;
}

/** Vertices plus indices. Flat arrays on purpose: this is what goes into a
 *  vertex buffer, and unpacking it into objects only to repack it would be the
 *  cost this type exists to avoid. */
export interface Mesh {
  /** Flat xyz triples. */
  positions: number[];
  /** Triangle indices. */
  indices: number[];
  normals?: number[];
  uvs?: number[];
}

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
