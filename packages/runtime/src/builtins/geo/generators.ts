import type { NodeExecutionContext } from "@cascade/contracts";

import { circleGeometry, rectangleGeometry } from "../../geometry/generate.js";
import type { DefinitionNodeRegistration } from "../../types.js";
import { circleDefinition, rectangleDefinition } from "./definitions.js";
import { geoModuleId } from "./namespace.js";

/**
 * The two generators. Houdini has no Rectangle and its Grid with two rows does
 * the job, so `size` and `center` are Grid's parameter names; `Circle` takes
 * Houdini's Circle parameters, including its "Primitive Type", which is what
 * selects a Bézier circle over a polygonal one.
 *
 * Numeric parameters are data inputs rather than props, so a graph can drive
 * them, which is the Cascade equivalent of a Houdini parameter being animatable.
 * The enumerated choice is a prop, as `Remap`'s `clamp` is.
 */
export function executeRectangle(
  context: NodeExecutionContext<typeof rectangleDefinition>,
): void {
  context.outputs.geometry.set(
    rectangleGeometry({
      size: context.inputs.size,
      center: context.inputs.center,
    }),
  );
}

export const rectangleRegistration = {
  kind: "definition-v1",
  moduleId: geoModuleId("Rectangle"),
  definition: rectangleDefinition,
  loadExecute: async () => executeRectangle,
} satisfies DefinitionNodeRegistration<typeof rectangleDefinition>;

export function executeCircle(
  context: NodeExecutionContext<typeof circleDefinition>,
): void {
  context.outputs.geometry.set(
    circleGeometry({
      center: context.inputs.center,
      radius: context.inputs.radius,
      divisions: context.inputs.divisions,
      type: context.props.type === "poly" ? "poly" : "bezier",
    }),
  );
}

export const circleRegistration = {
  kind: "definition-v1",
  moduleId: geoModuleId("Circle"),
  definition: circleDefinition,
  loadExecute: async () => executeCircle,
} satisfies DefinitionNodeRegistration<typeof circleDefinition>;

export { circleDefinition, rectangleDefinition } from "./definitions.js";
