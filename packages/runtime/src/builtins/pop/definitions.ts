import type { NodeDefinition, NodeExecutionContext } from "@cascade/contracts";

import {
  ParticleState,
  buildTrails,
  drag,
  emptyParticleGeometry,
  gravity,
  noiseField,
  separation,
  step,
  type ParticleForce,
  type TrailFrame,
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

const simulateDefinition = {
  apiVersion: 1,
  label: "POP Simulate",
  description: "Re-simulate a particle system from frame zero to this frame.",
  icon: "Rewind",
  runsOn: "portable",
  inputs: {
    /** Where particles are born. Its points are the birth positions. */
    geometry: { kind: "data", type: "geometry" },
    /** The frame to simulate up to. Drive it with `$F`. An input rather than
     *  a prop because the whole node is a function of it, and because a node
     *  that read the clock itself would be the thing `AGENTS.md` forbids. */
    frame: { kind: "data", type: "float", default: 1 },
  },
  outputs: {
    /** The particles, one point each. */
    geometry: { kind: "data", type: "geometry" },
    /**
     * The trails, one open polyline per particle.
     *
     * Emitted here rather than by a standalone `Trail` node, and that is a
     * consequence of re-simulation rather than a shortcut. Houdini's Trail SOP
     * reads a rolling window the cook already holds, because Houdini's cook is
     * stateful; Cascade's node is a pure function of its inputs, so a
     * standalone `Trail` can only see the frame on its port — one frame, which
     * draws nothing. This node replays every frame from zero, so it has the
     * whole history for free, and a node that draws nothing would be worse than
     * no node.
     *
     * When `CookScheduler` owns the rolling window the plan describes,
     * `cascade.pop.Trail` becomes a real node and this output stays as the
     * cheap path. The parameters are Houdini's either way.
     */
    trails: { kind: "data", type: "geometry" },
  },
  props: {
    /** Frames of history in the trails. Houdini's Trail `length`. */
    trail_length: { type: "int", default: 14, min: 1, max: 500 },
    /** Use every nth frame. Houdini's `increment`. */
    trail_increment: { type: "int", default: 1, min: 1, max: 32 },
    /**
     * Re-simulation, and why this is the first implementation rather than a
     * placeholder for a cached one.
     *
     * `PLAN particles.md`: re-simulation from the start frame is the
     * *definition* of correctness, and a cache is an accelerator holding
     * nothing re-simulation would not have produced. So this node is the
     * reference: it reads a frame, replays every step from zero, and depends on
     * no state whatsoever. Scrubbing is O(frame) and that is the honest cost —
     * a checkpoint cache makes it fast later without changing a single output,
     * which is exactly the property a cache should have.
     */
    substeps: { type: "int", default: 1, min: 1, max: 32 },
    timestep: { type: "float", default: 1 / 24, min: 1 / 240, max: 1, step: 1 / 240 },
    /** Per frame, as on Source. */
    impulse: { type: "int", default: 6, min: 0, max: 100000 },
    life: { type: "float", default: 4, min: 0, max: 3600, step: 0.1 },
    lifevar: { type: "float", default: 0.4, min: 0, max: 1, step: 0.01 },
    force: { type: "vec2", default: [0, 0] },
    airresist: { type: "float", default: 0.4, min: 0, max: 20, step: 0.05 },
    noise_amplitude: { type: "float", default: 14, min: 0, max: 500, step: 0.5 },
    noise_frequency: { type: "float", default: 0.02, min: 0.001, max: 10, step: 0.001 },
    /** Turns per second of field evolution. */
    noise_evolve: { type: "float", default: 0.08, min: -10, max: 10, step: 0.01 },
    separate_radius: { type: "float", default: 0, min: 0, max: 500, step: 0.5 },
    separate_strength: { type: "float", default: 12, min: 0, max: 500, step: 0.5 },
    maxspeed: { type: "float", default: 60, min: 0, max: 10000, step: 1 },
    /** `[minX, minY, maxX, maxY]`, or all zero for open space. The original
     *  piece is toroidal. */
    wrap: { type: "vec4", default: [0, 0, 0, 0] },
    seed: { type: "int", default: 7, min: 0, max: 999999 },
  },
} as const satisfies NodeDefinition;

export function executeSimulate(
  context: NodeExecutionContext<typeof simulateDefinition>,
): void {
  const props = context.props;
  const from = context.inputs.geometry;
  const frames = Math.max(0, Math.floor(context.inputs.frame));

  let state = ParticleState.fromGeometry(emptyParticleGeometry(2));
  // Bounded by the trail length: the whole point of a window is that it is
  // smaller than the simulation, so keeping every frame would give up the
  // property that makes trails cheaper than a state cache.
  const history: TrailFrame[] = [];
  const available = from ? from.pointCount : 0;
  const source = from?.point.P;
  const wrap = props.wrap.some((value) => value !== 0)
    ? ([props.wrap[0], props.wrap[1], props.wrap[2], props.wrap[3]] as const)
    : undefined;

  for (let frame = 1; frame <= frames; frame += 1) {
    if (available > 0 && source && props.impulse > 0) {
      const born = Math.min(props.impulse, available);
      const position = new Float64Array(born * 2);
      const life = new Float32Array(born);
      for (let index = 0; index < born; index += 1) {
        // Walk the source's points across frames rather than restarting at
        // zero, so a small impulse eventually covers the whole shape instead
        // of birthing from the same handful of points forever.
        const pick = (frame * born + index) % available;
        position[index * 2] = Number((source.data as ArrayLike<number>)[pick * source.size] ?? 0);
        position[index * 2 + 1] = Number((source.data as ArrayLike<number>)[pick * source.size + 1] ?? 0);
        const jitter = birthRandom(props.seed, state.nextId + index);
        life[index] = props.life * (1 - props.lifevar * jitter);
      }
      state = state.born({ position, life });
    }

    const forces: ParticleForce[] = [];
    if (props.force[0] !== 0 || props.force[1] !== 0) forces.push(gravity(props.force));
    if (props.airresist > 0) forces.push(drag(props.airresist));
    if (props.noise_amplitude > 0) {
      forces.push(noiseField({
        seed: props.seed,
        frequency: props.noise_frequency,
        amplitude: props.noise_amplitude,
        // Derived from the frame the caller stated, not from a clock — which
        // is what keeps the whole node a pure function of `frame`.
        evolve: frame * props.timestep * props.noise_evolve,
      }));
    }
    if (props.separate_radius > 0) {
      forces.push(separation({
        radius: props.separate_radius,
        strength: props.separate_strength,
      }));
    }

    for (let substep = 0; substep < props.substeps; substep += 1) {
      state = step(state, forces, {
        timestep: props.timestep / props.substeps,
        ...(props.maxspeed > 0 ? { maxSpeed: props.maxspeed } : {}),
        ...(wrap ? { wrap } : {}),
      });
    }

    history.push({
      id: Int32Array.from(state.id),
      position: Float64Array.from(state.position),
      size: state.size,
    });
    const keep = props.trail_length * props.trail_increment;
    if (history.length > keep) history.splice(0, history.length - keep);
  }

  const geometry = state.toGeometry();
  context.outputs.geometry.set(geometry);
  context.outputs.trails.set(
    buildTrails(history, geometry, {
      result: "polylines",
      length: props.trail_length,
      increment: props.trail_increment,
    }),
  );
}

export const simulateRegistration = {
  kind: "definition-v1",
  moduleId: "cascade.pop.Simulate",
  definition: simulateDefinition,
  loadExecute: async () => executeSimulate,
} satisfies DefinitionNodeRegistration<typeof simulateDefinition>;

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
  simulateRegistration,
  sourceRegistration,
  solverRegistration,
  noiseForceRegistration,
  separateRegistration,
]);

/** `[moduleId, definition]` pairs, for a host building a node palette. The
 *  same shape `geoNodeDefinitions` has, so Studio's library builder needs no
 *  second branch. */
export const popNodeDefinitions = Object.freeze([
  ["cascade.pop.Simulate", simulateDefinition],
  ["cascade.pop.Source", sourceDefinition],
  ["cascade.pop.Solver", solverDefinition],
  ["cascade.pop.NoiseForce", noiseForceDefinition],
  ["cascade.pop.Separate", separateDefinition],
] as const);
