import {
  POSITION_ATTRIBUTE,
  checkParticleContract,
  type Geometry,
} from "@cascade/contracts";

import { createAttribute } from "../geometry/attributes.js";
import { GeometryBuilder } from "../geometry/builder.js";

/**
 * A particle state, and the arithmetic for stepping it.
 *
 * Step 2 of `PLAN particles.md`. Deliberately not nodes: the nodes are thin
 * wrappers and this is where the risk lives, so it is testable without a graph.
 *
 * **The state is a `Geometry` and nothing else.** Marcus ruled that trails are
 * geometry rather than a faded canvas, which means points carrying the
 * attribute contract *are* the simulation — there is no particle type, no
 * parallel store, and every geometry node downstream already understands the
 * result. `Trail`, `CopyToPoints` and `SvgExport` need nothing new.
 *
 * **The step is a pure function.** `step(previous, forces, options)` returns a
 * new state and reads no clock. That is what lets the solver be re-simulated
 * from frame zero for correctness and cached only as an accelerator — the
 * ruling in the plan's central section — and it is why `cascade run --frames`
 * needs nothing added.
 */

/** A force reads the state and returns an acceleration per particle. It may
 *  not move anything: integration happens once, in `step`, or two forces
 *  disagree about the order of operations. */
export interface ParticleForce {
  readonly label: string;
  /** Acceleration in units per second squared, `size` components per particle,
   *  flat and parallel to the point arrays. */
  accelerate(state: ParticleState, size: number): Float32Array;
}

export interface ParticleStepOptions {
  /** Seconds. Stated by the caller, never derived from a clock here — the
   *  solver node decides whether it came from a fixed value or from fps, which
   *  is Marcus's ruling of 2026-09-09, and the difference is recorded in the
   *  cache key rather than in this function. */
  readonly timestep: number;
  /** Speed clamp in units per second, or 0 for none. The original piece has
   *  one, and a clamp is also what stops a stiff force exploding a step. */
  readonly maxSpeed?: number;
  /** Wrap positions into this box, `[minX, minY, maxX, maxY]`. The original is
   *  toroidal; omit for open space. */
  readonly wrap?: readonly [number, number, number, number];
}

/**
 * The state, read through accessors rather than as raw arrays.
 *
 * A class rather than a bag of typed arrays because every operator needs the
 * same four reads and the same bounds discipline, and because `size` — whether
 * this is a 2D or 3D system — has to be answered once rather than inferred by
 * each force from the length of an array it was handed.
 */
export class ParticleState {
  readonly count: number;
  readonly size: number;
  readonly position: Float64Array;
  readonly velocity: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly id: Int32Array;
  /**
   * `Cd`, four components, or null for a system with no colour.
   *
   * Null rather than a default white array, because the absence is meaningful:
   * `SvgExport` and every other consumer falls back to its own stroke prop
   * when a primitive carries no `Cd`, and filling one in here would take that
   * choice away from the graph.
   */
  readonly colour: Float32Array | null;
  nextId: number;

  /**
   * Internal, and taking the arrays by reference rather than copying.
   *
   * `@internal` rather than `private` because `step` and `select` are module
   * functions rather than methods — they are the arithmetic, and putting them
   * on the class would make a state object that can step itself, which is one
   * short hop from a state object that holds a clock.
   *
   * @internal
   */
  static of(fields: {
    count: number; size: number; position: Float64Array; velocity: Float32Array;
    age: Float32Array; life: Float32Array; id: Int32Array;
    colour?: Float32Array | null; nextId: number;
  }): ParticleState {
    return new ParticleState(fields);
  }

  private constructor(fields: {
    count: number; size: number; position: Float64Array; velocity: Float32Array;
    age: Float32Array; life: Float32Array; id: Int32Array;
    colour?: Float32Array | null; nextId: number;
  }) {
    this.count = fields.count;
    this.size = fields.size;
    this.position = fields.position;
    this.velocity = fields.velocity;
    this.age = fields.age;
    this.life = fields.life;
    this.id = fields.id;
    this.colour = fields.colour ?? null;
    this.nextId = fields.nextId;
  }

  /** An empty system. `nextId` starts at 0 and only ever increases. */
  static empty(size: 2 | 3 = 2): ParticleState {
    return new ParticleState({
      count: 0, size,
      position: new Float64Array(0), velocity: new Float32Array(0),
      age: new Float32Array(0), life: new Float32Array(0), id: new Int32Array(0),
      colour: null,
      nextId: 0,
    });
  }

