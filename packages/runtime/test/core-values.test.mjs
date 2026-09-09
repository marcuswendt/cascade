import assert from "node:assert/strict";
import test from "node:test";

import { createRuntime } from "../dist/index.js";
import { createNodeRuntimeHost } from "../dist/node.js";
import {
  randomFromSeed,
  randomRegistration,
} from "../dist/builtins/core/random.js";
import { remap, remapRegistration } from "../dist/builtins/core/remap.js";

test("Random is an explicit deterministic seed transform", () => {
  assert.equal(randomRegistration.moduleId, "cascade.core.Random");
  assert.equal(randomRegistration.definition.runsOn, "portable");
  assert.equal(randomFromSeed(0), 0.26642920868471265);
  assert.equal(randomFromSeed(42), 0.6011037519201636);
  assert.equal(randomFromSeed(42), randomFromSeed(42));
  assert.notEqual(randomFromSeed(42), randomFromSeed(43));
  assert.notEqual(randomFromSeed(42, 0), randomFromSeed(42, 1));
  assert.equal(randomFromSeed(42, 3), randomFromSeed(42, 3));

  for (const seed of [0, 1, -1, 2_147_483_647, 4_294_967_296]) {
    const value = randomFromSeed(seed);
    assert.ok(value >= 0);
    assert.ok(value < 1);
  }
});

test("Random normalizes seeds to deterministic 32-bit integers", () => {
  assert.equal(randomFromSeed(12.9), randomFromSeed(12));
  assert.equal(randomFromSeed(-1), randomFromSeed(4_294_967_295));
  assert.equal(randomFromSeed(0), randomFromSeed(4_294_967_296));
});

test("Remap extrapolates by default and clamps when requested", () => {
  assert.equal(remapRegistration.moduleId, "cascade.core.Remap");
  assert.equal(remapRegistration.definition.runsOn, "portable");
  assert.equal(remap(5, 0, 10, 100, 200, false), 150);
  assert.equal(remap(15, 0, 10, 100, 200, false), 250);
  assert.equal(remap(15, 0, 10, 100, 200, true), 200);
  assert.equal(remap(-5, 0, 10, 100, 200, true), 100);
});

test("Remap supports reversed ranges and a zero-width source range", () => {
  assert.equal(remap(7.5, 10, 0, 0, 100, false), 25);
  assert.equal(remap(15, 10, 0, 0, 100, true), 0);
  assert.equal(remap(5, 0, 10, 100, 0, false), 50);
  assert.equal(remap(123, 4, 4, 10, 20, false), 10);
  assert.equal(remap(123, 4, 4, 10, 20, true), 10);
});

test("Random and Remap execute without project module resolution", async () => {
  const runtime = createRuntime({
    host: createNodeRuntimeHost({
      modules: {
        resolve: async (moduleId) => {
          throw new Error(`unexpected project module resolution: ${moduleId}`);
        },
      },
    }),
  });
  const graph = await runtime.load({
    version: "0.2",
    nodes: [
      {
        id: "random",
        module: "cascade.core.Random",
        inputs: { seed: 42 },
      },
      {
        id: "remap",
        module: "cascade.core.Remap",
        inputs: { inMin: 0, inMax: 1, outMin: 10, outMax: 20 },
        props: { clamp: true },
      },
    ],
    connections: [
      {
        source: { nodeId: "random", outputName: "value" },
        target: { nodeId: "remap", inputName: "value" },
      },
    ],
  });

  const result = await graph.run({
    target: { kind: "output", nodeId: "remap", outputName: "result" },
  });
  assert.equal(result.status, "completed");
  assert.equal(
    graph.getOutput("remap", "result"),
    10 + randomFromSeed(42) * 10,
  );
  await runtime.dispose();
});

test("core routing nodes execute natively with legacy variadic port names", async () => {
  const runtime = createRuntime({
    host: createNodeRuntimeHost({ modules: { resolve: async () => null } }),
  });
  const graph = await runtime.load({
    version: "0.2",
    nodes: [
      { id: "first", module: "cascade.core.Input", inputs: { value: 2 } },
      { id: "second", module: "cascade.core.Input", inputs: { value: 5 } },
      { id: "switch", module: "cascade.core.Switch", props: { index: 1 } },
      { id: "merge", module: "cascade.core.Merge" },
      { id: "select", module: "cascade.core.Select", props: { index: -1, wrap: true } },
    ],
    connections: [
      [["first", 0, "output"], ["switch", 0, "input_0"]],
      [["second", 0, "output"], ["switch", 0, "input_1"]],
      [["first", 0, "output"], ["merge", 0, "input_0"]],
      [["switch", 0, "output"], ["merge", 0, "input_1"]],
      [["merge", 0, "output"], ["select", 0, "array"]],
    ],
  });

  const result = await graph.run({ target: { kind: "node", nodeId: "select" } });
  assert.equal(result.status, "completed");
  assert.deepEqual(graph.getOutput("merge", "output"), [2, 5]);
  assert.equal(graph.getOutput("select", "item"), 5);
  assert.equal(graph.getOutput("select", "count"), 2);
  await runtime.dispose();
});

