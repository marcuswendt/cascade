import type { NodeExecutionContext } from "@cascade/contracts";
import { emptyGeometry } from "@cascade/contracts";

import { copyToPoints } from "../../geometry/copy.js";
import type { DefinitionNodeRegistration } from "../../types.js";
import { copyToPointsDefinition } from "./definitions.js";
import { geoModuleId } from "./namespace.js";

/**
 * Copy to Points SOP: the source instanced onto every point of the target.
 *
 * Houdini's input names and parameter names, because a Houdini user should not
 * have to learn new words for the same idea: source, target points, target
 * group, and "Transform Using Target Point Orientations" for whether `pscale`
 * and `N` are read.
 *
 * This and `Merge` are the pair that fails loudly if the attribute model does
 * not compose, which is why both are in the first six rather than the second.
 */
export function executeCopyToPoints(
  context: NodeExecutionContext<typeof copyToPointsDefinition>,
): void {
  const source = context.inputs.source;
  const target = context.inputs.target;
  if (source === undefined || target === undefined) {
    context.outputs.geometry.set(emptyGeometry(2));
    return;
  }
  context.outputs.geometry.set(
    copyToPoints(source, target, {
      targetGroup: context.props.targetGroup,
      useTargetOrientations: context.props.useTargetOrientations,
    }),
  );
}

export const copyToPointsRegistration = {
  kind: "definition-v1",
  moduleId: geoModuleId("CopyToPoints"),
  definition: copyToPointsDefinition,
  loadExecute: async () => executeCopyToPoints,
} satisfies DefinitionNodeRegistration<typeof copyToPointsDefinition>;

export { copyToPointsDefinition } from "./definitions.js";
