import assert from "node:assert/strict";
import test from "node:test";

import {
  ParticleState,
  accumulateForce,
  clearForce,
  forceAttribute,
} from "../dist/pop/index.js";
import {
  executeNoiseForce,
  executeSeparate,
  executeSolver,
} from "../dist/builtins/pop/definitions.js";
import { noiseForceRegistration, separateRegistration, solverRegistration } from "../dist/builtins/pop/definitions.js";
import { GeometryBuilder } from "../dist/index.js";

/**
 * The POP force model: force nodes accumulate, the solver integrates once.
 *
 * Changed 2026-09-09 while rebuilding `pop.Simulate` as a network Marcus can
 * dive into, and it is a **correctness fix rather than a refinement**. The
 * force nodes as first written each called `step()`, which integrates. Chain
 * two of them and time advances twice per step: the particles travel further
 * than the timestep says, reordering nodes that ought to commute changes the
 * result, and nothing reports an error.
 *
 * Nothing tested those nodes at all, which is why the fault survived — so the
 * discriminating case is the first test here: **one force node and two must
 * advance time by the same amount.**
 */

const signal = { aborted: false, addEventListener() {}, removeEventListener() {} };
const progress = { report() {} };

function propDefaults(definition) {
  const values = {};
  for (const [name, prop] of Object.entries(definition.props ?? {}))
    values[name] = prop.default;
  return values;
}

function run(registration, execute, geometry, props = {}) {
  let result;
  execute({
    nodeId: "test",
    inputs: { particles: geometry },
    outputs: { geometry: { set: (value) => (result = value) } },
    props: { ...propDefaults(registration.definition), ...props },
    capabilities: {},
    signal,
    progress,
  });
  return result;
}

/** Two particles, at rest, with the mandatory particle attributes. */
function particles() {
  const builder = new GeometryBuilder({ positionSize: 2 });
  builder.addPoint(0, 0);
  builder.addPoint(1, 0);
  builder.setNumericAttribute("point", "v", new Float32Array([0, 0, 0, 0]), 2, "f32");
  builder.setNumericAttribute("point", "age", new Float32Array([0, 0]), 1, "f32");
  builder.setNumericAttribute("point", "life", new Float32Array([100, 100]), 1, "f32");
  builder.setNumericAttribute("point", "id", new Int32Array([0, 1]), 1, "i32");
  builder.setDetail("nextid", 2);
  return builder.build();
}

function positions(geometry) {
  return Array.from(geometry.point.P.data);
}

test("a force node accumulates and moves nothing", () => {
  const before = particles();
  const after = run(noiseForceRegistration, executeNoiseForce, before, { amplitude: 50 });
  // The whole point: positions are untouched, and a force attribute appears.
  assert.deepEqual(positions(after), positions(before));
  assert.ok(after.point.force, "the force attribute should exist");
  assert.equal(after.point.force.size, 2);
});

test("two force nodes advance time exactly as much as one — no double integration", () => {
  // The discriminating case, and the fault that survived because nothing
  // tested these nodes. Both chains apply the SAME single force (the second
  // node contributes zero), so any difference in the result is time being
  // integrated twice rather than a difference in the physics.
  const one = run(
    solverRegistration,
    executeSolver,
    run(noiseForceRegistration, executeNoiseForce, particles(), { amplitude: 50 }),
  );
  const two = run(
    solverRegistration,
    executeSolver,
    run(separateRegistration, executeSeparate, run(noiseForceRegistration, executeNoiseForce, particles(), { amplitude: 50 }), {
      // A radius of zero contributes nothing, so the physics is identical.
      radius: 0,
      strength: 0,
    }),
  );
  assert.deepEqual(positions(two), positions(one));
});

test("reordering two force nodes gives the same result", () => {
  // Forces add, so they commute. Under the old model they did not, because
  // each one integrated and the second saw positions the first had moved.
  const noiseThenSeparate = run(
    solverRegistration,
    executeSolver,
    run(separateRegistration, executeSeparate, run(noiseForceRegistration, executeNoiseForce, particles(), { amplitude: 30 }), { radius: 2, strength: 10 }),
  );
  const separateThenNoise = run(
    solverRegistration,
    executeSolver,
    run(noiseForceRegistration, executeNoiseForce, run(separateRegistration, executeSeparate, particles(), { radius: 2, strength: 10 }), { amplitude: 30 }),
  );
  for (const [index, value] of positions(noiseThenSeparate).entries())
    assert.ok(
      Math.abs(value - positions(separateThenNoise)[index]) < 1e-9,
      `component ${index} differs: ${value} vs ${positions(separateThenNoise)[index]}`,
    );
});