  /**
   * Read a state out of a geometry.
   *
   * Refuses rather than repairs. `checkParticleContract` returns every
   * violation, and a solver handed a geometry without `id` cannot invent one:
   * inventing ids per frame is precisely the fault the mandatory `id` exists to
   * prevent, because it would silently make every particle new every step.
   */
  static fromGeometry(geometry: Geometry): ParticleState {
    const violations = checkParticleContract(geometry);
    if (violations.length > 0) {
      throw new Error(
        `not a particle geometry: ${violations.map((v) => v.reason).join("; ")}`,
      );
    }
    const position = geometry.point[POSITION_ATTRIBUTE]!;
    const velocity = geometry.point.v!;
    return new ParticleState({
      count: geometry.pointCount,
      size: position.size,
      position: Float64Array.from(position.data as ArrayLike<number>),
      velocity: Float32Array.from(velocity.data as ArrayLike<number>),
      age: Float32Array.from(geometry.point.age!.data as ArrayLike<number>),
      life: Float32Array.from(geometry.point.life!.data as ArrayLike<number>),
      id: Int32Array.from(geometry.point.id!.data as ArrayLike<number>),
      colour: geometry.point.Cd && geometry.point.Cd.storage !== "string"
        ? Float32Array.from(geometry.point.Cd.data as ArrayLike<number>)
        : null,
      nextId: Number(geometry.detail.nextid ?? geometry.pointCount),
    });
  }

  /** Write the state back out as geometry, one point per particle. */
  toGeometry(): Geometry {
    const builder = new GeometryBuilder({ positionSize: this.size as 2 | 3 });
    for (let index = 0; index < this.count; index += 1) {
      builder.addPoint(
        this.position[index * this.size]!,
        this.position[index * this.size + 1]!,
        this.size === 3 ? this.position[index * this.size + 2]! : 0,
      );
    }
    builder.setAttribute("point", "v", { storage: "f32", size: this.size, data: this.velocity });
    builder.setAttribute("point", "age", { storage: "f32", size: 1, data: this.age });
    builder.setAttribute("point", "life", { storage: "f32", size: 1, data: this.life });
    builder.setAttribute("point", "id", { storage: "i32", size: 1, data: this.id });
    if (this.colour) {
      builder.setAttribute("point", "Cd", { storage: "f32", size: 4, data: this.colour });
    }
    builder.setDetail("nextid", this.nextId);
    return builder.build();
  }

  /** Add particles, handing each a fresh id. Returns the new state; the
   *  receiver is not mutated, so a source can be applied to a cached frame. */
  born(points: {
    readonly position: ArrayLike<number>;
    readonly velocity?: ArrayLike<number>;
    readonly life: ArrayLike<number>;
    /** `Cd` per new particle, four components. Once any particle has a colour
     *  the whole system carries the attribute, so the ones born before it get
     *  opaque white rather than the array being ragged. */
    readonly colour?: ArrayLike<number>;
  }): ParticleState {
    const added = points.life.length;
    if (added === 0) return this;
    const count = this.count + added;
    const position = new Float64Array(count * this.size);
    const velocity = new Float32Array(count * this.size);
    const age = new Float32Array(count);
    const life = new Float32Array(count);
    const id = new Int32Array(count);
    const wantsColour = this.colour !== null || points.colour !== undefined;
    const colour = wantsColour ? new Float32Array(count * 4) : null;
    if (colour) {
      // White for anything already present without a colour: a ragged
      // attribute is not representable, and white is what a fallback stroke
      // multiplies to itself.
      colour.fill(1, 0, this.count * 4);
      if (this.colour) colour.set(this.colour);
    }

    position.set(this.position);
    velocity.set(this.velocity);
    age.set(this.age);
    life.set(this.life);
    id.set(this.id);

    for (let index = 0; index < added; index += 1) {
      const at = this.count + index;
      for (let component = 0; component < this.size; component += 1) {
        position[at * this.size + component] = points.position[index * this.size + component] ?? 0;
        velocity[at * this.size + component] = points.velocity?.[index * this.size + component] ?? 0;
      }
      life[at] = points.life[index]!;
      if (colour) {
        for (let channel = 0; channel < 4; channel += 1) {
          colour[at * 4 + channel] = points.colour
            ? Number(points.colour[index * 4 + channel] ?? 1)
            : 1;
        }
      }
      // Monotonic, and never reused: a trail keyed on an id that came back
      // would join two unrelated particles into one stroke.
      id[at] = this.nextId + index;
    }

    return ParticleState.of({
      count, size: this.size, position, velocity, age, life, id, colour,
      nextId: this.nextId + added,
    });
  }
}

/**
 * One step. Forces, then integrate, then age, then kill.
 *
 * The order is Houdini's and it matters: a force that read a position already
 * advanced by this step's velocity would be integrating twice. So every force
 * sees the same state, their accelerations sum, and integration happens once.
 */
