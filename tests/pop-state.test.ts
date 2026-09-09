/**
 * Step 2 of `PLAN particles.md`: points born from a geometry, moving under a
 * force, dying of old age. **Re-simulation only — there is no cache yet**, and
 * that is the order the plan argues for: re-simulation from the start frame is
 * the *definition* of correctness, and a cache is an accelerator holding
 * nothing re-simulation would not have produced.
 *
 * The tests that matter here are the determinism ones. Everything downstream —
 * the checkpoint cache, `Trail`'s rolling window, scrubbing a timeline — is
 * only sound if stepping forward twice from the same state gives byte-identical
 * results, so that property is asserted directly rather than assumed from the
 * absence of a clock.
 */
import { describe, expect, it } from 'vitest';

import {
  ParticleState,
  drag,
  emptyParticleGeometry,
  gravity,
  kill,
  noiseField,
  separation,
  step,
  valueNoise,
} from '../packages/runtime/src/pop/index.js';

/** `n` particles in a row, each with the given life in seconds. */
function seeded(count: number, life = 0): ParticleState {
  const position = new Float64Array(count * 2);
  for (let index = 0; index < count; index += 1) position[index * 2] = index;
  return ParticleState.fromGeometry(emptyParticleGeometry(2)).born({
    position,
    life: new Float32Array(count).fill(life),
  });
}

describe('birth', () => {
  it('starts empty and reads back from a geometry', () => {
    const state = ParticleState.fromGeometry(emptyParticleGeometry(2));
    expect(state.count).toBe(0);
    expect(state.nextId).toBe(0);
  });

  it('hands each new particle a fresh id', () => {
    const state = seeded(3);
    expect([...state.id]).toEqual([0, 1, 2]);
    expect(state.nextId).toBe(3);
  });

  /** Monotonic and never reused: a trail keyed on an id that came back would
   *  join two unrelated particles into one stroke. */
  it('never reuses an id after a kill', () => {
    let state = seeded(3, 1);
    state = step(state, [], { timestep: 2 });
    expect(state.count).toBe(0);

    state = state.born({ position: new Float64Array(2), life: new Float32Array([5]) });
    expect([...state.id]).toEqual([3]);
  });

  it('does not mutate the state it was called on', () => {
    const before = seeded(2);
    const after = before.born({ position: new Float64Array(2), life: new Float32Array([1]) });
    expect(before.count).toBe(2);
    expect(after.count).toBe(3);
  });
});

describe('a force and a step', () => {
  it('accelerates, then integrates once', () => {
    let state = seeded(1);
    state = step(state, [gravity([0, -10])], { timestep: 0.5 });

    // Semi-implicit Euler: velocity first, then position from the NEW velocity.
    // v = -10 * 0.5 = -5; y = 0 + -5 * 0.5 = -2.5.
    expect(state.velocity[1]).toBeCloseTo(-5, 6);
    expect(state.position[1]).toBeCloseTo(-2.5, 6);
  });

  /** Two forces sum rather than compose, so the result cannot depend on wiring
   *  order. Asserted by adding them in both orders. */
  it('sums forces, in either order', () => {
    const forward = step(seeded(1), [gravity([0, -10]), gravity([2, 0])], { timestep: 0.5 });
    const backward = step(seeded(1), [gravity([2, 0]), gravity([0, -10])], { timestep: 0.5 });
    expect([...forward.velocity]).toEqual([...backward.velocity]);
    expect(forward.velocity[0]).toBeCloseTo(1, 6);
  });

  it('clamps speed when asked', () => {
    const state = step(seeded(1), [gravity([0, -1000])], { timestep: 1, maxSpeed: 7 });
    const speed = Math.hypot(state.velocity[0]!, state.velocity[1]!);
    expect(speed).toBeCloseTo(7, 5);
  });

  it('wraps positions into a box', () => {
    let state = seeded(1);
    state = step(state, [gravity([100, 0])], { timestep: 1, wrap: [0, 0, 10, 10] });
    expect(state.position[0]).toBeGreaterThanOrEqual(0);
    expect(state.position[0]).toBeLessThan(10);
  });

  it('opposes velocity with drag', () => {
    let state = step(seeded(1), [gravity([10, 0])], { timestep: 1 });
    const moving = state.velocity[0]!;
    state = step(state, [drag(0.5)], { timestep: 1 });
    expect(state.velocity[0]!).toBeLessThan(moving);
    expect(state.velocity[0]!).toBeGreaterThan(0);
  });

  /** A force returning the wrong number of values is a programming error that
   *  would otherwise read as particles drifting, so it is refused loudly. */
  it('refuses a force that returns the wrong length', () => {
    const wrong = { label: 'wrong', accelerate: () => new Float32Array(3) };
    expect(() => step(seeded(4), [wrong], { timestep: 1 }))
      .toThrow(/force wrong returned 3 values for 4 particles/);
  });
});

