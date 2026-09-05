import type { NodeExecutionContext } from "@cascade/contracts";

import { mergeGeometries } from "../../geometry/merge.js";
import type { DefinitionNodeRegistration } from "../../types.js";
import { mergeDefinition } from "./definitions.js";
import { geoModuleId } from "./namespace.js";

/**
 * Merge SOP: N geometries concatenated, with points, vertices and primitives
 * renumbered. The node that proves the format composes, which is why it is in
 * the first six.
 *
 * It is not `cascade.core.Merge` and cannot be: that one collects its variadic
 * inputs into an `array`, which is a different operation with the same name.
 * The widening rules for a colliding attribute name belong to `mergeGeometries`
 * and are not re-decided here.
 */
export function executeMerge(
  context: NodeExecutionContext<typeof mergeDefinition>,
): void {
  context.outputs.geometry.set(
    mergeGeometries(context.inputs.inputs.filter((input) => input !== undefined)),
  );
}

export const mergeRegistration = {
  kind: "definition-v1",
  moduleId: geoModuleId("Merge"),
  definition: mergeDefinition,
  loadExecute: async () => executeMerge,
} satisfies DefinitionNodeRegistration<typeof mergeDefinition>;

export { mergeDefinition } from "./definitions.js";
