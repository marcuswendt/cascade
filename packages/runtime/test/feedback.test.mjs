import assert from "node:assert/strict";
import test from "node:test";

import { createRuntime } from "../dist/index.js";
import { createNodeRuntimeHost } from "../dist/node.js";
import { coreNodeRegistration } from "../dist/builtins/core/index.js";

/**
 * `cascade.core.Feedback` — the evaluation construct a simulation needs.
 *
 * Built 2026-09-09, after Marcus tried to dive into the particle node and see
 * its forces: *"how do i jump into the sim node and see its network of
 * forces."* He could not, and the reason was structural — a subnet in Cascade
 * is a grouping whose children cook once each in one flat graph, so "the forces
 * are nodes inside, replayed per timestep" had nowhere to live.
 *
 * A simulation is `state = f(state)` repeated, which is a cycle, and a pure DAG
 * cannot express it. So these tests are about the loop being real: that the
 * contents run N times rather than once, that state actually threads from one
 * step to the next, and that the children are not also cooked by the ordinary
 * order behind the loop's back.
 */

const registrations = new Map();
function core(id) {
  const found = coreNodeRegistration(id);
  assert.ok(found, `${id} is not registered`);
  return found;
}

function project(moduleId, definition, execute) {
  const registration = { kind: "definition-v1", moduleId, definition, loadExecute: async () => execute };
  registrations.set(moduleId, registration);
  return registration;
}

/** Adds `by` to the incoming number. The body of a trivial simulation. */
project(
  "project.Add",
  {
    apiVersion: 1,
    runsOn: "portable",
    inputs: {
      value: { kind: "data", type: "float", default: 0 },
      by: { kind: "data", type: "float", default: 1 },
    },
    outputs: { value: { kind: "data", type: "float" } },
  },
  ({ inputs, outputs }) => outputs.value.set((inputs.value ?? 0) + (inputs.by ?? 0)),
);

/** Counts how many times it ran, so "did the loop actually loop" is answerable
 *  by something other than the result. */
const runCounts = new Map();
project(
  "project.Count",
  {
    apiVersion: 1,
    runsOn: "portable",
    inputs: { value: { kind: "data", type: "float", default: 0 } },
    outputs: { value: { kind: "data", type: "float" } },
  },
  ({ nodeId, inputs, outputs }) => {
    runCounts.set(nodeId, (runCounts.get(nodeId) ?? 0) + 1);
    outputs.value.set(inputs.value ?? 0);
  },
);

/** A constant, for wiring a value in from outside the container. */
project(
  "project.Const",
  {
    apiVersion: 1,
    runsOn: "portable",
    inputs: { value: { kind: "data", type: "float", default: 0 } },
    outputs: { value: { kind: "data", type: "float" } },
  },
  ({ inputs, outputs }) => outputs.value.set(inputs.value ?? 0),
);

function host() {
  return createNodeRuntimeHost({
    modules: {
      resolve: async (id) => registrations.get(id) ?? core(id),
    },
  });
}

function document(nodes, connections = []) {
  return { version: "0.2", nodes, connections };
}

/**
 * The canonical shape: a Feedback whose contents read `Previous`, add one, and
 * write the result to `Output`.
 */
function counterGraph({ steps = 5, initial = 0, body = "project.Add" } = {}) {
  return document(
    [
      { id: "loop", module: "cascade.core.Feedback", inputs: { initial, steps } },
      { id: "prev", module: "cascade.core.Previous", parent: "loop" },
      { id: "body", module: body, parent: "loop", inputs: { by: 1 } },
      { id: "out", module: "cascade.core.Output", parent: "loop", props: { outputIndex: 0 } },
    ],
    [
      [["prev", 0, "value"], ["body", 0, "value"]],
      [["body", 0, "value"], ["out", 0, "input"]],
    ],
  );
}

async function runCounter(options) {
  runCounts.clear();
  const runtime = createRuntime({ host: host() });
  const graph = await runtime.load(counterGraph(options));
  await graph.run();
  return graph;
}

