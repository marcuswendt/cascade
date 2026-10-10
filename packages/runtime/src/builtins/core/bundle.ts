import type { DefinitionNodeRegistration } from "../../types.js";

/**
 * Pick and Pack: the two adapters between bundles and single-value ports.
 *
 * A node that wants one number takes it from a bundle through Pick; a handful
 * of loose values become a bundle through Pack. Pick is cheap to re-cook and
 * its output only changes when the picked field does, so with early cutoff a
 * Pick is also the way to depend on one field of a bundle whose consumer
 * cannot declare its fields.
 */

const pickDefinition = {
  apiVersion: 1,
  runsOn: "portable",
  label: "Pick",
  description: "Reads one field of a bundle",
  icon: "ListFilter",
  inputs: {
    bundle: { kind: "data", type: "bundle" },
  },
  outputs: {
    value: { kind: "data", type: "any" },
  },
  props: {
    field: { type: "string", default: "", label: "Field" },
  },
} as const;

const packDefinition = {
  apiVersion: 1,
  runsOn: "portable",
  label: "Pack",
  description: "Collects inputs into a bundle, one named field each",
  icon: "Package",
  inputs: {
    inputs: { kind: "data", type: "any", variadic: true },
  },
  outputs: {
    bundle: { kind: "data", type: "bundle" },
  },
  props: {
    names: {
      type: "string",
      default: "",
      label: "Field names",
      description: "Comma-separated, one per input in order; an unnamed input becomes field_<n>",
    },
  },
} as const;

/** The field names Pack gives its inputs. */
export function packFieldNames(names: string, count: number): string[] {
  const declared = String(names ?? "")
    .split(",")
    .map((name) => name.trim());
  return Array.from({ length: count }, (_, index) => declared[index] || `field_${index}`);
}

export const pickRegistration: DefinitionNodeRegistration<typeof pickDefinition> = {
  kind: "definition-v1",
  moduleId: "cascade.core.Pick",
  definition: pickDefinition,
  loadExecute: async () => ({ inputs, outputs, props }) => {
    const bundle = inputs.bundle;
    const field = props.field.trim();
    outputs.value.set(
      bundle && field && Object.prototype.hasOwnProperty.call(bundle, field)
        ? bundle[field]
        : null,
    );
  },
};

export const packRegistration: DefinitionNodeRegistration<typeof packDefinition> = {
  kind: "definition-v1",
  moduleId: "cascade.core.Pack",
  definition: packDefinition,
  loadExecute: async () => ({ inputs, outputs, props }) => {
    const values = inputs.inputs;
    const names = packFieldNames(props.names, values.length);
    const bundle: Record<string, unknown> = {};
    names.forEach((name, index) => {
      if (values[index] !== undefined) bundle[name] = values[index];
    });
    outputs.bundle.set(bundle);
  },
};
