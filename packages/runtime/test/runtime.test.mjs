import assert from "node:assert/strict";
import test from "node:test";

import { createRuntime, CascadeRuntimeError } from "../dist/index.js";
import { createNodeRuntimeHost } from "../dist/node.js";
import { createBrowserRuntimeHost } from "../dist/browser.js";

function registration(moduleId, definition, execute, loaded) {
  return {
    kind: "definition-v1",
    moduleId,
    definition,
    loadExecute: async () => {
      loaded.push(moduleId);
      return execute;
    },
  };
}

function document(nodes, connections = []) {
  return { version: "0.2", nodes, connections };
}

test("load is side-effect-free and run lazily executes a data graph", async () => {
  const loaded = [];
  const modules = new Map([
    [
      "project.Source",
      registration(
        "project.Source",
        {
          apiVersion: 1,
          runsOn: "portable",
          outputs: { value: { kind: "data", type: "float" } },
        },
        ({ outputs }) => outputs.value.set(3),
        loaded,
      ),
    ],
    [
      "project.Scale",
      registration(
        "project.Scale",
        {
          apiVersion: 1,
          runsOn: "portable",
          inputs: { value: { kind: "data", type: "float" } },
          outputs: { result: { kind: "data", type: "float" } },
          props: { multiplier: { type: "float", default: 2 } },
        },
        ({ inputs, outputs, props }) =>
          outputs.result.set(inputs.value * props.multiplier),
        loaded,
      ),
    ],
  ]);
  const host = createNodeRuntimeHost({
    modules: { resolve: async (id) => modules.get(id) ?? null },
  });
  const runtime = createRuntime({ host });
  const graph = await runtime.load(
    document(
      [
        { id: "source", module: "project.Source" },
        { id: "scale", module: "project.Scale", props: { multiplier: 4 } },
      ],
      [
        [
          ["source", 0, "value"],
          ["scale", 0, "value"],
        ],
      ],
    ),
  );

  assert.deepEqual(loaded, []);
  assert.equal(graph.inspect().state, "ready");
  const result = await graph.run({
    runId: "run-1",
    target: { kind: "output", nodeId: "scale", outputName: "result" },
  });
  assert.equal(result.status, "completed");
  assert.equal(graph.getOutput("scale", "result"), 12);
  assert.deepEqual(loaded, ["project.Source", "project.Scale"]);
  await runtime.dispose();
});

test("portable registrations may select a host-specific executor", async () => {
  const environments = [];
  const portable = {
    kind: "definition-v1",
    moduleId: "project.HostValue",
    definition: {
      apiVersion: 1,
      runsOn: "portable",
      outputs: { value: { kind: "data", type: "string" } },
    },
    loadExecute: async (environment) => {
      environments.push(environment);
      return ({ outputs }) => outputs.value.set(environment);
    },
  };
  const graphDocument = document([
    { id: "host", module: "project.HostValue" },
  ]);

  for (const [host, expected] of [
    [createBrowserRuntimeHost({ modules: { resolve: async () => portable } }), "browser"],
    [createNodeRuntimeHost({ modules: { resolve: async () => portable } }), "server"],
  ]) {
    const runtime = createRuntime({ host });
    const graph = await runtime.load(graphDocument);
    await graph.run();
    assert.equal(graph.getOutput("host", "value"), expected);
    await runtime.dispose();
  }

  assert.deepEqual(environments, ["browser", "server"]);
});

test("preflight rejects missing capabilities before loading execute", async () => {
  const loaded = [];
  const node = registration(
    "project.Python",
    {
      apiVersion: 1,
      runsOn: "server",
      capabilities: ["python"],
      outputs: { result: { kind: "data", type: "float" } },
    },
    () => {},
    loaded,
  );
  const runtime = createRuntime({
    host: createNodeRuntimeHost({ modules: { resolve: async () => node } }),
  });
  const graph = await runtime.load(
    document([{ id: "python", module: "project.Python" }]),
  );
  await assert.rejects(
    () => graph.run(),
    (error) => {
      assert.ok(error instanceof CascadeRuntimeError);
      assert.equal(error.diagnostics[0].code, "runtime/missing-capability");
      return true;
    },
  );
  assert.deepEqual(loaded, []);
});

