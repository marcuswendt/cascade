import type { NodeDefinition, NodeExecutionContext } from "@cascade/contracts";

import {
  ParticleState,
  drag,
  emptyParticleGeometry,
  gravity,
  noiseField,
  separation,
  step,
  type ParticleForce,
} from "../../pop/index.js";
import type { DefinitionNodeRegistration } from "../../types.js";

/**
 * `cascade.pop.*` - the minimum useful particle set.
 *
 * Step 2 of `PLAN particles.md`, and the step that carries the risk: a source,
 * a solver, and forces, on **re-simulation only**. There is no cache. The plan
 * argues for that order - re-simulation from the start frame is the definition
 * of correctness, and a cache is an accelerator holding nothing re-simulation
 * would not have produced, so it is built second and can be cleared at any
 * time without changing a result.
 *
 * The arithmetic lives in `packages/runtime/src/pop`, deliberately: these
 * nodes are thin, the risk is in the stepping, and the stepping is testable
 * without a graph.
 */

const sourceDefinition = {
  apiVersion: 1,
  label: "POP Source",
  description: "Birth particles from a geometry's points.",
  icon: "Sparkles",
  runsOn: "portable",
  inputs: {
    geometry: { kind: "data", type: "geometry" },
    particles: { kind: "data", type: "geometry" },
  },
  outputs: { geometry: { kind: "data", type: "geometry" } },
  props: {
    impulse: { type: "int", default: 8, min: 0, max: 100000 },
    life: { type: "float", default: 3, min: 0, max: 3600, step: 0.1 },
    lifevar: { type: "float", default: 0.3, min: 0, max: 1, step: 0.01 },
    velocity: { type: "vec2", default: [0, 0] },
    seed: { type: "int", default: 7, min: 0, max: 999999 },
  },
} as const satisfies NodeDefinition;

/** A hash rather than a stream, so a birth is a pure function of `(seed, id)`
 *  and re-simulating reproduces the same particles. */
