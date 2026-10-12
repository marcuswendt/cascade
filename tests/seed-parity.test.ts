/**
 * Seeds and parity (doc/PRODUCTION_READINESS.md, item 5): a per-node seed
 * derived from the graph seed and the node id, the same in the headless
 * runtime and in Studio's executor, and `cascade parity`, which cooks both
 * and reports what differs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Graph } from '@/nodes/Graph';
import { compareSnapshots, formatParityReport, parity, parseParityArgs, type Snapshot } from '@/cli/parity';
import { graphSeed, nodeSeed, seededRandom } from '../packages/runtime/src/seed.js';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** A node that draws `count` numbers and reports their sum and its seed. */
const scatter = (draw: string) => `
export const definition = {
  apiVersion: 1,
  runsOn: 'portable',
  props: { count: { type: 'int', default: 16 } },
  outputs: {
    sum: { kind: 'data', type: 'float' },
    seed: { kind: 'data', type: 'int' },
  },
} as const;
export function execute(context) {
  let sum = 0;
  for (let index = 0; index < context.props.count; index++) sum += ${draw};
  context.outputs.sum.set(sum);
  context.outputs.seed.set(context.seed);
}
`;

function project(draw: string, seed?: number) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-parity-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'nodes', 'Scatter'), { recursive: true });
  fs.writeFileSync(path.join(root, 'nodes', 'Scatter', 'index.ts'), scatter(draw));
  const document = {
    version: '0.2',
    ...(seed === undefined ? {} : { seed }),
    nodes: [
      { id: 'left', module: 'project.Scatter', source: 'project', position: [0, 0] },
      { id: 'right', module: 'project.Scatter', source: 'project', position: [0, 200] },
    ],
    connections: [],
  };
  const file = path.join(root, 'index.cascade');
  fs.writeFileSync(file, JSON.stringify(document));
  return { root, file, document };
}

describe('node seeds', () => {
  it('derive from the graph seed and the node id, and nothing else', () => {
    expect(nodeSeed(0, 'ink')).toBe(nodeSeed(0, 'ink'));
    expect(nodeSeed(0, 'ink')).not.toBe(nodeSeed(0, 'ink2'));
    expect(nodeSeed(0, 'ink')).not.toBe(nodeSeed(1, 'ink'));
    expect(graphSeed({ seed: 42 })).toBe(42);
    expect(graphSeed({})).toBe(0);
    expect(graphSeed({ seed: 1.5 })).toBe(0);
  });

  it('give a repeatable stream', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const draws = Array.from({ length: 5 }, () => a());
    expect(draws).toEqual(Array.from({ length: 5 }, () => b()));
    expect(draws.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('survive a Studio load and save', () => {
    const graph = Graph.fromJSON({ version: '0.2', seed: 9, nodes: [], connections: [] });
    expect(graph.seed).toBe(9);
    expect(graph.toJSON().seed).toBe(9);
  });
});

describe('cascade parity', () => {
  it('finds a seeded graph identical headless twice and in Studio', async () => {
    const fixture = project('context.random()', 3);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const report = await parity({ file: fixture.file, tolerance: 0, json: false, studio: true });
    expect(report.failures).toEqual({});
    expect(report.ok).toBe(true);
    const seeds = report.ports.filter((port) => port.port === 'seed');
    expect(seeds.map((port) => [port.node, port.repeat.verdict, port.studio?.verdict])).toEqual([
      ['left', 'same', 'same'],
      ['right', 'same', 'same'],
    ]);
    expect(formatParityReport(report)).toContain('all outputs agree');
  });

  it('gives each node its own stream under the same graph seed', async () => {
    const fixture = project('context.random()', 3);
    const { cookProjectGraph } = await import('@/cli/projectRuntime');
    const { outputs } = await cookProjectGraph(fixture.file, fixture.document);
    expect(outputs.get('left')?.get('seed')).toBe(nodeSeed(3, 'left'));
    expect(outputs.get('left')?.get('sum')).not.toBe(outputs.get('right')?.get('sum'));
  });

  it('reports Math.random as not repeatable, per node and port', async () => {
    const fixture = project('Math.random()');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const report = await parity({ file: fixture.file, node: 'left', tolerance: 0, json: false, studio: false });
    expect(report.ok).toBe(false);
    const sum = report.ports.find((port) => port.node === 'left' && port.port === 'sum');
    expect(sum?.repeat.verdict).toBe('different');
    expect(sum?.repeat.detail).toMatch(/ vs /);
  });

  it('counts differing pixels and honours a tolerance', () => {
    const image = (values: number[]): Snapshot => ({
      kind: 'image', digest: values.join(','), width: values.length / 4, height: 1, pixels: Uint8Array.from(values),
    });
    const a = image([0, 0, 0, 255, 10, 10, 10, 255]);
    const b = image([0, 0, 0, 255, 12, 10, 10, 255]);
    expect(compareSnapshots(a, b, 0)).toMatchObject({ verdict: 'different', differingPixels: 1, maxDelta: 2 });
    expect(compareSnapshots(a, b, 2).verdict).toBe('within tolerance');
    expect(compareSnapshots(a, a, 0).verdict).toBe('same');
  });

  it('reads its arguments', () => {
    expect(parseParityArgs(['g.cascade', '--node', 'ink', '--seed', '4', '--tolerance', '1', '--json'])).toEqual({
      file: 'g.cascade', node: 'ink', seed: 4, tolerance: 1, json: true, studio: true,
    });
    expect(() => parseParityArgs(['g.cascade', '--seed', '-1'])).toThrow(/--seed/);
  });
});
