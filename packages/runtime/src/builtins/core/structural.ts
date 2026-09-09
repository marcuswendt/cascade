import type { DefinitionNodeRegistration } from "../../types.js";

const inputDefinition = {
  apiVersion: 1,
  runsOn: "portable",
  label: "Input",
  description: "Defines a public graph or subnet input",
  icon: "LogIn",
  inputs: {
    value: { kind: "data", type: "any", default: null },
  },
  outputs: {
    output: { kind: "data", type: "any" },
  },
  props: {
    inputIndex: { type: "int", default: 0, min: 0, step: 1 },
    inputName: { type: "string", default: "" },
    dataType: { type: "string", default: "any" },
  },
} as const;

const outputDefinition = {
  apiVersion: 1,
  runsOn: "portable",
  label: "Output",
  description: "Defines a public graph or subnet output",
  icon: "LogOut",
  inputs: {
    input: { kind: "data", type: "any", default: null },
  },
  outputs: {
    output: { kind: "data", type: "any" },
  },
  props: {
    outputIndex: { type: "int", default: 0, min: 0, step: 1 },
    outputName: { type: "string", default: "" },
    dataType: { type: "string", default: "any" },
  },
} as const;

const subnetDefinition = {
  apiVersion: 1,
  runsOn: "portable",
  container: "subnet",
  label: "Subnet",
  description: "Contains a nested deterministic graph",
  icon: "Folder",
} as const;

/**
 * `cascade.core.Feedback` — a container whose contents run once per step, with
 * the previous step's result carried forward.
 *
 * Marcus, 2026-09-09, trying to dive into the particle node: *"how do i jump
 * into the sim node and see its network of forces."* He could not, and the
 * reason was structural rather than a missing handler: **a subnet in Cascade is
 * a grouping, not an evaluation context.** Its children are ordinary nodes in
 * one flat graph, cooked once each. So "the forces are nodes inside, replayed
 * per timestep" had nowhere to live.
 *
 * This is that place, and it is the one construct a pure DAG cannot express. A
 * simulation is `state = f(state)` repeated, which is a cycle — and every
 * dataflow system that supports simulation makes it special somewhere. Houdini's
 * Solver SOP is a subnet with a `Prev_Frame` input; this is the same shape with
 * `cascade.core.Previous` in place of that input.
 *
 * ## The contract
 *
 * - `initial` seeds the first step. Whatever type it carries, the loop carries.
 * - `steps` is how many times the contents run. **An input rather than a prop**,
 *   because the whole point is to drive it from `cascade.core.Time` — a frame
 *   pinned in a prop is exactly the bug that made the timeline do nothing.
 * - Inside, `cascade.core.Previous` emits the carried value: `initial` on the
 *   first step, and the previous step's result after that.
 * - Inside, `cascade.core.Output` at index 0 is the step's result. Without one
 *   the loop has no result to carry and the container refuses rather than
 *   quietly returning `initial` — a simulation that silently does not simulate
 *   is the worst available failure.
 *
 * ## What it does not do, deliberately
 *
 * **`steps` of zero returns `initial` unchanged.** That is not an error: frame
 * zero of a simulation is its initial state, and a graph that throws at the
 * start of the timeline is unusable.
 *
 * **There is no per-step caching here.** The container re-runs from `initial`
 * every cook, which is O(steps) and honest — the same choice `pop.Simulate`
 * already made, for the same reason: re-simulation from the start is the
 * definition of correctness, and a cache is an optimisation layered on top of a
 * thing that is already right.
 */
