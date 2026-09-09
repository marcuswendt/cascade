import {
  POSITION_ATTRIBUTE,
  type Camera,
  type Color,
  type Geometry,
} from "@cascade/contracts";

import { projectionMatrix, viewMatrix } from "../camera/index.js";
import { numericAttribute, readElement } from "./attributes.js";

/**
 * Geometry to a raster, through the camera the render node was given.
 *
 * Step 2 of `PLAN viewport.md`, and the half that matters for correctness. The
 * plan's central rule: **a scene view and a render node must agree, and the
 * only way to guarantee that is both going through `packages/runtime/src/camera`.**
 * If a viewport implements its own matrices, the two disagree about framing and
 * every composition made in one is wrong in the other.
 *
 * So this file owns no projection maths at all. `viewMatrix` and
 * `projectionMatrix` came from the camera module this morning, with Houdini's
 * conventions already in them — down -Z, +Y up, `focal` and `aperture` rather
 * than a field of view. All that happens here is the multiply and the raster.
 *
 * **Wireframe and points, deliberately, and not because shading is hard.** Every
 * piece in this vault is lines: `cloud-volumes` is a volume, `particle-type` is
 * trails, `cloud-plots` is marks. A shaded mode needs normals and a light and
 * nothing here has a surface to put them on, so it would be a week spent on a
 * mode with no caller.
 */

export interface RenderOptions {
  readonly camera: Camera;
  /** Pixels. Independent of the camera's own `resolution`, which describes the
   *  frame the projection assumes — a preview renders small and frames the
   *  same. */
  readonly size: readonly [number, number];
  readonly background?: Color;
  /** Fallback stroke for a primitive with no `Cd`. */
  readonly stroke: Color;
  readonly strokeWidth: number;
  readonly opacity: number;
  /** Radius in pixels for a point with no primitive to belong to. */
  readonly pointRadius: number;
  /** Draw unprimitived points at all. A trail system has thousands and they
   *  are usually noise beside the strokes. */
  readonly drawPoints: boolean;
  /** How to make a canvas. The caller has a host; this file does not. */
  readonly surface: SurfaceFactory;
}

/**
 * The canvas surface this needs, declared rather than imported.
 *
 * `packages/runtime` compiles with `lib: ["ES2022"]` and no DOM, deliberately:
 * it is the host-agnostic half of the system and a `dom` lib would let a DOM
 * assumption into it by accident. So rather than widening that, this states the
 * dozen members it actually uses. Both hosts satisfy it — the browser natively,
 * the headless host through @napi-rs/canvas — and the narrow shape is also the
 * documentation of what a future host would have to provide.
 */
export interface DrawingSurface {
  readonly width: number;
  readonly height: number;
  getContext(kind: "2d"): DrawingContext | null;
  /** How the raster leaves: both hosts return a PNG blob, and the asset
   *  capability takes bytes. */
  convertToBlob(options?: { type?: string }): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
}

export interface DrawingContext {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  globalAlpha: number;
  fillRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, from: number, to: number): void;
  stroke(): void;
  fill(): void;
}

/**
 * Where a surface comes from, injected rather than reached for.
 *
 * The first version called `new OffscreenCanvas(...)` directly and it was the
 * wrong structure twice over. `packages/runtime` is the host-agnostic half of
 * the system, so a global is exactly the assumption it should not make — and
 * the test environment proved it immediately with *"OffscreenCanvas is not
 * defined"*, because the global is installed by the CLI host and by the
 * browser, not by node.
 *
 * So the host assumption lives in the node that has a host, and this file
 * takes a factory. Which also makes the renderer testable, and a renderer that
 * cannot be tested without a browser is the thing `PLAN viewport` argues
 * against building.
 */
export type SurfaceFactory = (width: number, height: number) => DrawingSurface;

/** One projected vertex: pixels, plus the depth that decides clipping. */
interface Projected {
  readonly x: number;
  readonly y: number;
  /** Clip-space w. At or below zero the vertex is behind the camera. */
  readonly w: number;
}

/**
 * A canvas the host already has.
 *
 * Both hosts supply `OffscreenCanvas` — the browser natively, the headless host
 * through @napi-rs/canvas — which is why the node is `portable` with no
 * capability for drawing and only needs `assets` to write the result.
 */
function css(colour: Color): string {
  const [r, g, b, a = 1] = colour as unknown as readonly number[];
  return `rgba(${Math.round(r! * 255)}, ${Math.round(g! * 255)}, ${Math.round(b! * 255)}, ${a})`;
}