describe('ageing and death', () => {
  it('ages in seconds, not frames', () => {
    const state = step(seeded(1, 10), [], { timestep: 0.25 });
    expect(state.age[0]).toBeCloseTo(0.25, 6);
  });

  it('kills a particle when its age reaches its life', () => {
    let state = seeded(3, 1);
    state = step(state, [], { timestep: 0.5 });
    expect(state.count).toBe(3);
    state = step(state, [], { timestep: 0.6 });
    expect(state.count).toBe(0);
  });

  /** Houdini's rule: a life of zero or less is immortal. A source that does not
   *  set a life should not birth particles that die on their first step. */
  it('treats a life of zero as immortal', () => {
    let state = seeded(2, 0);
    for (let index = 0; index < 20; index += 1) state = step(state, [], { timestep: 1 });
    expect(state.count).toBe(2);
  });

  /**
   * The reason `id` is mandatory. A kill compacts the arrays, so index 1 after
   * a death is a different particle from index 1 before it — while the id is
   * the same particle throughout.
   */
  it('reorders on a kill, which is why id is the address', () => {
    const position = new Float64Array([0, 0, 1, 0, 2, 0]);
    let state = ParticleState.fromGeometry(emptyParticleGeometry(2)).born({
      position,
      life: new Float32Array([10, 0.5, 10]),
    });
    expect([...state.id]).toEqual([0, 1, 2]);

    state = step(state, [], { timestep: 1 });
    expect(state.count).toBe(2);
    // The survivors kept their ids; their indices changed.
    expect([...state.id]).toEqual([0, 2]);
    expect(state.position[2]).toBeCloseTo(2, 6);
  });

  it('leaves the state alone when nothing dies', () => {
    const before = seeded(3, 10);
    expect(kill(before)).toBe(before);
  });
});

describe('determinism, which everything downstream depends on', () => {
  /**
   * The discriminating test for the whole design. Nothing here reads a clock,
   * so two runs from the same state must be byte-identical — and that is what
   * makes a checkpoint cache sound, because the cache can then hold only what
   * re-simulation would have produced anyway.
   */
  it('steps identically twice, over a hundred frames, with every force on', () => {
    const forces = (frame: number) => [
      gravity([0, -2]),
      drag(0.1),
      noiseField({ seed: 7, frequency: 0.3, amplitude: 8, evolve: frame * 0.05 }),
      separation({ radius: 0.5, strength: 4 }),
    ];
    const run = () => {
      let state = seeded(40, 0);
      for (let frame = 0; frame < 100; frame += 1) {
        state = step(state, forces(frame), { timestep: 1 / 24, maxSpeed: 6, wrap: [0, 0, 40, 40] });
      }
      return state;
    };

    const first = run();
    const second = run();
    expect([...first.position]).toEqual([...second.position]);
    expect([...first.velocity]).toEqual([...second.velocity]);
    expect([...first.id]).toEqual([...second.id]);
    expect(first.nextId).toBe(second.nextId);
  });

  /** And the forces themselves are pure functions of position, so a field
   *  sampled twice at the same point gives the same answer. */
  it('samples the noise field as a pure function', () => {
    expect(valueNoise(7, 1.25, -3.5)).toBe(valueNoise(7, 1.25, -3.5));
    expect(valueNoise(7, 1.25, -3.5)).not.toBe(valueNoise(8, 1.25, -3.5));
  });

  it('keeps the noise field bounded and smooth', () => {
    let previous = valueNoise(3, 0, 0);
    for (let x = 0; x < 5; x += 0.05) {
      const value = valueNoise(3, x, 0.5);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      // Smooth: no step larger than the sample spacing allows.
      expect(Math.abs(value - previous)).toBeLessThan(0.25);
      previous = value;
    }
  });
});

describe('the geometry round trip', () => {
  it('writes a state out and reads it back unchanged', () => {
    const before = step(seeded(5, 3), [gravity([1, -2])], { timestep: 0.2 });
    const after = ParticleState.fromGeometry(before.toGeometry());

    expect(after.count).toBe(before.count);
    expect([...after.id]).toEqual([...before.id]);
    expect(after.nextId).toBe(before.nextId);
    for (let index = 0; index < before.position.length; index += 1) {
      expect(after.position[index]).toBeCloseTo(before.position[index]!, 10);
    }
  });

  /** Refused rather than repaired. A solver handed a geometry without `id`
   *  cannot invent one: inventing ids per frame would silently make every
   *  particle new every step, which is the fault the mandatory id prevents. */
  it('refuses a geometry that is not a particle geometry', () => {
    const plain = { ...emptyParticleGeometry(2) } as any;
    plain.point = { P: plain.point.P };
    expect(() => ParticleState.fromGeometry(plain))
      .toThrow(/not a particle geometry.*reorders on every kill/s);
  });
});
