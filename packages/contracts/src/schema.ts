import { CORE_TYPES } from "./values.js";

type Schema = Readonly<Record<string, unknown>>;

function object(
  properties: Readonly<Record<string, Schema>>,
  required: readonly string[] = [],
): Schema {
  return {
    type: "object",
    ...(required.length ? { required } : {}),
    properties,
    additionalProperties: false,
  };
}

function record(value: Schema): Schema {
  return {
    type: "object",
    propertyNames: { pattern: "^[A-Za-z][A-Za-z0-9_]*$" },
    additionalProperties: value,
  };
}

const description = { type: "string" } as const;
const cascadeType = {
  anyOf: [
    { enum: CORE_TYPES },
    { type: "string", pattern: "^[a-z][a-z0-9-]*(?:\\.[A-Za-z][A-Za-z0-9_]*)+$" },
  ],
} as const;
const control = {
  enum: ["number", "slider", "range", "int", "boolean", "text", "textarea", "select", "vector", "matrix", "color", "image", "asset"],
} as const;
const trigger = object({ kind: { const: "trigger" }, description }, ["kind"]);
const dataProperties = {
  kind: { const: "data" },
  type: cascadeType,
  default: {},
  description,
  variadic: { type: "boolean" },
  min: { type: "number" },
  max: { type: "number" },
  step: { type: "number", exclusiveMinimum: 0 },
  accept: { type: "array", items: { type: "string", minLength: 1 } },
  control,
  options: { type: "array" },
} as const;
const data = object(dataProperties, ["kind", "type"]);
const output = object(
  { kind: dataProperties.kind, type: dataProperties.type, description },
  ["kind", "type"],
);
const { kind: _kind, variadic: _variadic, ...propProperties } = dataProperties;
const prop = object({ ...propProperties, label: { type: "string" } }, [
  "type",
  "default",
]);

function environmentCapabilities(
  runsOn: string,
  capabilities: readonly string[],
): Schema {
  return {
    if: { properties: { runsOn: { const: runsOn } } },
    then: { properties: { capabilities: { items: { enum: capabilities } } } },
  };
}

export const nodeDefinitionSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://cascade.dev/schema/node-definition-v1.json",
  ...object(
    {
      apiVersion: { const: 1 },
      runsOn: { enum: ["portable", "browser", "server"] },
      container: { const: "subnet" },
      capabilities: {
        type: "array",
        items: { type: "string" },
        uniqueItems: true,
      },
      label: description,
      description,
      icon: description,
      inputs: record({ anyOf: [trigger, data] }),
      outputs: record({ anyOf: [trigger, output] }),
      props: record(prop),
    },
    ["apiVersion", "runsOn"],
  ),
  allOf: [
    environmentCapabilities("portable", ["assets", "media"]),
    environmentCapabilities("browser", ["assets", "media", "webgl"]),
    environmentCapabilities("server", [
      "files",
      "assets",
      "media",
      "python",
      "shell",
    ]),
  ],
} as const;