test("delivers trigger fan-out in authored FIFO order", async () => {
  const loaded = [];
  const seen = [];
  const trigger = (definition) =>
    registration(
      definition.moduleId,
      definition.value,
      definition.execute,
      loaded,
    );
  const modules = new Map([
    [
      "project.Source",
      trigger({
        moduleId: "project.Source",
        value: {
          apiVersion: 1,
          runsOn: "portable",
          inputs: { start: { kind: "trigger" } },
          outputs: { next: { kind: "trigger" } },
        },
        execute: ({ inputs, outputs }) =>
          outputs.next.trigger(inputs.start.payload),
      }),
    ],
    [
      "project.Sink",
      trigger({
        moduleId: "project.Sink",
        value: {
          apiVersion: 1,
          runsOn: "portable",
          inputs: { tick: { kind: "trigger" } },
        },
        execute: ({ inputs }) => seen.push(inputs.tick.payload),
      }),
    ],
  ]);
  const runtime = createRuntime({
    host: createNodeRuntimeHost({
      modules: { resolve: async (id) => modules.get(id) ?? null },
    }),
  });
  const graph = await runtime.load(
    document(
      [
        { id: "source", module: "project.Source" },
        { id: "first", module: "project.Sink" },
        { id: "second", module: "project.Sink" },
      ],
      [
        [
          ["source", 0, "next"],
          ["first", 0, "tick"],
        ],
        [
          ["source", 0, "next"],
          ["second", 0, "tick"],
        ],
      ],
    ),
  );
  const events = [];
  graph.subscribe((event) => {
    if (event.type === "trigger:delivered") events.push(event.nodeId);
  });
  const result = await graph.trigger(
    "source",
    "start",
    { frame: 1 },
    { runId: "trigger-run" },
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(seen, [{ frame: 1 }, { frame: 1 }]);
  assert.deepEqual(events, ["source", "first", "second"]);
});

test("rejects concurrent runs instead of queueing them", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const node = registration(
    "project.Wait",
    {
      apiVersion: 1,
      runsOn: "portable",
      outputs: { done: { kind: "data", type: "bool" } },
    },
    async ({ outputs }) => {
      await gate;
      outputs.done.set(true);
    },
    [],
  );
  const runtime = createRuntime({
    host: createNodeRuntimeHost({ modules: { resolve: async () => node } }),
  });
  const graph = await runtime.load(
    document([{ id: "wait", module: "project.Wait" }]),
  );
  const first = graph.run();
  await assert.rejects(
    () => graph.run(),
    (error) => error.code === "runtime/invalid-state",
  );
  release();
  await first;
});

test("browser hosts bridge server nodes without importing their executors", async () => {
  const loaded = [];
  const calls = [];
  const node = registration(
    "project.Remote",
    {
      apiVersion: 1,
      runsOn: "server",
      capabilities: ["python"],
      inputs: { value: { kind: "data", type: "float", default: 2 } },
      outputs: { result: { kind: "data", type: "float" } },
    },
    () => {
      throw new Error("must not execute locally");
    },
    loaded,
  );
  const runtime = createRuntime({
    host: createBrowserRuntimeHost({
      modules: { resolve: async () => node },
      serverBridge: {
        execute: async (request) => {
          calls.push(request);
          return {
            outputs: { result: request.inputs.value * 3 },
            diagnostics: [],
          };
        },
      },
    }),
  });
  const graph = await runtime.load(
    document([{ id: "remote", module: "project.Remote" }]),
  );
  const result = await graph.run();
  assert.equal(result.status, "completed");
  assert.equal(graph.getOutput("remote", "result"), 6);
  assert.deepEqual(loaded, []);
  assert.equal(calls.length, 1);
});

