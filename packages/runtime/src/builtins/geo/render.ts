import type { NodeExecutionContext } from "@cascade/contracts";
import { asScene } from "@cascade/contracts";

import {
  renderScene,
  renderToPng,
  type DrawingSurface,
} from "../../geometry/render.js";
import type { DefinitionNodeRegistration } from "../../types.js";
import { renderDefinition } from "./definitions.js";
import { geoModuleId } from "./namespace.js";

/**
 * `cascade.geo.Render` — the 3D-to-2D half of `PLAN viewport.md`.
 *
 * Beside `SvgExport` rather than in a namespace of its own, and the naming
 * argument is in the plan: `cascade.geo.Render` puts it next to the node it
 * shares a style vocabulary with, while `cascade.render.Scene` would start a
 * namespace holding one node — a promise rather than a structure.
 *
 * **It is a node and not a viewport button** because a render is part of the
 * document: it has a resolution, it is what a series renders per instance, and
 * `cascade run --frames` has to produce it without a browser. A button produces
 * a file; a node produces a value other nodes consume, and the second is the
 * whole point of the graph.
 *
 * `portable` with only `assets`, like `SvgExport`: both hosts supply
 * `OffscreenCanvas`, so nothing here needs a GPU. The plan argues for the CPU
 * path first on the grounds that this vault's work is lines and a node that
 * runs in every host — including CI — is worth more than one that is faster in
 * one.
 */
/**
 * The one host assumption, and it lives here rather than in the renderer.
 *
 * Both hosts supply `OffscreenCanvas` — the browser natively, the headless host
 * through @napi-rs/canvas — so a `portable` node can draw. `packages/runtime`
 * itself compiles without a DOM lib and must not reach for a global, which is
 * why the renderer takes a factory and this is where it comes from.
 */
function hostSurface(width: number, height: number): DrawingSurface {
  const factory = (globalThis as { OffscreenCanvas?: new (w: number, h: number) => DrawingSurface })
    .OffscreenCanvas;
  if (!factory) {
    throw new Error(
      "cascade.geo.Render needs OffscreenCanvas, which this host does not provide",
    );
  }
  return new factory(width, height);
}

export async function executeRender(
  context: NodeExecutionContext<typeof renderDefinition>,
): Promise<void> {
  const { props } = context;
  const scene = asScene(context.inputs.scene);
  /**
   * The camera input wins over the scene's own, so one scene can be rendered
   * from several viewpoints without being rebuilt.
   *
   * And a render still refuses to invent one. The viewport may fall back to
   * whatever camera you have navigated to, because a view is a way of looking;
   * a render is a document, and a document with an implicit camera is one
   * nobody can reproduce — including `cascade run --frames`, which has no
   * viewport to borrow from.
   */
  const camera = context.inputs.camera ?? scene.camera;
  if (!camera) {
    throw new Error(
      "cascade.geo.Render has no camera — wire a cascade.core.Camera to its camera input, or into the scene",
    );
  }

  const surface = renderScene(scene.geometry, {
    camera,
    size: [props.size[0], props.size[1]],
    ...(props.background[3] > 0 ? { background: props.background } : {}),
    stroke: props.stroke,
    strokeWidth: props.strokeWidth,
    opacity: props.opacity,
    pointRadius: props.pointRadius,
    drawPoints: props.drawPoints,
    surface: hostSurface,
  });

  const bytes = await renderToPng(surface);
  const asset = await context.capabilities.assets.write(
    bytes,
    { mediaType: "image/png", suggestedName: props.filename },
    { signal: context.signal },
  );
  context.outputs.asset.set(asset);
  context.outputs.image.set({
    path: asset.path ?? props.filename,
    size: [surface.width, surface.height],
    channels: "rgba",
    depth: "u8",
    space: "srgb",
  });
}

export const renderRegistration = {
  kind: "definition-v1",
  moduleId: geoModuleId("Render"),
  definition: renderDefinition,
  loadExecute: async () => executeRender,
} satisfies DefinitionNodeRegistration<typeof renderDefinition>;

export { renderDefinition } from "./definitions.js";