test("Null passes any value through without project module resolution", async () => {
  const runtime = createRuntime({
    host: createNodeRuntimeHost({ modules: { resolve: async () => null } }),
  });
  const value = { palette: ["#112233", "#abcdef"], scale: 3 };
  const graph = await runtime.load({
    version: "0.2",
    nodes: [
      { id: "source", module: "cascade.core.Input", inputs: { value } },
      { id: "null", module: "cascade.core.Null" },
    ],
    connections: [[
      ["source", 0, "output"],
      ["null", 0, "input"],
    ]],
  });

  const result = await graph.run({ target: { kind: "output", nodeId: "null", outputName: "output" } });
  assert.equal(result.status, "completed");
  assert.deepEqual(graph.getOutput("null", "output"), value);
  await runtime.dispose();
});

test("legacy variadic ports keep numeric order without mutating frozen documents", async () => {
  const runtime = createRuntime({
    host: createNodeRuntimeHost({ modules: { resolve: async () => null } }),
  });
  const connection = (source, inputName) => Object.freeze({
    source: Object.freeze({ nodeId: source, outputName: "output" }),
    target: Object.freeze({ nodeId: "merge", inputName }),
  });
  const document = Object.freeze({
    version: "0.2",
    nodes: Object.freeze([
      Object.freeze({ id: "first", module: "cascade.core.Input", inputs: Object.freeze({ value: 1 }) }),
      Object.freeze({ id: "second", module: "cascade.core.Input", inputs: Object.freeze({ value: 2 }) }),
      Object.freeze({ id: "merge", module: "cascade.core.Merge" }),
    ]),
    connections: Object.freeze([
      connection("second", "input_2"),
      connection("first", "input_0"),
    ]),
  });

  const graph = await runtime.load(document);
  await graph.run();
  assert.deepEqual(graph.getOutput("merge", "output"), [1, 2]);
  assert.equal(document.connections[0].target.inputName, "input_2");
  await runtime.dispose();
});

test("root Input and Output expose a deterministic nested subnet interface", async () => {
  const double = {
    kind: "definition-v1",
    moduleId: "project.Double",
    definition: {
      apiVersion: 1,
      runsOn: "portable",
      inputs: { value: { kind: "data", type: "float" } },
      outputs: { result: { kind: "data", type: "float" } },
    },
    loadExecute: async () => ({ inputs, outputs }) => outputs.result.set(inputs.value * 2),
  };
  const runtime = createRuntime({
    host: createNodeRuntimeHost({ modules: { resolve: async () => null } }),
    nodes: [double],
  });
  const graph = await runtime.load({
    version: "0.2",
    nodes: [
      { id: "graph-input", module: "cascade.core.Input", props: { inputName: "source", dataType: "float" } },
      { id: "subnet", module: "cascade.core.Subnet" },
      { id: "subnet-input", module: "cascade.core.Input", parent: "subnet", props: { inputIndex: 0, dataType: "float" } },
      { id: "double", module: "project.Double", parent: "subnet" },
      { id: "subnet-output", module: "cascade.core.Output", parent: "subnet", props: { outputIndex: 0, dataType: "float" } },
      { id: "graph-output", module: "cascade.core.Output", props: { outputName: "result", dataType: "float" } },
    ],
    connections: [
      [["graph-input", 0, "output"], ["subnet", 0, "input_0"]],
      [["subnet-input", 0, "output"], ["double", 0, "value"]],
      [["double", 0, "result"], ["subnet-output", 0, "input"]],
      [["subnet", 0, "output_0"], ["graph-output", 0, "input"]],
    ],
  });

  await graph.setGraphInput("source", 7);
  const result = await graph.run({
    target: { kind: "output", nodeId: "graph-output", outputName: "output" },
  });
  assert.equal(result.status, "completed");
  assert.equal(graph.getGraphOutput("result"), 14);
  assert.deepEqual(graph.inspect().interface, {
    inputs: { source: { nodeId: "graph-input", type: "float" } },
    outputs: { result: { nodeId: "graph-output", type: "float" } },
  });
  await assert.rejects(
    () => graph.setProp("subnet-input", "inputIndex", 1),
    (error) => error.code === "runtime/structural-prop",
  );
  await runtime.dispose();
});