const feedbackDefinition = {
  apiVersion: 1,
  runsOn: "portable",
  container: "feedback",
  label: "Feedback",
  description:
    "Runs its contents once per step, carrying the previous result forward.",
  icon: "Repeat",
  inputs: {
    initial: {
      kind: "data",
      type: "any",
      default: null,
      description: "The state the first step starts from.",
    },
    steps: {
      kind: "data",
      type: "int",
      default: 1,
      min: 0,
      description: "How many times the contents run. Drive it from a Time node.",
    },
  },
  outputs: {
    result: {
      kind: "data",
      type: "any",
      description: "The last step's result, or `initial` when steps is zero.",
    },
    /**
     * Every kept step, oldest first.
     *
     * This exists because **a trail needs the history, not the final state**,
     * and nothing outside the loop could reconstruct it: a downstream node sees
     * one frame, which draws nothing. Houdini's Trail SOP has the same
     * requirement and solves it the same way, by being given the frames.
     *
     * Empty unless `history` is non-zero, because the alternative is a
     * simulation that quietly holds 120 copies of its own geometry — and at
     * a few thousand particles that is the difference between a preview and a
     * tab that runs out of memory.
     */
    history: {
      kind: "data",
      type: "array",
      description: "The kept step results, oldest first. Empty unless History is set.",
    },
  },
  props: {
    /**
     * How many step results to keep, newest-biased: `0` keeps none, `N` keeps
     * the last `N`.
     *
     * A prop rather than an input because it is structural — how much memory
     * this loop is allowed — rather than something to animate. It is also a
     * cap rather than a flag on purpose: "keep everything" is not offered,
     * because the honest version of that is a number somebody chose.
     */
    history: {
      type: "int",
      default: 0,
      min: 0,
      max: 100000,
      label: "History",
      description: "Keep the last N step results on the history output. 0 keeps none.",
    },
  },
} as const;

/**
 * `cascade.core.Previous` — the carried state, inside a feedback container.
 *
 * The counterpart to `cascade.core.Input`, and it resolves the same way: the
 * runtime special-cases the module id and supplies the value, because a
 * boundary node's input comes from its parent rather than from a wire. What it
 * emits is `initial` on the first step and the previous step's `Output` after
 * that.
 *
 * It also carries the step number, which is what a force needs to evolve noise
 * or ramp a strength over the run — and having it here rather than as a global
 * keeps a step-dependent node a pure function of its inputs.
 *
 * Outside a feedback container it emits its own `initial` input and a step of
 * zero. Not an error: a node dragged out of a container should show something
 * explicable rather than throw, and the alternative is a graph that cannot be
 * edited without first being valid.
 */
const previousDefinition = {
  apiVersion: 1,
  runsOn: "portable",
  label: "Previous",
  description:
    "The previous step's state, inside a Feedback container. The first step gets the container's initial value.",
  icon: "Rewind",
  inputs: {
    initial: {
      kind: "data",
      type: "any",
      default: null,
      description: "Used only outside a Feedback container.",
    },
  },
  outputs: {
    value: { kind: "data", type: "any", description: "The carried state." },
    step: { kind: "data", type: "int", description: "Zero-based step index." },
  },
  props: {},
} as const;

export const inputRegistration: DefinitionNodeRegistration<typeof inputDefinition> = {
  kind: "definition-v1",
  moduleId: "cascade.core.Input",
  definition: inputDefinition,
  loadExecute: async () => ({ inputs, outputs }) => outputs.output.set(inputs.value),
};

export const outputRegistration: DefinitionNodeRegistration<typeof outputDefinition> = {
  kind: "definition-v1",
  moduleId: "cascade.core.Output",
  definition: outputDefinition,
  loadExecute: async () => ({ inputs, outputs }) => outputs.output.set(inputs.input),
};

export const subnetRegistration: DefinitionNodeRegistration<typeof subnetDefinition> = {
  kind: "definition-v1",
  moduleId: "cascade.core.Subnet",
  definition: subnetDefinition,
  loadExecute: async () => () => {},
};

/**
 * Both of these have an empty `execute`, and that is the design rather than a
 * stub: the runtime supplies their behaviour because both are *boundaries*, and
 * a boundary's value comes from its parent's evaluation rather than from its own
 * inputs. `cascade.core.Subnet` and `cascade.core.Input` already work this way.
 *
 * Writing the loop in `Feedback.execute` instead would need the node to reach
 * the graph, its children and the scheduler — and `NodeExecutionContext` gives
 * a node its own id and nothing else, deliberately, which is what keeps a
 * definition-v1 node a pure function of its inputs.
 */
export const feedbackRegistration: DefinitionNodeRegistration<typeof feedbackDefinition> = {
  kind: "definition-v1",
  moduleId: "cascade.core.Feedback",
  definition: feedbackDefinition,
  loadExecute: async () => () => {},
};

export const previousRegistration: DefinitionNodeRegistration<typeof previousDefinition> = {
  kind: "definition-v1",
  moduleId: "cascade.core.Previous",
  definition: previousDefinition,
  loadExecute: async () => ({ inputs, outputs }) => {
    // Outside a container this is what runs. Inside, the runtime overwrites
    // both outputs before any child reads them.
    outputs.value.set(inputs.initial);
    outputs.step.set(0);
  },
};
