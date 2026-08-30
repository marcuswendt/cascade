import type { DefinitionNodeRegistration } from "../../types.js";

const inputDefinition = {
  apiVersion: 1,
  runsOn: "portable",
  label: "Input",
  description: "Defines a public graph or subnet input",
  icon: "LogIn",
  inputs: {
    value: { kind: "data", type: "any", default: null },
  },
  outputs: {
    output: { kind: "data", type: "any" },
  },
  props: {
    inputIndex: { type: "int", default: 0, min: 0, step: 1 },
    inputName: { type: "string", default: "" },
    dataType: { type: "string", default: "any" },
  },
} as const;

const outputDefinition = {
  apiVersion: 1,
  runsOn: "portable",
  label: "Output",
  description: "Defines a public graph or subnet output",
  icon: "LogOut",
  inputs: {
    input: { kind: "data", type: "any", default: null },
  },
  outputs: {
    output: { kind: "data", type: "any" },
  },
  props: {
    outputIndex: { type: "int", default: 0, min: 0, step: 1 },
    outputName: { type: "string", default: "" },
    dataType: { type: "string", default: "any" },
  },
} as const;

const subnetDefinition = {
  apiVersion: 1,
  runsOn: "portable",
  container: "subnet",
  label: "Subnet",
  description: "Contains a nested deterministic graph",
  icon: "Folder",
} as const;

export const inputRegistration: DefinitionNodeRegistration<typeof inputDefinition> = {
  kind: "definition-v1",
  moduleId: "cascade.core.Input",
  definition: inputDefinition,
  loadExecute: async () => ({ inputs, outputs }) => outputs.output.set(inputs.value),
};

export const outputRegistration: DefinitionNodeRegistration<typeof outputDefinition> = {
  kind: "definition-v1",
  moduleId: "cascade.core.Output",
  definition: outputDefinition,
  loadExecute: async () => ({ inputs, outputs }) => outputs.output.set(inputs.input),
};

export const subnetRegistration: DefinitionNodeRegistration<typeof subnetDefinition> = {
  kind: "definition-v1",
  moduleId: "cascade.core.Subnet",
  definition: subnetDefinition,
  loadExecute: async () => () => {},
};
