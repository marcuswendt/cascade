/**
 * The viewer's change-detection keys, out here so they can be tested.
 *
 * Every guard in Viewer.svelte is a string comparison: redraw when the key
 * changed, take the early return when it did not. That makes the keys the whole
 * of the correctness argument, and they have now been wrong twice in the same
 * way — a key that reads like content but is actually metadata.
 *
 * The first time it was an image path: a Python-backed node rewrites the same
 * file on every cook, so the path never changes and the viewer never
 * re-requested it. The fix was to let the cook count reach the URL.
 *
 * The second time it was the core `geometry` type. `valueFingerprint` had no
 * case for it, so it fell through to the generic object branch and produced
 * `object:x:` — the literal same string for every geometry ever made, because a
 * `Geometry` has no `width`, `height` or `size` property. Any node whose output
 * is geometry therefore drew once and then froze: `line-events`, `line-repel`,
 * `dot-scatter` and `compose-frame` in cascade-logo all moved points around
 * faithfully on every cook and the viewer kept showing the first raster.
 *
 * So the rule these functions exist to keep: a fingerprint reads the value's
 * SAMPLES, and every raster key also carries the cook that produced it. Either
 * one alone has already failed.
 */
import { coerceImageRef } from '@/types/coreTypes';

/** A geometry's `P` attribute, or any other flat numeric attribute. */
interface SampledAttribute {
  readonly size?: number;
  readonly data?: ArrayLike<number>;
}

/**
 * Cheap content hash of a flat numeric array. FNV-style over the bit pattern of
 * each value, so a coordinate that moved by a float's worth still registers.
 *
 * Hashing every value rather than sampling a few, because a stride sample is
 * exactly how the last two of these bugs got written: it looks like content and
 * it is not. Above the cap it degrades to a strided read, which is the only
 * place a miss is still possible — and the cook count in the raster key is what
 * covers that case.
 */
const HASH_CAP = 200_000;

export function hashNumericArray(data: ArrayLike<number> | undefined | null): string {
  if (!data) return 'none';
  const length = data.length;
  if (length === 0) return 'empty';
  const step = length > HASH_CAP ? Math.ceil(length / HASH_CAP) : 1;
  let hash = 0x811c9dc5;
  for (let i = 0; i < length; i += step) {
    const value = data[i];
    // Scaled and truncated rather than bit-read: the array may be f64, f32 or
    // i32, and one arithmetic path over all of them keeps this readable.
    const bits = Number.isFinite(value) ? Math.round(value * 4096) | 0 : 0x7fffffff;
    hash ^= bits & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (bits >>> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (bits >>> 16) & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (bits >>> 24) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${length}/${step}:${(hash >>> 0).toString(36)}`;
}

function isCoreGeometry(value: any): boolean {
  return !!value
    && typeof value === 'object'
    && value.kind === 'geometry'
    && typeof value.pointCount === 'number';
}

/**
 * The fingerprint of a core `Geometry`: its counts, and the samples of every
 * point attribute.
 *
 * Counts alone are not enough and that is the point of the bug. `line-repel`
 * and `compose-frame` move points without adding or removing one, so a key made
 * of counts is as constant as the one it replaced.
 */
function geometryFingerprint(value: any): string {
  const parts = [
    `geometry:${value.pointCount}/${value.vertexCount ?? 0}/${value.primitiveCount ?? 0}`,
  ];
  const point = (value.point ?? {}) as Record<string, SampledAttribute>;
  for (const name of Object.keys(point).sort()) {
    const attribute = point[name];
    parts.push(`${name}${attribute?.size ?? ''}=${hashNumericArray(attribute?.data)}`);
  }
  // Topology, so a re-chained set of the same points is a different drawing.
  parts.push(`t=${hashNumericArray(value.topology?.offsets)}`);
  return parts.join('|');
}

/**
 * What the viewer uses to decide a value is a different value.
 *
 * Deliberately not a deep JSON hash: this runs on every cook of the node being
 * looked at, and some of these values are megabytes. Cheap where cheapness is
 * safe, and real where it is not.
 */
export function valueFingerprint(value: any): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value !== 'object') return `${typeof value}:${String(value).slice(0, 80)}`;
  if (isCoreGeometry(value)) return geometryFingerprint(value);
  // A geometry held out of band. The path is not its identity for the same
  // reason an image path is not — the file behind it gets rewritten.
  if (value.kind === 'geometry-file') {
    return `geometry-file:${value.path}:${value.pointCount ?? ''}:${value.attribute?.name ?? ''}`;
  }
  if (ArrayBuffer.isView(value)) return `buffer:${hashNumericArray(value as unknown as ArrayLike<number>)}`;
  const image = coerceImageRef(value);
  if (image) return `image:${image.path}:${image.size.join('x')}`;
  if (Array.isArray(value)) return `array:${value.length}`;
  return `object:${value.width ?? ''}x${value.height ?? ''}:${value.size?.join?.('x') ?? ''}`;
}

/**
 * The key the geometry raster is cached under.
 *
 * `cookVersion` is in it on purpose and is not redundant with the fingerprint.
 * The fingerprint can legitimately miss — a strided hash on a very large
 * attribute, or a `.npy` path whose file was rewritten — and a cook is the one
 * piece of evidence that the value may be new. Same argument as the media
 * version in the image path, and the same bug when it is left out.
 */
export function geometryRasterKey(input: {
  nodeId: string | undefined;
  portId: string | undefined;
  kind: string;
  value: unknown;
  cookVersion: number;
}): string {
  return [
    input.nodeId ?? 'view',
    input.portId ?? 'port',
    input.kind,
    input.cookVersion,
    valueFingerprint(input.value),
  ].join(':');
}
