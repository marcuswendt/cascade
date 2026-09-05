import type { NodeExecutionContext } from "@cascade/contracts";
import { emptyGeometry } from "@cascade/contracts";

import { geometryToSvg, utf8Bytes } from "../../geometry/svg.js";
import type { DefinitionNodeRegistration } from "../../types.js";
import { svgExportDefinition } from "./definitions.js";
import { geoModuleId } from "./namespace.js";

/**
 * The output end: an SVG document, as a string and as a written asset.
 *
 * It declares `assets` and nothing else. Writing is not optional and there is
 * no `write` prop, because an export node whose file is a choice is a node that
 * silently did nothing. `assets` is available to a `portable` node, so this
 * stays portable and needs no `files` capability: the host decides where an
 * asset lands, which is the whole point of the capability.
 *
 * The props are the fallbacks for `Cd`, `width` and `opacity`. A per-primitive
 * attribute wins where it exists; see `geometryToSvg`, which also owns the one
 * +Y-up-to-+Y-down flip in the system.
 *
 * `stroke` and `fill` are both `color`, which is a four-component vector with a
 * swatch control rather than a second colour representation. `fill` used to be
 * an SVG paint string so that `"none"` was expressible; Marcus ruled colour to
 * be a `vec4` everywhere, so the absence of a fill is now the separate
 * `fillMode` prop and the writer converts to text through `Color.toHex`. The
 * reason "no fill" is a mode rather than a zero alpha is in `SvgExportOptions`.
 */
export async function executeSvgExport(
  context: NodeExecutionContext<typeof svgExportDefinition>,
): Promise<void> {
  const { props } = context;
  const svg = geometryToSvg(context.inputs.geometry ?? emptyGeometry(2), {
    width: props.width,
    height: props.height,
    margin: props.margin,
    stroke: props.stroke,
    strokeWidth: props.strokeWidth,
    opacity: props.opacity,
    fill: props.fill,
    fillMode: props.fillMode === "solid" ? "solid" : "none",
    pointRadius: props.pointRadius,
    precision: props.precision,
  });
  context.outputs.svg.set(svg);
  const asset = await context.capabilities.assets.write(
    utf8Bytes(svg),
    { mediaType: "image/svg+xml", suggestedName: props.filename },
    { signal: context.signal },
  );
  context.outputs.asset.set(asset);
}

export const svgExportRegistration = {
  kind: "definition-v1",
  moduleId: geoModuleId("SvgExport"),
  definition: svgExportDefinition,
  loadExecute: async () => executeSvgExport,
} satisfies DefinitionNodeRegistration<typeof svgExportDefinition>;

export { svgExportDefinition } from "./definitions.js";
