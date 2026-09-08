/**
 * Step 1 of `PLAN series.md`: cooking one graph once per parameter set.
 *
 * Headless on purpose — it is the foundation the gallery and the scheduler
 * stand on, and it is verifiable without looking at a picture.
 *
 * **The fault these tests exist for is that a parameter set is sparse.**
 * `applyPreset` mutates the graph, so an instance that overrides `seed` while
 * the next one does not leaves its seed behind for the next one to inherit.
 * That is accidental feedback, in the one mechanism the plan specifies as
 * having none, and it is close to the worst failure this system could have:
 * the pictures come out order-dependent, so re-running gives a different
 * answer and it reads as a flaky renderer rather than as a bug. Every instance
 * is therefore cooked from a baseline captured before the first `applyPreset`.
 */
import { describe, expect, it } from 'vitest';

import { createRuntime } from '../packages/runtime/src/index.js';
import { createNodeRuntimeHost } from '../packages/runtime/src/node.js';
import { runSeries, seriesBaseline, validateSeries } from '../packages/runtime/src/series/index.js';
import type { CascadeSeries } from '@cascade/contracts';

/** `result = offset + gain`, both props, so an instance's parameter set is the
 *  only thing that can move the number and the output reports both stores. */
const registration = {
  kind: 'definition-v1',
  moduleId: 'cascade.test.Sum',
  definition: {
    apiVersion: 1,
    label: 'Sum',
    runsOn: 'portable',
    inputs: {},
    outputs: { result: { kind: 'data', type: 'float' } },
    props: {
      offset: { type: 'float', default: 1 },
      gain: { type: 'float', default: 10 },
    },
  },
  loadExecute: async () => (context: any) => {
    context.outputs.result.set(context.props.offset + context.props.gain);
  },
} as never;

async function load() {
  const runtime = createRuntime({
    host: createNodeRuntimeHost({ modules: { resolve: async () => null } }),
    nodes: [registration],
  });
  const graph = await runtime.load({
    version: '0.2',
    nodes: [{ id: 'sum', module: 'cascade.test.Sum', props: {} }],
    connections: [],
  } as never);
  return { graph, done: async () => { await graph.dispose(); await runtime.dispose(); } };
}

function series(
  instances: Array<[string, Record<string, unknown>]>,
): CascadeSeries {
  return {
    version: 1,
    instances: instances.map(([id, props]) => ({
      id,
      parameters: { version: 1, nodes: { sum: { props } } } as never,
    })),
    collect: { nodeId: 'sum', output: 'result' },
  };
}

describe('cooking a series', () => {
  it('produces one result per instance, addressed by record id', async () => {
    const { graph, done } = await load();
    const result = await runSeries(graph, series([
      ['a', { offset: 2 }],
      ['b', { offset: 3 }],
      ['c', { offset: 4 }],
    ]));

    expect(result.status).toBe('completed');
    expect(result.instances.map(instance => instance.id)).toEqual(['a', 'b', 'c']);
    expect(result.byId.get('a')!.value).toBe(12);
    expect(result.byId.get('b')!.value).toBe(13);
    expect(result.byId.get('c')!.value).toBe(14);
    await done();
  });

  /**
   * The one that matters. Instance `b` overrides nothing, so under a naive
   * implementation it inherits `a`'s offset of 50 and reports 60 instead of
   * the graph's own 11 — and `c` then inherits from `b`. Note that this cannot
   * be caught by a series where every instance sets every key, which is what a
   * test would naturally be written with.
   */
  it('cooks every instance from the graph, not from the previous instance', async () => {
    const { graph, done } = await load();
    const result = await runSeries(graph, series([
      ['a', { offset: 50 }],
      ['b', {}],
      ['c', { gain: 100 }],
    ]));

    expect(result.byId.get('a')!.value).toBe(60);
    // Nothing overridden: the graph's own 1 + 10.
    expect(result.byId.get('b')!.value).toBe(11);
    // `gain` overridden, `offset` back to the graph's 1 rather than a's 50.
    expect(result.byId.get('c')!.value).toBe(101);
    await done();
  });

  it('leaves the graph on the values it was found with', async () => {
    const { graph, done } = await load();
    await runSeries(graph, series([['a', { offset: 50, gain: 70 }]]));

    await graph.run();
    expect(graph.getOutput('sum', 'result')).toBe(11);
    await done();
  });

  /** *"Making changes to the underlying network re-renders the current selected
   *  item first."* The work reorders; the results do not. */
  it('cooks the selected instance first and still reports in series order', async () => {
    const { graph, done } = await load();
    const order: string[] = [];
    const result = await runSeries(
      graph,
      series([['a', { offset: 2 }], ['b', { offset: 3 }], ['c', { offset: 4 }]]),
      { first: 'c', onInstance: instance => order.push(instance.id) },
    );

    expect(order).toEqual(['c', 'a', 'b']);
    expect(result.instances.map(instance => instance.id)).toEqual(['a', 'b', 'c']);
    expect(result.instances.map(instance => instance.index)).toEqual([0, 1, 2]);
    await done();
  });

  it('ignores a selected id that is not in the series', async () => {
    const { graph, done } = await load();
    const order: string[] = [];
    await runSeries(graph, series([['a', {}], ['b', {}]]), {
      first: 'missing',
      onInstance: instance => order.push(instance.id),
    });
    expect(order).toEqual(['a', 'b']);
    await done();
  });

  /** A gallery fills in as results arrive; waiting for the last of ten thousand
   *  is the thing the whole scheduling policy exists to avoid. */
  it('reports each instance as it finishes rather than at the end', async () => {
    const { graph, done } = await load();
    const seen: number[] = [];
    await runSeries(graph, series([['a', { offset: 2 }], ['b', { offset: 3 }]]), {
      onInstance: instance => seen.push(instance.value as number),
    });
    expect(seen).toEqual([12, 13]);
    await done();
  });
});

describe('the baseline', () => {
  /** Only the keys some instance touches, so a large graph does not pay for a
   *  series that varies two numbers. */
  it('captures exactly the keys the series overrides', async () => {
    const { graph, done } = await load();
    const baseline = seriesBaseline(graph, series([['a', { offset: 5 }]]));

    expect(baseline).toEqual({ version: 1, nodes: { sum: { props: { offset: 1 } } } });
    // `gain` is untouched by this series, so it is not in the baseline at all.
    expect((baseline.nodes.sum as any).props.gain).toBeUndefined();
    await done();
  });
});

describe('series identity', () => {
  /**
   * Ids must be unique or an instance has no address, and every judgement,
   * override and cache key in the plan hangs off that address. Rejected up
   * front rather than by last-write-wins, which would silently drop a picture.
   */
  it('rejects a duplicate instance id', () => {
    expect(() => validateSeries(series([['a', {}], ['a', {}]])))
      .toThrow(/Duplicate series instance id a/);
  });

  it('rejects an empty id', () => {
    expect(() => validateSeries(series([['', {}]]))).toThrow(/needs an id/);
  });

  it('rejects a version it does not understand', () => {
    expect(() => validateSeries({ ...series([['a', {}]]), version: 2 as never }))
      .toThrow(/version must be 1/);
  });
});
