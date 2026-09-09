<script lang="ts">
  import type { Prop } from '@/types/node.types';
  import { expressionEngine } from '@/engine/expressions/index';
  import { numberFieldCommit, NUMBER_PATTERN } from './numberFieldCommit';

  export let prop: Prop;
  export let id: string;
  export let onValueChange: (value: number) => void;
  /**
   * Typing something that is not a number.
   *
   * The field used to be `type="number"` with an `isNaN` guard, so `$T * 0.25`
   * could not even be entered — the characters were refused by the input and
   * the guard would have rejected them anyway. That is the gesture Marcus
   * reaches for first, and Houdini's primary one: the value field IS the
   * expression field. So the field is text with a numeric input mode, and text
   * that does not parse as a number is handed to this callback to become an
   * expression rather than being thrown away.
   *
   * **But only if it is a valid expression.** Until 2026-09-09 anything that
   * was not a number became one, so a fat-fingered edit did real damage:
   * typing `0.4` in front of an existing `1.215` gives `0.41.215`, which
   * became an expression, which removed the slider and left the parameter in
   * `has-error` with the tooltip `Unexpected number`. The only way back was
   * the ✕ that deletes the expression. That is what Marcus meant by *"there's
   * something strange with the spin parameter — i cant change its value"*:
   * his `spin` held 1.215, he edited on top of it, and the control vanished.
   *
   * A typo is not a gesture. Text that parses as neither a number nor a valid
   * expression is now rejected with the field intact and the parameter
   * untouched — measured and diagnosed by MW-OBSERVATORY-ART from a browser
   * session.
   *
   * Optional: without it the old behaviour stands and unparseable text reverts.
   */
  export let onExpressionChange: ((expression: string) => void) | null = null;

  $: value = typeof prop.value === 'number' ? prop.value : 0;
  $: min = typeof prop.params?.min === 'number' ? prop.params.min : undefined;
  $: max = typeof prop.params?.max === 'number' ? prop.params.max : undefined;
  $: step = prop.params?.step ?? (prop.params?.integer ? 1 : 0.01);
  $: isInteger = prop.params?.integer === true || step === 1;
  $: hasSlider = min !== undefined && max !== undefined;
  $: disabled = typeof prop.disabled === 'function' ? prop.disabled() : prop.disabled;

  // Display value for number input - formatted based on integer setting
  $: displayValue = isInteger ? Math.round(value) : value;

  /** What the field is showing. Held locally because the field is now text: a
   *  half-typed "1." or "-" is a legitimate intermediate state, and rewriting
   *  it from the value on every keystroke is what makes such a field unusable. */
  let text = String(displayValue);
  let focused = false;
  // Follow the value while the field is not being typed into.
  $: if (!focused) text = String(displayValue);

  const NUMBER = NUMBER_PATTERN;

  function clamp(next: number): number {
    let clamped = next;
    if (min !== undefined && clamped < min) clamped = min;
    if (max !== undefined && clamped > max) clamped = max;
    return isInteger ? Math.round(clamped) : clamped;
  }

  function handleSliderInput(e: Event) {
    const newValue = parseFloat((e.target as HTMLInputElement).value);
    if (Number.isNaN(newValue)) return;
    onValueChange(isInteger ? Math.round(newValue) : newValue);
  }

  /** Committed live, but only while the text is a whole number — so nudging
   *  still updates as you type and `$T` does not fire a commit per character. */
  function handleTextInput(e: Event) {
    text = (e.target as HTMLInputElement).value;
    const trimmed = text.trim();
    if (NUMBER.test(trimmed)) {
      rejected = null;
      lastCommitted = trimmed;
      onValueChange(clamp(Number(trimmed)));
    }
  }

  /**
   * What was last sent upward, so the same edit is not committed twice.
   *
   * Enter calls `commit` and then blurs the field, and blur calls `commit`
   * again — so every typed parameter change cooked the graph **twice**.
   * Measured on `cloud-volumes`: the first cook was aborted about 82 ms in,
   * *after* it had already encoded and PUT a 1.55 MB PNG, so a keyboard edit
   * cost an extra 82 ms and a wasted 1.55 MB upload every time. Frame-stepping
   * cooked once, which is what pointed at the field rather than the scheduler.
   */
  let lastCommitted: string | null = null;

  /** Why the last commit was refused, shown on the field itself. Reverting
   *  silently is the other half of the trap: the value snaps back and nothing
   *  says the text was not an expression. */
  let rejected: string | null = null;

  /** Enter or blur. The decision itself is in `numberFieldCommit`, which is
   *  where it can be tested; this only carries it out. */
  function commit(): void {
    const outcome = numberFieldCommit(text, {
      lastCommitted,
      allowExpression: Boolean(onExpressionChange),
      expressionError,
    });

    switch (outcome.kind) {
      case 'unchanged':
        return;
      case 'value':
        rejected = null;
        lastCommitted = outcome.text;
        onValueChange(clamp(outcome.value));
        return;
      case 'expression':
        rejected = null;
        lastCommitted = outcome.text;
        onExpressionChange?.(outcome.expression);
        return;
      case 'rejected':
        // The parameter keeps its value and its control; only the field
        // reverts, and it carries the reason so the revert is not silent.
        rejected = outcome.reason;
        text = String(displayValue);
        return;
      case 'revert':
        rejected = null;
        text = String(displayValue);
        return;
    }
  }

  /**
   * Whether this text would compile, without evaluating it.
   *
   * `compile()` already returns `{ error }` for a syntax fault and caches by
   * source, so this is the check the engine could always answer and nothing
   * asked. Deliberately syntax only: an expression referring to a node that
   * does not exist yet is a legitimate thing to type, and rejecting it here
   * would make the field refuse valid work.
   */
  function expressionError(expression: string): string | null {
    try {
      return expressionEngine.compile(expression).error ?? null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /** Arrow keys still nudge. They came free with `type="number"` and would
   *  have been lost with it — a field that gains expressions and loses nudging
   *  is a bad trade. Shift for ten steps, as everywhere else. */
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const trimmed = text.trim();
      if (trimmed && !NUMBER.test(trimmed)) return;
      e.preventDefault();
      const base = NUMBER.test(trimmed) ? Number(trimmed) : value;
      const amount = (typeof step === 'number' ? step : 1) * (e.shiftKey ? 10 : 1);
      const next = clamp(base + (e.key === 'ArrowUp' ? amount : -amount));
      // Floating-point step arithmetic prints 0.30000000000000004 otherwise.
      const rounded = isInteger ? next : Number(next.toFixed(6));
      text = String(rounded);
      rejected = null;
      lastCommitted = text;
      onValueChange(rounded);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      text = String(displayValue);
      rejected = null;
      (e.target as HTMLInputElement).blur();
    }
  }

  function handleFocus() {
    focused = true;
    // A fresh edit is not the previous one, so the guard must not suppress
    // retyping the same value after it has been changed elsewhere.
    lastCommitted = null;
  }

  function handleBlur() {
    focused = false;
    commit();
  }
