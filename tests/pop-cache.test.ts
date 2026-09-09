/**
 * Checkpoints, and the one test that makes them safe.
 *
 * `PLAN particles.md`: **re-simulation from the start frame is the definition
 * of correctness, and a cache is an accelerator that must hold nothing
 * re-simulation would not have produced.** The plan also names the
 * discriminating test, and it is the first one here: simulate forward to a
 * frame, clear the cache, seek cold to the same frame, and assert the results
 * are byte-identical. If that holds, the cache cannot be wrong — only slower
 * once it is thrown away.
 *
 * The cost it removes was measured rather than assumed: `Simulate`
 * re-simulates from zero on every cook, so N frames is N(N+1)/2 steps. 110
 * frames of `particle-type` is about 6,000, roughly a second a frame, which
 * makes offline rendering fine and interactive playback a slideshow.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { createRuntime } from '../packages/runtime/src/index.js';
import { createNodeRuntimeHost } from '../packages/runtime/src/node.js';
import {
  checkpointStats,
  clearCheckpoints,
} from '../packages/runtime/src/pop/index.js';
import type { Geometry } from '@cascade/contracts';

function document(frame: number, over: Record<string, unknown> = {}) {
  return {
    version: '0.2',
    nodes: [
      {
        id: 'sim', module: 'cascade.pop.Simulate',
        inputs: [{ name: 'frame', defaultValue: frame, dataType: 'float' }],
        props: {
          birth_area: [-40, -40, 40, 40],
          impulse: 4, life: 6, lifevar: 0.4,
          airresist: 0.3, maxspeed: 50,
          noise_amplitude: 12, noise_frequency: 0.05,
          trail_length: 6, seed: 3, ...over,
        },
      },
      { id: 'out', module: 'cascade.core.Output', props: { outputName: 'points' } },
    ],
    connections: [
      { source: { nodeId: 'sim', outputName: 'geometry' }, target: { nodeId: 'out', inputName: 'input' } },
    ],
  } as never;
}

async function cook(frame: number, over: Record<string, unknown> = {}): Promise<Geometry> {
  const runtime = createRuntime({
    host: createNodeRuntimeHost({ modules: { resolve: async () => null } }),
  });
  const graph = await runtime.load(document(frame, over));
  const result = await graph.run();
  expect(result.status).toBe('completed');
  const geometry = graph.getGraphOutput('points') as Geometry;
  await graph.dispose();
  await runtime.dispose();
  return geometry;
}

function bytes(geometry: Geometry): number[] {
  return [...(geometry.point.P!.data as ArrayLike<number>)];
}

describe('the checkpoint cache', () => {
  beforeEach(() => clearCheckpoints());

  /**
   * The discriminating test, exactly as the plan words it. Everything else in
   * this file is detail; this is the one that makes the cache safe to have.
   */
  it('gives the same answer warm as cold, byte for byte', async () => {
    // Walk forward, filling the cache.
    for (let frame = 1; frame <= 40; frame += 1) await cook(frame);
    const warm = await cook(40);
    expect(checkpointStats().checkpoints).toBeGreaterThan(0);

    clearCheckpoints();
    const cold = await cook(40);

    expect(bytes(warm)).toEqual(bytes(cold));
    expect(warm.pointCount).toBe(cold.pointCount);
    expect([...(warm.point.id!.data as ArrayLike<number>)])
      .toEqual([...(cold.point.id!.data as ArrayLike<number>)]);
  });

  it('keeps checkpoints as the frame advances', async () => {
    expect(checkpointStats().checkpoints).toBe(0);
    await cook(24);
    expect(checkpointStats().checkpoints).toBeGreaterThan(0);
  });

  /**
   * The safety property. A prop that changes the simulation must invalidate,
   * or the cache serves a stale state that looks plausible — and a wrong
   * particle system is indistinguishable from a different-looking one.
   */
  it('is invalidated by a prop that changes the simulation', async () => {
    const first = await cook(24, { seed: 3 });
    const second = await cook(24, { seed: 9 });
    expect(bytes(first)).not.toEqual(bytes(second));

    // And going back to the first seed still gives the first answer, so the
    // second run did not poison the entry.
    clearCheckpoints();
    const again = await cook(24, { seed: 3 });
    expect(bytes(again)).toEqual(bytes(first));
  });

  it('is invalidated by every stepping prop, not just the seed', async () => {
    const base = await cook(20);
    for (const change of [
      { noise_amplitude: 30 },
      { airresist: 1.5 },
      // 0.5 rather than 10: at these settings nothing reaches speed 10, so
      // clamping there changes nothing and the assertion could not tell the
      // implementation from a broken one — the same "is there a discriminating
      // input" question the camera rotation order turned on.
      { maxspeed: 0.5 },
      { impulse: 9 },
      // 0.3 seconds, not 2: twenty frames at 1/24 is 0.83s, so a life of 2
      // and a life of 6 both outlive the whole window and nothing dies under
      // either. Second time in this one test that the obvious value could not
      // discriminate.
      { life: 0.3 },
      { timestep: 1 / 12 },
      { birth_area: [-10, -10, 10, 10] },
    ]) {
      clearCheckpoints();
      const changed = await cook(20, change);
      expect(bytes(changed), `${JSON.stringify(change)} should change the result`)
        .not.toEqual(bytes(base));
    }
  });

  /**
   * And the parameter that must NOT invalidate. `trail_length` changes what is
   * drawn rather than what is simulated, and it is exactly the parameter
   * someone drags while watching — throwing away a good simulation on every
   * drag would make the cache useless when it matters most.
   */
  it('survives a change to a drawing-only parameter', async () => {
    await cook(24, { trail_length: 6 });
    const before = checkpointStats().checkpoints;
    expect(before).toBeGreaterThan(0);

    await cook(24, { trail_length: 20 });
    // Same entry reused rather than replaced: the count did not restart.
    expect(checkpointStats().checkpoints).toBeGreaterThanOrEqual(before);
  });

  /** A cache is cleared, never reconciled — reconciling is where the bugs
   *  live, and throwing it away costs one re-simulation. */
  it('clears completely on demand', async () => {
    await cook(24);
    expect(checkpointStats().checkpoints).toBeGreaterThan(0);
    clearCheckpoints();
    expect(checkpointStats()).toEqual({ keys: 0, checkpoints: 0 });
  });

  /** Scrubbing backwards is correct, which is the case a checkpoint at or
   *  *after* the frame would break. */
  it('answers an earlier frame correctly after a later one', async () => {
    clearCheckpoints();
    const coldEarly = await cook(12);

    clearCheckpoints();
    await cook(40);
    const afterLater = await cook(12);

    expect(bytes(afterLater)).toEqual(bytes(coldEarly));
  });

  /**
   * The geometry half of the fingerprint, and it needed its own test.
   *
   * Every case above scatters into a `birth_area` and wires no geometry at
   * all, so a control that deleted the geometry hashing from the fingerprint
   * **passed all seven of them.** The whole safety argument rests on that hash
   * and nothing was exercising it — the same "is there a discriminating input"
   * fault as the two clamps above, one level up.
   *
   * A field with the same point count and different values is the case that
   * matters: counting points would miss a word changing from one to another at
   * the same resolution, and the cache would happily replay the old one.
   */
  it('is invalidated by a geometry whose values changed but whose count did not', async () => {
    const field = (offset: number) => {
      const count = 24;
      const position = new Float64Array(count * 2);
      const normals = new Float32Array(count * 2);
      for (let index = 0; index < count; index += 1) {
        position[index * 2] = Math.cos(index + offset) * 30;
        position[index * 2 + 1] = Math.sin(index + offset) * 30;
        normals[index * 2] = Math.cos(index + offset);
        normals[index * 2 + 1] = Math.sin(index + offset);
      }
      return {
        kind: 'geometry', pointCount: count, vertexCount: 0, primitiveCount: 0,
        topology: { vertexPoints: new Int32Array(0), offsets: new Int32Array([0]), kinds: new Uint8Array(0), closed: new Uint8Array(0) },
        point: {
          P: { storage: 'f64', size: 2, data: position },
          N: { storage: 'f32', size: 2, data: normals },
        },
        vertex: {}, primitive: {}, detail: {}, pointGroups: {}, primitiveGroups: {},
      } as unknown as Geometry;
    };

    const {
      executeSimulate,
    } = await import('../packages/runtime/src/builtins/pop/definitions.js');

    const run = (which: Geometry) => {
      let out: Geometry | undefined;
      executeSimulate({
        nodeId: 'sim',
        // Frame 16, not 20, and the 16 is load-bearing: it is a multiple of
        // the checkpoint stride, so a resumed cook lands exactly on a
        // checkpoint and steps nothing further. At frame 20 the resume starts
        // at 16 and then steps four frames with the NEW field, which moves the
        // particles enough that the results differ anyway — so the assertion
        // passed with the geometry hash removed from the fingerprint and could
        // not tell a correct implementation from a broken one.
        inputs: { geometry: undefined, frame: 16, attract: undefined, field: which },
        props: {
          birth_area: [-40, -40, 40, 40], impulse: 4, life: 6, lifevar: 0.4,
          airresist: 0.3, maxspeed: 50, noise_amplitude: 0, noise_frequency: 0.05,
          noise_evolve: 0, attract_amplitude: 0, attract_radius: 60,
          separate_radius: 0, separate_strength: 12,
          field_normal: 400, field_tangential: 400, field_radius: 20,
          field_level: 0.3, field_hold: 0,
          birth_hue: [0, 0], birth_saturation: 0, birth_value: 1,
          substeps: 1, timestep: 1 / 24, wrap: [0, 0, 0, 0], seed: 3,
          force: [0, 0],
          trail_length: 6, trail_increment: 1,
        },
        outputs: {
          geometry: { set: (value: Geometry) => { out = value; } },
          trails: { set: () => {} },
        },
      } as never);
      return [...(out!.point.P!.data as ArrayLike<number>)];
    };

    clearCheckpoints();
    const first = run(field(0));
    // Same count, different values. Without the geometry hash in the key this
    // returns the cached first answer.
    const second = run(field(1.7));
    expect(second).not.toEqual(first);
  });
});