function birthRandom(seed: number, sample: number): number {
  const n = Math.sin(seed * 12.9898 + sample * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

export function executeSource(
  context: NodeExecutionContext<typeof sourceDefinition>,
): void {
  const props = context.props;
  const incoming = context.inputs.particles;
  const state = incoming
    ? ParticleState.fromGeometry(incoming)
    : ParticleState.fromGeometry(emptyParticleGeometry(2));

  const from = context.inputs.geometry;
  const available = from ? from.pointCount : 0;
  const born = available === 0 ? 0 : Math.min(props.impulse, available);
  if (born === 0) {
    context.outputs.geometry.set(state.toGeometry());
    return;
  }

  const size = state.size;
  const position = new Float64Array(born * size);
  const velocity = new Float32Array(born * size);
  const life = new Float32Array(born);
  const source = from!.point.P!;

  for (let index = 0; index < born; index += 1) {
    // Spread across the source's points rather than taking the first N, so a
    // small impulse from a large source still samples the whole shape.
    const pick = available === born ? index : Math.floor((index / born) * available);
    for (let component = 0; component < size; component += 1) {
      position[index * size + component] =
        Number((source.data as ArrayLike<number>)[pick * source.size + component] ?? 0);
      velocity[index * size + component] = props.velocity[component] ?? 0;
    }
    // Keyed on the id this particle is about to get, so the same particle gets
    // the same life however many times the frame is re-simulated.
    const jitter = birthRandom(props.seed, state.nextId + index);
    life[index] = props.life * (1 - props.lifevar * jitter);
  }

  context.outputs.geometry.set(state.born({ position, velocity, life }).toGeometry());
}

const solverDefinition = {
  apiVersion: 1,
  label: "POP Solver",
  description: "Advance a particle system by one timestep.",
  icon: "Play",
  runsOn: "portable",
  inputs: { particles: { kind: "data", type: "geometry" } },
  outputs: { geometry: { kind: "data", type: "geometry" } },
  props: {
    /**
     * Where the timestep comes from. Marcus's ruling, 2026-09-09: *"Let the
     * user choose nodes fixed or variable."*
     *
     * `fixed` is the default on the ordinary grounds that the safer of two
     * behaviours is the one you get without asking - a simulation whose result
     * depends on a playback setting is not reproducible from the document
     * alone. With `fps` the render rate becomes part of what determines the
     * output, which is correct for a mode called variable and must not be
     * silent: it belongs in the cache key, and `cascade check` should say so.
     */
    timestep_mode: {
      type: "string",
      default: "fixed",
      control: "select",
      options: [
        { value: "fixed", label: "Fixed - reproducible from the document" },
        { value: "fps", label: "Variable - derived from the render rate" },
      ],
    },
    timestep: { type: "float", default: 1 / 24, min: 1 / 240, max: 1, step: 1 / 240 },
    maxspeed: { type: "float", default: 0, min: 0, max: 10000, step: 0.5 },
    force: { type: "vec2", default: [0, 0] },
    airresist: { type: "float", default: 0, min: 0, max: 20, step: 0.05 },
  },
} as const satisfies NodeDefinition;

export function executeSolver(
  context: NodeExecutionContext<typeof solverDefinition>,
): void {
  const props = context.props;
  const incoming = context.inputs.particles;
  if (!incoming) {
    context.outputs.geometry.set(emptyParticleGeometry(2));
    return;
  }

  const state = ParticleState.fromGeometry(incoming);
  const forces: ParticleForce[] = [];
  if (props.force[0] !== 0 || props.force[1] !== 0) forces.push(gravity(props.force));
  if (props.airresist > 0) forces.push(drag(props.airresist));

  context.outputs.geometry.set(
    step(state, forces, {
      timestep: props.timestep,
      ...(props.maxspeed > 0 ? { maxSpeed: props.maxspeed } : {}),
    }).toGeometry(),
  );
}

const noiseForceDefinition = {
  apiVersion: 1,
  label: "POP Noise Force",
  description: "Push particles along a heading read from a noise field.",
  icon: "Wind",
  runsOn: "portable",
  inputs: { particles: { kind: "data", type: "geometry" } },
  outputs: { geometry: { kind: "data", type: "geometry" } },
  props: {
    amplitude: { type: "float", default: 6, min: 0, max: 500, step: 0.5 },
    frequency: { type: "float", default: 0.3, min: 0.001, max: 10, step: 0.01 },
    evolve: { type: "float", default: 0, min: -1000, max: 1000, step: 0.01 },
    timestep: { type: "float", default: 1 / 24, min: 1 / 240, max: 1, step: 1 / 240 },
    seed: { type: "int", default: 7, min: 0, max: 999999 },
  },
} as const satisfies NodeDefinition;

export function executeNoiseForce(
  context: NodeExecutionContext<typeof noiseForceDefinition>,
): void {
  const incoming = context.inputs.particles;
  if (!incoming) {
    context.outputs.geometry.set(emptyParticleGeometry(2));
    return;
  }
  const props = context.props;
  context.outputs.geometry.set(
    step(
      ParticleState.fromGeometry(incoming),
      [noiseField({
        seed: props.seed,
        frequency: props.frequency,
        amplitude: props.amplitude,
        evolve: props.evolve,
      })],
      { timestep: props.timestep },
    ).toGeometry(),
  );
}

const separateDefinition = {
  apiVersion: 1,
  label: "POP Separate",
  description: "Push neighbours apart within a radius.",
  icon: "Move3d",
  runsOn: "portable",
  inputs: { particles: { kind: "data", type: "geometry" } },
  outputs: { geometry: { kind: "data", type: "geometry" } },
  props: {
    radius: { type: "float", default: 0.5, min: 0, max: 100, step: 0.01 },
    strength: { type: "float", default: 4, min: 0, max: 500, step: 0.1 },
    timestep: { type: "float", default: 1 / 24, min: 1 / 240, max: 1, step: 1 / 240 },
  },
} as const satisfies NodeDefinition;

export function executeSeparate(
  context: NodeExecutionContext<typeof separateDefinition>,
): void {
  const incoming = context.inputs.particles;
  if (!incoming) {
    context.outputs.geometry.set(emptyParticleGeometry(2));
    return;
  }
  const props = context.props;
  context.outputs.geometry.set(
    step(
      ParticleState.fromGeometry(incoming),
      [separation({ radius: props.radius, strength: props.strength })],
      { timestep: props.timestep },
    ).toGeometry(),
  );
}

export const sourceRegistration = {
  kind: "definition-v1",
  moduleId: "cascade.pop.Source",
  definition: sourceDefinition,
  loadExecute: async () => executeSource,
} satisfies DefinitionNodeRegistration<typeof sourceDefinition>;

export const solverRegistration = {
  kind: "definition-v1",
  moduleId: "cascade.pop.Solver",
  definition: solverDefinition,
  loadExecute: async () => executeSolver,
} satisfies DefinitionNodeRegistration<typeof solverDefinition>;

export const noiseForceRegistration = {
  kind: "definition-v1",
  moduleId: "cascade.pop.NoiseForce",
  definition: noiseForceDefinition,
  loadExecute: async () => executeNoiseForce,
} satisfies DefinitionNodeRegistration<typeof noiseForceDefinition>;

export const separateRegistration = {
  kind: "definition-v1",
  moduleId: "cascade.pop.Separate",
  definition: separateDefinition,
  loadExecute: async () => executeSeparate,
} satisfies DefinitionNodeRegistration<typeof separateDefinition>;

export const popNodeRegistrations: readonly DefinitionNodeRegistration[] = Object.freeze([
  sourceRegistration,
  solverRegistration,
  noiseForceRegistration,
  separateRegistration,
]);
