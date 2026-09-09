/**
 * The step-2 milestone from `PLAN particles.md`, as a graph rather than as
 * arithmetic: **points born from a geometry, falling under gravity, dying of
 * old age, verifiable headlessly.**
 *
 * That wording is the plan's, and it is the acceptance test for the whole
 * risky step — everything after this is operators. Cooked through the neutral
 * runtime with no browser and no cache, which is also the proof that
 * `cascade run --frames` needs nothing added for a simulation.
 */
import { describe, expect, it } from 'vitest';

import { createRuntime } from '../packages/runtime/src/index.js';
import { createNodeRuntimeHost } from '../packages/runtime/src/node.js';
import { ParticleState } from '../packages/runtime/src/pop/index.js';
import type { Geometry } from '@cascade/contracts';

/** A rectangle's four corners, as the thing particles are born from. */
const document = {
  version: '0.2',
  nodes: [
    // `size` is an INPUT on Rectangle, not a prop. Writing it under `props`
    // cooked fine and reverted to the default, and `preflight` said so:
    // "stores size under props, and its definition declares no such prop —
    // that value was dropped on load". Which is the whole reason that warning
    // exists, demonstrated on its author.
    {
      id: 'shape', module: 'cascade.geo.Rectangle',
      inputs: [{ name: 'size', defaultValue: [10, 10], dataType: 'vec2' }],
    },
    { id: 'source', module: 'cascade.pop.Source', props: { impulse: 4, life: 1, lifevar: 0 } },
    { id: 'solve', module: 'cascade.pop.Solver', props: { timestep: 0.25, force: [0, -10] } },
    { id: 'out', module: 'cascade.core.Output', props: { outputName: 'particles' } },
  ],
  connections: [
    { source: { nodeId: 'shape', outputName: 'geometry' }, target: { nodeId: 'source', inputName: 'geometry' } },
    { source: { nodeId: 'source', outputName: 'geometry' }, target: { nodeId: 'solve', inputName: 'particles' } },
    { source: { nodeId: 'solve', outputName: 'geometry' }, target: { nodeId: 'out', inputName: 'input' } },
  ],
} as never;

async function load() {
  const runtime = createRuntime({
    host: createNodeRuntimeHost({ modules: { resolve: async () => null } }),
  });
  const graph = await runtime.load(document);
  return {
    graph,
    async cook(): Promise<Geometry> {
      const result = await graph.run();
      expect(result.status).toBe('completed');
      return graph.getGraphOutput('particles') as Geometry;
    },
    done: async () => { await graph.dispose(); await runtime.dispose(); },
  };
}

describe('a particle graph, cooked headlessly', () => {
  it('passes its static check with no missing capability', async () => {
    const { graph, done } = await load();
    // A POP node is `portable`, so nothing here needs a browser — which is the
    // whole reason the arithmetic went in the runtime rather than in Studio.
    expect(graph.preflight()).toEqual([]);
    await done();
  });

  it('births particles from the source geometry and moves them under gravity', async () => {
    const { cook, done } = await load();
    const geometry = await cook();
    const state = ParticleState.fromGeometry(geometry);

    expect(state.count).toBe(4);
    // One step of 0.25s under -10: v = -2.5, y moves by -0.625 from its birth.
    for (let index = 0; index < state.count; index += 1) {
      expect(state.velocity[index * 2 + 1]).toBeCloseTo(-2.5, 5);
    }
    expect([...state.id]).toEqual([0, 1, 2, 3]);
    await done();
  });

  it('gives every particle an id and a life from the source', async () => {
    const { cook, done } = await load();
    const state = ParticleState.fromGeometry(await cook());
    expect([...state.life]).toEqual([1, 1, 1, 1]);
    expect(state.nextId).toBe(4);
    await done();
  });

  /**
   * The output is ordinary geometry, which is the point of the whole design:
   * there is no particle type, so `CopyToPoints`, `Trail` and `SvgExport` need
   * nothing new to consume a simulation.
   */
  it('outputs geometry that any geometry node would accept', async () => {
    const { cook, done } = await load();
    const geometry = await cook();
    expect(geometry.kind).toBe('geometry');
    expect(geometry.pointCount).toBe(4);
    expect(geometry.point.P).toBeDefined();
    // And the particle attributes ride along on the same points.
    expect(geometry.point.v).toBeDefined();
    expect(geometry.point.age).toBeDefined();
    expect(geometry.detail.nextid).toBe(4);
    await done();
  });

  /**
   * Stepping repeatedly by hand rather than through the graph, because the
   * graph has no feedback yet — the solver reads its input, not its own
   * previous output. That is step 4's job, and this asserts the arithmetic the
   * feedback will drive: particles die of old age, and the survivors keep
   * their ids.
   */
  it('kills particles of old age when stepped forward', async () => {
    const { cook, done } = await load();
    let state = ParticleState.fromGeometry(await cook());
    expect(state.count).toBe(4);

    const { step } = await import('../packages/runtime/src/pop/index.js');
    const { gravity } = await import('../packages/runtime/src/pop/index.js');
    for (let frame = 0; frame < 5; frame += 1) {
      state = step(state, [gravity([0, -10])], { timestep: 0.25 });
    }
    // Life is 1s, birth step took 0.25s, five more steps is 1.5s total.
    expect(state.count).toBe(0);
    await done();
  });
});