test("two force nodes move the particles further than one does", () => {
  // The counterweight to the test above: proving the two chains agree is only
  // meaningful if a real second force actually changes something. Otherwise
  // "no double integration" would also pass for a solver that ignored forces.
  const single = run(
    solverRegistration,
    executeSolver,
    run(noiseForceRegistration, executeNoiseForce, particles(), { amplitude: 30 }),
  );
  const doubled = run(
    solverRegistration,
    executeSolver,
    run(noiseForceRegistration, executeNoiseForce, run(noiseForceRegistration, executeNoiseForce, particles(), { amplitude: 30 }), { amplitude: 30 }),
  );
  assert.notDeepEqual(positions(doubled), positions(single));
});

test("the solver emits no force attribute", () => {
  // A leak would make a simulation accelerate for reasons nothing in the graph
  // explains: every step inheriting the last step's forces on top of its own.
  //
  // Worth being honest about what this test does and does not prove. It passes
  // with `clearForce` stubbed out to the identity, because `ParticleState`
  // rebuilds the geometry from the contract attributes and `force` is not one
  // of them — so today the drop is incidental. The explicit clear stays as the
  // guarantee rather than the mechanism: `toGeometry` already carries `Cd`
  // through, so "it only writes the mandatory attributes" is not a rule this
  // can lean on. The next test is the one that actually tests clearing.
  const stepped = run(
    solverRegistration,
    executeSolver,
    run(noiseForceRegistration, executeNoiseForce, particles(), { amplitude: 50 }),
  );
  assert.equal(stepped.point.force, undefined);
});

test("clearForce removes an accumulated force", () => {
  const carrying = accumulateForce(particles(), new Float32Array([5, 5, 5, 5]), 2);
  assert.ok(carrying.point.force);
  assert.equal(clearForce(carrying).point.force, undefined);
  // And leaves everything else alone: dropping `v` or `id` here would break the
  // contract the whole simulation rests on.
  assert.ok(clearForce(carrying).point.v);
  assert.ok(clearForce(carrying).point.id);
});

test("a solver with no force upstream holds the particles still", () => {
  const before = particles();
  const after = run(solverRegistration, executeSolver, before);
  assert.deepEqual(positions(after), positions(before));
});

test("accumulateForce adds rather than replaces", () => {
  const base = particles();
  const once = accumulateForce(base, new Float32Array([1, 0, 1, 0]), 2);
  const twice = accumulateForce(once, new Float32Array([2, 0, 2, 0]), 2);
  assert.deepEqual(Array.from(twice.point.force.data), [3, 0, 3, 0]);
});

test("accumulateForce refuses a contribution of the wrong length", () => {
  // Silently padding or truncating would scramble the stride and misattribute
  // one particle's force to another.
  assert.throws(
    () => accumulateForce(particles(), new Float32Array([1, 0]), 2),
    /2 values for 2 particles of size 2/,
  );
});

test("forceAttribute reads zero when nothing accumulated", () => {
  const state = ParticleState.fromGeometry(particles());
  const force = forceAttribute(particles()).accelerate(state, state.size);
  assert.deepEqual(Array.from(force), [0, 0, 0, 0]);
});

test("forceAttribute takes the shared components of a 3D force on a 2D system", () => {
  // Rather than throwing or reading across the stride, which would put one
  // particle's z into the next particle's x.
  const geometry = particles();
  const withForce = {
    ...geometry,
    point: {
      ...geometry.point,
      force: { storage: "f32", size: 3, data: new Float32Array([1, 2, 9, 3, 4, 9]) },
    },
  };
  const state = ParticleState.fromGeometry(geometry);
  assert.deepEqual(
    Array.from(forceAttribute(withForce).accelerate(state, 2)),
    [1, 2, 3, 4],
  );
});

test("clearForce is a no-op on a geometry that has none", () => {
  const base = particles();
  assert.equal(clearForce(base), base);
});
