import { CAMERA_DEFAULTS, type Camera, type Vec3 } from '@cascade/contracts';
import { cameraBasis, frameAspect } from '@cascade/runtime/camera';

/**
 * The Viewer's own camera state — an orbit camera, converted to a real
 * `Camera` on every draw.
 *
 * ## Why the state is not a `Camera`
 *
 * A `Camera` carries `translate` and `rotate`, which is what a camera *is* and
 * the wrong thing to store for a view you drag. Tumbling means rotating about a
 * pivot, and a pivot cannot be recovered from a position and an orientation —
 * every point along the view direction is a candidate. Houdini keeps the same
 * distinction: the viewport has a pivot you can set (`Space`+`Z`) which is not
 * a parameter of any camera object.
 *
 * So the state is pivot, orientation and distance, and `viewCameraFor` derives
 * the `Camera`. Everything downstream — the projection, the grid, the render
 * node — sees only the derived camera, which is what stops the viewport and
 * `cascade.geo.Render` from framing a graph two ways.
 *
 * ## Houdini's vocabulary, kept exactly
 *
 * *Tumble* rotates about the pivot. *Track* slides the pivot in the view plane
 * (Houdini's word for pan). *Dolly* moves the camera along its view direction.
 * **Zoom changes the focal length**, which is a different picture from dollying
 * and the one thing every 2D-tool user expects to mean the same. Keeping the
 * four separate is the reason the wheel is bound to dolly and not to "zoom".
 */
export interface ViewState {
  /** What tumbling rotates about, and what framing centres. */
  readonly pivot: readonly [number, number, number];
  /** Degrees about world +Y. */
  readonly yaw: number;
  /** Degrees about the camera's own right. Negative looks down from above. */
  readonly pitch: number;
  /** Camera distance from the pivot. Perspective only, but kept in both so
   *  that toggling projection twice returns you to where you were. */
  readonly distance: number;
  readonly ortho: boolean;
  /** World units across the frame, orthographic only. Houdini `orthowidth`. */
  readonly orthoWidth: number;
  /** Millimetres. Houdini `focal`, and what `Space`+`Ctrl`+RMB changes. */
  readonly focal: number;
}

/**
 * Houdini's default homing view is a three-quarter perspective, and this is it:
 * from front-right, above, looking back at the origin.
 *
 * `PLAN viewport` records why 2D work does **not** get this view — a plane seen
 * from three-quarters keystones, and parallel lines converging is the exact
 * property plotter work is judged on.
 */
export const THREE_QUARTER: Pick<ViewState, 'yaw' | 'pitch'> = { yaw: 30, pitch: -25 };

/** Straight down -Z at the XY plane, +Y up. The 2D view, and Houdini's Front. */
export const FRONT: Pick<ViewState, 'yaw' | 'pitch'> = { yaw: 0, pitch: 0 };
/** Houdini's Top: down -Y at the XZ plane. */
export const TOP: Pick<ViewState, 'yaw' | 'pitch'> = { yaw: 0, pitch: -90 };
/** Houdini's Side: down -X at the ZY plane. */
export const SIDE: Pick<ViewState, 'yaw' | 'pitch'> = { yaw: 90, pitch: 0 };

export const STANDARD_VIEWS = {
  perspective: THREE_QUARTER,
  front: FRONT,
  top: TOP,
  side: SIDE,
} as const;
export type StandardView = keyof typeof STANDARD_VIEWS;

