/**
 * Concurrent nodes within a frame (performance round 2, move 3b): independent
 * ready nodes cook at once on a runtime with `concurrency` > 1, nodes that read
 * each other never overlap, the start order stays the serial one, and the
 * headless stage host keeps a small pool of warm Python workers.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntime } from '../packages/runtime/src/runtime';
import { createNodeRuntimeHost } from '../packages/runtime/src/node';
import type { DefinitionNodeRegistration, RuntimeEvent } from '../packages/runtime/src/types';
import { ProjectRoot } from '../server/src/project.js';
import { installStageBridge, runStage } from '../server/src/runtime/stage.js';
import { defaultStageWorkerCount } from '../server/src/pythonWorker.js';
import { installedStageLanes, installProjectStages } from '@/cli/projectStages';
import { RunTrace, traceNodeScope } from '@/cli/runTrace';

type Interval = { start: number; end: number };

/**
 * `src` feeds `a` and `b`, which do not read each other; `join` reads both.
 * `a` and `b` each make one fake stage call, which takes `stageMs`.
 */
function fixture(concurrency: number, options: { stageMs?: number; fail?: string[]; trace?: RunTrace } = {}) {
  const stageMs = options.stageMs ?? 40;
  const intervals = new Map<string, Interval>();
  const clock = () => performance.now();
  const timed = (id: string, work: () => Promise<void> | void) => async () => {
    const interval: Interval = { start: clock(), end: Number.NaN };
    intervals.set(id, interval);
    await work();
    interval.end = clock();
  };
  const any = { kind: 'data', type: 'float', default: 0 } as const;
  const stageNode = (moduleId: string): DefinitionNodeRegistration => ({
    kind: 'definition-v1',
    moduleId,
    definition: { apiVersion: 1, runsOn: 'portable', inputs: { value: any }, outputs: { value: { kind: 'data', type: 'float' } } },
    loadExecute: async () => async (context: any) => {
      await timed(context.nodeId, async () => {
        if (options.fail?.includes(context.nodeId)) {
          await new Promise((resolve) => setTimeout(resolve, context.nodeId === 'a' ? stageMs : 1));
          throw new Error(`${context.nodeId} failed`);
        }
        const answer = await runStage<{ value: number }>('slow', { value: context.inputs.value });
        context.outputs.value.set(answer.value);
      })();
    },
  });
  const nodes: DefinitionNodeRegistration[] = [
    {
      kind: 'definition-v1', moduleId: 'test.Source',
      definition: { apiVersion: 1, runsOn: 'portable', outputs: { value: { kind: 'data', type: 'float' } } },
      loadExecute: async () => async (context: any) => {
        await timed('src', () => { context.outputs.value.set(1); })();
      },
    },
    stageNode('test.StageA'),
    stageNode('test.StageB'),
    {
      kind: 'definition-v1', moduleId: 'test.Join',
      definition: { apiVersion: 1, runsOn: 'portable', inputs: { a: any, b: any }, outputs: { sum: { kind: 'data', type: 'float' } } },
      loadExecute: async () => async (context: any) => {
        await timed('join', () => { context.outputs.sum.set(context.inputs.a + context.inputs.b); })();
      },
    },
  ];
  const disposeBridge = installStageBridge(async (_stage, args) => {
    await new Promise((resolve) => setTimeout(resolve, stageMs));
    // A stage call made inside a node's cook: the trace must give it to that node.
    options.trace?.recordStage({ stage: 'slow', key: String(args.value), cache: 'off', code: '', cascade: '', inputs: {}, ms: stageMs } as never);
    return { value: Number(args.value) * 2 };
  });
  const runtime = createRuntime({
    host: createNodeRuntimeHost({ modules: { resolve: async () => null } }),
    nodes,
    concurrency,
    nodeScope: traceNodeScope,
  });
  const document = {
    version: '0.2',
    nodes: [
      { id: 'src', module: 'test.Source' },
      { id: 'a', module: 'test.StageA' },
      { id: 'b', module: 'test.StageB' },
      { id: 'join', module: 'test.Join' },
    ],
    connections: [
      { source: { nodeId: 'src', outputName: 'value' }, target: { nodeId: 'a', inputName: 'value' } },
      { source: { nodeId: 'src', outputName: 'value' }, target: { nodeId: 'b', inputName: 'value' } },
      { source: { nodeId: 'a', outputName: 'value' }, target: { nodeId: 'join', inputName: 'a' } },
      { source: { nodeId: 'b', outputName: 'value' }, target: { nodeId: 'join', inputName: 'b' } },
    ],
  };
  return {
    intervals,
    load: () => runtime.load(document),
    dispose: async () => { disposeBridge(); await runtime.dispose(); },
  };
}

const overlap = (first: Interval, second: Interval) => first.start < second.end && second.start < first.end;
const before = (first: Interval, second: Interval) => first.end <= second.start;