export function step(
  state: ParticleState,
  forces: readonly ParticleForce[],
  options: ParticleStepOptions,
): ParticleState {
  const { timestep, maxSpeed = 0, wrap } = options;
  const { count, size } = state;
  if (count === 0) return state;

  const acceleration = new Float32Array(count * size);
  for (const force of forces) {
    const contribution = force.accelerate(state, size);
    if (contribution.length !== count * size) {
      throw new Error(
        `force ${force.label} returned ${contribution.length} values for ${count} particles of size ${size}`,
      );
    }
    for (let index = 0; index < acceleration.length; index += 1) {
      acceleration[index] = acceleration[index]! + contribution[index]!;
    }
  }

  const position = Float64Array.from(state.position);
  const velocity = Float32Array.from(state.velocity);
  const age = Float32Array.from(state.age);

  for (let index = 0; index < count; index += 1) {
    // Semi-implicit Euler: velocity first, then position from the NEW velocity.
    // Explicit Euler drifts visibly on a curl field at any timestep a sketch
    // would use, and the cost of the better one is nothing.
    let speedSquared = 0;
    for (let component = 0; component < size; component += 1) {
      const at = index * size + component;
      velocity[at] = velocity[at]! + acceleration[at]! * timestep;
      speedSquared += velocity[at]! * velocity[at]!;
    }
    if (maxSpeed > 0 && speedSquared > maxSpeed * maxSpeed) {
      const scale = maxSpeed / Math.sqrt(speedSquared);
      for (let component = 0; component < size; component += 1) {
        velocity[index * size + component] = velocity[index * size + component]! * scale;
      }
    }
    for (let component = 0; component < size; component += 1) {
      const at = index * size + component;
      position[at] = position[at]! + velocity[at]! * timestep;
    }
    if (wrap) {
      position[index * size] = wrapInto(position[index * size]!, wrap[0], wrap[2]);
      position[index * size + 1] = wrapInto(position[index * size + 1]!, wrap[1], wrap[3]);
    }
    // Seconds, not frames — the one place this departs from the sketch, and
    // the reason the contract states a unit.
    age[index] = age[index]! + timestep;
  }

  return kill(ParticleState.of({
    count, size: state.size, position, velocity, age,
    life: Float32Array.from(state.life), id: Int32Array.from(state.id),
    colour: state.colour ? Float32Array.from(state.colour) : null,
    nextId: state.nextId,
  }));
}

function wrapInto(value: number, low: number, high: number): number {
  const span = high - low;
  if (span <= 0) return value;
  return low + (((value - low) % span) + span) % span;
}

/**
 * Remove particles whose age has reached their life.
 *
 * Compacts in place order, which reorders the arrays — and is exactly why `id`
 * is mandatory. A `life` of zero or less means immortal, following Houdini,
 * because a source that does not set a life should not birth particles that
 * die on their first step.
 */
export function kill(state: ParticleState): ParticleState {
  const keep: number[] = [];
  for (let index = 0; index < state.count; index += 1) {
    const life = state.life[index]!;
    if (life <= 0 || state.age[index]! < life) keep.push(index);
  }
  if (keep.length === state.count) return state;
  return select(state, keep);
}

/** A new state holding only these particles, in this order. */
export function select(state: ParticleState, indices: readonly number[]): ParticleState {
  const count = indices.length;
  const { size } = state;
  const position = new Float64Array(count * size);
  const velocity = new Float32Array(count * size);
  const age = new Float32Array(count);
  const life = new Float32Array(count);
  const id = new Int32Array(count);
  const colour = state.colour ? new Float32Array(count * 4) : null;

  indices.forEach((from, to) => {
    for (let component = 0; component < size; component += 1) {
      position[to * size + component] = state.position[from * size + component]!;
      velocity[to * size + component] = state.velocity[from * size + component]!;
    }
    age[to] = state.age[from]!;
    life[to] = state.life[from]!;
    id[to] = state.id[from]!;
    if (colour && state.colour) {
      for (let channel = 0; channel < 4; channel += 1) {
        colour[to * 4 + channel] = state.colour[from * 4 + channel]!;
      }
    }
  });

  return ParticleState.of({
    count, size, position, velocity, age, life, id, colour, nextId: state.nextId,
  });
}

/** A blank particle geometry, for a source to add to. */
export function emptyParticleGeometry(size: 2 | 3 = 2): Geometry {
  const builder = new GeometryBuilder({ positionSize: size });
  builder.setAttribute("point", "v", createAttribute(0, size, "f32"));
  builder.setAttribute("point", "age", createAttribute(0, 1, "f32"));
  builder.setAttribute("point", "life", createAttribute(0, 1, "f32"));
  builder.setAttribute("point", "id", createAttribute(0, 1, "i32"));
  builder.setDetail("nextid", 0);
  return builder.build();
}
