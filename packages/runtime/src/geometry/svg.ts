import {
  Color,
  isStringAttribute,
  type AnyAttribute,
  type Attribute,
  type Geometry,
} from "@cascade/contracts";

import {
  geometryError,
  numericAttribute,
  positionAttribute,
  readComponent,
} from "./attributes.js";
import { groupNames } from "./groups.js";
import {
  bezierSegments,
  geometryBounds,
  isBezier,
  isClosed,
  loosePointMask,
  primitivePoints,
} from "./primitives.js";

/**
 * Geometry to an SVG document. The node that makes the library provably useful,
 * because it produces a file to print or plot rather than an assertion.
 *
 * ## The Y flip lives here and nowhere else
 *
 * Geometry is +Y up: Marcus ruled on that, so a `Circle` at `+1` sits above the
 * origin and every operation upstream reads the same way. SVG, Canvas and the
 * existing rasterizer are all +Y down. The whole point of deciding the handedness
 * once is that there is then exactly one flip, and this is it: a
 * `transform="scale(1,-1)"` on the root group, with the viewBox's `y` set to
 * `-maxY` so the flipped content lands inside it.
 *
 * Do not "fix" this by negating anywhere upstream. A flip applied per operation
 * is the version that produces a drawing which is right until something rotates.
 *
 * ## Style is an attribute, with the prop as the fallback
 *
 * `Cd`, `width` and `opacity` are read per primitive when present and taken
 * from the caller's default when absent. That rule is not invented here:
 * `cloud-plots/src/cloud_plots/svgio.py` already runs it as
 * `color = r.get("color", mark_color)`, having arrived at Houdini's convention
 * independently. So the defaults go on the root group and a per-primitive value
 * is emitted only where it exists, which also keeps the file small.
 *
 * ## Colour is a `vec4`, and this file is where it becomes text
 *
 * `Cd` is a four-component colour and nothing else. A string `Cd` used to be
 * accepted here so that `cloud-plots`' `"#3a7f5c"` could be stored verbatim;
 * Marcus overruled that 2026-09-04, so a hex string is now converted at the
 * boundary by `Color.fromHex` and the attribute holds the vector. An emitted
 * paint goes through `Color.toHex`, and `Cd`'s alpha becomes a separate
 * `stroke-opacity` rather than an eight-digit hex, because plotter and
 * vector-editor software does not read CSS Color 4.
 *
 * A `Cd` that is a string, or numeric with any size but 4, is refused rather
 * than ignored. Silently dropping a colour attribute is the exact bug the plan
 * records twice in `cloud-plots`, and an export that quietly turns black is
 * worse than one that says why.
 *
 * ## One group element per primitive group
 *
 * Not a refinement either: `cloud-plots` carries a whole `layer-group` node and
 * a layers path through its Python writer so that plotter software can assign a
 * pen per layer, and duplicates the geometry per layer to express it. A
 * primitive belongs to exactly one emitted group, the first it is a member of in
 * insertion order, because a pen is not a set.
 */
export interface SvgExportOptions {
  /** Document width; 0 or absent derives it from the geometry bounds. */
  readonly width?: number;
  readonly height?: number;
  /** Added around the derived bounds, in geometry units. */
  readonly margin?: number;
  /** Fallback stroke colour for a primitive with no `Cd`. */
  readonly stroke?: Color;
  /** Fallback stroke width for a primitive with no `width`. */
  readonly strokeWidth?: number;
  /** Fallback opacity for a primitive with no `opacity`. */
  readonly opacity?: number;
  /**
   * Fill colour for every primitive, applied only when `fillMode` is "solid".
   *
   * Fill is two settings rather than one because a zero-alpha fill and SVG's
   * `fill="none"` are not the same thing: `none` says the region is not filled,
   * while a transparent fill says it is filled with nothing, and a plotter
   * driver reading the second still generates a fill toolpath. Inferring the
   * intent from alpha also throws the colour away, so a fill cannot be switched
   * back on without picking it again. Declaring the mode keeps the two
   * independent. Stroke has no matching mode because nothing exports geometry
   * with no stroke, and inventing one for symmetry would add a way to produce an
   * empty file.
   */
  readonly fill?: Color;
  readonly fillMode?: "none" | "solid";
  /** Radius for a loose point with no `pscale`. */
  readonly pointRadius?: number;
  /** Decimal places on emitted coordinates. */
  readonly precision?: number;
}

const UNGROUPED = "ungrouped";
const BLACK: Color = [0, 0, 0, 1];

