<script lang="ts">
  import type { Prop } from '@/types/node.types';

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

  /** A COMPLETE number. `parseFloat` accepts "1.2abc" and "1." and would
   *  commit halfway through typing an expression; this does not. */
  const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

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
    if (NUMBER.test(trimmed)) onValueChange(clamp(Number(trimmed)));
  }

  /** Enter or blur: a number commits, anything else becomes an expression. */
  function commit(): void {
    const trimmed = text.trim();
    if (NUMBER.test(trimmed)) {
      onValueChange(clamp(Number(trimmed)));
      return;
    }
    if (trimmed && onExpressionChange) {
      onExpressionChange(trimmed);
      return;
    }
    text = String(displayValue);
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
      onValueChange(rounded);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      text = String(displayValue);
      (e.target as HTMLInputElement).blur();
    }
  }

  function handleFocus() {
    focused = true;
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

