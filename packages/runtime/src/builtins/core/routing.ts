import type { DefinitionNodeRegistration } from "../../types.js";

const switchDefinition = {
  apiVersion: 1,
  runsOn: "portable",
  label: "Switch",
  description: "Selects one input by index",
  icon: "GitBranch",
  inputs: {
    inputs: { kind: "data", type: "any", variadic: true },
  },
  outputs: {
    output: { kind: "data", type: "any" },
  },
  props: {
    index: { type: "int", default: 0, min: 0, step: 1 },
  },
} as const;

const mergeDefinition = {
  apiVersion: 1,
  runsOn: "portable",
  label: "Merge",
  description: "Collects inputs into an array",
  icon: "GitMerge",
  inputs: {
    inputs: { kind: "data", type: "any", variadic: true },
  },
  outputs: {
    output: { kind: "data", type: "array" },
  },
  props: {
    append: { type: "bool", default: false },
  },
} as const;

const selectDefinition = {
  apiVersion: 1,
  runsOn: "portable",
  label: "Select",
  description: "Selects an array item by index",
  icon: "ListFilter",
  inputs: {
    array: { kind: "data", type: "array", default: [] },
  },
  outputs: {
    item: { kind: "data", type: "any" },
    count: { kind: "data", type: "int" },
  },
  props: {
    index: { type: "int", default: 0, min: 0, step: 1 },
    wrap: { type: "bool", default: true },
  },
} as const;

export const switchRegistration: DefinitionNodeRegistration<typeof switchDefinition> = {
  kind: "definition-v1",
  moduleId: "cascade.core.Switch",
  definition: switchDefinition,
  loadExecute: async () => ({ inputs, outputs, props }) => {
    const values = inputs.inputs;
    if (!values.length) {
      outputs.output.set(null);
      return;
    }
    const index = Math.max(0, Math.min(props.index, values.length - 1));
    outputs.output.set(values[index]);
  },
};

export const mergeRegistration: DefinitionNodeRegistration<typeof mergeDefinition> = {
  kind: "definition-v1",
  moduleId: "cascade.core.Merge",
  definition: mergeDefinition,
  loadExecute: async () => ({ inputs, outputs, props }) => {
    const values = inputs.inputs.filter((value) => value !== null);
    outputs.output.set(
      props.append && Array.isArray(values[0])
        ? [...values[0], ...values.slice(1)]
        : values,
    );
  },
};

export const selectRegistration: DefinitionNodeRegistration<typeof selectDefinition> = {
  kind: "definition-v1",
  moduleId: "cascade.core.Select",
  definition: selectDefinition,
  loadExecute: async () => ({ inputs, outputs, props }) => {
    const count = inputs.array.length;
    outputs.count.set(count);
    if (!count) {
      outputs.item.set(null);
      return;
    }
    const index = props.wrap
      ? ((props.index % count) + count) % count
      : Math.max(0, Math.min(props.index, count - 1));
    outputs.item.set(inputs.array[index]);
  },
};
