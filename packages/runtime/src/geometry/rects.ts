import type { Geometry, Rect, Rects } from "@cascade/contracts";

import { GeometryBuilder } from "./builder.js";

/**
 * `rects` into `geometry` — the conversion that gives the type consumers.
 *
 * `rects` has been a declared core type with **zero consumers in the runtime**:
 * nothing converted it, `cascade.geo.SvgExport` takes only `geometry`, and
 * `cloud-plots` rendered its rects through its own Python export instead.
 * Marcus decided on 2026-09-12 that this lands now rather than after the
 * cutover.
 *
 * ## Why a conversion and not a second input on `SvgExport`
 *
 * MW-OBSERVATORY-ART's argument, as the owner of the consuming code, and it is
 * the right one: a second input would make **every** geometry consumer learn
 * about `rects` separately — the SVG writer, then the renderer, then the
 * viewport — which is three type vocabularies again by another route. One
 * conversion means `rects` reaches all of them at once and none of them
 * changes.
 *
 * ## Two wire shapes, because the producer and the contract disagree
 *
 * `packages/contracts` declares a rect as `{ x, y, width, height, tag? }`. The
 * only thing that actually produces rects — `cloud-plots`' Python
 * `node_cli.py` — emits `{ "rect": [x, y, w, h], "tag": "<name>" }`, measured
 * by MW-OBSERVATORY-ART rather than remembered. Both are accepted here.
 *
 * Being permissive is deliberate: the declared shape has no producer and the
 * produced shape has no declaration, so refusing either would mean the
 * conversion works for nothing that exists or for nothing that is written
 * down. Which of the two becomes canonical is a separate decision, and this
 * keeps working whichever way it goes.
 *
 * ## The tag rides along, and that was the condition
 *
 * *"A conversion that keeps the four numbers and drops the tag would silently
 * destroy the labelling, and the failure would show up as unlabelled marks in
 * a poster rather than as an error."* So every rect's tag becomes a
 * **primitive-level string attribute** named `tag` — geometry has string
 * attributes, so this is lossless rather than an approximation, and `SvgExport`
 * and the renderer already read primitive attributes for style.
 */

/** The shape `cloud-plots` actually emits. */
interface TaggedBox {
  readonly rect: readonly [number, number, number, number];
  readonly tag?: string;
}

export type RectLike = Rect | TaggedBox;

export interface RectsToGeometryOptions {
  /**
   * Where a rect's `y` is measured from.
   *
   * **`top-left` is raster space**, which is what `cloud-plots` produces —
   * pixel coordinates against the image, clamped to its bounds by
   * `_clamp_rects`. Cascade geometry is **+Y up**, and `geometryToSvg` flips on
   * the way out, so a raster rect passed through unflipped comes out of the SVG
   * writer mirrored. Converting with `top-left` and a `height` is what makes
   * the picture come back the way the analyst saw it.
   *
   * `bottom-left` passes the numbers through and is right for anything already
   * in geometry's own space.
   */
  readonly origin?: "top-left" | "bottom-left";
  /**
   * The image height, for `top-left`. Zero means no flip.
   *
   * Required rather than inferred, because the rects themselves do not carry
   * the frame they were measured against — flipping about the tallest rect
   * would be a guess that looks right on a full-height mark and wrong on every
   * other one.
   */
  readonly height?: number;
}

function coordinates(rect: RectLike): readonly [number, number, number, number] | null {
  if (Array.isArray((rect as TaggedBox).rect)) {
    const box = (rect as TaggedBox).rect;
    if (box.length < 4 || box.some((value) => typeof value !== "number")) return null;
    return [box[0]!, box[1]!, box[2]!, box[3]!];
  }
  const declared = rect as Rect;
  if (
    typeof declared?.x !== "number" ||
    typeof declared?.y !== "number" ||
    typeof declared?.width !== "number" ||
    typeof declared?.height !== "number"
  )
    return null;
  return [declared.x, declared.y, declared.width, declared.height];
}

/**
 * One closed four-point polygon per rect, counter-clockwise from the corner
 * nearest the origin — the same winding `rectangleGeometry` produces, so a
 * converted rect and an authored rectangle behave identically downstream.
 *
 * A rect with a non-finite or missing number is **skipped**, and the count of
 * what was skipped is on the geometry as a `rects_skipped` detail. Throwing
 * would make one bad mark in a thousand lose the other nine hundred and
 * ninety-nine; silence would lose them without saying so.
 */
export function rectsToGeometry(
  value: Rects | readonly RectLike[] | null | undefined,
  options: RectsToGeometryOptions = {},
): Geometry {
  const list: readonly RectLike[] = Array.isArray(value)
    ? (value as readonly RectLike[])
    : ((value as Rects)?.rects ?? []);
  const flip = options.origin === "top-left" ? (options.height ?? 0) : 0;

  const builder = new GeometryBuilder();
  const tags: string[] = [];
  let skipped = 0;
  let tagged = false;

  for (const rect of list) {
    const box = coordinates(rect);
    if (!box || box.some((component) => !Number.isFinite(component))) {
      skipped += 1;
      continue;
    }
    const [x, y, width, height] = box;
    // In raster space `y` is the TOP edge and grows downwards, so the flip is
    // about the frame and the box's own height comes back off it.
    const bottom = flip > 0 ? flip - (y + height) : y;
    const top = bottom + height;
    builder.addPolygon([x, bottom, x + width, bottom, x + width, top, x, top], {
      closed: true,
    });
    const tag = (rect as { tag?: unknown }).tag;
    tags.push(typeof tag === "string" ? tag : "");
    if (typeof tag === "string" && tag.length > 0) tagged = true;
  }

  // Only when something is actually labelled: an attribute of empty strings on
  // every primitive is noise in the Inspector and in every exported file.
  if (tagged) builder.setStringAttribute("primitive", "tag", tags);
  if (skipped > 0) builder.setDetail("rects_skipped", skipped);
  return builder.build();
}

/** True for either accepted wire shape. Used by the node to say what arrived
 *  when something else does. */
export function isRectLike(value: unknown): value is RectLike {
  return (
    typeof value === "object" && value !== null && coordinates(value as RectLike) !== null
  );
}