test("server hosts never accept browser nodes through a server bridge", async () => {
  const node = registration(
    "project.Browser",
    {
      apiVersion: 1,
      runsOn: "browser",
      outputs: { result: { kind: "data", type: "float" } },
    },
    () => {},
    [],
  );
  const runtime = createRuntime({
    host: createNodeRuntimeHost({
      modules: { resolve: async () => node },
      serverBridge: { execute: async () => ({ outputs: {}, diagnostics: [] }) },
    }),
  });
  const graph = await runtime.load(
    document([{ id: "browser", module: "project.Browser" }]),
  );
  await assert.rejects(
    () => graph.run(),
    (error) => error.code === "runtime/preflight-environment",
  );
});

test("rejects cyclic values and validates node parent hierarchy", async () => {
  const node = registration(
    "project.Value",
    {
      apiVersion: 1,
      runsOn: "portable",
      inputs: { value: { kind: "data", type: "any" } },
    },
    () => {},
    [],
  );
  const runtime = createRuntime({
    host: createNodeRuntimeHost({ modules: { resolve: async () => node } }),
  });
  await assert.rejects(
    () => runtime.load(document([{ id: "child", module: "project.Value", parent: "missing" }])),
    (error) => error.code === "runtime/parent-not-found",
  );

  const container = registration(
    "project.Subnet",
    { apiVersion: 1, runsOn: "portable", container: "subnet" },
    () => {},
    [],
  );
  const hierarchyRuntime = createRuntime({
    host: createNodeRuntimeHost({ modules: { resolve: async (id) => id === container.moduleId ? container : node } }),
  });
  const graph = await hierarchyRuntime.load({
    ...document([
      { id: "subnet", module: "project.Subnet" },
      { id: "child", module: "project.Value", parent: "subnet" },
    ]),
    annotations: [
      {
        id: "note",
        type: "text",
        parent: "subnet",
        content: "kept as authored data",
      },
    ],
  });
  assert.equal(graph.inspect().nodes.find((item) => item.id === "child").parent, "subnet");
  const cyclic = {};
  cyclic.self = cyclic;
  await assert.rejects(
    () => graph.setInput("child", "value", cyclic),
    (error) => error.code === "runtime/non-serializable-value",
  );
});

test("rejects non-container parents and parent cycles", async () => {
  const ordinary = registration(
    "project.Value",
    { apiVersion: 1, runsOn: "portable" },
    () => {},
    [],
  );
  const container = registration(
    "project.Subnet",
    { apiVersion: 1, runsOn: "portable", container: "subnet" },
    () => {},
    [],
  );
  const makeRuntime = () => createRuntime({
    host: createNodeRuntimeHost({ modules: { resolve: async (id) => id === container.moduleId ? container : ordinary } }),
  });
  await assert.rejects(
    () => makeRuntime().load(document([
      { id: "parent", module: "project.Value" },
      { id: "child", module: "project.Value", parent: "parent" },
    ])),
    (error) => error.code === "runtime/parent-not-container",
  );
  await assert.rejects(
    () => makeRuntime().load(document([
      { id: "a", module: "project.Subnet", parent: "b" },
      { id: "b", module: "project.Subnet", parent: "a" },
    ])),
    (error) => error.code === "runtime/parent-cycle",
  );
});

test("inspection returns frozen connection snapshots", async () => {
  const source = registration(
    "project.Source",
    {
      apiVersion: 1,
      runsOn: "portable",
      outputs: { value: { kind: "data", type: "float" } },
    },
    ({ outputs }) => outputs.value.set(1),
    [],
  );
  const sink = registration(
    "project.Sink",
    {
      apiVersion: 1,
      runsOn: "portable",
      inputs: { value: { kind: "data", type: "float" } },
    },
    () => {},
    [],
  );
  const runtime = createRuntime({
    host: createNodeRuntimeHost({
      modules: {
        resolve: async (moduleId) =>
          moduleId === source.moduleId ? source : sink,
      },
    }),
  });
  const graph = await runtime.load({
    nodes: [
      { id: "source", module: source.moduleId },
      { id: "sink", module: sink.moduleId },
    ],
    connections: [
      [
        ["source", 0, "value"],
        ["sink", 0, "value"],
      ],
    ],
  });

  const inspection = graph.inspect();
  assert(Object.isFrozen(inspection.connections));
  assert(Object.isFrozen(inspection.connections[0]));
  assert(Object.isFrozen(inspection.connections[0].source));
  assert.throws(() => {
    inspection.connections[0].source.nodeId = "changed";
  }, TypeError);
  assert.equal(graph.inspect().connections[0].source.nodeId, "source");
});

