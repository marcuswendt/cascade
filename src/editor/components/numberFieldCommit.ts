/**
 * What a number field does with the text in it.
 *
 * Extracted from `NumberInput.svelte` on 2026-09-09 because both faults it
 * fixes were invisible to every test in the repo — there is no harness that
 * mounts a component, and the decision is logic rather than markup, so putting
 * it behind a DOM would only have made it harder to check.
 *
 * The two faults, measured by MW-OBSERVATORY-ART in a browser session:
 *
 *   - **A typo became an expression.** Anything that was not a number was
 *     committed as one, so typing `0.4` in front of an existing `1.215` gave
 *     `0.41.215`, which became an expression, which removed the slider and left
 *     the parameter in `has-error`. That is what Marcus meant by *"there's
 *     something strange with the spin parameter — i cant change its value"*.
 *   - **Every commit happened twice.** Enter committed and then blurred, and
 *     blur committed again, so a typed parameter change cooked the graph twice.
 *     The first cook was abandoned about 82 ms in, after it had already encoded
 *     and uploaded a 1.55 MB PNG.
 */

/** A COMPLETE number. `parseFloat` accepts "1.2abc" and "1." and would commit
 *  halfway through typing an expression; this does not. */
export const NUMBER_PATTERN = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

export type NumberFieldCommit =
  /** Send this number upward. */
  | { readonly kind: "value"; readonly text: string; readonly value: number }
  /** Send this expression upward. */
  | { readonly kind: "expression"; readonly text: string; readonly expression: string }
  /** Refuse it: the parameter keeps its value AND its control, and the field
   *  says why. */
  | { readonly kind: "rejected"; readonly reason: string }
  /** Empty, or unparseable with no expression support. Put the value back. */
  | { readonly kind: "revert" }
  /** Already sent. The guard that stops one edit cooking twice. */
  | { readonly kind: "unchanged" };

export interface NumberFieldContext {
  /** The text of the last commit that went upward, or null after a fresh focus.
   *  Compared as text rather than as a number so that `1.20` following `1.2`
   *  is still recognised as the same commit. */
  readonly lastCommitted: string | null;
  /** Whether this field may hold an expression at all. */
  readonly allowExpression: boolean;
  /** A syntax error for this expression, or null if it compiles. Injected
   *  rather than imported so this stays free of the engine — and so a test can
   *  state the parse result instead of depending on the parser. */
  readonly expressionError: (expression: string) => string | null;
}

export function numberFieldCommit(
  text: string,
  context: NumberFieldContext,
): NumberFieldCommit {
  const trimmed = text.trim();

  // Before anything else: the same text going up twice is the double cook.
  if (trimmed === context.lastCommitted) return { kind: "unchanged" };

  if (NUMBER_PATTERN.test(trimmed)) {
    return { kind: "value", text: trimmed, value: Number(trimmed) };
  }

  if (trimmed && context.allowExpression) {
    const reason = context.expressionError(trimmed);
    // A typo is not a gesture. An expression is a deliberate act, and a parse
    // failure is evidence that this was not one.
    return reason
      ? { kind: "rejected", reason }
      : { kind: "expression", text: trimmed, expression: trimmed };
  }

  return { kind: "revert" };
}
