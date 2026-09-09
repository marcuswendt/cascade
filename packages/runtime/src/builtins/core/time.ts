import type { NodeDefinition, NodeExecutionContext } from "@cascade/contracts";

import type { DefinitionNodeRegistration } from "../../types.js";

/**
 * `cascade.core.Time` — the clock, as a value the graph can carry.
 *
 * Built 2026-09-09, from Marcus scrubbing the timeline on `particle-type` and
 * seeing nothing move: *"when i jump to a different time on the timeline i dont
 * actually see the pop simulation animating in the viewer."*
 *
 * The cause was not the viewer. `cascade.pop.Simulate` takes the frame on an
 * **input**, its own comment says *"drive it with `$F`"*, and **that was not
 * possible**: expressions attach to props, and an input port has no expression
 * field. So the sketch had a constant in there and no graph in the system could
 * read the clock through a port at all.
 *
 * ## Why a node rather than an expression on the input
 *
 * Making inputs expression-bearing is the other fix, and it is the wrong one.
 * An input is a *wire*, and a wire that is sometimes a formula means every
 * consumer of every input has two ways to get a value — which is the shape that
 * made props themselves complicated (a value, an expression, a channel, and a
 * resolution order between them). Doing it again on the input side doubles that
 * surface for one use.
 *
 * The node is also the more honest picture. Time is an input to the graph in
 * the same way a camera is, and a graph that shows where the clock enters can
 * be read; one where any of two hundred ports might secretly be `$F` cannot.
 *
 * ## Why the props carry the expressions
 *
 * `frame` and `time` are props with declared default expressions — `$F` and
 * `$T` — which is the one mechanism that already reads the clock and updates a
 * node's time dependency. Nothing here calls a clock: the node is a pure
 * function of its props, and the props are where the binding lives. That keeps
 * `execute` deterministic and testable, which a node reading a global clock
 * would not be.
 *
 * They are props rather than fixed values so you can override one: pinning
 * `frame` to a constant is exactly what a still render wants, and it is a
 * one-field edit rather than a rewire.
 */
export const timeDefinition = {
  apiVersion: 1,
  label: "Time",
  description: "The current frame and time, as values the graph can read.",
  icon: "Clock",
  runsOn: "portable",
  inputs: {},
  outputs: {
    /**
     * The whole frame, as an integer — Houdini's `$F`.
     *
     * An `int` rather than a `float`, and that is the point of having two
     * outputs. Anything that **counts** frames needs an integer: a feedback
     * container's step count, a sequence index, a modulo. Narrowing is never
     * implicit in Cascade, so a float frame simply could not be wired to a step
     * count, and the alternative — truncating silently somewhere downstream —
     * is a simulation running 3 steps when the graph said 3.7.
     */
    frame: {
      kind: "data",
      type: "int",
      description: "The whole frame. Houdini's $F.",
    },
    /** The fractional frame — Houdini's `$FF`. For anything that moves. */
    fframe: {
      kind: "data",
      type: "float",
      description: "The fractional frame, for sub-frame motion. Houdini's $FF.",
    },
    time: {
      kind: "data",
      type: "float",
      description: "The playhead in seconds.",
    },
  },
  props: {
    frame: {
      type: "int",
      default: 1,
      expression: "$F",
      label: "Frame",
      description:
        "Bound to $F. Replace with a number to pin a still, or with any expression.",
    },
    fframe: {
      type: "float",
      default: 1,
      expression: "$FF",
      label: "Fractional Frame",
      description: "Bound to $FF.",
    },
    time: {
      type: "float",
      default: 0,
      expression: "$T",
      label: "Time",
      description: "Bound to $T, in seconds.",
    },
  },
} as const satisfies NodeDefinition;

export function executeTime(
  context: NodeExecutionContext<typeof timeDefinition>,
): void {
  context.outputs.frame.set(context.props.frame);
  context.outputs.fframe.set(context.props.fframe);
  context.outputs.time.set(context.props.time);
}

export const timeRegistration = {
  kind: "definition-v1",
  moduleId: "cascade.core.Time",
  definition: timeDefinition,
  loadExecute: async () => executeTime,
} satisfies DefinitionNodeRegistration<typeof timeDefinition>;
