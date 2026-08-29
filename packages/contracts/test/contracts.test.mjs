import assert from "node:assert/strict";
import test from "node:test";

import { ShellProcessError, validateNodeDefinition } from "../dist/index.js";
import { nodeDefinitionSchema } from "../dist/schema.js";

test("validates a portable deterministic definition", () => {
  const definition = {
    apiVersion: 1,
    runsOn: "portable",
    inputs: { value: { kind: "data", type: "float", default: 0 } },
    outputs: { result: { kind: "data", type: "float" } },
    props: { multiplier: { type: "float", default: 2 } },
  };

  assert.deepEqual(validateNodeDefinition(definition), []);
});

test("rejects environment, name, collision, and numeric contract violations", () => {
  const diagnostics = validateNodeDefinition({
    apiVersion: 1,
    runsOn: "server",
    capabilities: ["webgl", "webgl"],
    inputs: {
      constructor: { kind: "data", type: "texture", default: null },
      value: { kind: "data", type: "int", default: 1.5, step: 0 },
    },
    outputs: { value: { kind: "data", type: "float" } },
  });

  assert.deepEqual(
    diagnostics.map(({ code }) => code),
    [
      "definition/capability-not-allowed",
      "definition/duplicate-capability",
      "definition/reserved-name",
      "definition/texture-not-portable",
      "definition/texture-default",
      "definition/non-integer",
      "definition/invalid-step",
      "definition/name-collision",
    ],
  );
});

test("ShellProcessError retains the typed process result", () => {
  const result = {
    stdout: "",
    stderr: "nope",
    code: 2,
    timedOut: false,
    cancelled: false,
    outputLimited: false,
  };
  const error = new ShellProcessError("nonzero", result);
  assert.equal(error.name, "ShellProcessError");
  assert.equal(error.kind, "nonzero");
  assert.equal(error.result, result);
});

test("rejects malformed containers, unknown fields, trigger extras, and scalar defaults", () => {
  const diagnostics = validateNodeDefinition({
    apiVersion: 1,
    runsOn: "portable",
    capabilities: "ai",
    mystery: true,
    inputs: {
      tick: { kind: "trigger", type: "float", default: 1 },
      enabled: { kind: "data", type: "bool", default: "yes" },
    },
    outputs: {
      result: { kind: "wrong", type: "float", default: 1 },
    },
    props: {
      label: { type: "string", default: 42, unknown: true },
    },
  });
  const codes = diagnostics.map(({ code }) => code);
  for (const code of [
    "definition/unknown-field",
    "definition/invalid-capabilities",
    "definition/trigger-extra",
    "definition/default-type",
    "definition/invalid-kind",
  ]) {
    assert.ok(codes.includes(code), `missing ${code}`);
  }
});

test("rejects ai as a core capability while preserving provider-neutral capabilities", () => {
  assert.deepEqual(validateNodeDefinition({
    apiVersion: 1,
    runsOn: "portable",
    capabilities: ["assets", "media"],
  }), []);

  const diagnostics = validateNodeDefinition({
    apiVersion: 1,
    runsOn: "portable",
    capabilities: ["ai"],
  });
  assert.deepEqual(diagnostics.map(({ code }) => code), [
    "definition/capability-not-allowed",
  ]);
});

test("keeps public type and control schema vocabularies aligned with validation", () => {
  const diagnostics = validateNodeDefinition({
    apiVersion: 1,
    runsOn: "portable",
    inputs: { value: { kind: "data", type: "not a type", control: "magic" } },
  });
  assert.ok(diagnostics.some(({ code }) => code === "definition/invalid-type"));
  assert.ok(diagnostics.some(({ code }) => code === "definition/invalid-control"));

  const inputSchema = nodeDefinitionSchema.properties.inputs.additionalProperties.anyOf[1];
  assert.ok(inputSchema.properties.type.anyOf[0].enum.includes("float"));
  assert.ok(inputSchema.properties.type.anyOf[1].pattern.includes("A-Za-z"));
  assert.ok(inputSchema.properties.control.enum.includes("slider"));
});
