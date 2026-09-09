import type { ParticleForce, ParticleState } from "./state.js";

/**
 * The forces, as plain objects rather than nodes.
 *
 * A force reads the state and returns an acceleration. It never moves
 * anything — integration happens once, in `step`, because two forces that each
 * integrated would disagree about the order of operations and the result would
 * depend on wiring order rather than on physics.
 *
 * Houdini's names for the parameters, per the standing rule.
 */

/** Constant acceleration. Houdini's POP Force, whose parameter is `force`. */
export function gravity(force: readonly number[]): ParticleForce {
  return {
    label: "gravity",
    accelerate(state: ParticleState, size: number): Float32Array {
      const out = new Float32Array(state.count * size);
      for (let index = 0; index < state.count; index += 1) {
        for (let component = 0; component < size; component += 1) {
          out[index * size + component] = force[component] ?? 0;
        }
      }
      return out;
    },
  };
}

/**
 * Velocity-opposing drag. Houdini's POP Drag, parameter `airresist`.
 *
 * Returned as an acceleration rather than applied as a multiplier on velocity,
 * which is the same choice as everywhere else here: a drag that scaled velocity
 * directly would be integrating, and its result would then depend on whether it
 * ran before or after a force that also scaled velocity.
 */
export function drag(airresist: number): ParticleForce {
  return {
    label: "drag",
    accelerate(state: ParticleState, size: number): Float32Array {
      const out = new Float32Array(state.count * size);
      for (let index = 0; index < out.length; index += 1) {
        out[index] = -state.velocity[index]! * airresist;
      }
      return out;
    },
  };
}

/**
 * A heading read from a noise field — the first of the four forces the
 * living-identity piece applies.
 *
 * Value noise on a hashed lattice rather than a gradient noise: it is a few
 * lines, it is deterministic from `(seed, cell)` with no state, and at the
 * scales this is used at the difference is not visible. A curl noise belongs in
 * the same file later and wants the same hash.
 *
 * `frequency` is in turns per unit, `amplitude` in units per second squared.
 */
export function noiseField(options: {
  readonly seed: number;
  readonly frequency: number;
  readonly amplitude: number;
  /** Advances the field itself, so the flow evolves. Stated by the caller from
   *  the frame, never read from a clock here. */
  readonly evolve?: number;
}): ParticleForce {
  const { seed, frequency, amplitude, evolve = 0 } = options;
  return {
    label: "noiseField",
    accelerate(state: ParticleState, size: number): Float32Array {
      const out = new Float32Array(state.count * size);
      for (let index = 0; index < state.count; index += 1) {
        const x = state.position[index * size]! * frequency;
        const y = state.position[index * size + 1]! * frequency;
        // One noise value read as an angle, which is what the original does:
        // a heading rather than a vector, so the field never has still points
        // where two components happen to cancel.
        const heading = valueNoise(seed, x, y, evolve) * Math.PI * 2;
        out[index * size] = Math.cos(heading) * amplitude;
        out[index * size + 1] = Math.sin(heading) * amplitude;
      }
      return out;
    },
  };
}

/**
 * Neighbour separation — the third force, and the expensive one.
 *
 * A uniform grid rebuilt every step, which is what the original does and what
 * `PLAN geometry` says about spatial indexes: they live inside the node that
 * needs them rather than becoming a type. O(n) for the scales here; a system
 * large enough to need something better should say so with a measurement.
 */
export function separation(options: {
  readonly radius: number;
  readonly strength: number;
}): ParticleForce {
  const { radius, strength } = options;
  return {
    label: "separation",
    accelerate(state: ParticleState, size: number): Float32Array {
      const out = new Float32Array(state.count * size);
      if (radius <= 0 || strength === 0) return out;

      const cell = radius;
      const buckets = new Map<string, number[]>();
      const key = (x: number, y: number) =>
        `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;

      for (let index = 0; index < state.count; index += 1) {
        const k = key(state.position[index * size]!, state.position[index * size + 1]!);
        const bucket = buckets.get(k);
        if (bucket) bucket.push(index);
        else buckets.set(k, [index]);
      }

      for (let index = 0; index < state.count; index += 1) {
        const px = state.position[index * size]!;
        const py = state.position[index * size + 1]!;
        const cx = Math.floor(px / cell);
        const cy = Math.floor(py / cell);
        let ax = 0;
        let ay = 0;
        for (let ox = -1; ox <= 1; ox += 1) {
          for (let oy = -1; oy <= 1; oy += 1) {
            const bucket = buckets.get(`${cx + ox}:${cy + oy}`);
            if (!bucket) continue;
            for (const other of bucket) {
              if (other === index) continue;
              const dx = px - state.position[other * size]!;
              const dy = py - state.position[other * size + 1]!;
              const distanceSquared = dx * dx + dy * dy;
              if (distanceSquared === 0 || distanceSquared > radius * radius) continue;
              // Falls off linearly to the radius. Inverse-square would be
              // physical and is wrong here: two coincident particles produce an
              // unbounded acceleration and the step explodes.
              const distance = Math.sqrt(distanceSquared);
              const falloff = (1 - distance / radius) / distance;
              ax += dx * falloff;
              ay += dy * falloff;
            }
          }
        }
        out[index * size] = ax * strength;
        out[index * size + 1] = ay * strength;
      }
      return out;
    },
  };
}

/**
 * Deterministic value noise. A hash, not a PRNG: the same seed and cell always
 * give the same number, so nothing carries between particles or frames — the
 * property that makes re-simulation from frame zero reproduce exactly.
 */
export function valueNoise(seed: number, x: number, y: number, z = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const fz = smooth(z - z0);

  let value = 0;
  for (let dz = 0; dz <= 1; dz += 1) {
    for (let dy = 0; dy <= 1; dy += 1) {
      for (let dx = 0; dx <= 1; dx += 1) {
        const weight =
          (dx === 0 ? 1 - fx : fx) *
          (dy === 0 ? 1 - fy : fy) *
          (dz === 0 ? 1 - fz : fz);
        value += hash(seed, x0 + dx, y0 + dy, z0 + dz) * weight;
      }
    }
  }
  return value;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function hash(seed: number, x: number, y: number, z: number): number {
  const n = Math.sin(seed * 12.9898 + x * 78.233 + y * 37.719 + z * 19.371) * 43758.5453;
  return n - Math.floor(n);
}
