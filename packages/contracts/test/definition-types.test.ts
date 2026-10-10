import type {
  NodeDefinition,
  NodeExecute,
} from "../src/index.js";

const scale = {
  apiVersion: 1,
  runsOn: "portable",
  capabilities: ["assets"],
  inputs: {
    value: { kind: "data", type: "float", default: 0 },
    optional: { kind: "data", type: "float" },
  },
  outputs: { result: { kind: "data", type: "float" } },
  props: { multiplier: { type: "float", default: 2 } },
} as const satisfies NodeDefinition;

const execute: NodeExecute<typeof scale> = ({
  inputs,
  outputs,
  props,
  capabilities,
}) => {
  const optional = inputs.optional ?? 0;
  outputs.result.set((inputs.value + optional) * props.multiplier);
  void capabilities.assets;
  // @ts-expect-error Only declared capabilities are available.
  void capabilities.files;
  // @ts-expect-error Float outputs accept numbers, not strings.
  outputs.result.set("invalid");
};

void execute;

// @ts-expect-error AI integrations are project modules, not a core capability.
const invalidAi: NodeDefinition = { apiVersion: 1, runsOn: "portable", capabilities: ["ai"] };

// @ts-expect-error Shell is server-only.
const invalidPortable: NodeDefinition = { apiVersion: 1, runsOn: "portable", capabilities: ["shell"] };

// @ts-expect-error Texture ports are browser-only.
const invalidTexture: NodeDefinition = { apiVersion: 1, runsOn: "server", inputs: { texture: { kind: "data", type: "texture" } } };

void invalidPortable;
void invalidTexture;
void invalidAi;

// Bundles: a producer's fields type its `set`, a consumer's fields type its input.
const format = {
  apiVersion: 1,
  runsOn: "portable",
  inputs: {
    upstream: { kind: "data", type: "bundle", schema: "format", fields: ["dpi"] },
  },
  outputs: {
    format: {
      kind: "data",
      type: "bundle",
      schema: "format",
      fields: { dpi: "float", size: { type: "vec2i", description: "pixels" } },
    },
  },
} as const satisfies NodeDefinition;

const executeFormat: NodeExecute<typeof format> = ({ inputs, outputs }) => {
  const dpi: unknown = inputs.upstream?.dpi;
  void dpi;
  outputs.format.set({ dpi: 300, size: [10, 20] });
  outputs.format.set({ dpi: 300 });
  // @ts-expect-error An undeclared field is not settable.
  outputs.format.set({ dpu: 300 });
  // @ts-expect-error A field takes its declared type.
  outputs.format.set({ dpi: "300" });
  // @ts-expect-error A consumer sees only the fields it declared.
  void inputs.upstream?.size;
};

void executeFormat;

// @ts-expect-error schema and fields belong to bundle ports.
const notBundle: NodeDefinition = { apiVersion: 1, runsOn: "portable", outputs: { x: { kind: "data", type: "float", schema: "format" } } };
void notBundle;
