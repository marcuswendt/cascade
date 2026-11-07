/**
 * Runtime copies (performance round 2, move 4): a value a node hands over is
 * adopted, not cloned, and reading it back is a lookup. Counts, not wall-clock:
 * the runtime's own copy counter, and element reads through a proxy.
 */
import { describe, expect, it } from 'vitest';

import { createRuntime } from '../../packages/runtime/src/index.js';
import { runtimeValueCopies } from '../../packages/runtime/src/runtime.js';
import { createNodeRuntimeHost } from '../../packages/runtime/src/node.js';
import type { DefinitionNodeRegistration, RuntimeValuePolicy } from '../../packages/runtime/src/types.js';

type Context = { inputs: Record<string, unknown>; outputs: Record<string, { set(value: unknown): void }>; props: Record<string, unknown> };

function registrations(make: () => unknown[]): DefinitionNodeRegistration[] {
  const definition = (inputs: Record<string, unknown>, outputs: Record<string, unknown>) => ({
    apiVersion: 1,
    runsOn: 'portable',
    inputs,
    outputs,
    props: { t: { type: 'float', default: 0 } },
  });
  const any = { kind: 'data', type: 'any' };
  return [
    {
      kind: 'definition-v1',
      moduleId: 'copies.Source',
      definition: definition({}, { points: any, meta: { kind: 'data', type: 'bundle' } }),
      loadExecute: async () => (context: Context) => {
        context.outputs.points.set(make());
        context.outputs.meta.set({ count: 1, nested: { tags: ['a', 'b'] } });
      },
    },
    {
      kind: 'definition-v1',
      moduleId: 'copies.Pass',
      definition: definition({ points: any }, { points: any }),
      loadExecute: async () => (context: Context) => context.outputs.points.set(context.inputs.points),
    },
    {
      kind: 'definition-v1',
      moduleId: 'copies.Sink',
      definition: definition({ points: any }, { count: { kind: 'data', type: 'float' } }),
      loadExecute: async () => (context: Context) =>
        context.outputs.count.set((context.inputs.points as unknown[] | undefined)?.length ?? 0),
    },
  ] as unknown as DefinitionNodeRegistration[];
}

async function chain(length: number, make: () => unknown[], values?: RuntimeValuePolicy) {
  const runtime = createRuntime({
    host: createNodeRuntimeHost({ modules: { resolve: async () => null } }),
    nodes: registrations(make),
    ...(values ? { values } : {}),
  });
  const nodes = [
    { id: 'n0', module: 'copies.Source' },
    ...Array.from({ length: length - 2 }, (_, index) => ({ id: `n${index + 1}`, module: 'copies.Pass' })),
    { id: `n${length - 1}`, module: 'copies.Sink' },
  ];
  const connections = nodes.slice(1).map((node, index) => ({
    source: { nodeId: nodes[index]!.id, outputName: 'points' },
    target: { nodeId: node.id, inputName: 'points' },
  }));
  const graph = await runtime.load({ version: '0.2', nodes, connections });
  return { runtime, graph };
}

const points = (count: number) => () => Array.from({ length: count }, (_, index) => [index, index * 0.5]);

describe('runtime copies', () => {
  it('a 200-node frame copies no value: not on set, event, getOutputs, finish or inspect', async () => {
    const { runtime, graph } = await chain(200, points(100));
    const events: unknown[] = [];
    graph.subscribe((event) => {
      if (event.type === 'node:output' && event.outputName === 'points') events.push(event.value);
    });
    await graph.run({ frame: 1 });
    const before = runtimeValueCopies();
    for (let frame = 2; frame <= 4; frame++) {
      const result = await graph.run({ frame });
      expect(result.status).toBe('completed');
      graph.inspect();
      for (let index = 0; index < 200; index++) graph.getOutputs(`n${index}`);
    }
    expect(runtimeValueCopies() - before).toBe(0);
    // One value travels the chain: the event, every Pass and getOutput are the
    // producer's own array, deep-frozen where it stands.
    const value = graph.getOutput('n0', 'points') as number[][];
    expect(graph.getOutput('n198', 'points')).toBe(value);
    expect(events[events.length - 1]).toBe(value);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value[0])).toBe(true);
    expect(Object.isFrozen((graph.getOutput('n0', 'meta') as { nested: object }).nested)).toBe(true);
    expect(graph.getOutput('n199', 'count')).toBe(100);
    await runtime.dispose();
  });

  it('"freeze" still refuses a value a copy would have refused', async () => {
    const bad = await chain(3, () => [[1, Number.NaN]]);
    const result = await bad.graph.run();
    expect(result.status).toBe('failed');
    expect(result.diagnostics[0]?.message).toMatch(/finite/);
    await bad.runtime.dispose();
    const cyclic: unknown[] = [];
    cyclic.push([cyclic]);
    const loop = await chain(3, () => cyclic);
    expect((await loop.graph.run()).diagnostics[0]?.message).toMatch(/cycles/);
    await loop.runtime.dispose();
  });

  it('"trust": a 1M-point array crosses three nodes without the runtime reading one element', async () => {
    const size = 1_000_000;
    let reads = 0;
    const made: unknown[][] = [];
    const make = () => {
      const array: unknown[] = new Array(size);
      for (let index = 0; index < size - 1; index++) array[index] = [index, index * 0.5];
      // The last element counts its reads: a walk of the array would touch it.
      Object.defineProperty(array, size - 1, { enumerable: true, get: () => (reads++, [0, 0]) });
      made.push(array);
      return array;
    };
    const { runtime, graph } = await chain(3, make, 'trust');
    const before = runtimeValueCopies();
    for (let frame = 1; frame <= 3; frame++) {
      expect((await graph.run({ frame })).status).toBe('completed');
      graph.inspect();
    }
    expect(reads).toBe(0);
    expect(runtimeValueCopies() - before).toBe(0);
    expect(graph.getOutput('n2', 'count')).toBe(size);
    expect(graph.getOutput('n1', 'points')).toBe(made[made.length - 1]);
    // Shallow-frozen: a consumer cannot push into what it was handed.
    expect(Object.isFrozen(graph.getOutput('n1', 'points'))).toBe(true);
    await runtime.dispose();
  });
});