describe('concurrent nodes in one run', () => {
  it('cooks two independent stage nodes at once, and never a node before what it reads', async () => {
    const test = fixture(2);
    try {
      const graph = await test.load();
      const result = await graph.run();
      expect(result.status).toBe('completed');
      expect(graph.getOutput('join', 'sum')).toBe(4);
      const { src, a, b, join } = Object.fromEntries(test.intervals) as Record<string, Interval>;
      expect(overlap(a!, b!)).toBe(true);
      expect(before(src!, a!) && before(src!, b!)).toBe(true);
      expect(before(a!, join!) && before(b!, join!)).toBe(true);
    } finally {
      await test.dispose();
    }
  });

  it('runs one after another at the default concurrency of 1', async () => {
    const test = fixture(1);
    try {
      const graph = await test.load();
      await graph.run();
      expect(overlap(test.intervals.get('a')!, test.intervals.get('b')!)).toBe(false);
    } finally {
      await test.dispose();
    }
  });

  it('starts nodes in topological order on every run, whichever finishes first', async () => {
    const test = fixture(2, { stageMs: 5 });
    try {
      const graph = await test.load();
      const starts: string[][] = [];
      graph.subscribe((event: RuntimeEvent) => {
        if (event.type === 'run:start') starts.push([]);
        if (event.type === 'node:start') starts[starts.length - 1]!.push(event.nodeId);
      });
      for (let frame = 1; frame <= 5; frame++) await graph.run({ frame });
      for (const order of starts) expect(order).toEqual(['src', 'a', 'b', 'join']);
    } finally {
      await test.dispose();
    }
  });

  it('reports the failure earliest in the order, after the nodes in flight finish', async () => {
    // `b` fails first in time, `a` (earlier in the order) a little later.
    const test = fixture(2, { fail: ['a', 'b'] });
    try {
      const graph = await test.load();
      const result = await graph.run();
      expect(result.status).toBe('failed');
      expect(result.diagnostics[0]?.message).toBe('a failed');
      expect(test.intervals.has('join')).toBe(false);
    } finally {
      await test.dispose();
    }
  });

  it('gives each concurrent stage call to the node that made it in the run trace', async () => {
    const trace = new RunTrace('fixture.cascade', 'test', 0);
    const test = fixture(2, { trace });
    try {
      const graph = await test.load();
      trace.attach(graph);
      await graph.run();
      const run = trace.toJSON().runs[0]!;
      expect(run.nodes.map((node) => node.id)).toEqual(['src', 'a', 'b', 'join']);
      expect(run.nodes.find((node) => node.id === 'a')!.stages).toHaveLength(1);
      expect(run.nodes.find((node) => node.id === 'b')!.stages).toHaveLength(1);
      expect(run.nodes.find((node) => node.id === 'join')!.stages).toHaveLength(0);
    } finally {
      await test.dispose();
    }
  });
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** A project whose warm worker sleeps `seconds` per call and answers with its pid. */
function sleepyProject(seconds: number) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-stage-pool-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'runtime'));
  fs.writeFileSync(path.join(root, 'runtime', 'stages.py'), 'print("{}")\n');
  fs.writeFileSync(path.join(root, 'runtime', 'worker.py'), [
    'import json, os, sys, time',
    'for line in sys.stdin:',
    '    req = json.loads(line)',
    `    time.sleep(${seconds})`,
    '    print(json.dumps({"id": req["id"], "ok": True, "result": {"pid": os.getpid(), "value": req["args"]["value"]}}), flush=True)',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify({
    exec: { stages: { entrypoint: 'runtime/stages.py', worker: 'runtime/worker.py' } },
  }));
  return new ProjectRoot(root);
}

describe('stage worker pool', () => {
  it('sizes the pool from cores and memory, two to four', () => {
    const GB = 1024 ** 3;
    expect(defaultStageWorkerCount(16, 128 * GB)).toBe(4);
    expect(defaultStageWorkerCount(10, 16 * GB)).toBe(2);
    expect(defaultStageWorkerCount(64, 512 * GB)).toBe(4);
    expect(defaultStageWorkerCount(4, 8 * GB)).toBe(2);
    expect(defaultStageWorkerCount(12, 24 * GB)).toBe(3);
  });

  it('answers two calls at once from two warm processes, and lanes follow the pool', async () => {
    const dispose = installProjectStages(sleepyProject(0.4), { poolSize: 2 });
    try {
      expect(installedStageLanes()).toBe(2);
      // Warm both processes first, so the timing below is the calls, not Python starting.
      await Promise.all([runStage('warm', { value: -1 }), runStage('warm', { value: -2 })]);
      const started = performance.now();
      const answers = await Promise.all([1, 2].map((value) => runStage<{ pid: number; value: number }>('sleep', { value })));
      const elapsed = performance.now() - started;
      expect(new Set(answers.map((answer) => answer.pid)).size).toBe(2);
      // One worker would take two sleeps (800 ms); two take one.
      expect(elapsed).toBeLessThan(750);
    } finally {
      dispose();
    }
    expect(installedStageLanes()).toBe(1);
  });

  it('keeps one process and one lane when the pool is 1 (a render worker)', async () => {
    const dispose = installProjectStages(sleepyProject(0), { poolSize: 1 });
    try {
      expect(installedStageLanes()).toBe(1);
      const answers = await Promise.all([1, 2].map((value) => runStage<{ pid: number }>('sleep', { value })));
      expect(new Set(answers.map((answer) => answer.pid)).size).toBe(1);
    } finally {
      dispose();
    }
  });
});