test("validates runtime values and emits cancellation before completion", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const listeners = new Set();
  const signal = {
    aborted: false,
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    abort() {
      this.aborted = true;
      for (const listener of [...listeners]) listener();
    },
  };
  const node = registration(
    "project.Number",
    {
      apiVersion: 1,
      runsOn: "portable",
      inputs: { value: { kind: "data", type: "int", default: 1 } },
      outputs: { result: { kind: "data", type: "int" } },
    },
    async ({ outputs }) => {
      await gate;
      outputs.result.set(1);
    },
    [],
  );
  const runtime = createRuntime({
    host: createNodeRuntimeHost({
      modules: { resolve: async () => node },
    }),
  });
  const graph = await runtime.load(
    document([{ id: "number", module: "project.Number" }]),
  );
  await assert.rejects(
    () => graph.setInput("number", "value", 1.5),
    (error) => error.code === "runtime/value-type",
  );
  const events = [];
  graph.subscribe((event) => events.push(event.type));
  const running = graph.run({ signal, runId: "cancelled-run" });
  await Promise.resolve();
  signal.abort();
  release();
  const result = await running;
  assert.equal(result.status, "cancelled");
  assert.ok(events.indexOf("run:cancel") < events.indexOf("run:complete"));
});

test("clones definitions and freezes execute context snapshots", async () => {
  const definition = {
    apiVersion: 1,
    runsOn: "portable",
    capabilities: ["assets"],
    inputs: { value: { kind: "data", type: "float", default: 2 } },
    outputs: { result: { kind: "data", type: "float" } },
    props: { factor: { type: "float", default: 3 } },
  };
  let contextFrozen = false;
  const node = registration(
    "project.Frozen",
    definition,
    ({ inputs, outputs, props, capabilities }) => {
      contextFrozen =
        Object.isFrozen(inputs) &&
        Object.isFrozen(props) &&
        Object.isFrozen(capabilities);
      assert.throws(() => {
        props.factor = 20;
      }, TypeError);
      outputs.result.set(inputs.value * props.factor);
    },
    [],
  );
  const runtime = createRuntime({
    host: createNodeRuntimeHost({
      modules: { resolve: async () => node },
      assets: {},
    }),
  });
  const graph = await runtime.load(
    document([{ id: "frozen", module: "project.Frozen" }]),
  );
  definition.props.factor.default = 99;
  definition.inputs.value.default = 99;
  const result = await graph.run();
  assert.equal(result.status, "completed");
  assert.equal(graph.getOutput("frozen", "result"), 6);
  assert.equal(result.outputs.get("frozen").get("result"), 6);
  assert.equal(result.outputs.set, undefined);
  assert.equal(result.outputs.get("frozen").set, undefined);
  assert.equal(graph.getOutputs("frozen").set, undefined);
  assert.equal(contextFrozen, true);
});