export interface Bounds3 {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

const DEG = Math.PI / 180;

/**
 * The offset from pivot to camera, for a yaw and pitch.
 *
 * Derived from `cameraBasis`' own rotation order rather than re-invented, which
 * is the whole reason it is a five-line function with a comment this long:
 * `R = Ry * Rx * Rz` gives `forward = [-sy·cx, sx, -cy·cx]`, and the camera
 * must sit at `pivot - forward · distance`. Getting the sign wrong here is the
 * mistake that survives every test taken at yaw and pitch zero, which is how
 * the rotation order itself was got wrong twice on 2026-09-08.
 */
export function orbitOffset(yaw: number, pitch: number, distance: number): Vec3 {
  const sy = Math.sin(yaw * DEG);
  const cy = Math.cos(yaw * DEG);
  const sx = Math.sin(pitch * DEG);
  const cx = Math.cos(pitch * DEG);
  return [sy * cx * distance, -sx * distance, cy * cx * distance];
}

/**
 * The `Camera` this view describes, at a pixel size.
 *
 * The resolution is the canvas's own pixel size, not the document's, because
 * `frameAspect` derives the vertical field of view from it — a camera that did
 * not know its frame shape could not produce a vertical angle at all. That is
 * also why resizing the panel changes what is visible vertically rather than
 * stretching it.
 */
export function viewCameraFor(
  view: ViewState,
  size: readonly [number, number],
): Camera {
  const offset = orbitOffset(view.yaw, view.pitch, view.distance);
  return {
    ...CAMERA_DEFAULTS,
    translate: [
      view.pivot[0] + offset[0],
      view.pivot[1] + offset[1],
      view.pivot[2] + offset[2],
    ],
    rotate: [view.pitch, view.yaw, 0],
    focal: view.focal,
    resolution: [Math.max(1, Math.round(size[0])), Math.max(1, Math.round(size[1]))],
    projection: view.ortho ? 'orthographic' : 'perspective',
    // Houdini's spelling, all lower case, and the contract keeps it. The view
    // state's own `orthoWidth` is Studio-side camelCase; they are the same
    // number and this is the one place they meet.
    orthowidth: view.orthoWidth,
    // A viewport must show geometry the moment it is cooked, and a near plane
    // of 0.001 with a far of 10000 puts a 1e-7 depth range inside a float
    // depth buffer. Nothing here uses a depth buffer — the renderer is 2D
    // canvas — so the planes only clip, and these are wide enough not to.
    near: 0.001,
    far: 1e7,
  };
}

/** World units per screen pixel at the pivot's depth. */
export function worldPerPixel(
  view: ViewState,
  size: readonly [number, number],
): number {
  const width = Math.max(1, size[0]);
  if (view.ortho) return view.orthoWidth / width;
  // The visible width at the pivot's distance. `focalScale = 2·focal/aperture`
  // in the projection, so the frame spans `distance · aperture / focal`.
  return (view.distance * CAMERA_DEFAULTS.aperture) / view.focal / width;
}

/** Tumble: rotate about the pivot. Houdini's Orbit style keeps the view upright,
 *  so pitch is clamped rather than allowed to roll past the pole. */
export function tumble(view: ViewState, dx: number, dy: number): ViewState {
  const pitch = Math.max(-89.9, Math.min(89.9, view.pitch + dy * 0.4));
  return { ...view, yaw: view.yaw + dx * 0.4, pitch };
}

/**
 * Track: slide the pivot in the view plane.
 *
 * The pivot moves rather than the camera, which is Houdini's *When Panning ▸
 * Move Pivot* default and the thing that keeps "tumble around the centre of the
 * view" true after a pan. Move the camera alone and the next tumble swings
 * around a point that is no longer on screen.
 */
export function track(
  view: ViewState,
  dx: number,
  dy: number,
  size: readonly [number, number],
): ViewState {
  const scale = worldPerPixel(view, size);
  /**
   * The axes come from `cameraBasis` rather than being re-derived here, and
   * that is not tidiness. A hand-written `up` for this rotation order was wrong
   * by a sign in Z on the first pass — invisible at pitch zero, where the term
   * vanishes, and visible only as a pan that drifts the wrong way once you have
   * tumbled. Deriving the axes twice is how a viewport disagrees with its own
   * projection.
   */
  const { right, up } = cameraBasis(viewCameraFor(view, size));
  return {
    ...view,
    pivot: [
      view.pivot[0] - right[0] * dx * scale + up[0] * dy * scale,
      view.pivot[1] - right[1] * dx * scale + up[1] * dy * scale,
      view.pivot[2] - right[2] * dx * scale + up[2] * dy * scale,
    ],
  };
}

/**
 * Dolly: move along the view direction, or widen the orthographic frame.
 *
 * Multiplicative, so one wheel notch covers the same proportion of the way in
 * at every scale — the alternative crawls when you are far out and overshoots
 * when you are close. Clamped away from zero because a distance of zero is a
 * division by zero in `worldPerPixel` and a view nothing recovers from.
 */
export function dolly(view: ViewState, notches: number): ViewState {
  const factor = Math.exp(notches * 0.12);
  return {
    ...view,
    distance: Math.max(1e-4, Math.min(1e9, view.distance * factor)),
    orthoWidth: Math.max(1e-6, Math.min(1e9, view.orthoWidth * factor)),
  };
}

/** Zoom, in Houdini's sense: the lens. Clamped to real focal lengths. */
export function zoomLens(view: ViewState, notches: number): ViewState {
  return {
    ...view,
    focal: Math.max(4, Math.min(600, view.focal * Math.exp(notches * 0.08))),
  };
}

/**
 * Switching projection keeps the picture the same size.
 *
 * Matching `orthoWidth` to the perspective frame at the pivot — and back — is
 * what makes the toggle usable: derive it from nothing and every press jumps
 * the framing, so you press it once, lose your place, and stop pressing it.
 */
export function toggleProjection(view: ViewState): ViewState {
  if (view.ortho)
    return {
      ...view,
      ortho: false,
      distance: (view.orthoWidth * view.focal) / CAMERA_DEFAULTS.aperture,
    };
  return {
    ...view,
    ortho: true,
    orthoWidth: (view.distance * CAMERA_DEFAULTS.aperture) / view.focal,
  };
}

/**
 * Frame a bounding box.
 *
 * `rotate: false` is Houdini's `Space`+`F` — frame the selection without
 * changing the view angle. `rotate: true` is `Space`+`G`, which is allowed to
 * move to the standard angle. The split is worth having: it is the difference
 * between *"show me this"* and *"show me this from the usual place"*, and
 * conflating them means you lose a considered angle every time you frame.
 */
export function frameBounds(
  view: ViewState,
  bounds: Bounds3 | undefined,
  size: readonly [number, number],
  options: { readonly rotate?: boolean } = {},
): ViewState {
  const angles = options.rotate ? (view.ortho ? FRONT : THREE_QUARTER) : {};
  if (!bounds) return { ...view, ...angles, pivot: [0, 0, 0], distance: 5, orthoWidth: 2 };

  const centre: readonly [number, number, number] = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const extent = Math.hypot(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  );
  // Houdini's Minimum Home Size, and it exists for the same reason: homing a
  // single point has no extent, and without a floor the camera lands on top of
  // it and every subsequent gesture is at a scale nothing is visible at.
  const radius = Math.max(extent / 2, 1e-3);
  const margin = 1.15;
  const aspect = frameAspect(
    viewCameraFor(view, size),
  );
  // Fit the tighter axis, so a wide scene in a tall panel is fully visible
  // rather than cropped left and right.
  const fitScale = aspect >= 1 ? 1 : 1 / aspect;
  const orthoWidth = radius * 2 * margin * fitScale;
  return {
    ...view,
    ...angles,
    pivot: centre,
    orthoWidth,
    distance: (orthoWidth * view.focal) / CAMERA_DEFAULTS.aperture,
  };
}

/** A view for a scene, before anything has been remembered for the node. */
export function defaultView(is2d: boolean): ViewState {
  return {
    pivot: [0, 0, 0],
    ...(is2d ? FRONT : THREE_QUARTER),
    distance: 5,
    ortho: is2d,
    orthoWidth: 2,
    focal: CAMERA_DEFAULTS.focal,
  };
}

/** Jump to one of Houdini's `Space`+`1`…`4` views, keeping pivot and scale. */
export function standardView(view: ViewState, which: StandardView): ViewState {
  return {
    ...view,
    ...STANDARD_VIEWS[which],
    // Houdini's `Space`+`2`/`3`/`4` land in an orthographic view and `Space`+`1`
    // in a perspective one, which is the behaviour that makes the number keys
    // useful for measuring rather than just for turning.
    ortho: which !== 'perspective',
  };
}
