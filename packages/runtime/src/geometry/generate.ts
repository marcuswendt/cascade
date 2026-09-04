import type { Geometry } from "@cascade/contracts";

import { geometryError } from "./attributes.js";
import { GeometryBuilder } from "./builder.js";

/**
 * The generators. Each returns one primitive in a geometry of its own, so a
 * graph composes them with `Merge` rather than with a multi-shape node.
 *
 * Geometry is +Y up, so a circle of radius 1 has a point at `(0, 1)` above the
 * origin and a rectangle's first corner is its bottom-left one. The flip into
 * SVG's frame lives in `geometryToSvg` and nowhere else.
 */

export interface RectangleOptions {
  /** Width and height, as Houdini's Grid states its size. */
  readonly size?: readonly [number, number];
  readonly center?: readonly [number, number];
}

function finitePair(value: readonly [number, number], code: string): void {
  if (!Number.isFinite(value[0]) || !Number.isFinite(value[1]))
    geometryError(code, "both components must be finite");
}

/**
 * A closed four-point polygon, counter-clockwise from the bottom-left corner.
 * Houdini has no Rectangle: its Grid with two rows and two columns does the
 * job, and `size` and `center` are that node's parameter names.
 */
export function rectangleGeometry(options: RectangleOptions = {}): Geometry {
  const [width, height] = options.size ?? [1, 1];
  const [cx, cy] = options.center ?? [0, 0];
  finitePair([width, height], "rectangle-size");
  finitePair([cx, cy], "rectangle-center");
  if (width < 0 || height < 0)
    geometryError("rectangle-size", "rectangle size must not be negative");
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  const y0 = cy - height / 2;
  const y1 = cy + height / 2;
  const builder = new GeometryBuilder();
  builder.addPolygon([x0, y0, x1, y0, x1, y1, x0, y1], { closed: true });
  return builder.build();
}

export interface CircleOptions {
  readonly center?: readonly [number, number];
  /** X and Y radius, as Houdini's Circle states its radius. */
  readonly radius?: readonly [number, number];
  /**
   * Houdini's Circle "Primitive Type". `bezier` is the default because a circle
   * is a circle: four cubic segments hold it to within 0.02% of the true arc,
   * where a polygon of any division count is visibly a polygon in print.
   */
  readonly type?: "bezier" | "poly";
  /** Houdini's Circle "Divisions". Used by `poly` only. */
  readonly divisions?: number;
}

/**
 * A closed circle, either as one cubic Bézier chain or as one polygon.
 *
 * The Bézier form is four segments with the classic handle length
 * `k = 4/3 · tan(π/8)`, which is the standard four-arc approximation and the
 * one every vector tool uses. Twelve points: four anchors at the axes and two
 * handles between each pair.
 */
export function circleGeometry(options: CircleOptions = {}): Geometry {
  const [cx, cy] = options.center ?? [0, 0];
  const [rx, ry] = options.radius ?? [1, 1];
  finitePair([cx, cy], "circle-center");
  finitePair([rx, ry], "circle-radius");
  if (rx < 0 || ry < 0)
    geometryError("circle-radius", "circle radius must not be negative");
  const builder = new GeometryBuilder();
  if ((options.type ?? "bezier") === "poly") {
    const divisions = options.divisions ?? 32;
    if (!Number.isSafeInteger(divisions) || divisions < 3)
      geometryError(
        "circle-divisions",
        "a polygonal circle needs an integer division count of at least 3",
      );
    const flat: number[] = [];
    for (let index = 0; index < divisions; index += 1) {
      const angle = (2 * Math.PI * index) / divisions;
      flat.push(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle));
    }
    builder.addPolygon(flat, { closed: true });
    return builder.build();
  }
  const k = (4 / 3) * Math.tan(Math.PI / 8);
  const kx = rx * k;
  const ky = ry * k;
  // Anchor, handle, handle, per quarter, counter-clockwise from +X.
  const flat = [
    cx + rx, cy,
    cx + rx, cy + ky,
    cx + kx, cy + ry,
    cx, cy + ry,
    cx - kx, cy + ry,
    cx - rx, cy + ky,
    cx - rx, cy,
    cx - rx, cy - ky,
    cx - kx, cy - ry,
    cx, cy - ry,
    cx + kx, cy - ry,
    cx + rx, cy - ky,
  ];
  builder.addPolygon(flat, { closed: true, kind: "bezier" });
  return builder.build();
}
