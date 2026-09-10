import type { NodeDefinition, NodeExecutionContext } from "@cascade/contracts";

import type { DefinitionNodeRegistration } from "../../types.js";

/**
 * `cascade.math.*` — arithmetic as nodes.
 *
 * Asked for by a user on 2026-09-10, an hour after installing from npm:
 * *"the usual math nodes are always a treat to have!"*
 *
 * ## Why these exist when expressions already do the maths
 *
 * Every parameter field already takes `sin($T)`, `clamp`, `lerp`, `fit`,
 * `smooth`, `noise`. So this is not a second way to compute — it is a second
 * way to *place* a computation. **An expression is private to one parameter.**
 * A value you want to look at, reuse, or wire into three places has to be a
 * node, and no amount of expression syntax gets you that.
 *
 * ## Grouped rather than one node per operation
 *
 * Houdini has a separate VOP for `add`, `multiply`, `sin` and the rest, which
 * would be about twenty-five nodes here. Marcus chose the grouped form on
 * 2026-09-10: six nodes with an operation to pick, covering the same ground.
 * The reason is palette navigability — twenty-five nodes that each do one
 * arithmetic operation is the part of Houdini's palette people complain about,
 * and Cascade has followed Houdini's conventions everywhere it costs nothing.
 * This is the place it costs something.
 *
 * ## `any` rather than `float`, and what that buys
 *
 * Multiplying a `vec2` by a scalar and adding two `vec3`s are the two things
 * anybody actually reaches for, so the inputs are `any` and every operation is
 * component-wise with scalar broadcast. Typed `float` these nodes would serve
 * numbers only and a parallel vector set would have to exist; the cost is that
 * a wrong wire is caught at cook time with a message rather than refused at
 * connection time.
 *
 * There is deliberately **no `Fit` node**: `cascade.core.Remap` already is one,
 * with `inMin`/`inMax`/`outMin`/`outMax`. Two nodes doing one job is worse than
 * a name that does not match Houdini's.
 */

/** A number, or a vector as a plain numeric array — what a `vec2`/`vec3`/`vec4`
 *  port carries. */
type Numeric = number | readonly number[];

function asComponents(value: unknown, label: string): readonly number[] {
  if (typeof value === "number") return [value];
  if (Array.isArray(value) && value.every((part) => typeof part === "number"))
    return value as readonly number[];
  if (value === undefined || value === null) return [0];
  throw new Error(
    `${label} needs a number or a vector of numbers, and got ${describe(value)}`,
  );
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return `an array of ${value.length}`;
  return `a ${typeof value}`;
}

/**
 * Apply an operation component-wise, broadcasting a scalar against a vector.
 *
 * Mismatched vector widths throw rather than padding: `vec2 + vec3` is a wiring
 * mistake, and quietly treating the missing component as zero would produce a
 * plausible wrong answer — the failure that is hardest to see in a picture.
 */
function combine(
  left: unknown,
  right: unknown,
  operate: (a: number, b: number) => number,
): Numeric {
  const a = asComponents(left, "the first input");
  const b = asComponents(right, "the second input");
  if (a.length !== b.length && a.length !== 1 && b.length !== 1)
    throw new Error(
      `cannot combine a vector of ${a.length} with a vector of ${b.length}`,
    );
  const width = Math.max(a.length, b.length);
  const out: number[] = [];
  for (let index = 0; index < width; index += 1)
    out.push(operate(a[a.length === 1 ? 0 : index]!, b[b.length === 1 ? 0 : index]!));
  return width === 1 ? out[0]! : out;
}

function map(value: unknown, operate: (a: number) => number): Numeric {
  const components = asComponents(value, "the input");
  const out = components.map(operate);
  return out.length === 1 ? out[0]! : out;
}

/**
 * Division and modulo by zero give **zero**, not `Infinity` or `NaN`.
 *
 * Both choices hide something, so this is the lesser one. A non-finite number
 * flows downstream into a position and the geometry silently vanishes — a
 * blank frame with no error anywhere, which is the hardest thing to diagnose
 * here. And a zero divisor is almost always a parameter nobody set yet rather
 * than an intent, so zero is also the likelier thing to have meant.
 */
