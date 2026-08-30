import type { NodeDefinition, NodeExecutionContext } from "@cascade/contracts";

import type { DefinitionNodeRegistration } from "../../types.js";

export const remapDefinition = {
  apiVersion: 1,
  label: "Remap",
  description: "Map a number from one range into another.",
  icon: "ArrowRightLeft",
  runsOn: "portable",
  inputs: {
    value: { kind: "data", type: "float", default: 0 },
    inMin: { kind: "data", type: "float", default: 0 },
    inMax: { kind: "data", type: "float", default: 1 },
    outMin: { kind: "data", type: "float", default: 0 },
    outMax: { kind: "data", type: "float", default: 1 },
  },
  outputs: {
    result: { kind: "data", type: "float" },
  },
  props: {
    clamp: {
      type: "bool",
      default: false,
      label: "Clamp",
      description: "Keep the normalized input between zero and one.",
    },
  },
} as const satisfies NodeDefinition;

export function remap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
  clamp: boolean,
): number {
  if (inMin === inMax) return outMin;
  const normalized = (value - inMin) / (inMax - inMin);
  const amount = clamp ? Math.min(1, Math.max(0, normalized)) : normalized;
  return outMin + amount * (outMax - outMin);
}

export function executeRemap(
  context: NodeExecutionContext<typeof remapDefinition>,
): void {
  const { value, inMin, inMax, outMin, outMax } = context.inputs;
  context.outputs.result.set(
    remap(value, inMin, inMax, outMin, outMax, context.props.clamp),
  );
}

export const remapRegistration = {
  kind: "definition-v1",
  moduleId: "cascade.core.Remap",
  definition: remapDefinition,
  loadExecute: async () => executeRemap,
} satisfies DefinitionNodeRegistration<typeof remapDefinition>;
