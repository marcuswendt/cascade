import type { NodeDefinition, NodeExecutionContext } from "@cascade/contracts";

import {
  ParticleState,
  attract,
  buildTrails,
  flowField,
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

/** HSV in, RGB out. Written here rather than imported because a colour
 *  conversion is four lines and an import across package boundaries for four
 *  lines is worse. */
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const turn = ((h % 1) + 1) % 1;
  const sector = turn * 6;
  const c = v * s;
  const x = c * (1 - Math.abs((sector % 2) - 1));
  const m = v - c;
  const rgb: [number, number, number] =
    sector < 1 ? [c, x, 0] :
    sector < 2 ? [x, c, 0] :
    sector < 3 ? [0, c, x] :
    sector < 4 ? [0, x, c] :
    sector < 5 ? [x, 0, c] : [c, 0, x];
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
}

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
    /**
     * Points particles are drawn toward. Houdini's POP Attract.
     *
     * **Geometry rather than an image, and that was a correction.** The
     * original piece renders its word to a canvas, blurs it, reads the pixels
     * back and takes central differences — so its target really is a raster
     * field, and an `image` input was the first thing tried here. It was wrong
     * for this node: decoding an image needs a capability, the media
     * capability hands back a host-specific lease rather than a portable
     * raster, and a POP node doing IO stops being the pure arithmetic that
     * makes it cook identically in both hosts.
     *
     * So the rasterising belongs upstream, in whatever node knows about text
     * or photographs, and what reaches the solver is a set of target points.
     * `fieldForce` in `pop/forces.ts` still takes a sampled raster for a node
     * that has one; this input is the composable half.
     */
    attract: { kind: "data", type: "geometry" },
    /**
     * A flow field, as points carrying `N`.
     *
     * Marcus's description of the original: *"a delicate balance between a
     * force pulling the particles towards the centre spine of the type and
     * tangentially around their outlines."* This is that field — the gradient
     * of a BLURRED letterform, whose ridge runs down each stroke's middle, so
     * the gradient points at the spine and its perpendicular runs along the
     * outline. `field_normal` and `field_tangential` are the two halves of the
     * balance.
     */
    field: { kind: "data", type: "geometry" },
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
    /** Toward the spine, up the field's gradient. */
    field_normal: { type: "float", default: 0, min: -20000, max: 20000, step: 1 },
    /** Around the outline, perpendicular to the gradient. Sign picks which way. */
    field_tangential: { type: "float", default: 0, min: -20000, max: 20000, step: 1 },
    /** Field samples beyond this are ignored, and it is the grid's cell size. */
    field_radius: { type: "float", default: 24, min: 0.5, max: 2000, step: 0.5 },
    /**
     * The contour to hold, as a field level 0..1, with `field_hold` as how
     * firmly.
     *
     * Marcus: *"the lines flow tangentially around the letters in a bundle …
     * loosely describing the type."* A bundle is a contour, so holding a level
     * and letting the tangent carry particles round it is the mechanism —
     * pulling them to the spine instead collapses each letter to a point, and
     * pure tangential flow lets every particle converge onto one level set.
     */
    field_level: { type: "float", default: 0.35, min: 0, max: 1, step: 0.01 },
    field_hold: { type: "float", default: 0, min: 0, max: 40000, step: 10 },
    /**
     * Scatter births across this box instead of on the source geometry's
     * points, `[minX, minY, maxX, maxY]`. All zero uses the points.
     *
     * Houdini's POP Source has the same choice — *Scatter onto Surface* against
     * *Points* — and Marcus's note is that the original spawns *around* the
     * type rather than on it: *"The particles should spawn in the area around
     * the type … and then the forces should drag them around."* Birthing on
     * the letterforms puts every particle where it is already going, so
     * nothing travels and the field has nothing to reveal.
     */
    birth_area: { type: "vec4", default: [0, 0, 0, 0] },
    /**
     * A colour per particle, drawn at birth and fixed for its life.
     *
     * Hashed on the id, so the same particle gets the same colour however many
     * times the frame is re-simulated — a colour drawn from a stream would
     * change on every scrub, which reads as the render being unstable.
     *
     * `[from, to]` in turns around the wheel. Equal values give one hue; a
     * narrow span is usually what a piece wants, because a full-spectrum
     * random set reads as a test pattern rather than as a palette.
     */
    birth_hue: { type: "vec2", default: [0, 0], min: 0, max: 1, step: 0.01 },
    birth_saturation: { type: "float", default: 0.6, min: 0, max: 1, step: 0.01 },
    birth_value: { type: "float", default: 1, min: 0, max: 1, step: 0.01 },
    /** How hard the targets pull. Houdini's POP Attract strength. */
    attract_amplitude: { type: "float", default: 0, min: 0, max: 20000, step: 1 },
    /** Beyond this distance a target is ignored, which is what keeps the pull
     *  local and the cost bounded. 0 means every target pulls every particle. */
    attract_radius: { type: "float", default: 60, min: 0, max: 5000, step: 1 },
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
  // Read once for the whole replay: none of these change within a cook.
  const targets = context.inputs.attract;
  const flow = context.inputs.field;
  const scatter = props.birth_area.some((value) => value !== 0)
    ? props.birth_area
    : null;
  // Scattering needs no source points: the box is the source. Requiring a
  // wired geometry to scatter inside a box would be a dependency on nothing.
  const canBirth = scatter !== null || (available > 0 && source !== undefined);
  const wrap = props.wrap.some((value) => value !== 0)
    ? ([props.wrap[0], props.wrap[1], props.wrap[2], props.wrap[3]] as const)
    : undefined;

  for (let frame = 1; frame <= frames; frame += 1) {
    if (canBirth && props.impulse > 0) {
      const born = scatter ? props.impulse : Math.min(props.impulse, available);
      const position = new Float64Array(born * 2);
      const life = new Float32Array(born);
      // Only when a span is asked for: an all-white `Cd` would still be a `Cd`,
      // and it would override the export's own stroke colour with white.
      const colours = props.birth_hue[0] !== props.birth_hue[1]
        || props.birth_saturation !== 0
        ? new Float32Array(born * 4)
        : null;
      for (let index = 0; index < born; index += 1) {
        const id = state.nextId + index;
        if (scatter) {
          // Hashed on the id, so a particle is born in the same place however
          // many times the frame is re-simulated. Two draws from one hash
          // stream would correlate x with y into a diagonal, so the second
          // takes a different sample.
          position[index * 2] = scatter[0]! + birthRandom(props.seed, id * 2) * (scatter[2]! - scatter[0]!);
          position[index * 2 + 1] = scatter[1]! + birthRandom(props.seed, id * 2 + 1) * (scatter[3]! - scatter[1]!);
        } else {
          // Walk the source's points across frames rather than restarting at
          // zero, so a small impulse eventually covers the whole shape instead
          // of birthing from the same handful of points forever.
          const pick = (frame * born + index) % available;
          const points = source!.data as ArrayLike<number>;
          position[index * 2] = Number(points[pick * source!.size] ?? 0);
          position[index * 2 + 1] = Number(points[pick * source!.size + 1] ?? 0);
        }
        const jitter = birthRandom(props.seed, id);
        life[index] = props.life * (1 - props.lifevar * jitter);
        if (colours) {
          // A third hash sample, distinct from the two the scatter uses and
          // the one the life uses: drawing twice from the same sample would
          // correlate a particle's colour with where it was born.
          const hue = props.birth_hue[0]!
            + birthRandom(props.seed, id * 4 + 3) * (props.birth_hue[1]! - props.birth_hue[0]!);
          const [r, g, b] = hsvToRgb(hue, props.birth_saturation, props.birth_value);
          colours[index * 4] = r;
          colours[index * 4 + 1] = g;
          colours[index * 4 + 2] = b;
          colours[index * 4 + 3] = 1;
        }
      }
      state = state.born({ position, life, ...(colours ? { colour: colours } : {}) });
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
    if (flow && flow.pointCount > 0 && flow.point.N
        && (props.field_normal !== 0 || props.field_tangential !== 0)) {
      forces.push(flowField({
        positions: flow.point.P!.data as ArrayLike<number>,
        positionSize: flow.point.P!.size,
        directions: flow.point.N.data as ArrayLike<number>,
        ...(flow.point.level && flow.point.level.storage !== "string"
          ? { levels: flow.point.level.data as ArrayLike<number> }
          : {}),
        count: flow.pointCount,
        normal: props.field_normal,
        tangential: props.field_tangential,
        radius: props.field_radius,
        level: props.field_level,
        hold: props.field_hold,
      }));
    }
    if (targets && targets.pointCount > 0 && props.attract_amplitude > 0) {
      forces.push(attract({
        targets: targets.point.P!.data as ArrayLike<number>,
        targetSize: targets.point.P!.size,
        targetCount: targets.pointCount,
        amplitude: props.attract_amplitude,
        radius: props.attract_radius,
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
