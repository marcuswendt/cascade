import type { Camera, Mat4, Vec3 } from "@cascade/contracts";

/**
 * Everything derived from a `camera`, so that no renderer derives it twice.
 *
 * The type stores intent — a transform, a lens, a frame — and every consumer
 * wants something else: a rasteriser wants matrices, a raymarcher wants the
 * basis vectors directly, and a UI wants the angle in degrees. Deriving those
 * here is the same argument as `resolvePropBinding`: one implementation, or the
 * second one disagrees with the first about handedness in a way that takes an
 * afternoon to find.
 *
 * Houdini's conventions throughout: the camera looks down its own **-Z** with
 * **+Y** up, rotation is degrees applied in **XYZ** order, and the vertical
 * aperture is derived from the horizontal one and the frame shape rather than
 * stored.
 *
 * **Matching a frame is one number, never two.** Both angles come from the same
 * `focal`, `aperture` and resolution ratio, so a `focal` chosen to reproduce a
 * known horizontal angle reproduces the vertical one at the same time. Worked
 * example, from converting `cloud-volumes` off its hand-rolled projection on
 * 2026-09-08: that sketch pinned its **vertical** half-tangent at `0.36` and
 * scaled the horizontal by aspect, which on a 1098×1512 page gave a 29.3°
 * horizontal angle; `focal = (aperture / 2) / 0.261 ≈ 79.2 mm` reproduces it,
 * and the vertical lands back on `0.36` without being asked. Which is also the
 * reason that sketch's `fit` parameter had to go — it backed the camera off to
 * win back horizontal coverage a portrait page had lost, and that is the same
 * compensation this module already does in the projection.
 */

const DEG = Math.PI / 180;

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length === 0) return [0, 0, 0];
  return [v[0] / length, v[1] / length, v[2] / length];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** The camera's own axes in world space. */
export interface CameraBasis {
  /** Where the camera is. */
  readonly eye: Vec3;
  /** Unit vector the camera looks along — its own -Z. */
  readonly forward: Vec3;
  /** Unit vector to the camera's right — its own +X. */
  readonly right: Vec3;
  /** Unit vector for the camera's up — its own +Y. */
  readonly up: Vec3;
}

/**
 * The rotation the camera needs to look at a point, as Houdini's look-at does.
 *
 * Returned as degrees in XYZ order so it can be written straight into
 * `camera.rotate` — which is what makes look-at an override of the transform
 * rather than a second, parallel way to orient a camera.
 *
 * **`up` chooses the roll, and only the roll.** Yaw and pitch are fixed the
 * moment a direction is given; all an up vector can still decide is the
 * rotation about that direction. The default `[0, 1, 0]` is Houdini's own
 * `upvector` default and gives roll zero for any horizontal up, which is why
 * every ordinary orbit never needs to think about it.
 *
 * Written first with `roll = 0` and the parameter ignored, which was wrong in
 * the way this codebase keeps finding: the node exposes `up` as an input, so a
 * value set there did nothing at all and nothing said so.
 */
export function lookAtRotation(from: Vec3, to: Vec3, up: Vec3 = [0, 1, 0]): Vec3 {
  const forward = normalize(subtract(to, from));
  if (forward[0] === 0 && forward[1] === 0 && forward[2] === 0) return [0, 0, 0];

  // Pitch first, because yaw is measured in the horizontal plane and the
  // horizontal length is what is left of the vector once pitch is taken out.
  const horizontal = Math.hypot(forward[0], forward[2]);
  const pitch = Math.atan2(forward[1], horizontal);
  // Looking down -Z at rest, so a forward of (0, 0, -1) must give a yaw of 0.
  const yaw = Math.atan2(-forward[0], -forward[2]);

  return [pitch / DEG, yaw / DEG, rollTowards(forward, pitch, yaw, up) / DEG];
}

/**
 * The rotation about `forward` that takes the world-up-locked up vector onto
 * the requested one.
 *
 * Only the component of `up` perpendicular to `forward` can be honoured — the
 * parallel component is asking the camera to look along its own up, which is
 * not a rotation. So it is projected out, and an up parallel to forward leaves
 * nothing to aim at and returns zero rather than a NaN.
 */
function rollTowards(forward: Vec3, pitch: number, yaw: number, up: Vec3): number {
  const desired = normalize([
    up[0] - forward[0] * dot(up, forward),
    up[1] - forward[1] * dot(up, forward),
    up[2] - forward[2] * dot(up, forward),
  ]);
  if (desired[0] === 0 && desired[1] === 0 && desired[2] === 0) return 0;

  // The up this camera has with no roll, taken from the basis rather than
  // rebuilt, so the two cannot drift apart.
  const locked = cameraBasis({
    ...CAMERA_ROTATION_ONLY,
    rotate: [pitch / DEG, yaw / DEG, 0],
  }).up;

  // `cross(desired, locked)` rather than the other way round: a positive
  // `rotate.z` carries the camera's up toward its own -X, so the angle that
  // takes `locked` onto `desired` runs the opposite way.
  return Math.atan2(dot(cross(desired, locked), forward), dot(locked, desired));
}

/** Only `rotate` is read by `cameraBasis`, so the rest is filler rather than a
 *  claim about any real camera. */
