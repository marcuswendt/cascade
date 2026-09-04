import type { NodeDefinition, NodeExecutionContext } from "@cascade/contracts";
import { emptyGeometry } from "@cascade/contracts";

import { transformMatrix } from "../../geometry/matrix.js";
import { transformGeometry } from "../../geometry/transform.js";
import type { DefinitionNodeRegistration } from "../../types.js";
import { geoModuleId } from "./namespace.js";

/**
 * Transform SOP's parameters, by its names: translate, rotate, scale, pivot,
 * in Houdini's scale-rotate-translate order about the pivot. Rotation is in
 * degrees and counter-clockwise, because geometry is +Y up.
 *
 * The plan described this node as applying a `mat3`. It builds one instead: a
 * matrix-typed input is the primitive the operation wants and the wrong thing
 * to put in front of an artist, and the four parameters are what a Houdini user
 * reaches for.
 */
export const transformDefinition = {
  apiVersion: 1,
  label: "Transform",
  description: "Translate, rotate and scale geometry about a pivot.",
  icon: "Move",
  runsOn: "portable",
  inputs: {
    /**
     * `geometry` in and `geometry` out, which is what a SOP is. This was named
     * `input` while the definition validator kept one namespace across `inputs`
     * and `outputs`; outputs now have their own, so the port has the name it
     * should always have had and every node in the set speaks `geometry` in both
     * directions.
     */
    geometry: { kind: "data", type: "geometry" },
    translate: { kind: "data", type: "vec2", default: [0, 0] },
    rotate: {
      kind: "data",
      type: "float",
      default: 0,
      description: "Degrees, counter-clockwise.",
    },
    scale: { kind: "data", type: "vec2", default: [1, 1] },
    pivot: { kind: "data", type: "vec2", default: [0, 0] },
  },
  outputs: {
    geometry: { kind: "data", type: "geometry" },
  },
} as const satisfies NodeDefinition;

export function executeTransform(
  context: NodeExecutionContext<typeof transformDefinition>,
): void {
  const geometry = context.inputs.geometry ?? emptyGeometry(2);
  context.outputs.geometry.set(
    transformGeometry(
      geometry,
      transformMatrix({
        translate: context.inputs.translate,
        rotate: context.inputs.rotate,
        scale: context.inputs.scale,
        pivot: context.inputs.pivot,
      }),
    ),
  );
}

export const transformRegistration = {
  kind: "definition-v1",
  moduleId: geoModuleId("Transform"),
  definition: transformDefinition,
  loadExecute: async () => executeTransform,
} satisfies DefinitionNodeRegistration<typeof transformDefinition>;
