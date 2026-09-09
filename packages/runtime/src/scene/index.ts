import type { Scene } from "@cascade/contracts";

import { type Bounds, geometryBounds } from "../geometry/primitives.js";

export type { Bounds };

/**
 * Axis-aligned bounds over every geometry in the scene, or `undefined` when
 * there is nothing in it.
 *
 * Always three components, even when every geometry inside is 2D — a 2D
 * geometry's `P` has a `size` of 2 and `geometryBounds` returns two components
 * for it, and a viewport doing arithmetic on `min[2]` needs it to be `0` rather
 * than `undefined`. Padding here rather than at each caller is the whole reason
 * this function exists instead of callers mapping `geometryBounds`.
 */
export function sceneBounds(scene: Scene): Bounds | undefined {
  const min = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  let found = false;
  for (const geometry of scene.geometry) {
    const bounds = geometryBounds(geometry);
    if (bounds === undefined) continue;
    found = true;
    for (let axis = 0; axis < 3; axis += 1) {
      const low = bounds.min[axis] ?? 0;
      const high = bounds.max[axis] ?? 0;
      if (low < min[axis]) min[axis] = low;
      if (high > max[axis]) max[axis] = high;
    }
  }
  return found ? { min, max } : undefined;
}

/**
 * Relative epsilon for the flatness test.
 *
 * Absolute would be wrong in both directions: a scene in millimetres is
 * legitimately 0.4 deep, and a scene in metres can carry 0.4 of floating-point
 * noise on a plane that was meant to be flat. So the test is against the scene's
 * own size.
 */
const FLATNESS_EPSILON = 1e-6;

export interface SceneDimensionality {
  readonly is2d: boolean;
  /** Why. Shown in the viewport's mode control, so it is never a mystery. */
  readonly reason:
    | "camera"
    | "normals"
    | "depth"
    | "flat"
    | "empty";
}

/**
 * Is this scene flat enough to look at as a drawing?
 *
 * Marcus, 2026-09-09: *"i want the viewer to detect if our geometry is 2D or 3D
 * and adapt the viewport accordingly … unless our geometry / camera wants a 3D
 * view."*
 *
 * Three conditions, and every one of them is a **fact about the cooked output**
 * rather than a guess about intent, which is the property that makes this
 * safe to act on:
 *
 * 1. A wired camera forces 3D whatever the bounds say. That is the *"unless the
 *    camera wants a 3D view"* clause, and it is also the escape hatch for a
 *    deliberately flat 3D scene — somebody who wires a camera has said which
 *    way they are looking at it.
 * 2. A point `N` attribute forces 3D. Normals only mean something on a surface.
 * 3. Otherwise, flat iff the Z extent is below a relative epsilon.
 *
 * ## This may only ever set the *initial* mode
 *
 * A particle simulation can be planar at frame 1 and gain depth by frame 20.
 * Re-running this on every cook would flip the viewport mid-playback, which is
 * worse than either mode would have been. So the Viewer calls this **once**,
 * when a node has no remembered view, and never again — which is why the
 * per-node view memory is not a separate feature but the thing that makes
 * detect-once implementable at all. Without somewhere to keep the answer the
 * only options are re-detecting, which flips, and never detecting, which is
 * useless.
 */
export function sceneDimensionality(scene: Scene): SceneDimensionality {
  if (scene.camera !== null) return { is2d: false, reason: "camera" };
  for (const geometry of scene.geometry)
    if (geometry.point.N !== undefined)
      return { is2d: false, reason: "normals" };
  const bounds = sceneBounds(scene);
  if (bounds === undefined) return { is2d: true, reason: "empty" };
  const depth = (bounds.max[2] ?? 0) - (bounds.min[2] ?? 0);
  const size = Math.max(
    (bounds.max[0] ?? 0) - (bounds.min[0] ?? 0),
    (bounds.max[1] ?? 0) - (bounds.min[1] ?? 0),
    Math.abs(bounds.max[2] ?? 0),
    Math.abs(bounds.min[2] ?? 0),
  );
  const tolerance = Math.max(size, 1) * FLATNESS_EPSILON;
  return depth <= tolerance
    ? { is2d: true, reason: "flat" }
    : { is2d: false, reason: "depth" };
}
