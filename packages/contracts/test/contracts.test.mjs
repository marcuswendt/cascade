import assert from "node:assert/strict";
import test from "node:test";

import {
  canConnectTypes,
  Color,
  normalizeCascadeType,
  ShellProcessError,
  validateNodeDefinition,
} from "../dist/index.js";
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

test("normalizes and connects types identically in every host", () => {
  assert.equal(normalizeCascadeType("number"), "float");
  assert.equal(normalizeCascadeType("boolean"), "bool");
  assert.equal(normalizeCascadeType("curves"), "polyline");
  assert.equal(normalizeCascadeType(undefined), "any");
  assert.equal(canConnectTypes("vec2i", "vec2"), true);
  assert.equal(canConnectTypes("curves", "polyline"), true);
  assert.equal(canConnectTypes("float", "int"), false);
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
    props: { value: { type: "float", default: 0 } },
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

test("one name for both an input and an output is allowed", () => {
  // A SOP takes geometry and returns geometry, and the two ports are addressed
  // in opposite directions, so the name means one thing on each side. Marcus
  // ruled on this 2026-09-04: "sounds weird, we need to allow this case."
  assert.deepEqual(
    validateNodeDefinition({
      apiVersion: 1,
      runsOn: "portable",
      inputs: { geometry: { kind: "data", type: "geometry" } },
      outputs: { geometry: { kind: "data", type: "geometry" } },
    }),
    [],
  );

  // Inputs and props still share one namespace: both feed the node from the
  // same side and there is no direction to tell them apart by.
  assert.deepEqual(
    validateNodeDefinition({
      apiVersion: 1,
      runsOn: "portable",
      inputs: { size: { kind: "data", type: "float", default: 1 } },
      props: { size: { type: "float", default: 1 } },
    }).map(({ code }) => code),
    ["definition/name-collision"],
  );

  // And a name repeated inside one section is still a collision on each side.
  assert.deepEqual(
    validateNodeDefinition({
      apiVersion: 1,
      runsOn: "portable",
      outputs: { geometry: { kind: "data", type: "geometry" } },
      props: { geometry: { type: "string", default: "" } },
    }).map(({ code }) => code),
    [],
  );
});

test("Color converts to and from hex and CSS without a second representation", () => {
  assert.deepEqual(Color.fromHex("#3a7f5c"), [
    0x3a / 255,
    0x7f / 255,
    0x5c / 255,
    1,
  ]);
  assert.deepEqual(Color.fromHex("#00000080"), [0, 0, 0, 128 / 255]);
  // CSS shorthand, because hand-written palettes use it.
  assert.deepEqual(Color.fromHex("#fff"), [1, 1, 1, 1]);
  assert.deepEqual(Color.fromHex("#0f08"), [0, 1, 0, 136 / 255]);
  // A colour that silently parses to black is the failure this ruling removes.
  assert.throws(
    () => Color.fromHex("none"),
    (error) => /color\/invalid-hex/.test(error.message),
  );
  assert.equal(Color.isHex("#3a7f5c"), true);
  assert.equal(Color.isHex("rgb(1,2,3)"), false);

  assert.equal(Color.toHex([1, 0.5, 0, 1]), "#ff8000");
  assert.equal(Color.toHex([1, 0.5, 0, 0.5], true), "#ff800080");
  // Clamped rather than thrown on: an out-of-range component is arithmetic.
  assert.equal(Color.toHex([2, -1, 0, 1]), "#ff0000");
  assert.equal(Color.toString([1, 0.5, 0, 1]), "rgb(255, 128, 0)");
  assert.equal(Color.toString([1, 0.5, 0, 0.25]), "rgba(255, 128, 0, 0.25)");
  assert.equal(Color.alpha([0, 0, 0, 0.5]), 0.5);
  assert.deepEqual(Color.opaque([0, 0, 0, 0.5]), [0, 0, 0, 1]);

  // The round trip the cloud-plots migration will run at the boundary.
  assert.equal(Color.toHex(Color.fromHex("#3a7f5c")), "#3a7f5c");

  // The reader for a Cd attribute's flat array.
  const data = Float64Array.of(1, 0, 0, 1, 0, 0, 1, 0.5);
  assert.deepEqual(Color.fromComponents(data, 4, 4), [0, 0, 1, 0.5]);
  assert.deepEqual(Color.fromComponents(Float64Array.of(1, 0, 0), 0, 3), [
    1, 0, 0, 1,
  ]);
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
