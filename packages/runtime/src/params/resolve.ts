/**
 * The one place a parameter becomes a value.
 *
 * Three bindings, in one order: a keyframe channel, an expression, the stored
 * value. That order was implemented once, in Studio's `Node.evalParm`, which
 * meant the deterministic runtime had no answer at all — a definition-v1 prop
 * carrying `$T` or a drawn curve rendered as a static number offline. Copying
 * `evalParm` into the runtime would have produced a second answer to the same
 * question, which is exactly the two-parameter-stores mistake this codebase
 * has already paid for once. So the order moved here, into the neutral
 * runtime, and both hosts call it.
 *
 * What it deliberately does NOT own: the expression *engine*. Evaluation is
 * passed in as a callback, because each host has its own scope (Studio's
 * `ExpressionEngine` reaches into the compatibility graph; the runtime binds
 * its own node map) and its own error bookkeeping (Studio stores the message
 * on the prop for the Inspector to show). Keeping evaluation out is also what
 * keeps this module dependent on nothing but the channel sampler — no cycle
 * between `animation` and `expressions`, and no clock anywhere: the frame is a
 * value the caller hands in, which is what keeps a cook deterministic.
 */

import { isEmptyChannel, sampleChannel } from "../animation/channel.js";
import type { Channel } from "../animation/channel.js";

/**
 * A parameter and everything bound to it. Structurally what Studio's `Prop`
 * already is, and what `CascadeSerializedProp` deserialises to, so neither
 * host has to build an adapter object to ask this question.
 */
export interface PropBinding {
  /** The stored value — what the author typed, and what the file records. */
  readonly value: unknown;
  readonly expression?: string | undefined;
  readonly channel?: Channel | null | undefined;
}

/** Which of the three bindings actually produced the value. */
export type PropBindingSource = "channel" | "expression" | "value";

export interface ResolvedProp {
  readonly value: unknown;
  readonly source: PropBindingSource;
  /** An expression that failed. The value has fallen back to the stored one. */
  readonly error?: string;
}

export interface PropResolutionContext {
  /** Fractional frame — a channel is sampled at it, and it is what the host's
   *  expression engine should already be set to. */
  readonly frame: number;
  /**
   * Evaluate one expression. Omitted by a caller with no engine (a static
   * inspection), in which case an expression is skipped rather than guessed
   * at and the stored value stands.
   */
  readonly evaluateExpression?: (
    expression: string,
  ) => { value: unknown; error?: string } | undefined;
}

/** True when a parameter carries something beyond its stored value, and so has
 *  to be resolved per frame rather than read once. */
export function isBoundProp(binding: PropBinding | null | undefined): boolean {
  if (!binding) return false;
  return !!binding.expression || !isEmptyChannel(binding.channel);
}

/**
 * Resolve a parameter at a frame.
 *
 * A parameter may carry both a channel and an expression, and the channel
 * wins. The expression is kept, inert, and comes back when the channel is
 * deleted: silently discarding what an author wrote is the worse of the two
 * failures. `contracts/animation.ts` states the same rule for the document, so
 * the file format and the resolver agree by construction.
 *
 * An empty channel resolves to nothing rather than to zero, so a parameter
 * whose last key was deleted falls through to its expression or its value
 * instead of snapping to the origin.
 */
export function resolvePropBinding(
  binding: PropBinding,
  context: PropResolutionContext,
): ResolvedProp {
  if (!isEmptyChannel(binding.channel)) {
    const sampled = sampleChannel(binding.channel, context.frame);
    if (sampled !== undefined) return { value: sampled, source: "channel" };
  }

  if (binding.expression && context.evaluateExpression) {
    const result = context.evaluateExpression(binding.expression);
    // A failed expression falls back to the stored value and reports why. The
    // alternative — a hole in the middle of a render — is the one outcome
    // nobody can act on.
    if (result?.error) {
      return { value: binding.value, source: "value", error: result.error };
    }
    if (result) return { value: result.value, source: "expression" };
  }

  return { value: binding.value, source: "value" };
}