export function geometryToSvg(
  geometry: Geometry,
  options: SvgExportOptions = {},
): string {
  validateOptions(options);
  const margin = options.margin ?? 0;
  const bounds = geometryBounds(geometry);
  const minX = bounds === undefined ? 0 : bounds.min[0] - margin;
  const minY = bounds === undefined ? 0 : bounds.min[1] - margin;
  const maxX = bounds === undefined ? 1 : bounds.max[0] + margin;
  const maxY = bounds === undefined ? 1 : bounds.max[1] + margin;
  const spanX = Math.max(maxX - minX, Number.EPSILON);
  const spanY = Math.max(maxY - minY, Number.EPSILON);
  const width = options.width && options.width > 0 ? options.width : spanX;
  const height = options.height && options.height > 0 ? options.height : spanY;
  const precision = options.precision ?? 3;
  const number = (value: number) => format(value, precision);

  const stroke = options.stroke ?? BLACK;
  const strokeWidth = options.strokeWidth ?? 1;
  const fill = options.fill ?? BLACK;
  const filled = (options.fillMode ?? "none") === "solid";

  const colour = geometry.primitive.Cd;
  const strokeWidths = numericAttribute(geometry.primitive.width, "primitive.width", [1]);
  const opacities = numericAttribute(geometry.primitive.opacity, "primitive.opacity", [1]);
  const pointScale = numericAttribute(geometry.point.pscale, "point.pscale", [1]);
  const pointColour = geometry.point.Cd;
  validateRange(strokeWidths, "primitive.width", (value) => value >= 0, "non-negative");
  validateRange(opacities, "primitive.opacity", (value) => value >= 0 && value <= 1, "between 0 and 1");
  validateRange(pointScale, "point.pscale", (value) => value >= 0, "non-negative");

  const names = groupNames(geometry, "primitive");
  const assigned = new Int32Array(geometry.primitiveCount).fill(-1);
  for (let index = 0; index < names.length; index += 1) {
    const mask = geometry.primitiveGroups[names[index]!]!;
    for (let primitive = 0; primitive < geometry.primitiveCount; primitive += 1)
      if (mask[primitive] === 1 && assigned[primitive] === -1)
        assigned[primitive] = index;
  }

  const path = (primitive: number): string => {
    const attributes: string[] = [`d="${pathData(geometry, primitive, number)}"`];
    const paint = paintOf(colour, primitive, "primitive");
    if (paint !== undefined) {
      attributes.push(`stroke="${Color.toHex(paint)}"`);
      if (Color.alpha(paint) < 1)
        attributes.push(`stroke-opacity="${number(Color.alpha(paint))}"`);
    }
    if (strokeWidths !== undefined)
      attributes.push(
        `stroke-width="${number(readComponent(strokeWidths, primitive))}"`,
      );
    if (opacities !== undefined)
      attributes.push(`opacity="${number(readComponent(opacities, primitive))}"`);
    return `<path ${attributes.join(" ")} />`;
  };

  const body: string[] = [];
  if (names.length === 0) {
    for (let primitive = 0; primitive < geometry.primitiveCount; primitive += 1)
      body.push(indent(path(primitive), 2));
  } else {
    for (let index = 0; index < names.length; index += 1) {
      const members: string[] = [];
      for (
        let primitive = 0;
        primitive < geometry.primitiveCount;
        primitive += 1
      )
        if (assigned[primitive] === index)
          members.push(indent(path(primitive), 3));
      body.push(
        indent(`<g id="${escapeXml(names[index]!)}">`, 2),
        ...members,
        indent("</g>", 2),
      );
    }
    const rest: string[] = [];
    for (let primitive = 0; primitive < geometry.primitiveCount; primitive += 1)
      if (assigned[primitive] === -1) rest.push(indent(path(primitive), 3));
    if (rest.length > 0)
      body.push(
        indent(`<g id="${UNGROUPED}">`, 2),
        ...rest,
        indent("</g>", 2),
      );
  }

  // Loose points are the dots: a point no primitive references. `cascade-logo`
  // is half made of them and `cloud-plots` stipples thousands, so they are a
  // first-class part of the drawing rather than debris. They take their radius
  // from `pscale`, which is Houdini's name for exactly that quantity and what
  // the Python stipple stage already means by its third position component.
  const loose = loosePointMask(geometry);
  const position = positionAttribute(geometry);
  for (let point = 0; point < geometry.pointCount; point += 1) {
    if (loose[point] !== 1) continue;
    const radius =
      pointScale === undefined
        ? (options.pointRadius ?? 0.5)
        : readComponent(pointScale, point);
    const paint = paintOf(pointColour, point, "point") ?? stroke;
    const transparent = Color.alpha(paint) < 1;
    body.push(
      indent(
        `<circle cx="${number(readComponent(position, point, 0))}" cy="${number(
          readComponent(position, point, 1),
        )}" r="${number(radius)}" fill="${Color.toHex(paint)}"${
          transparent ? ` fill-opacity="${number(Color.alpha(paint))}"` : ""
        } stroke="none" />`,
        2,
      ),
    );
  }

  const root: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}" height="${number(height)}" viewBox="${number(minX)} ${number(-maxY)} ${number(spanX)} ${number(spanY)}">`,
    indent("<!-- Geometry is +Y up; SVG is +Y down. This is the one flip. -->", 1),
    indent(
      `<g transform="scale(1,-1)" fill="${
        filled ? Color.toHex(fill) : "none"
      }"${
        filled && Color.alpha(fill) < 1
          ? ` fill-opacity="${number(Color.alpha(fill))}"`
          : ""
      } stroke="${Color.toHex(stroke)}"${
        Color.alpha(stroke) < 1
          ? ` stroke-opacity="${number(Color.alpha(stroke))}"`
          : ""
      } stroke-width="${number(strokeWidth)}"${
        options.opacity !== undefined && options.opacity !== 1
          ? ` opacity="${number(options.opacity)}"`
          : ""
      }>`,
      1,
    ),
    ...body,
    indent("</g>", 1),
    "</svg>",
  ];
  return `${root.join("\n")}\n`;
}