test("run all ignores dormant trigger branches and their data descendants", async () => {
  const loaded = [];
  const modules = new Map([
    [
      "project.Live",
      registration(
        "project.Live",
        {
          apiVersion: 1,
          runsOn: "portable",
          outputs: { value: { kind: "data", type: "float" } },
        },
        ({ outputs }) => outputs.value.set(4),
        loaded,
      ),
    ],
    [
      "project.Dormant",
      registration(
        "project.Dormant",
        {
          apiVersion: 1,
          runsOn: "server",
          capabilities: ["python"],
          inputs: { start: { kind: "trigger" } },
          outputs: { value: { kind: "data", type: "float" } },
        },
        ({ outputs }) => outputs.value.set(10),
        loaded,
      ),
    ],
    [
      "project.After",
      registration(
        "project.After",
        {
          apiVersion: 1,
          runsOn: "portable",
          inputs: { value: { kind: "data", type: "float" } },
          outputs: { result: { kind: "data", type: "float" } },
        },
        ({ inputs, outputs }) => outputs.result.set(inputs.value),
        loaded,
      ),
    ],
  ]);
  const runtime = createRuntime({
    host: createNodeRuntimeHost({
      modules: { resolve: async (id) => modules.get(id) ?? null },
    }),
  });
  const graph = await runtime.load(
    document(
      [
        { id: "live", module: "project.Live" },
        { id: "dormant", module: "project.Dormant" },
        { id: "after", module: "project.After" },
      ],
      [
        [
          ["dormant", 0, "value"],
          ["after", 0, "value"],
        ],
      ],
    ),
  );
  const result = await graph.run();
  assert.equal(result.status, "completed");
  assert.equal(graph.getOutput("live", "value"), 4);
  assert.deepEqual(loaded, ["project.Live"]);
});

test("targeted runs reject data ancestry gated by a missing event", async () => {
  const gated = registration(
    "project.Gated",
    {
      apiVersion: 1,
      runsOn: "portable",
      inputs: { start: { kind: "trigger" } },
      outputs: { value: { kind: "data", type: "float" } },
    },
    ({ outputs }) => outputs.value.set(2),
    [],
  );
  const sink = registration(
    "project.Sink",
    {
      apiVersion: 1,
      runsOn: "portable",
      inputs: { value: { kind: "data", type: "float" } },
      outputs: { result: { kind: "data", type: "float" } },
    },
    ({ inputs, outputs }) => outputs.result.set(inputs.value),
    [],
  );
  const runtime = createRuntime({
    host: createNodeRuntimeHost({
      modules: {
        resolve: async (id) => (id === gated.moduleId ? gated : sink),
      },
    }),
  });
  const graph = await runtime.load(
    document(
      [
        { id: "gated", module: gated.moduleId },
        { id: "sink", module: sink.moduleId },
      ],
      [
        [
          ["gated", 0, "value"],
          ["sink", 0, "value"],
        ],
      ],
    ),
  );
  await assert.rejects(
    () =>
      graph.run({
        target: { kind: "output", nodeId: "sink", outputName: "result" },
      }),
    (error) => error.code === "runtime/invalid-target",
  );
});

test("enforces input cardinality and supplies ordered variadic values", async () => {
  const source = (moduleId, value) =>
    registration(
      moduleId,
      {
        apiVersion: 1,
        runsOn: "portable",
        outputs: { value: { kind: "data", type: "float" } },
      },
      ({ outputs }) => outputs.value.set(value),
      [],
    );
  const first = source("project.First", 1);
  const second = source("project.Second", 2);
  let seen;
  const collector = registration(
    "project.Collector",
    {
      apiVersion: 1,
      runsOn: "portable",
      inputs: {
        values: { kind: "data", type: "float", variadic: true },
      },
      outputs: { total: { kind: "data", type: "float" } },
    },
    ({ inputs, outputs }) => {
      seen = inputs.values;
      outputs.total.set(inputs.values.reduce((sum, value) => sum + value, 0));
    },
    [],
  );
  const modules = new Map(
    [first, second, collector].map((item) => [item.moduleId, item]),
  );
  const runtime = createRuntime({
    host: createNodeRuntimeHost({
      modules: { resolve: async (id) => modules.get(id) ?? null },
    }),
  });
  const graph = await runtime.load(
    document(
      [
        { id: "first", module: first.moduleId },
        { id: "second", module: second.moduleId },
        { id: "collector", module: collector.moduleId },
      ],
      [
        [
          ["second", 0, "value"],
          ["collector", 0, "values"],
        ],
        [
          ["first", 0, "value"],
          ["collector", 0, "values"],
        ],
      ],
    ),
  );
  await graph.run();
  assert.deepEqual(seen, [2, 1]);
  assert.equal(graph.getOutput("collector", "total"), 3);

  const nonVariadic = {
    ...collector,
    moduleId: "project.Single",
    definition: {
      ...collector.definition,
      inputs: { values: { kind: "data", type: "float" } },
    },
  };
  const invalidRuntime = createRuntime({
    host: createNodeRuntimeHost({
      modules: {
        resolve: async (id) =>
          id === first.moduleId
            ? first
            : id === second.moduleId
              ? second
              : nonVariadic,
      },
    }),
  });
  await assert.rejects(
    () =>
      invalidRuntime.load(
        document(
          [
            { id: "first", module: first.moduleId },
            { id: "second", module: second.moduleId },
            { id: "single", module: nonVariadic.moduleId },
          ],
          [
            [
              ["first", 0, "value"],
              ["single", 0, "values"],
            ],
            [
              ["second", 0, "value"],
              ["single", 0, "values"],
            ],
          ],
        ),
      ),
    (error) => error.code === "runtime/input-cardinality",
  );
});

