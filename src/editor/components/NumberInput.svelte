<script lang="ts">
  import type { Prop } from '@/types/node.types';

  export let prop: Prop;
  export let id: string;
  export let onValueChange: (value: number) => void;

  $: value = typeof prop.value === 'number' ? prop.value : 0;
  $: min = typeof prop.params?.min === 'number' ? prop.params.min : undefined;
  $: max = typeof prop.params?.max === 'number' ? prop.params.max : undefined;
  $: step = prop.params?.step ?? (prop.params?.integer ? 1 : 0.01);
  $: isInteger = prop.params?.integer === true || step === 1;
  $: hasSlider = min !== undefined && max !== undefined;
  $: disabled = typeof prop.disabled === 'function' ? prop.disabled() : prop.disabled;

  // Display value for number input - formatted based on integer setting
  $: displayValue = isInteger ? Math.round(value) : value;

  function handleSliderInput(e: Event) {
    const newValue = parseFloat((e.target as HTMLInputElement).value);
    const finalValue = isInteger ? Math.round(newValue) : newValue;
    onValueChange(finalValue);
  }

  function handleNumberInput(e: Event) {
    const input = e.target as HTMLInputElement;
    let newValue = parseFloat(input.value);

    if (isNaN(newValue)) {
      input.value = String(value);
      return;
    }

    if (min !== undefined && newValue < min) newValue = min;
    if (max !== undefined && newValue > max) newValue = max;

    onValueChange(isInteger ? Math.round(newValue) : newValue);
  }

  function handleBlur(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.value === '' || isNaN(parseFloat(input.value))) {
      input.value = String(value);
    }
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
      {#key displayValue}
        <input
          type="number"
          class="number-input"
          min={min}
          max={max}
          step={step}
          value={displayValue}
          disabled={disabled}
          on:input={handleNumberInput}
          on:blur={handleBlur}
        />
      {/key}
    </div>
  {:else}
    <input
      type="number"
      id={id}
      class="number-input-full"
      min={min}
      max={max}
      step={step}
      value={displayValue}
      disabled={disabled}
      on:input={handleNumberInput}
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