/** Column-major, GLSL convention, matching the camera module's own output. */
function multiply(matrix: readonly number[], x: number, y: number, z: number): readonly number[] {
  return [0, 1, 2, 3].map((row) =>
    matrix[row]! * x + matrix[4 + row]! * y + matrix[8 + row]! * z + matrix[12 + row]!,
  );
}

export function renderGeometry(
  geometry: Geometry,
  options: RenderOptions,
): DrawingSurface {
  const [width, height] = options.size;
  const canvas = options.surface(
    Math.max(1, Math.round(width)),
    Math.max(1, Math.round(height)),
  );
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2D context on this surface");

  if (options.background && (options.background as unknown as readonly number[])[3]! > 0) {
    context.fillStyle = css(options.background);
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  const view = viewMatrix(options.camera);
  const projection = projectionMatrix(options.camera);
  const position = geometry.point[POSITION_ATTRIBUTE];
  if (!position || position.storage === "string") return canvas;
  const size = position.size;
  const points = position.data as ArrayLike<number>;

  const projected: Projected[] = [];
  for (let index = 0; index < geometry.pointCount; index += 1) {
    const world = multiply(
      view,
      Number(points[index * size]),
      Number(points[index * size + 1]),
      size >= 3 ? Number(points[index * size + 2]) : 0,
    );
    const clip = multiply(projection, world[0]!, world[1]!, world[2]!);
    // The perspective divide. `w` is kept so a segment with one vertex behind
    // the camera can be dropped rather than drawn mirrored — which is what
    // dividing by a negative w produces, and it looks like a plausible line.
    const w = clip[3]!;
    projected.push({
      x: (clip[0]! / w + 1) * 0.5 * canvas.width,
      y: (1 - (clip[1]! / w + 1) * 0.5) * canvas.height,
      w,
    });
  }

  // Validated to the sizes the style vocabulary declares, so a `Cd` with three
  // components is refused rather than read as a colour with a missing channel.
  // That rule is PLAN geometry's and SvgExport already enforces it; a renderer
  // that was laxer would draw what the exporter refuses.
  const colours = numericAttribute(geometry.primitive.Cd, "primitive.Cd", [4]);
  const widths = numericAttribute(geometry.primitive.width, "primitive.width", [1]);

  context.lineCap = "round";
  context.lineJoin = "round";
  context.globalAlpha = options.opacity;

  const { vertexPoints, offsets, closed } = geometry.topology;
  const drawn = new Set<number>();

  for (let primitive = 0; primitive < geometry.primitiveCount; primitive += 1) {
    const from = offsets[primitive]!;
    const to = offsets[primitive + 1]!;
    if (to - from < 2) continue;

    context.strokeStyle = colours
      ? css(readElement(colours, primitive) as unknown as Color)
      : css(options.stroke);
    context.lineWidth = widths ? readElement(widths, primitive)[0]! : options.strokeWidth;

    context.beginPath();
    let open = false;
    for (let vertex = from; vertex < to; vertex += 1) {
      const point = vertexPoints[vertex]!;
      drawn.add(point);
      const at = projected[point];
      if (!at || at.w <= 0) {
        // Behind the camera: break the run rather than joining across it. A
        // line from an on-screen vertex to a mirrored one is the failure this
        // avoids, and it draws as a plausible stroke to the wrong place.
        open = false;
        continue;
      }
      if (open) context.lineTo(at.x, at.y);
      else {
        context.moveTo(at.x, at.y);
        open = true;
      }
    }
    if (closed[primitive] === 1 && open) {
      const first = projected[vertexPoints[from]!];
      if (first && first.w > 0) context.lineTo(first.x, first.y);
    }
    context.stroke();
  }

  if (options.drawPoints && options.pointRadius > 0) {
    context.fillStyle = css(options.stroke);
    for (let index = 0; index < projected.length; index += 1) {
      // Only points no primitive claimed. A trail system has thousands of
      // vertices and drawing a dot on every one buries the strokes.
      if (drawn.has(index)) continue;
      const at = projected[index]!;
      if (at.w <= 0) continue;
      context.beginPath();
      context.arc(at.x, at.y, options.pointRadius, 0, Math.PI * 2);
      context.fill();
    }
  }

  return canvas;
}

/** The raster as PNG bytes, for the asset capability. */
export async function renderToPng(surface: DrawingSurface): Promise<Uint8Array> {
  const blob = await surface.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}