function divide(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

const BINARY = {
  add: (a: number, b: number) => a + b,
  subtract: (a: number, b: number) => a - b,
  multiply: (a: number, b: number) => a * b,
  divide,
  power: (a: number, b: number) => a ** b,
  modulo: (a: number, b: number) => (b === 0 ? 0 : a % b),
  min: (a: number, b: number) => Math.min(a, b),
  max: (a: number, b: number) => Math.max(a, b),
  atan2: (a: number, b: number) => Math.atan2(a, b),
} as const;

const DEG = Math.PI / 180;

const UNARY = {
  abs: Math.abs,
  negate: (a: number) => -a,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sqrt: (a: number) => (a < 0 ? 0 : Math.sqrt(a)),
  sign: Math.sign,
  // Trigonometry in RADIANS, matching the expression engine, where bare `sin`
  // is radians too. `radians` and `degrees` are here for the conversion, and
  // the divergence from `Transform`'s degrees is recorded in AGENTS.md.
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: (a: number) => Math.asin(Math.max(-1, Math.min(1, a))),
  acos: (a: number) => Math.acos(Math.max(-1, Math.min(1, a))),
  exp: Math.exp,
  log: (a: number) => (a <= 0 ? 0 : Math.log(a)),
  radians: (a: number) => a * DEG,
  degrees: (a: number) => a / DEG,
  /** The fractional part, always positive — `fract(-0.25)` is `0.75`, which is
   *  what a repeating pattern wants and what GLSL's `fract` does. */
  fract: (a: number) => a - Math.floor(a),
} as const;

const COMPARE = {
  greater: (a: number, b: number) => a > b,
  "greater-or-equal": (a: number, b: number) => a >= b,
  less: (a: number, b: number) => a < b,
  "less-or-equal": (a: number, b: number) => a <= b,
  equal: (a: number, b: number) => a === b,
  "not-equal": (a: number, b: number) => a !== b,
} as const;

function options<T extends Record<string, unknown>>(table: T) {
  return Object.keys(table).map((value) => ({ value, label: label(value) }));
}

function label(value: string): string {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export const binaryDefinition = {
  apiVersion: 1,
  label: "Binary Math",
  description:
    "Two values, one operation. Component-wise, and a scalar broadcasts against a vector.",
  icon: "Plus",
  runsOn: "portable",
  inputs: {
    a: { kind: "data", type: "any", default: 0, description: "First value." },
    b: { kind: "data", type: "any", default: 0, description: "Second value." },
  },
  outputs: { value: { kind: "data", type: "any" } },
  props: {
    operation: {
      type: "string",
      default: "add",
      control: "select",
      options: options(BINARY),
      label: "Operation",
    },
  },
} as const satisfies NodeDefinition;

export function executeBinary(
  context: NodeExecutionContext<typeof binaryDefinition>,
): void {
  const operate = BINARY[context.props.operation as keyof typeof BINARY];
  if (!operate)
    throw new Error(
      `cascade.math.Binary has no operation "${context.props.operation}"`,
    );
  context.outputs.value.set(combine(context.inputs.a, context.inputs.b, operate));
}

export const unaryDefinition = {
  apiVersion: 1,
  label: "Unary Math",
  description: "One value, one operation. Trigonometry is in radians.",
  icon: "FunctionSquare",
  runsOn: "portable",
  inputs: {
    value: { kind: "data", type: "any", default: 0 },
  },
  outputs: { value: { kind: "data", type: "any" } },
  props: {
    operation: {
      type: "string",
      default: "abs",
      control: "select",
      options: options(UNARY),
      label: "Operation",
    },
  },
} as const satisfies NodeDefinition;

export function executeUnary(
  context: NodeExecutionContext<typeof unaryDefinition>,
): void {
  const operate = UNARY[context.props.operation as keyof typeof UNARY];
  if (!operate)
    throw new Error(
      `cascade.math.Unary has no operation "${context.props.operation}"`,
    );
  context.outputs.value.set(map(context.inputs.value, operate));
}

export const clampDefinition = {
  apiVersion: 1,
  label: "Clamp",
  description: "Hold a value between two bounds.",
  icon: "Brackets",
  runsOn: "portable",
  inputs: {
    value: { kind: "data", type: "any", default: 0 },
    min: { kind: "data", type: "any", default: 0 },
    max: { kind: "data", type: "any", default: 1 },
  },
  outputs: { value: { kind: "data", type: "any" } },
  props: {},
} as const satisfies NodeDefinition;

export function executeClamp(
  context: NodeExecutionContext<typeof clampDefinition>,
): void {
  const lower = combine(context.inputs.value, context.inputs.min, Math.max);
  context.outputs.value.set(combine(lower, context.inputs.max, Math.min));
}

export const mixDefinition = {
  apiVersion: 1,
  label: "Mix",
  description: "Blend between two values. Houdini's lerp.",
  icon: "Blend",
  runsOn: "portable",
  inputs: {
    a: { kind: "data", type: "any", default: 0, description: "The value at 0." },
    b: { kind: "data", type: "any", default: 1, description: "The value at 1." },
    bias: {
      kind: "data",
      type: "float",
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      description: "Not clamped: past 0..1 this extrapolates, which is useful.",
    },
  },
  outputs: { value: { kind: "data", type: "any" } },
  props: {},
} as const satisfies NodeDefinition;

export function executeMix(
  context: NodeExecutionContext<typeof mixDefinition>,
): void {
  const bias = context.inputs.bias ?? 0.5;
  // a + (b - a) * bias, component-wise. Written this way rather than as
  // `a*(1-t) + b*t` because it is exact at t = 0 and t = 1 in floating point,
  // which matters when a mix drives something that must land exactly on an end.
  const delta = combine(context.inputs.b, context.inputs.a, (b, a) => b - a);
  context.outputs.value.set(
    combine(context.inputs.a, delta, (a, d) => a + d * bias),
  );
}

export const compareDefinition = {
  apiVersion: 1,
  label: "Compare",
  description: "Test two values. Outputs a bool, for a Switch.",
  icon: "Equal",
  runsOn: "portable",
  inputs: {
    a: { kind: "data", type: "float", default: 0 },
    b: { kind: "data", type: "float", default: 0 },
  },
  outputs: { result: { kind: "data", type: "bool" } },
  props: {
    operation: {
      type: "string",
      default: "greater",
      control: "select",
      options: options(COMPARE),
      label: "Test",
    },
    /**
     * Scalars only, unlike the rest of this namespace.
     *
     * "Is this vector greater than that one" has no single right answer — all
     * components, any component, or the length — and a node that picked one
     * silently would be wrong for the other two readings. A comparison feeding
     * a `Switch` wants one boolean, so the input is a `float` and the question
     * does not arise.
     */
    tolerance: {
      type: "float",
      default: 0,
      min: 0,
      label: "Tolerance",
      description:
        "Slack for Equal and Not Equal. Floating point rarely lands on exactly equal.",
    },
  },
} as const satisfies NodeDefinition;

export function executeCompare(
  context: NodeExecutionContext<typeof compareDefinition>,
): void {
  const operation = context.props.operation as keyof typeof COMPARE;
  const test = COMPARE[operation];
  if (!test)
    throw new Error(`cascade.math.Compare has no test "${context.props.operation}"`);
  const a = context.inputs.a ?? 0;
  const b = context.inputs.b ?? 0;
  const tolerance = context.props.tolerance;
  if (tolerance > 0 && (operation === "equal" || operation === "not-equal")) {
    const near = Math.abs(a - b) <= tolerance;
    context.outputs.result.set(operation === "equal" ? near : !near);
    return;
  }
  context.outputs.result.set(test(a, b));
}

function registration<D extends NodeDefinition>(
  name: string,
  definition: D,
  execute: (context: NodeExecutionContext<D>) => void,
) {
  return {
    kind: "definition-v1",
    moduleId: `cascade.math.${name}`,
    definition,
    loadExecute: async () => execute,
  } satisfies DefinitionNodeRegistration<D>;
}

export const binaryRegistration = registration("Binary", binaryDefinition, executeBinary);
export const unaryRegistration = registration("Unary", unaryDefinition, executeUnary);
export const clampRegistration = registration("Clamp", clampDefinition, executeClamp);
export const mixRegistration = registration("Mix", mixDefinition, executeMix);
export const compareRegistration = registration("Compare", compareDefinition, executeCompare);

export const mathNodeRegistrations: readonly DefinitionNodeRegistration[] =
  Object.freeze([
    binaryRegistration,
    unaryRegistration,
    clampRegistration,
    mixRegistration,
    compareRegistration,
  ]);

/** `[moduleId, definition]` pairs, the shape a host's palette builder wants. */
export const mathNodeDefinitions = Object.freeze([
  ["cascade.math.Binary", binaryDefinition],
  ["cascade.math.Unary", unaryDefinition],
  ["cascade.math.Clamp", clampDefinition],
  ["cascade.math.Mix", mixDefinition],
  ["cascade.math.Compare", compareDefinition],
] as const);

export { BINARY, UNARY, COMPARE };
