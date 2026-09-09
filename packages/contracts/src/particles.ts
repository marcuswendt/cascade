import {
  POSITION_ATTRIBUTE,
  type AttributeLevel,
  type AttributeStorage,
  type Geometry,
} from "./geometry.js";

/**
 * The attribute contract a particle system reads and writes.
 *
 * Step 1 of `PLAN particles.md`, and it is deliberately first: **renaming an
 * attribute after three operators read it is the expensive change.** So the
 * names, levels and storage are fixed before any node exists, and nothing here
 * is a node — this file declares a vocabulary and the checks that hold it.
 *
 * Houdini's names throughout, per the standing rule. Where Houdini and Cascade
 * disagree the reason is written down beside the entry rather than left as a
 * preference.
 *
 * **A particle system is geometry.** There is no particle type: points with
 * these attributes on them are what a solver reads and what `CopyToPoints`,
 * `SvgExport` and every other geometry node already understand. That is the
 * whole reason `PLAN geometry` retires `points` to an alias — four names for
 * one concept, and a fifth for particles would be worse.
 */

export interface ParticleAttributeSpec {
  readonly name: string;
  readonly level: AttributeLevel;
  readonly storage: AttributeStorage;
  /** Components. `P` is 2 or 3, so it is stated as a range rather than a size. */
  readonly size: number | readonly [number, number];
  /** Whether a solver may run without it. */
  readonly required: boolean;
  readonly units?: "seconds" | "turns";
  readonly note: string;
}

/**
 * Position. Already `POSITION_ATTRIBUTE`, and `f64` because the Python bridge
 * writes points as float64 and narrowing would add a lossy step to a boundary
 * that is lossless today.
 */
const P: ParticleAttributeSpec = {
  name: POSITION_ATTRIBUTE,
  level: "point",
  storage: "f64",
  size: [2, 3],
  required: true,
  note: "Position. Shared with every other geometry node, not a particle attribute.",
};

export const PARTICLE_ATTRIBUTES: readonly ParticleAttributeSpec[] = Object.freeze([
  P,
  {
    name: "v",
    level: "point",
    storage: "f32",
    size: [2, 3],
    required: true,
    note: "Velocity, in units per second. f32 rather than f64: a velocity is not a coordinate, so the precision argument for P does not carry over.",
  },
  {
    name: "age",
    level: "point",
    storage: "f32",
    size: 1,
    required: true,
    units: "seconds",
    // The one place this departs from the sketch it is modelled on.
    note: "Seconds, not frames. A frame count changes meaning with fps, and a graph whose particles die at a different point when rendered at 60 is not deterministic in any useful sense.",
  },
  {
    name: "life",
    level: "point",
    storage: "f32",
    size: 1,
    required: true,
    units: "seconds",
    note: "Life expectancy in seconds. A particle dies when age >= life.",
  },
  {
    name: "id",
    level: "point",
    storage: "i32",
    size: 1,
    required: true,
    note: "Stable across frames and across kills. Mandatory: a particle array reorders on every kill, so anything durable and per-particle must key on this rather than on an index.",
  },
  {
    name: "nextid",
    level: "detail",
    storage: "i32",
    size: 1,
    required: true,
    note: "The next id to hand out. Houdini's own mechanism for keeping id monotonic, and what stops an id being reused after a kill.",
  },
  {
    name: "Cd",
    level: "point",
    storage: "f32",
    size: 4,
    required: false,
    note: "Colour. Owned by the style vocabulary in PLAN geometry, which refuses a Cd that is a string or numeric with any size but four.",
  },
  {
    name: "pscale",
    level: "point",
    storage: "f32",
    size: 1,
    required: false,
    note: "Not a POP attribute in Houdini's sense. Writing it is what makes CopyToPoints scale its instances, which is how oriented marks get drawn without a new node.",
  },
  {
    name: "N",
    level: "point",
    storage: "f32",
    size: [2, 3],
    required: false,
    note: "Orientation, read by CopyToPoints alongside pscale.",
  },
]);

const BY_NAME: ReadonlyMap<string, ParticleAttributeSpec> = new Map(
  PARTICLE_ATTRIBUTES.map((spec) => [spec.name, spec]),
);

export function particleAttribute(name: string): ParticleAttributeSpec | undefined {
  return BY_NAME.get(name);
}

/** The attributes a solver cannot run without. */
export function requiredParticleAttributes(): readonly ParticleAttributeSpec[] {
  return PARTICLE_ATTRIBUTES.filter((spec) => spec.required);
}

function sizeMatches(spec: ParticleAttributeSpec, size: number): boolean {
  return typeof spec.size === "number"
    ? size === spec.size
    : size >= spec.size[0] && size <= spec.size[1];
}

function describeSize(spec: ParticleAttributeSpec): string {
  return typeof spec.size === "number" ? String(spec.size) : `${spec.size[0]} or ${spec.size[1]}`;
}

export interface ParticleContractViolation {
  readonly attribute: string;
  readonly reason: string;
}

/**
 * Whether a geometry carries the attributes a solver reads, in the shapes it
 * reads them in.
 *
 * Returns every violation rather than the first, because the answer a caller
 * wants is *what is wrong with this geometry* and not *what is the first thing
 * wrong with it* — a source node missing three attributes should say so once.
 *
 * Deliberately not a throw: `cascade check` wants to report this statically
 * alongside its other findings, and a solver wants to fail with a sentence. The
 * shared thing between them is the list.
 */
export function checkParticleContract(geometry: Geometry): readonly ParticleContractViolation[] {
  const violations: ParticleContractViolation[] = [];

  for (const spec of PARTICLE_ATTRIBUTES) {
    if (spec.level === "detail") {
      const value = geometry.detail[spec.name];
      if (value === undefined) {
        if (spec.required) {
          violations.push({
            attribute: spec.name,
            reason: `missing detail attribute ${spec.name} — ${spec.note}`,
          });
        }
        continue;
      }
      if (typeof value !== "number") {
        violations.push({
          attribute: spec.name,
          reason: `detail ${spec.name} must be a number, not ${typeof value}`,
        });
      }
      continue;
    }

    const attribute = geometry.point[spec.name];
    if (attribute === undefined) {
      if (spec.required) {
        violations.push({
          attribute: spec.name,
          reason: `missing point attribute ${spec.name} — ${spec.note}`,
        });
      }
      continue;
    }

    // A string where a number belongs is the failure that would otherwise
    // reach arithmetic and produce NaN silently.
    if (attribute.storage === "string") {
      violations.push({
        attribute: spec.name,
        reason: `${spec.name} is a string attribute; a solver reads it as ${spec.storage}`,
      });
      continue;
    }
    if (!sizeMatches(spec, attribute.size)) {
      violations.push({
        attribute: spec.name,
        reason: `${spec.name} has size ${attribute.size}; expected ${describeSize(spec)}`,
      });
    }
  }

  return violations;
}

/** True when this geometry could be stepped by a solver. */
export function isParticleGeometry(geometry: Geometry): boolean {
  return checkParticleContract(geometry).length === 0;
}