test("the contents run once per step and the state carries forward", async () => {
  const graph = await runCounter({ steps: 5, initial: 0 });
  // Five steps of +1 from zero. A container that ran its contents once would
  // give 1, and one that ran five times without carrying would also give 1 —
  // so this single number discriminates both failures at once.
  assert.equal(graph.getOutput("loop", "result"), 5);
});

test("the initial value seeds the first step", async () => {
  const graph = await runCounter({ steps: 3, initial: 10 });
  assert.equal(graph.getOutput("loop", "result"), 13);
});

test("zero steps returns the initial state rather than failing", async () => {
  // Frame zero of a simulation is where it starts. A graph that throws at the
  // beginning of the timeline is unusable.
  const graph = await runCounter({ steps: 0, initial: 7 });
  assert.equal(graph.getOutput("loop", "result"), 7);
});

test("a fractional step count is refused at the port, not quietly rounded", async () => {
  // `steps` is an `int`, so the runtime's own port validation catches this
  // before the loop sees it — which is the better place for it. A simulation
  // silently running 3 steps when the graph said 3.7 is the kind of nearly-
  // right that is hard to notice.
  await assert.rejects(
    () => runCounter({ steps: 3.7, initial: 0 }),
    (error) => /steps is not a valid int/.test(error.message),
  );
});

test("a negative step count clamps to zero and returns the initial state", async () => {
  // -4 is a valid int, so the port lets it through and the loop clamps. Zero
  // steps is already the defined answer for "nothing has happened yet", so a
  // negative frame is the same statement made carelessly rather than an error
  // worth stopping a render for.
  assert.equal((await runCounter({ steps: -4, initial: 2 })).getOutput("loop", "result"), 2);
});

test("the children are run by the loop and not also by the ordinary order", async () => {
  // The failure this catches is subtle and would read as a simulation that is
  // one step wrong: if the children stayed in the main cook order they would
  // each run a sixth time, outside the loop, with whatever state the last step
  // left behind.
  runCounts.clear();
  const runtime = createRuntime({ host: host() });
  const graph = await runtime.load(
    document(
      [
        { id: "loop", module: "cascade.core.Feedback", inputs: { initial: 0, steps: 4 } },
        { id: "prev", module: "cascade.core.Previous", parent: "loop" },
        { id: "count", module: "project.Count", parent: "loop" },
        { id: "out", module: "cascade.core.Output", parent: "loop", props: { outputIndex: 0 } },
      ],
      [
        [["prev", 0, "value"], ["count", 0, "value"]],
        [["count", 0, "value"], ["out", 0, "input"]],
      ],
    ),
  );
  await graph.run();
  assert.equal(runCounts.get("count"), 4);
});

test("a value wired in from outside reaches every step", async () => {
  runCounts.clear();
  const runtime = createRuntime({ host: host() });
  const graph = await runtime.load(
    document(
      [
        { id: "size", module: "project.Const", inputs: { value: 3 } },
        { id: "loop", module: "cascade.core.Feedback", inputs: { initial: 0, steps: 4 } },
        { id: "prev", module: "cascade.core.Previous", parent: "loop" },
        { id: "body", module: "project.Add", parent: "loop" },
        { id: "out", module: "cascade.core.Output", parent: "loop", props: { outputIndex: 0 } },
      ],
      [
        [["prev", 0, "value"], ["body", 0, "value"]],
        // The outside value drives the step size, so a container scheduled
        // before its source would add `undefined` and produce NaN.
        [["size", 0, "value"], ["body", 1, "by"]],
        [["body", 0, "value"], ["out", 0, "input"]],
      ],
    ),
  );
  await graph.run();
  assert.equal(graph.getOutput("loop", "result"), 12);
});

