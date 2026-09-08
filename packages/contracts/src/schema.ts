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
  // A bare value, or `{ value, label, disabled? }`. Both forms, because a
  // bare value means "the value is its own label" and is what every
  // definition written before the labelled form meant.
  options: {
    type: "array",
    items: {
      anyOf: [
        { not: { type: "object" } },
        {
          type: "object",
          properties: {
            value: {},
            label: { type: "string", minLength: 1 },
            disabled: { type: "boolean" },
          },
          required: ["value", "label"],
          additionalProperties: false,
        },
      ],
    },
  },
} as const;
const data = object(dataProperties, ["kind", "type"]);
const output = object(
  { kind: dataProperties.kind, type: dataProperties.type, description },
  ["kind", "type"],
);
const { kind: _kind, variadic: _variadic, ...propProperties } = dataProperties;
const prop = object(
  {
    ...propProperties,
    label: { type: "string" },
    // Props only, not inputs: an input's value comes from whatever is wired to
    // it, so a default expression there would be describing the wrong thing.
    expression: { type: "string", minLength: 1 },
    // A button that fires a named host action instead of an editable field.
    action: { type: "string", minLength: 1 },
  },
  ["type", "default"],
);

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
    environmentCapabilities("browser", ["assets", "media", "gpu"]),
    environmentCapabilities("server", [
      "files",
      "assets",
      "media",
      "python",
      "shell",
    ]),
  ],
} as const;