test("applies presets atomically after validating the complete draft", async () => {
  const node = registration(
    "project.Preset",
    {
      apiVersion: 1,
      runsOn: "portable",
      inputs: { value: { kind: "data", type: "int", default: 1 } },
      props: { factor: { type: "int", default: 2 } },
    },
    () => {},
    [],
  );
  const runtime = createRuntime({
    host: createNodeRuntimeHost({ modules: { resolve: async () => node } }),
  });
  const graph = await runtime.load(
    document([{ id: "preset", module: node.moduleId }]),
  );
  await assert.rejects(() =>
    graph.applyPreset({
      version: 1,
      nodes: {
        preset: { inputs: { value: 10 }, props: { factor: 1.5 } },
      },
    }),
  );
  const inspection = graph.inspect().nodes[0];
  assert.equal(inspection.inputs.value.value, 1);
  assert.equal(inspection.props.factor.value, 2);
});

test("isolates abort-listener errors and disposal awaits active execution", async () => {
  let release;
  let markStarted;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  let secondListenerCalled = false;
  const reports = [];
  const node = registration(
    "project.Dispose",
    { apiVersion: 1, runsOn: "portable" },
    async ({ signal }) => {
      signal.addEventListener("abort", () => {
        throw new Error("listener failed");
      });
      signal.addEventListener("abort", () => {
        secondListenerCalled = true;
      });
      markStarted();
      await gate;
    },
    [],
  );
  const runtime = createRuntime({
    host: createNodeRuntimeHost({
      modules: { resolve: async () => node },
      report: (diagnostic) => reports.push(diagnostic),
    }),
  });
  const graph = await runtime.load(
    document([{ id: "dispose", module: node.moduleId }]),
  );
  const running = graph.run();
  await started;
  let disposed = false;
  const disposal = graph.dispose().then(() => {
    disposed = true;
  });
  await Promise.resolve();
  assert.equal(disposed, false);
  assert.equal(secondListenerCalled, true);
  release();
  await running;
  await disposal;
  assert.equal(graph.state, "disposed");
  assert.equal(reports[0].code, "runtime/abort-listener-failed");
});

test("binds shell calls to the active graph cancellation signal", async () => {
  let shellStarted;
  const started = new Promise((resolve) => { shellStarted = resolve; });
  const shell = {
    run: (_command, _args, options) => new Promise((_resolve, reject) => {
      shellStarted();
      options.signal.addEventListener("abort", () => reject(new Error("shell cancelled")), { once: true });
    }),
    runJson: async () => ({}),
  };
  const node = registration(
    "project.Shell",
    { apiVersion: 1, runsOn: "server", capabilities: ["shell"] },
    ({ capabilities }) => capabilities.shell.run("tool"),
    [],
  );
  const runtime = createRuntime({
    host: createNodeRuntimeHost({ modules: { resolve: async () => node }, shell }),
  });
  const graph = await runtime.load(document([{ id: "shell", module: node.moduleId }]));
  const running = graph.run();
  await started;
  graph.cancel("superseded");
  const result = await running;
  assert.equal(result.status, "cancelled");
});