test("triggered subnet nodes load and cook synthesized data ancestors", async () => {
  const triggered = {
    kind: "definition-v1",
    moduleId: "project.Triggered",
    definition: {
      apiVersion: 1,
      runsOn: "portable",
      inputs: {
        value: { kind: "data", type: "float" },
        go: { kind: "trigger" },
      },
      outputs: { result: { kind: "data", type: "float" } },
    },
    loadExecute: async () => ({ inputs, outputs }) => {
      if (inputs.go) outputs.result.set(inputs.value * 3);
    },
  };
  const runtime = createRuntime({
    host: createNodeRuntimeHost({ modules: { resolve: async () => null } }),
    nodes: [triggered],
  });
  const graph = await runtime.load({
    nodes: [
      { id: "source", module: "cascade.core.Input", props: { inputName: "source", dataType: "float" } },
      { id: "subnet", module: "cascade.core.Subnet" },
      { id: "inside", module: "cascade.core.Input", parent: "subnet", props: { inputIndex: 0, dataType: "float" } },
      { id: "triggered", module: "project.Triggered", parent: "subnet" },
    ],
    connections: [
      [["source", 0, "output"], ["subnet", 0, "input_0"]],
      [["inside", 0, "output"], ["triggered", 0, "value"]],
    ],
  });

  await graph.setGraphInput("source", 3);
  const result = await graph.trigger("triggered", "go");
  assert.equal(result.status, "completed");
  assert.equal(graph.getOutput("triggered", "result"), 9);
  await runtime.dispose();
});

/**
 * `cascade.core.Time` — the clock as a value.
 *
 * Built because scrubbing the timeline on `particle-type` moved nothing:
 * `pop.Simulate` takes the frame on an input, its comment says to drive it with
 * `$F`, and an input cannot carry an expression. So the graph had a constant in
 * it and no node in the system could read the clock through a port.
 *
 * The node itself is a passthrough, and that is the property being tested: its
 * `execute` reads props and touches no clock, so it stays deterministic and
 * the time binding lives entirely in the props' declared default expressions.
 */
test("cascade.core.Time declares $F and $T as prop default expressions", async () => {
  const { timeDefinition, timeRegistration } = await import(
    "../dist/builtins/core/time.js"
  );
  assert.equal(timeRegistration.moduleId, "cascade.core.Time");
  // The binding is here and nowhere else. Studio turns a prop `expression` into
  // a `defaultExpression`, which is the one mechanism that already reads the
  // clock and maintains a node's time dependency.
  assert.equal(timeDefinition.props.frame.expression, "$F");
  assert.equal(timeDefinition.props.fframe.expression, "$FF");
  assert.equal(timeDefinition.props.time.expression, "$T");
  // `frame` is an INT and `fframe` a float, which is Houdini's own split and
  // the reason both exist: anything that counts frames — a feedback step
  // count, a sequence index — needs an integer, and narrowing is never
  // implicit here. Without this a float frame could not be wired to a step
  // count at all.
  assert.equal(timeDefinition.outputs.frame.type, "int");
  assert.equal(timeDefinition.outputs.fframe.type, "float");
  // No inputs: it is a source. A frame input would be the thing it exists to
  // provide.
  assert.deepEqual(Object.keys(timeDefinition.inputs), []);
  assert.deepEqual(Object.keys(timeDefinition.outputs), ["frame", "fframe", "time"]);
});

test("cascade.core.Time passes its props through and calls no clock", async () => {
  const { executeTime } = await import("../dist/builtins/core/time.js");
  const values = {};
  executeTime({
    nodeId: "t",
    inputs: {},
    outputs: {
      frame: { set: (value) => (values.frame = value) },
      fframe: { set: (value) => (values.fframe = value) },
      time: { set: (value) => (values.time = value) },
    },
    props: { frame: 47, fframe: 47.5, time: 1.979 },
    capabilities: {},
    signal: { aborted: false, addEventListener() {}, removeEventListener() {} },
    progress: { report() {} },
  });
  assert.equal(values.frame, 47);
  // Fractional on purpose: sub-frame time exists, and rounding it away would
  // make a 48 fps preview step in pairs.
  assert.equal(values.fframe, 47.5);
  assert.equal(values.time, 1.979);
});
