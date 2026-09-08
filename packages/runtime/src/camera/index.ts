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
 * rather than a second, parallel way to orient a camera. Roll is always zero:
 * an up vector fixes two axes and the third follows, so there is nothing left
 * to choose.
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

  // Roll is the up vector's only say, and with a horizontal up there is none.
  const roll = 0;
  void up;

  return [pitch / DEG, yaw / DEG, roll];
}

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

  // R = Rz * Ry * Rx applied to a column vector, which is Houdini's XYZ order:
  // the X rotation is applied to the vector first.
  const m00 = cy * cz;
  const m01 = cz * sx * sy - cx * sz;
  const m02 = cx * cz * sy + sx * sz;
  const m10 = cy * sz;
  const m11 = cx * cz + sx * sy * sz;
  const m12 = -cz * sx + cx * sy * sz;
  const m20 = -sy;
  const m21 = cy * sx;
  const m22 = cx * cy;

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
