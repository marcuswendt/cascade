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

  // Reference to the number input element for manual sync
  let numberInputEl: HTMLInputElement;

  // Sync number input when prop value changes externally (e.g., from slider)
  $: if (numberInputEl && document.activeElement !== numberInputEl) {
    numberInputEl.value = String(displayValue);
  }

  function handleSliderInput(e: Event) {
    const newValue = parseFloat((e.target as HTMLInputElement).value);
    const finalValue = isInteger ? Math.round(newValue) : newValue;
    onValueChange(finalValue);
    // Immediately update the number input display
    if (numberInputEl) {
      numberInputEl.value = String(finalValue);
    }
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
      <input
        type="number"
        class="number-input"
        bind:this={numberInputEl}
        min={min}
        max={max}
        step={step}
        value={displayValue}
        disabled={disabled}
        on:input={handleNumberInput}
        on:blur={handleBlur}
      />
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
    background: rgba(255, 255, 255, 0.1);
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
    background: #4a9eff;
    border-radius: 50%;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  
  .slider:hover::-webkit-slider-thumb {
    background: #6bb6ff;
  }
  
  .slider:disabled::-webkit-slider-thumb {
    background: #666;
    cursor: not-allowed;
  }
  
  .slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    background: #4a9eff;
    border-radius: 50%;
    cursor: pointer;
    border: none;
    transition: background 0.15s ease;
  }
  
  .slider:hover::-moz-range-thumb {
    background: #6bb6ff;
  }
  
  .slider:disabled::-moz-range-thumb {
    background: #666;
    cursor: not-allowed;
  }
  
  .number-input,
  .number-input-full {
    width: 70px;
    padding: 4px 6px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: #fff;
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
    border-color: #4a9eff;
  }
  
  .number-input:disabled,
  .number-input-full:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>

