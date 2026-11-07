import type { NodeDefinition } from "@cascade/contracts";

/** The declarations of `cascade.assert.*`; see `index.ts`. */

export const rangeDefinition = {
  apiVersion: 1,
  runsOn: "portable",
  label: "Assert Range",
  description: "Fails the run unless value is a finite number in [min, max]; passes value through",
  icon: "ShieldCheck",
  inputs: { value: { kind: "data", type: "float", default: 0 } },
  outputs: { value: { kind: "data", type: "float" } },
  props: {
    min: { type: "float", default: 0 },
    max: { type: "float", default: 1 },
    message: { type: "string", default: "" },
  },
} as const satisfies NodeDefinition;

export const equalsDefinition = {
  apiVersion: 1,
  runsOn: "portable",
  label: "Assert Equals",
  description: "Fails the run unless value equals expected (JSON-equal; numbers within tolerance); passes value through",
  icon: "ShieldCheck",
  inputs: { value: { kind: "data", type: "any", default: null } },
  outputs: { value: { kind: "data", type: "any" } },
  props: {
    expected: { type: "any", default: null },
    tolerance: { type: "float", default: 0, min: 0 },
    message: { type: "string", default: "" },
  },
} as const satisfies NodeDefinition;

export const trueDefinition = {
  apiVersion: 1,
  runsOn: "portable",
  label: "Assert True",
  description: "Fails the run unless value is true (wire a condition, or give the prop an expression); passes value through",
  icon: "ShieldCheck",
  inputs: { value: { kind: "data", type: "bool", default: false } },
  outputs: { value: { kind: "data", type: "bool" } },
  props: { message: { type: "string", default: "" } },
} as const satisfies NodeDefinition;

export const notBlankDefinition = {
  apiVersion: 1,
  runsOn: "portable",
  label: "Assert Not Blank",
  description: "Fails the run when an image (PNG or PPM) is one flat colour or fully transparent; passes the image through",
  icon: "ShieldCheck",
  capabilities: ["assets"],
  inputs: { image: { kind: "data", type: "image" } },
  outputs: { image: { kind: "data", type: "image" } },
  props: {
    tolerance: { type: "int", default: 0, min: 0, max: 255, step: 1 },
    message: { type: "string", default: "" },
  },
} as const satisfies NodeDefinition;
