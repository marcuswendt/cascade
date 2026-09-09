import type { Camera } from "./camera.js";
import type { Geometry } from "./geometry.js";
import type { Vec3, Vec4 } from "./values.js";

/**
 * A scene: geometry, an optional camera, and lights.
 *
 * Marcus asked for this on 2026-09-09, and it arrived as a correction to a
 * worse design. The plan before it proposed a separate `scene` panel beside the
 * Viewer, and then — once that was corrected — a Viewer 3D mode that special
 * cased `geometry`. His version:
 *
 * > *"If we want a 'scene' we could just create a merge node with a 3D viewer,
 * > or perhaps a 'scene' root node with a variadic input? … a 'scene' node with
 * > a camera, lights and geometry attached becomes a '3d scene'."*
 *
 * What that buys is not a feature, it is the removal of a branch. **The Viewer's
 * 3D mode renders exactly one type.** A bare `geometry` output is a scene
 * carrying a default camera and a default light, which is what Houdini itself
 * does — the viewport camera and the headlight exist until you make real ones —
 * so "geometry displays in 3D" is a promotion (`sceneFromGeometry`) rather than
 * a second code path. Every branch that special-cases geometry against scene is
 * a place the two can disagree about framing.
 *
 * The same promotion is why `cascade.geo.Render` can take a scene without
 * breaking a single existing sketch: `geometry` widens to `scene`, so the old
 * wire is still legal and lands on `asScene`.
 *
 * ## Why this is not `cascade.geo.Merge`
 *
 * Merge concatenates points, vertices and primitives and renumbers them, and a
 * camera is not a primitive — `mergeGeometries`' collision rules have nothing
 * to say about one. Two operations that both take N inputs are not the same
 * operation.
 *
 * ## Why the camera is nullable rather than defaulted here
 *
 * A scene with no camera means *"use the viewport's own navigated camera"*, and
 * that is a different statement from *"use a 50 mm camera at the origin"*. It
 * is also Houdini's behaviour, which Marcus confirmed on 2026-09-09 — *"yes to
 * copying the Houdini camera"*: unwired, you fly around freely; wire a
 * `cascade.core.Camera` and the view locks to it and navigation writes back
 * into its parameters. A defaulted camera here would make that distinction
 * unrepresentable, and the viewport would have no way to know whether the
 * camera it was handed was a decision or a fallback.
 *
 * `CAMERA_DEFAULTS` is still where the fallback numbers live; a consumer that
 * genuinely needs a camera object asks for one there, and the null stays
 * meaningful.
 */
export interface Scene {
  /**
   * Every geometry in the scene, in input order.
   *
   * A list rather than one merged geometry, because merging is lossy in the way
   * that matters to a viewport: two geometries with different point counts and
   * different style attributes become one after `mergeGeometries`, and the
   * viewport can then no longer draw them with separate styles, report which
   * one is over the item cap, or let one be soloed. Merge is available as a
   * node when someone wants it.
   */
  readonly geometry: readonly Geometry[];
  /** `null` means the viewport's own navigated camera. See above. */
  readonly camera: Camera | null;
  readonly lights: readonly Light[];
}

/**
 * A light, following Houdini's `/obj/hlight` where it has an equivalent.
 *
 * Houdini's parameters are `light_type`, `light_color` and `light_intensity`;
 * the names here drop the redundant prefix a Cascade node does not need, since
 * the type already says it is a light. `type` keeps Houdini's own vocabulary,
 * including **`distant`** for what most renderers call a directional light.
 *
 * Nothing consumes lights yet — every piece in the vault is lines, and there is
 * no surface to shade. They are in the type from the start anyway, because
 * adding a field to `Scene` later means every serialized scene and every node
 * that constructs one changes, and the whole point of landing the type first is
 * that it stops changing.
 */
export interface Light {
  /** Houdini `light_type`. `ambient` ignores `translate` and `direction`. */
  readonly type: "point" | "distant" | "ambient" | "spot";
  /** World position. Ignored for `distant` and `ambient`. */
  readonly translate: Vec3;
  /** Direction the light points. Used by `distant` and `spot`. */
  readonly direction: Vec3;
  /** Houdini `light_color`, as a `vec4` — colour is four components, always. */
  readonly color: Vec4;
  /** Houdini `light_intensity`. */
  readonly intensity: number;
  /** Cone angle in degrees, `spot` only. Houdini `coneangle`. */
  readonly coneangle: number;
}

export const LIGHT_DEFAULTS: Light = {
  type: "point",
  translate: [0, 0, 0],
  direction: [0, 0, -1],
  color: [1, 1, 1, 1],
  intensity: 1,
  coneangle: 45,
};

/** A scene with nothing in it. Not a failure — an empty graph produces one. */
export const EMPTY_SCENE: Scene = { geometry: [], camera: null, lights: [] };

export function isLight(value: unknown): value is Light {
  if (typeof value !== "object" || value === null) return false;
  const light = value as Partial<Light>;
  return (
    (light.type === "point" ||
      light.type === "distant" ||
      light.type === "ambient" ||
      light.type === "spot") &&
    Array.isArray(light.translate) &&
    Array.isArray(light.direction) &&
    Array.isArray(light.color) &&
    typeof light.intensity === "number"
  );
}

/**
 * Structural, and deliberately not a brand.
 *
 * A scene crosses the host boundary as JSON — Studio panel to worker, project
 * module to runtime — and a branded type would not survive the round trip, so
 * the check has to be answerable from the shape alone. It tests `geometry` and
 * `lights` are arrays and that `camera` is present-and-nullable rather than
 * merely absent, which is what distinguishes a scene from an arbitrary object
 * that happens to carry a `geometry` field.
 */
export function isScene(value: unknown): value is Scene {
  if (typeof value !== "object" || value === null) return false;
  const scene = value as Partial<Scene>;
  return (
    Array.isArray(scene.geometry) &&
    Array.isArray(scene.lights) &&
    "camera" in scene &&
    (scene.camera === null || typeof scene.camera === "object")
  );
}

/** The promotion: a geometry is a scene with the viewport's camera and no lights. */
export function sceneFromGeometry(geometry: Geometry): Scene {
  return { geometry: [geometry], camera: null, lights: [] };
}

/**
 * Read a `scene` input, which may have received a `geometry`.
 *
 * `geometry` widens to `scene` in `IMPLICIT_TYPE_CONVERSIONS`, so a node
 * declaring a `scene` input can be handed either. **Every consumer of a scene
 * input must go through this**, and that is the whole contract: the alternative
 * is each consumer testing `isScene` and getting the fallback subtly different,
 * which is how a viewport and a render node end up framing the same graph two
 * ways.
 *
 * Returns `EMPTY_SCENE` for a missing input rather than throwing, because an
 * unwired viewport is a normal state and not an error — and for anything that
 * is neither a scene nor a geometry, because a viewport that throws on a
 * surprising value is a viewport that goes black while the graph is fine. The
 * connection rules are what stop a wrong type arriving; this is the floor under
 * them, not the check.
 */
export function asScene(value: unknown): Scene {
  if (value === undefined || value === null) return EMPTY_SCENE;
  if (isScene(value)) return value;
  if (typeof value === "object" && (value as Geometry).kind === "geometry")
    return sceneFromGeometry(value as Geometry);
  return EMPTY_SCENE;
}