const CAMERA_ROTATION_ONLY = {
  translate: [0, 0, 0],
  focal: 50,
  aperture: 41.4214,
  near: 0.001,
  far: 10000,
  resolution: [1, 1],
  aspect: 1,
  projection: "perspective",
  orthowidth: 2,
} as const satisfies Omit<Camera, "rotate">;

/** The camera's axes, applying Houdini's XYZ rotation order to a camera that
 *  looks down -Z at rest. */
export function cameraBasis(camera: Camera): CameraBasis {
  const [rx, ry, rz] = camera.rotate;
  const sx = Math.sin(rx * DEG);
  const cx = Math.cos(rx * DEG);
  const sy = Math.sin(ry * DEG);
  const cy = Math.cos(ry * DEG);
  const sz = Math.sin(rz * DEG);
  const cz = Math.cos(rz * DEG);

  /**
   * `R = Ry * Rx * Rz` on a column vector: yaw about world +Y, then pitch
   * about the camera's own right, then roll about its own view direction.
   *
   * This is the third order tried and the reason is worth writing down, because
   * two of them are indistinguishable by almost every test. With `rotate.z` at
   * zero all three agree exactly — so yaw, pitch, look-at and orthonormality
   * passed under each, and only the roll separates them. Under `Rz * Ry * Rx`,
   * written first, `rotate.z` turns the camera about the WORLD z axis, which
   * looks like a roll for as long as the camera faces -Z and stops being one
   * the moment it does not. Under `Rx * Ry * Rz` the yaw stops being a yaw
   * about world up, which is what an orbit needs. This order is the one every
   * camera rig uses, and it is what banking a camera means.
   */
  const m00 = cy * cz + sy * sx * sz;
  const m01 = -cy * sz + sy * sx * cz;
  const m02 = sy * cx;
  const m10 = cx * sz;
  const m11 = cx * cz;
  const m12 = -sx;
  const m20 = -sy * cz + cy * sx * sz;
  const m21 = sy * sz + cy * sx * cz;
  const m22 = cy * cx;

  const right: Vec3 = [m00, m10, m20];
  const up: Vec3 = [m01, m11, m21];
  // Its own -Z, which is the whole convention in one line.
  const forward: Vec3 = [-m02, -m12, -m22];

  return { eye: camera.translate, forward, right, up };
}

/**
 * The horizontal field of view in degrees, from the lens rather than stored.
 *
 * Houdini's defaults of 50 mm and 41.4214 mm are exactly 45°, which is the
 * check worth having in a test: it is the one value that proves the formula and
 * the defaults agree.
 */
export function horizontalFov(camera: Camera): number {
  if (camera.focal === 0) return 0;
  return (2 * Math.atan(camera.aperture / (2 * camera.focal))) / DEG;
}

/**
 * The VERTICAL field of view in degrees.
 *
 * Houdini does not store a vertical aperture; it derives one from the
 * horizontal aperture, the resolution ratio and the pixel aspect. Which is why
 * `resolution` is on the camera at all — without it there is no vertical angle
 * to be had.
 */
export function verticalFov(camera: Camera): number {
  if (camera.focal === 0) return 0;
  const [width, height] = camera.resolution;
  if (width === 0 || camera.aspect === 0) return 0;
  const verticalAperture = (camera.aperture * height) / (width * camera.aspect);
  return (2 * Math.atan(verticalAperture / (2 * camera.focal))) / DEG;
}

/** Frame aspect — the shape of the picture, pixel aspect included. Distinct
 *  from `camera.aspect`, which is the aspect of one pixel. */
export function frameAspect(camera: Camera): number {
  const [width, height] = camera.resolution;
  if (height === 0) return 1;
  return (width * camera.aspect) / height;
}

/** Column-major, GLSL convention, matching `MATRIX_TYPES` in Studio: element 0
 *  starts the first COLUMN. */
export function viewMatrix(camera: Camera): Mat4 {
  const { eye, forward, right, up } = cameraBasis(camera);
  // The view matrix is the inverse of the camera's transform, and for a
  // rotation that inverse is the transpose — so the basis vectors become rows.
  const back: Vec3 = [-forward[0], -forward[1], -forward[2]];
  return [
    right[0], up[0], back[0], 0,
    right[1], up[1], back[1], 0,
    right[2], up[2], back[2], 0,
    -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]),
    -(up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2]),
    -(back[0] * eye[0] + back[1] * eye[1] + back[2] * eye[2]),
    1,
  ];
}

/** Column-major, and orthographic when the camera says so — `orthowidth` is a
 *  width in world units, so the height comes from the frame aspect. */
export function projectionMatrix(camera: Camera): Mat4 {
  const { near, far } = camera;
  const aspect = frameAspect(camera);

  if (camera.projection === "orthographic") {
    const halfWidth = camera.orthowidth / 2;
    const halfHeight = aspect === 0 ? halfWidth : halfWidth / aspect;
    return [
      1 / halfWidth, 0, 0, 0,
      0, 1 / halfHeight, 0, 0,
      0, 0, -2 / (far - near), 0,
      0, 0, -(far + near) / (far - near), 1,
    ];
  }

  const focalScale = (2 * camera.focal) / camera.aperture;
  return [
    focalScale, 0, 0, 0,
    0, focalScale * aspect, 0, 0,
    0, 0, -(far + near) / (far - near), -1,
    0, 0, (-2 * far * near) / (far - near), 0,
  ];
}
