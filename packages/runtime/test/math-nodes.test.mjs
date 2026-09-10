import assert from "node:assert/strict";
import test from "node:test";

import {
  binaryRegistration,
  clampRegistration,
  compareRegistration,
  executeBinary,
  executeClamp,
  executeCompare,
  executeMix,
  executeUnary,
  mathNodeRegistrations,
  mixRegistration,
  unaryRegistration,
} from "../dist/builtins/math/index.js";

/**
 * `cascade.math.*` — arithmetic as nodes.
 *
 * Asked for by a user on 2026-09-10: *"the usual math nodes are always a treat
 * to have!"* The maths already existed as expressions, so what these add is
 * not computation but placement — an expression is private to one parameter,
 * and a value you want to reuse has to be a node.
 *
 * The tests worth having are about the two decisions rather than about
 * arithmetic: **component-wise with scalar broadcast**, and what happens at
 * the edges — a zero divisor, a mismatched vector, a name that is not an
 * operation.
 */

const signal = { aborted: false, addEventListener() {}, removeEventListener() {} };
const progress = { report() {} };

function run(registration, execute, inputs = {}, props = {}) {
  const definition = registration.definition;
  const values = {};
  const outputs = {};
  for (const name of Object.keys(definition.outputs ?? {}))
    outputs[name] = { set: (value) => (values[name] = value) };
  const defaults = {};
  for (const [name, input] of Object.entries(definition.inputs ?? {}))
    if ("default" in input) defaults[name] = input.default;
  const propDefaults = {};
  for (const [name, prop] of Object.entries(definition.props ?? {}))
    propDefaults[name] = prop.default;
  execute({
    nodeId: "test",
    inputs: { ...defaults, ...inputs },
    outputs,
    props: { ...propDefaults, ...props },
    capabilities: {},
    signal,
    progress,
  });
  return values;
}

test("five nodes, one namespace, no Fit", () => {
  // No `Fit`, deliberately: `cascade.core.Remap` already is one. Two nodes
  // doing one job is worse than a name that does not match Houdini's.
  assert.deepEqual(
    mathNodeRegistrations.map((registration) => registration.moduleId),
    [
      "cascade.math.Binary",
      "cascade.math.Unary",
      "cascade.math.Clamp",
      "cascade.math.Mix",
      "cascade.math.Compare",
    ],
  );
});

test("Binary does the nine operations on scalars", () => {
  const cases = [
    ["add", 7, 3, 10],
    ["subtract", 7, 3, 4],
    ["multiply", 7, 3, 21],
    ["divide", 6, 3, 2],
    ["power", 2, 10, 1024],
    ["modulo", 7, 3, 1],
    ["min", 7, 3, 3],
    ["max", 7, 3, 7],
  ];
  for (const [operation, a, b, expected] of cases)
    assert.equal(
      run(binaryRegistration, executeBinary, { a, b }, { operation }).value,
      expected,
      operation,
    );
  assert.ok(
    Math.abs(run(binaryRegistration, executeBinary, { a: 1, b: 1 }, { operation: "atan2" }).value - Math.PI / 4) < 1e-12,
  );
});

test("dividing by zero gives zero rather than Infinity", () => {
  // Both choices hide something and this is the lesser one: a non-finite
  // number flows into a position and the geometry silently vanishes, which is
  // a blank frame with no error anywhere. A zero divisor is also almost always
  // an unset parameter rather than an intent.
  assert.equal(run(binaryRegistration, executeBinary, { a: 5, b: 0 }, { operation: "divide" }).value, 0);
  assert.equal(run(binaryRegistration, executeBinary, { a: 5, b: 0 }, { operation: "modulo" }).value, 0);
});

test("operations are component-wise on vectors", () => {
  assert.deepEqual(
    run(binaryRegistration, executeBinary, { a: [1, 2, 3], b: [10, 20, 30] }, { operation: "add" }).value,
    [11, 22, 33],
  );
});

test("a scalar broadcasts against a vector, both ways round", () => {
  // The thing anybody actually reaches for: scaling a position.
  assert.deepEqual(
    run(binaryRegistration, executeBinary, { a: [1, 2], b: 3 }, { operation: "multiply" }).value,
    [3, 6],
  );
  assert.deepEqual(
    run(binaryRegistration, executeBinary, { a: 12, b: [2, 3, 4] }, { operation: "divide" }).value,
    [6, 4, 3],
  );
});

test("mismatched vector widths throw rather than padding", () => {
  // Padding the missing component with zero would give a plausible wrong
  // answer, which is the failure hardest to see in a picture.
  assert.throws(
    () => run(binaryRegistration, executeBinary, { a: [1, 2], b: [1, 2, 3] }, { operation: "add" }),
    /cannot combine a vector of 2 with a vector of 3/,
  );
});

test("a non-numeric input says what it got", () => {
  assert.throws(
    () => run(binaryRegistration, executeBinary, { a: "twelve", b: 1 }, { operation: "add" }),
    /needs a number or a vector of numbers, and got a string/,
  );
});

test("an unwired input reads as zero rather than throwing", () => {
  // A half-built graph should compute something explicable.
  assert.equal(
    run(binaryRegistration, executeBinary, { a: undefined, b: 5 }, { operation: "add" }).value,
    5,
  );
});

test("an unknown operation names itself", () => {
  assert.throws(
    () => run(binaryRegistration, executeBinary, { a: 1, b: 1 }, { operation: "smoosh" }),
    /has no operation "smoosh"/,
  );
});

