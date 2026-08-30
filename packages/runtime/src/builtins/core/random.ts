import type { NodeDefinition, NodeExecutionContext } from "@cascade/contracts";

import type { DefinitionNodeRegistration } from "../../types.js";

export const randomDefinition = {
  apiVersion: 1,
  label: "Random",
  description: "Generate a deterministic unit value from an explicit seed.",
  icon: "Dice5",
  runsOn: "portable",
  inputs: {
    seed: {
      kind: "data",
      type: "int",
      default: 0,
      description: "Integer seed. Equal seeds always produce equal values.",
    },
    sample: {
      kind: "data",
      type: "int",
      default: 0,
      description: "Stable sample index within the seeded sequence.",
    },
  },
  outputs: {
    value: {
      kind: "data",
      type: "float",
      description: "Deterministic value in the half-open range [0, 1).",
    },
  },
} as const satisfies NodeDefinition;

/** Mulberry32's output transform, evaluated once for the supplied seed. */
export function randomFromSeed(seed: number, sample = 0): number {
  const streamSeed = (Math.trunc(seed) ^ Math.imul(Math.trunc(sample), 0x9e3779b1)) >>> 0;
  let value = (streamSeed + 0x6d2b79f5) >>> 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
}

export function executeRandom(
  context: NodeExecutionContext<typeof randomDefinition>,
): void {
  context.outputs.value.set(randomFromSeed(context.inputs.seed, context.inputs.sample));
}

export const randomRegistration = {
  kind: "definition-v1",
  moduleId: "cascade.core.Random",
  definition: randomDefinition,
  loadExecute: async () => executeRandom,
} satisfies DefinitionNodeRegistration<typeof randomDefinition>;
