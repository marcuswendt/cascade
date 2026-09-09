import { POSITION_ATTRIBUTE, type Geometry } from "@cascade/contracts";

import { GeometryBuilder } from "../geometry/builder.js";

/**
 * Trails, following Houdini's Trail SOP.
 *
 * Marcus, 2026-09-09: *"particle trails as geometry is neater"*, and then
 * *"Caching just needs to be considered. Houdini has a nice trail node for
 * this."* Both are load-bearing. Trails being geometry rather than a faded
 * canvas is what keeps one feedback loop instead of two and makes the result
 * printable; Houdini's Trail is the precedent for how the history is held.
 *
 * **The window is passed in, not held here.** Houdini's Trail keeps a rolling
 * window of previous frames rather than re-cooking backwards to find them, and
 * that is the shape — but a module-level buffer is exactly the per-cook state
 * `cascade check` refuses, and it is what would make a cook depend on how many
 * times it had run. So this function takes the history and returns geometry,
 * and whoever owns the cache passes it.
 *
 * A trail needs `length` frames of positions, not the whole simulation state,
 * so the window is bounded where a state cache is not — which is why the
 * plan's *one cache mechanism, two clients* holds.
 */

/** One frame of history: a particle id and where it was. */
export interface TrailFrame {
  readonly id: Int32Array;
  readonly position: Float64Array;
  readonly size: number;
}

export type TrailResult =
  /** The input points, untouched. Houdini's default. */
  | "preserve"
  /** One open polyline per particle, oldest to newest. */
  | "polylines"
  /** Velocity derived from successive positions, written to `v`, no lines. */
  | "velocity";

export interface TrailOptions {
  readonly result?: TrailResult;
  /** Frames of history to use. Houdini's `length`. */
  readonly length?: number;
  /** Use every nth frame. Houdini's `increment`. */
  readonly increment?: number;
  /** Weights the derived velocity. Houdini's `velocityscale`. */
  readonly velocityscale?: number;
}

/**
 * Read one frame of history out of a particle geometry.
 *
 * Positions only. A trail does not need velocity, age or life, and copying
 * them would make the window several times larger for nothing — the size of
 * the window is the whole reason this is cheaper than a state cache.
 */
export function trailFrame(geometry: Geometry): TrailFrame {
  const position = geometry.point[POSITION_ATTRIBUTE]!;
  return {
    id: Int32Array.from((geometry.point.id?.data ?? new Int32Array(0)) as ArrayLike<number>),
    position: Float64Array.from(position.data as ArrayLike<number>),
    size: position.size,
  };
}

/**
 * Build trails from a history, oldest frame first.
 *
 * **Joined on `id`, never on index.** A particle array reorders on every kill,
 * so index 3 in one frame is not index 3 in the next — joining by position in
 * the array would draw a stroke from one particle to an unrelated one, which is
 * the exact fault the mandatory `id` exists to prevent and would look like a
 * plausible tangle rather than an error.
 */
export function buildTrails(
  history: readonly TrailFrame[],
  current: Geometry,
  options: TrailOptions = {},
): Geometry {
  const { result = "polylines", length = 12, increment = 1, velocityscale = 1 } = options;
  if (result === "preserve") return current;

  const frames = sampled(history, length, increment);
  const size = frames[0]?.size ?? 2;

  // id -> the positions it held, oldest first.
  const paths = new Map<number, number[]>();
  for (const frame of frames) {
    for (let index = 0; index < frame.id.length; index += 1) {
      const id = frame.id[index]!;
      const path = paths.get(id) ?? [];
      path.push(
        frame.position[index * frame.size]!,
        frame.position[index * frame.size + 1]!,
      );
      paths.set(id, path);
    }
  }

  if (result === "velocity") {
    return withDerivedVelocity(current, paths, velocityscale);
  }

  const builder = new GeometryBuilder({ positionSize: 2 });
  const trailIds: number[] = [];
  for (const [id, path] of paths) {
    // A single position is a point, not a line. Houdini's Trail emits nothing
    // for a particle born this frame, and a one-point polyline would be a
    // primitive that draws as nothing while counting as something.
    if (path.length < 4) continue;
    const points: number[] = [];
    for (let at = 0; at < path.length; at += 2) {
      points.push(builder.addPoint(path[at]!, path[at + 1]!));
    }
    // `poly`, open. `PRIMITIVE_KINDS` has no separate polyline: an open poly
    // IS one, which is Houdini's model too.
    builder.addPrimitive(points, { closed: false, kind: "poly" });
    trailIds.push(id);
  }

  if (trailIds.length > 0) {
    // Carried to the primitive level so a downstream node can still tell which
    // particle a stroke belongs to — a trail that loses its id is back to
    // being addressed by position in an array.
    builder.setNumericAttribute("primitive", "id", Int32Array.from(trailIds), 1, "i32");
  }
  void size;
  return builder.build();
}

/** The frames a trail actually uses: the last `length`, every `increment`th,
 *  oldest first. */
function sampled(
  history: readonly TrailFrame[],
  length: number,
  increment: number,
): readonly TrailFrame[] {
  const step = Math.max(1, Math.floor(increment));
  const window = history.slice(Math.max(0, history.length - length * step));
  if (step === 1) return window;
  // Counted back from the newest, so the current frame is always included —
  // a trail whose head lags the particle reads as the whole system trailing.
  const picked: TrailFrame[] = [];
  for (let index = window.length - 1; index >= 0; index -= step) picked.unshift(window[index]!);
  return picked;
}

/**
 * Houdini's *Compute Velocity* result: `v` from successive positions.
 *
 * A genuinely separate use of the same history, which is why the plan says the
 * extra modes cost almost nothing once the window exists — and why `Trail` is
 * more than a node that draws lines.
 */
function withDerivedVelocity(
  current: Geometry,
  paths: ReadonlyMap<number, readonly number[]>,
  velocityscale: number,
): Geometry {
  const size = current.point[POSITION_ATTRIBUTE]!.size;
  const ids = current.point.id?.data as ArrayLike<number> | undefined;
  const velocity = new Float32Array(current.pointCount * size);

  for (let index = 0; index < current.pointCount; index += 1) {
    const path = ids ? paths.get(Number(ids[index])) : undefined;
    if (!path || path.length < 4) continue;
    const last = path.length;
    velocity[index * size] = (path[last - 2]! - path[last - 4]!) * velocityscale;
    velocity[index * size + 1] = (path[last - 1]! - path[last - 3]!) * velocityscale;
  }

  return {
    ...current,
    point: { ...current.point, v: { storage: "f32", size, data: velocity } },
  };
}