function pathData(
  geometry: Geometry,
  primitive: number,
  number: (value: number) => string,
): string {
  const position = positionAttribute(geometry);
  const at = (point: number) =>
    `${number(readComponent(position, point, 0))} ${number(
      readComponent(position, point, 1),
    )}`;
  const closed = isClosed(geometry, primitive);
  if (isBezier(geometry, primitive)) {
    const segments = bezierSegments(geometry, primitive);
    if (segments.length === 0) return "";
    const commands = [`M ${at(segments[0]![0]!)}`];
    for (const [, first, second, end] of segments)
      commands.push(`C ${at(first!)} ${at(second!)} ${at(end!)}`);
    if (closed) commands.push("Z");
    return commands.join(" ");
  }
  const points = primitivePoints(geometry, primitive);
  if (points.length === 0) return "";
  const commands = [`M ${at(points[0]!)}`];
  for (let index = 1; index < points.length; index += 1)
    commands.push(`L ${at(points[index]!)}`);
  if (closed) commands.push("Z");
  return commands.join(" ");
}

/**
 * The colour of one element from a `Cd` attribute. `Cd` is a `vec4` and this
 * refuses anything else, loudly: a string attribute is the representation the
 * ruling removed, and a numeric attribute of any other size is a colour whose
 * components do not mean what the reader assumes.
 */
function paintOf(
  attribute: AnyAttribute | undefined,
  index: number,
  level: string,
): Color | undefined {
  if (attribute === undefined) return undefined;
  if (isStringAttribute(attribute))
    geometryError(
      "colour-storage",
      `${level}.Cd is a string attribute; colour is a vec4. Convert with Color.fromHex at the boundary.`,
    );
  if (attribute.size !== 4)
    geometryError(
      "colour-size",
      `${level}.Cd has size ${attribute.size}; colour is a vec4`,
    );
  return Color.fromComponents(attribute.data, index * 4, 4);
}

function format(value: number, precision: number): string {
  if (!Number.isFinite(value))
    geometryError("svg-number", `cannot format non-finite value ${String(value)}`);
  const rounded = Number.parseFloat(value.toFixed(precision));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function validateOptions(options: SvgExportOptions): void {
  for (const [name, value] of [
    ["width", options.width],
    ["height", options.height],
    ["margin", options.margin],
    ["strokeWidth", options.strokeWidth],
    ["opacity", options.opacity],
    ["pointRadius", options.pointRadius],
  ] as const) {
    if (value !== undefined && !Number.isFinite(value))
      geometryError("svg-option", `${name} must be finite`);
  }
  if ((options.width ?? 0) < 0 || (options.height ?? 0) < 0)
    geometryError("svg-option", "width and height must not be negative");
  if ((options.strokeWidth ?? 0) < 0 || (options.pointRadius ?? 0) < 0)
    geometryError("svg-option", "strokeWidth and pointRadius must not be negative");
  if (options.opacity !== undefined && (options.opacity < 0 || options.opacity > 1))
    geometryError("svg-option", "opacity must be between 0 and 1");
  const precision = options.precision ?? 3;
  if (!Number.isSafeInteger(precision) || precision < 0 || precision > 15)
    geometryError("svg-precision", "precision must be an integer from 0 to 15");
}

function validateRange(
  attribute: Attribute | undefined,
  path: string,
  accepts: (value: number) => boolean,
  expectation: string,
): void {
  if (attribute === undefined) return;
  for (const value of attribute.data)
    if (!accepts(value))
      geometryError("attribute-value", `${path} values must be ${expectation}`);
}

function indent(line: string, depth: number): string {
  return `${"  ".repeat(depth)}${line}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * UTF-8 bytes for a document, hand-rolled because the runtime's `lib` is
 * `ES2022` and nothing else: `TextEncoder` exists in every host that will ever
 * run this but is typed in the DOM and Node libraries, which this package
 * deliberately does not include. Adding either to see one constructor would
 * widen the environment-neutral surface for the sake of a nine-line loop.
 */
export function utf8Bytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    let code = character.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000)
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    else
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    code = 0;
  }
  return Uint8Array.from(bytes);
}
