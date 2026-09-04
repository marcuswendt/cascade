import type { Mat3 } from "@cascade/contracts";

/**
 * The `mat3` a transform node or an instancing operation needs, built from the
 * four parameters a Houdini user already knows: translate, rotate, scale and
 * pivot.
 *
 * Matrices are column-major, as the `mat3` type is documented to be, so the
 * translation sits in the third column at indices 6 and 7 and `transformGeometry`
 * reads it there.
 *
 * Rotation is in degrees and counter-clockwise, because geometry is +Y up and a
 * positive angle turning clockwise would be the first of the small surprises
 * that make a hand feel wrong.
 *
 * The order is Houdini's SRT with a pivot: scale, then rotate, then translate,
 * all about the pivot. Written out, `M = T(t) · T(p) · R(r) · S(s) · T(-p)`.
 */
export interface TransformParameters {
  readonly translate?: readonly [number, number];
  /** Degrees, counter-clockwise. */
  readonly rotate?: number;
  readonly scale?: readonly [number, number];
  readonly pivot?: readonly [number, number];
}

export function transformMatrix(parameters: TransformParameters): Mat3 {
  const [tx, ty] = parameters.translate ?? [0, 0];
  const [sx, sy] = parameters.scale ?? [1, 1];
  const [px, py] = parameters.pivot ?? [0, 0];
  const rotate = parameters.rotate ?? 0;
  if (![tx, ty, sx, sy, px, py, rotate].every(Number.isFinite))
    throw new TypeError("geometry/transform: transform parameters must be finite");
  const radians = (rotate * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const a00 = cos * sx;
  const a10 = sin * sx;
  const a01 = -sin * sy;
  const a11 = cos * sy;
  return [
    a00,
    a10,
    0,
    a01,
    a11,
    0,
    tx + px - (a00 * px + a01 * py),
    ty + py - (a10 * px + a11 * py),
    1,
  ];
}
