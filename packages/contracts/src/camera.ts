import type { Vec2i, Vec3 } from "./values.js";

/**
 * A camera, following Houdini's `/obj/cam`.
 *
 * `AGENTS.md` already required following Houdini's parameter names where
 * Houdini has an equivalent node, and Marcus restated it for this type
 * specifically on 2026-09-08. It is worth writing down what that costs, because
 * the obvious design is not the Houdini one and it was proposed first here:
 *
 * **There is no field of view.** Houdini has `focal` (a focal length in
 * millimetres) and `aperture` (the horizontal aperture, also in millimetres),
 * and the angle is derived from the two. The defaults — 50 mm on a 41.4214 mm
 * aperture — are a 45° horizontal field of view, which is where that odd
 * aperture number comes from. Carrying an `fov` instead would be one number
 * rather than two, and it would also make every lens value a photographer knows
 * untypeable.
 *
 * **The orientation is `translate` and `rotate`, not eye-and-target.** A
 * Houdini camera is an object with an ordinary transform, looking down its own
 * **-Z** with **+Y** up, and look-at is a second mechanism layered on top
 * (`lookatpath` and `upvector`) rather than the primitive. So `lookat` and `up`
 * are here as the optional override they are in Houdini, and `rotate` is what
 * the type actually carries.
 *
 * **Rotation is degrees, XYZ order** — Houdini's convention, and already the
 * one `cascade.geo.Transform` uses for its own `rotate`. Note that this is
 * deliberately unlike expressions, where bare trigonometry is radians; that
 * divergence is recorded in `AGENTS.md` and is not new here.
 *
 * The one place this departs from Houdini's names is **`resolution` in place of
 * `resx` and `resy`**, because the vault's more specific rule wins: anything
 * with an x and a y is one `vec2`, and resolutions are named in that rule
 * explicitly. Two floats that are really one vector cost two Inspector rows and
 * two keyframes and let a graph carry a width without its height.
 *
 * Resolution belongs to the camera rather than to the render target for a
 * Houdini reason that is easy to miss: the **vertical** aperture is not stored,
 * it is derived from the horizontal one and the resolution ratio. So the frame
 * shape participates in the projection, and a camera that did not know it could
 * not produce a vertical angle at all.
 */
export interface Camera {
  /** World position. Houdini `t`. */
  readonly translate: Vec3;
  /** Degrees, XYZ order. Houdini `r`. The camera looks down its own -Z. */
  readonly rotate: Vec3;
  /** Focal length in millimetres. Houdini `focal`, default 50. */
  readonly focal: number;
  /** Horizontal aperture in millimetres. Houdini `aperture`, default 41.4214. */
  readonly aperture: number;
  /** Near clipping plane. Houdini `near`, default 0.001. */
  readonly near: number;
  /** Far clipping plane. Houdini `far`, default 10000. */
  readonly far: number;
  /** Frame size in pixels. Houdini `resx`/`resy` as one `vec2i`. */
  readonly resolution: Vec2i;
  /** PIXEL aspect ratio, not the frame's. Houdini `aspect`, default 1. */
  readonly aspect: number;
  /** Houdini `projection`. */
  readonly projection: "perspective" | "orthographic";
  /** Width of the orthographic frame in world units. Houdini `orthowidth`. */
  readonly orthowidth: number;
}

/** Houdini's own defaults, so a camera with nothing set matches a fresh
 *  `/obj/cam` rather than something invented here. */
export const CAMERA_DEFAULTS: Camera = Object.freeze({
  translate: [0, 0, 0] as Vec3,
  rotate: [0, 0, 0] as Vec3,
  focal: 50,
  aperture: 41.4214,
  near: 0.001,
  far: 10000,
  resolution: [1280, 720] as Vec2i,
  aspect: 1,
  projection: "perspective",
  orthowidth: 2,
});

/** True for any object carrying the fields this type is identified by. Used at
 *  the document boundary, where a value arrives as parsed JSON. */
export function isCamera(value: unknown): value is Camera {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<Camera>;
  return (
    Array.isArray(candidate.translate) &&
    Array.isArray(candidate.rotate) &&
    typeof candidate.focal === "number" &&
    typeof candidate.aperture === "number"
  );
}
