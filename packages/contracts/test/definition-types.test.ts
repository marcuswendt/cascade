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