test("Previous reports the step index", async () => {
  // What a force needs to evolve noise or ramp a strength across a run, and the
  // reason it is an output rather than a global: a step-dependent node stays a
  // pure function of its inputs.
  const runtime = createRuntime({ host: host() });
  const graph = await runtime.load(
    document(
      [
        { id: "loop", module: "cascade.core.Feedback", inputs: { initial: 0, steps: 4 } },
        { id: "prev", module: "cascade.core.Previous", parent: "loop" },
        // value + step: 0+0, then 0+1, 1+2, 3+3 → 6.
        { id: "body", module: "project.Add", parent: "loop" },
        { id: "out", module: "cascade.core.Output", parent: "loop", props: { outputIndex: 0 } },
      ],
      [
        [["prev", 0, "value"], ["body", 0, "value"]],
        [["prev", 1, "step"], ["body", 1, "by"]],
        [["body", 0, "value"], ["out", 0, "input"]],
      ],
    ),
  );
  await graph.run();
  assert.equal(graph.getOutput("loop", "result"), 6);
});

test("a container with no Output says so rather than silently not simulating", async () => {
  const runtime = createRuntime({ host: host() });
  const graph = await runtime.load(
    document(
      [
        { id: "loop", module: "cascade.core.Feedback", inputs: { initial: 1, steps: 3 } },
        { id: "prev", module: "cascade.core.Previous", parent: "loop" },
        { id: "body", module: "project.Add", parent: "loop", inputs: { by: 1 } },
      ],
      [[["prev", 0, "value"], ["body", 0, "value"]]],
    ),
  );
  const result = await graph.run();
  assert.equal(result.status, "failed");
  assert.ok(
    result.diagnostics.some((diagnostic) =>
      /no cascade.core.Output inside it/.test(diagnostic.message),
    ),
    "the diagnostic should name what to add",
  );
});

test("an empty container with zero steps is still fine", async () => {
  // The no-Output check only fires when a step would actually run. Refusing an
  // empty container at frame zero would make a half-built graph unopenable.
  const runtime = createRuntime({ host: host() });
  const graph = await runtime.load(
    document([{ id: "loop", module: "cascade.core.Feedback", inputs: { initial: 5, steps: 0 } }]),
  );
  const result = await graph.run();
  assert.equal(result.status, "completed");
  assert.equal(graph.getOutput("loop", "result"), 5);
});

test("Previous outside a container emits its own initial rather than throwing", async () => {
  // A node dragged out of a loop should show something explicable. The
  // alternative is a graph that cannot be edited without first being valid.
  const runtime = createRuntime({ host: host() });
  const graph = await runtime.load(
    document([{ id: "prev", module: "cascade.core.Previous", inputs: { initial: 42 } }]),
  );
  await graph.run();
  assert.equal(graph.getOutput("prev", "value"), 42);
  assert.equal(graph.getOutput("prev", "step"), 0);
});

test("nested feedback: an inner loop runs to completion inside each outer step", async () => {
  // The reason the carried state is keyed by container id. Two steps outside,
  // three inside, each adding one: 2 x 3 = 6.
  const runtime = createRuntime({ host: host() });
  const graph = await runtime.load(
    document(
      [
        { id: "outer", module: "cascade.core.Feedback", inputs: { initial: 0, steps: 2 } },
        { id: "outerPrev", module: "cascade.core.Previous", parent: "outer" },
        { id: "inner", module: "cascade.core.Feedback", parent: "outer", inputs: { steps: 3 } },
        { id: "innerPrev", module: "cascade.core.Previous", parent: "inner" },
        { id: "innerBody", module: "project.Add", parent: "inner", inputs: { by: 1 } },
        { id: "innerOut", module: "cascade.core.Output", parent: "inner", props: { outputIndex: 0 } },
        { id: "outerOut", module: "cascade.core.Output", parent: "outer", props: { outputIndex: 0 } },
      ],
      [
        [["outerPrev", 0, "value"], ["inner", 0, "initial"]],
        [["innerPrev", 0, "value"], ["innerBody", 0, "value"]],
        [["innerBody", 0, "value"], ["innerOut", 0, "input"]],
        [["inner", 0, "result"], ["outerOut", 0, "input"]],
      ],
    ),
  );
  await graph.run();
  assert.equal(graph.getOutput("outer", "result"), 6);
});