</script>

<div class="number-input-container">
  {#if hasSlider}
    <div class="slider-wrapper">
      <input
        type="range"
        id={id}
        class="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        on:input={handleSliderInput}
      />
      <input
        type="text"
        inputmode="decimal"
        spellcheck="false"
        autocomplete="off"
        class="number-input"
        class:rejected={rejected !== null}
        title={rejected ?? undefined}
        value={text}
        disabled={disabled}
        on:input={handleTextInput}
        on:keydown={handleKeydown}
        on:focus={handleFocus}
        on:blur={handleBlur}
      />
    </div>
  {:else}
    <input
      type="text"
      inputmode="decimal"
      spellcheck="false"
      autocomplete="off"
      id={id}
      class="number-input-full"
      class:rejected={rejected !== null}
      title={rejected ?? undefined}
      value={text}
      disabled={disabled}
      on:input={handleTextInput}
      on:keydown={handleKeydown}
      on:focus={handleFocus}
      on:blur={handleBlur}
    />
  {/if}
</div>

<style>
  /* The field snapped back and said nothing, which is the other half of the
     trap: a silent revert reads as the field being broken rather than as the
     text being refused. The reason is on the title so it is readable without
     a panel to put it in. */
  .rejected {
    border-color: var(--status-error) !important;
  }

  .number-input-container {
    width: 100%;
  }
  
  .slider-wrapper {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  
  .slider {
    flex: 1;
    height: 4px;
    background: var(--tint);
    border-radius: 2px;
    outline: none;
    -webkit-appearance: none;
    appearance: none;
    cursor: pointer;
  }
  
  .slider:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    background: var(--accent);
    border-radius: 50%;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  
  .slider:hover::-webkit-slider-thumb {
    background: var(--accent-hover);
  }
  
  .slider:disabled::-webkit-slider-thumb {
    background: var(--surface-muted);
    cursor: not-allowed;
  }
  
  .slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    background: var(--accent);
    border-radius: 50%;
    cursor: pointer;
    border: none;
    transition: background 0.15s ease;
  }
  
  .slider:hover::-moz-range-thumb {
    background: var(--accent-hover);
  }
  
  .slider:disabled::-moz-range-thumb {
    background: var(--surface-muted);
    cursor: not-allowed;
  }
  
  .number-input,
  .number-input-full {
    width: 70px;
    padding: 4px 6px;
    background: var(--shade-weak);
    border: 1px solid var(--tint);
    border-radius: 3px;
    color: var(--text-bright);
    font-size: 12px;
    font-family: 'Monaco', 'Menlo', monospace;
    text-align: right;
  }
  
  .number-input-full {
    width: 100%;
  }
  
  .number-input:focus,
  .number-input-full:focus {
    outline: none;
    border-color: var(--accent);
  }
  
  .number-input:disabled,
  .number-input-full:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>

