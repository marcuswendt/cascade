import type { NodeDefinition, NodeExecutionContext } from "@cascade/contracts";
import { emptyGeometry } from "@cascade/contracts";

import { copyToPoints } from "../../geometry/copy.js";
import type { DefinitionNodeRegistration } from "../../types.js";
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
export const copyToPointsDefinition = {
  apiVersion: 1,
  label: "Copy to Points",
  description: "Instance one geometry onto every point of another.",
  icon: "Copy",
  runsOn: "portable",
  inputs: {
    source: { kind: "data", type: "geometry" },
    target: { kind: "data", type: "geometry" },
  },
  outputs: {
    geometry: { kind: "data", type: "geometry" },
  },
  props: {
    targetGroup: {
      type: "string",
      default: "",
      label: "Target Group",
      description: "Copy onto this point group only; empty means every point.",
    },
    useTargetOrientations: {
      type: "bool",
      default: true,
      label: "Transform Using Target Point Orientations",
      description: "Read pscale and N from the target points.",
    },
  },
} as const satisfies NodeDefinition;

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