test("Unary covers the usual set, in radians", () => {
  const value = (operation, input) =>
    run(unaryRegistration, executeUnary, { value: input }, { operation }).value;
  assert.equal(value("abs", -3), 3);
  assert.equal(value("negate", 3), -3);
  assert.equal(value("floor", 2.7), 2);
  assert.equal(value("ceil", 2.1), 3);
  assert.equal(value("round", 2.5), 3);
  assert.equal(value("sign", -9), -1);
  assert.equal(value("sqrt", 9), 3);
  assert.ok(Math.abs(value("sin", Math.PI / 2) - 1) < 1e-12);
  assert.ok(Math.abs(value("degrees", Math.PI) - 180) < 1e-9);
  assert.ok(Math.abs(value("radians", 180) - Math.PI) < 1e-12);
});

test("the domain guards return a number rather than NaN", () => {
  // sqrt of a negative, log of zero, asin past one. Each of these is reachable
  // from an animated parameter that overshoots, and NaN downstream is the
  // vanishing-geometry failure again.
  const value = (operation, input) =>
    run(unaryRegistration, executeUnary, { value: input }, { operation }).value;
  assert.equal(value("sqrt", -4), 0);
  assert.equal(value("log", 0), 0);
  assert.equal(value("asin", 2), Math.asin(1));
  assert.equal(value("acos", -2), Math.acos(-1));
});

test("fract is positive below zero, as a repeating pattern needs", () => {
  const value = (input) =>
    run(unaryRegistration, executeUnary, { value: input }, { operation: "fract" }).value;
  assert.ok(Math.abs(value(0.25) - 0.25) < 1e-12);
  // JavaScript's % would give -0.25 here, which breaks a tiling pattern at
  // the origin. GLSL's fract is the behaviour people expect.
  assert.ok(Math.abs(value(-0.25) - 0.75) < 1e-12);
});

test("Unary is component-wise too", () => {
  assert.deepEqual(
    run(unaryRegistration, executeUnary, { value: [-1, 2, -3] }, { operation: "abs" }).value,
    [1, 2, 3],
  );
});

test("Clamp holds a value between bounds, component-wise", () => {
  assert.equal(run(clampRegistration, executeClamp, { value: 5, min: 0, max: 1 }).value, 1);
  assert.equal(run(clampRegistration, executeClamp, { value: -5, min: 0, max: 1 }).value, 0);
  assert.equal(run(clampRegistration, executeClamp, { value: 0.5, min: 0, max: 1 }).value, 0.5);
  assert.deepEqual(
    run(clampRegistration, executeClamp, { value: [-1, 0.5, 9], min: 0, max: 1 }).value,
    [0, 0.5, 1],
  );
});

test("Mix is exact at both ends", () => {
  // `a + (b - a) * t` rather than `a*(1-t) + b*t`, because the second is not
  // exact at t = 1 in floating point — and a mix that drives something which
  // must land on an end has to land on it.
  assert.equal(run(mixRegistration, executeMix, { a: 0.1, b: 0.7, bias: 0 }).value, 0.1);
  assert.equal(run(mixRegistration, executeMix, { a: 0.1, b: 0.7, bias: 1 }).value, 0.7);
});

test("Mix extrapolates past the ends rather than clamping", () => {
  // Deliberate: overshoot is how an ease-out-back or a bounce is built.
  assert.equal(run(mixRegistration, executeMix, { a: 0, b: 10, bias: 1.5 }).value, 15);
  assert.equal(run(mixRegistration, executeMix, { a: 0, b: 10, bias: -0.5 }).value, -5);
});

test("Mix blends vectors", () => {
  assert.deepEqual(
    run(mixRegistration, executeMix, { a: [0, 0], b: [10, 20], bias: 0.5 }).value,
    [5, 10],
  );
});

test("Compare answers the six tests", () => {
  const result = (operation, a, b) =>
    run(compareRegistration, executeCompare, { a, b }, { operation }).result;
  assert.equal(result("greater", 2, 1), true);
  assert.equal(result("greater-or-equal", 1, 1), true);
  assert.equal(result("less", 2, 1), false);
  assert.equal(result("less-or-equal", 1, 1), true);
  assert.equal(result("equal", 1, 1), true);
  assert.equal(result("not-equal", 1, 2), true);
});

test("Compare's tolerance applies to equality only", () => {
  const result = (operation, a, b, tolerance) =>
    run(compareRegistration, executeCompare, { a, b }, { operation, tolerance }).result;
  // Floating point rarely lands on exactly equal, which is what the slack is for.
  assert.equal(result("equal", 0.1 + 0.2, 0.3, 0), false);
  assert.equal(result("equal", 0.1 + 0.2, 0.3, 1e-9), true);
  assert.equal(result("not-equal", 0.1 + 0.2, 0.3, 1e-9), false);
  // And not to the orderings, where it would be meaningless.
  assert.equal(result("greater", 1, 1.0000001, 1), false);
});

test("Compare outputs a bool, which is what a Switch takes", () => {
  const { result } = run(compareRegistration, executeCompare, { a: 5, b: 1 }, { operation: "greater" });
  assert.equal(typeof result, "boolean");
  assert.equal(compareRegistration.definition.outputs.result.type, "bool");
});

test("every operation named in a dropdown actually exists", () => {
  // The failure this catches: an option added to the list and not to the table,
  // which would throw only when somebody picked it.
  for (const [registration, execute, key] of [
    [binaryRegistration, executeBinary, "operation"],
    [unaryRegistration, executeUnary, "operation"],
    [compareRegistration, executeCompare, "operation"],
  ]) {
    for (const option of registration.definition.props[key].options) {
      const inputs = registration === unaryRegistration ? { value: 1 } : { a: 1, b: 1 };
      assert.doesNotThrow(
        () => run(registration, execute, inputs, { [key]: option.value }),
        `${registration.moduleId} ${option.value}`,
      );
    }
  }
});
