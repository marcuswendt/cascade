<script lang="ts">
  import type { Prop } from '@/types/node.types';
  import { onMount, tick } from 'svelte';
  import { scrub, type ScrubOptions } from './scrub';
  import { evaluateArithmetic, nudgeValue } from './fieldMaths';
  import { NUMBER_PATTERN } from './numberFieldCommit';
  import ScrubField from './ScrubField.svelte';

  export let prop: Prop;
  export let id: string;
  export let onValueChange: (value: number[]) => void;
  
  // Use reactive statement to always sync with prop.value
  // Watch the prop object itself, not just prop.value, to detect when prop reference changes
  let value: number[] = Array.isArray(prop.value) ? [...prop.value] : [0, 0, 0];
  $: {
    // Watch prop object reference AND prop.value to catch both cases
    const propValue = prop.value;
    const newValue = Array.isArray(propValue) ? [...propValue] : [0, 0, 0];
    const currentStr = JSON.stringify(value);
    const newStr = JSON.stringify(newValue);
    if (currentStr !== newStr) {
      value = newValue;
    }
  }
  
  // Force update of input elements when value changes
  let inputElements: (HTMLInputElement | undefined)[] = [];
  
  // Update input values directly when value changes externally
  $: if (value) {
    tick().then(() => {
      value.forEach((val, i) => {
        if (inputElements[i]) {
          const inputValue = isInteger ? Math.round(val) : val;
          const currentValue = inputElements[i]!.value;
          if (currentValue !== String(inputValue) && !isNaN(inputValue)) {
            inputElements[i]!.value = String(inputValue);
          }
        }
      });
    });
  }
  
  $: componentCount = value.length;
  $: labels = componentCount === 2 ? ['X', 'Y'] : ['X', 'Y', 'Z'];
  $: min = typeof prop.params?.min === 'number' ? prop.params.min : (Array.isArray(prop.params?.min) ? prop.params.min : undefined);
  $: max = typeof prop.params?.max === 'number' ? prop.params.max : (Array.isArray(prop.params?.max) ? prop.params.max : undefined);
  $: step = prop.params?.step ?? (prop.params?.integer ? 1 : 0.01);
  $: isInteger = prop.params?.integer === true || step === 1;
  $: disabled = typeof prop.disabled === 'function' ? prop.disabled() : prop.disabled;
  
  // Lock state - defaults to prop.params.locked but can be toggled locally
  let locked = prop.params?.locked ?? false;
  
  // Update locked state when prop changes
  $: if (prop.params?.locked !== undefined) {
    locked = prop.params.locked;
  }
  
  // Preset dropdown state
  let showPresets = false;
  let presetButton: HTMLButtonElement;
  let presetDropdown: HTMLDivElement;
  
  // Resolution presets
  const presets = [
    { label: '256 × 256', value: [256, 256] },
    { label: '512 × 512', value: [512, 512] },
    { label: '1024 × 1024', value: [1024, 1024] },
    { label: '2048 × 2048', value: [2048, 2048] },
    { label: '640 × 480', value: [640, 480] },
    { label: '1280 × 720', value: [1280, 720] },
    { label: '1920 × 1080', value: [1920, 1080] },
    { label: '3840 × 2160', value: [3840, 2160] }
  ];
  
  function selectPreset(preset: number[]) {
    if (componentCount === 2) {
      onValueChange([preset[0], preset[1]]);
    } else if (componentCount === 3) {
      onValueChange([preset[0], preset[1], value[2]]);
    }
    showPresets = false;
  }
  
  function handleClickOutside(e: MouseEvent) {
    if (presetDropdown && !presetDropdown.contains(e.target as Node) && 
        presetButton && !presetButton.contains(e.target as Node)) {
      showPresets = false;
    }
  }
  
  function updateComponent(index: number, newValue: number) {
    const newArray = [...value];
    
    if (isInteger) {
      newValue = Math.round(newValue);
    }
    
    // Only enforce min/max if they're defined and within slider bounds
    // Allow values outside slider bounds when manually entered
    if (min !== undefined) {
      const minVal = Array.isArray(min) ? min[index] : min;
      if (minVal !== undefined && newValue < minVal) newValue = minVal;
    }
    if (max !== undefined) {
      const maxVal = Array.isArray(max) ? max[index] : max;
      if (maxVal !== undefined && newValue > maxVal) newValue = maxVal;
    }
    
    if (locked) {
      // If locked, update all components to the same value
      newArray.fill(newValue);
    } else {
      newArray[index] = newValue;
    }
    
    onValueChange(newArray);
    return newValue;
  }
  
  const limit = (bound: number | number[] | undefined, index: number) => (Array.isArray(bound) ? bound[index] : bound);

  /** Writes one component and the local array, because the next frame of a
   *  drag (or the next step) builds on it. */
  function withComponent(index: number, next: number): number[] {
    const updated = [...value];
    if (locked) updated.fill(next); else updated[index] = next;
    return updated;
  }

  function setComponent(index: number, typed: number) {
    value = withComponent(index, updateComponent(index, typed));
  }

  /** Each component is a scrub number: drag anywhere on it, click to type,
   *  middle-drag and Alt-drag as before. */
  function componentScrub(index: number): ScrubOptions {
    return {
      field: true,
      getValue: () => Number(value[index] ?? 0),
      setValue: (next: number) => setComponent(index, next),
      meta: () => ({
        min: limit(min, index),
        max: limit(max, index),
        step: typeof prop.params?.step === 'number' ? prop.params.step : undefined,
        integer: isInteger,
      }),
      disabled: () => Boolean(disabled),
    };
  }

  function nudgeComponent(index: number, direction: number, coarse: boolean) {
    const meta = { min: limit(min, index), max: limit(max, index), integer: isInteger };
    setComponent(index, nudgeValue(Number(value[index] ?? 0), direction, typeof step === 'number' ? step : 1, meta, coarse));
  }

  /** What typing last sent live, so blur does not send it a second time. */
  let typedLive: (number | undefined)[] = [];

  /** Live while the text is a whole number, as before. */
  function handleNumberInput(e: Event, index: number) {
    const text = (e.target as HTMLInputElement).value.trim();
    if (NUMBER_PATTERN.test(text)) typedLive[index] = updateComponent(index, Number(text));
  }

  /** Enter or blur: `320/2` and `10+5` work out; anything else reverts. */
  function commitText(input: HTMLInputElement, index: number) {
    const text = input.value.trim();
    const live = typedLive[index];
    typedLive[index] = undefined;
    if (NUMBER_PATTERN.test(text)) {
      // Already sent while typing; only the local copy is behind.
      if (live !== undefined) value = withComponent(index, live);
    } else {
      const worked = evaluateArithmetic(text);
      if (worked !== null) setComponent(index, worked);
    }
    const shown = value[index];
    input.value = String(isInteger ? Math.round(shown) : shown);
  }

  function handleKeydown(e: KeyboardEvent, index: number) {
    const input = e.target as HTMLInputElement;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      nudgeComponent(index, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
      input.value = String(value[index]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      input.value = String(value[index]);
      input.blur();
    }
  }
  
  onMount(() => {
    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  });
</script>

<div class="vector-input-container">
  <div class="vector-row">
    {#each Array(componentCount) as _, i}
      {@const inputValue = value[i] !== undefined ? (isInteger ? Math.round(value[i]) : value[i]) : 0}
      {@const low = limit(min, i)}
      {@const high = limit(max, i)}
      <ScrubField
        grow
        atMin={low !== undefined && inputValue <= low}
        atMax={high !== undefined && inputValue >= high}
        {disabled}
        onStep={(direction, e) => nudgeComponent(i, direction, e.shiftKey)}
      >
        <input
          type="text"
          inputmode="decimal"
          spellcheck="false"
          autocomplete="off"
          id="{id}-{i}"
          class="number-input"
          bind:this={inputElements[i]}
          value={inputValue}
          disabled={disabled}
          use:scrub={componentScrub(i)}
          on:input={(e) => handleNumberInput(e, i)}
          on:keydown={(e) => handleKeydown(e, i)}
          on:blur={(e) => commitText(e.currentTarget, i)}
        />
      </ScrubField>
    {/each}
    {#if componentCount === 2}
      <div class="preset-container">
        <button
          bind:this={presetButton}
          class="preset-button"
          title="Resolution presets"
          disabled={disabled}
          on:click|stopPropagation={(e) => {
            e.stopPropagation();
            showPresets = !showPresets;
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 3h8M2 6h8M2 9h8"/>
          </svg>
        </button>
        {#if showPresets}
          <div class="preset-dropdown" bind:this={presetDropdown} role="menu" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
            {#each presets as preset}
              <button
                class="preset-option"
                on:click|stopPropagation={() => selectPreset(preset.value)}
              >
                {preset.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    {#if componentCount > 1}
      <button
        class="lock-button"
        class:locked={locked}
        title={locked ? 'Unlock components' : 'Lock components'}
        disabled={disabled}
        on:click={(e) => {
          e.stopPropagation();
          locked = !locked;
          // Update prop.params.locked if it exists
          if (prop.params) {
            prop.params.locked = locked;
          }
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
          {#if locked}
            <path d="M3 5.5 V4 a3 3 0 0 1 6 0 v1.5 M6 8.5 v2 M2.5 5.5 h7 a1 1 0 0 1 1 1 v4 a1 1 0 0 1 -1 1 h-7 a1 1 0 0 1 -1 -1 v-4 a1 1 0 0 1 1 -1 z"/>
          {:else}
            <path d="M3 5.5 V4 a3 3 0 0 1 6 0 v1.5 M6 8.5 v2 M2.5 5.5 h7 a1 1 0 0 1 1 1 v4 a1 1 0 0 1 -1 1 h-7 a1 1 0 0 1 -1 -1 v-4 a1 1 0 0 1 1 -1 z" stroke-dasharray="2 2"/>
          {/if}
        </svg>
      </button>
    {/if}
  </div>
</div>

<style>
  .vector-input-container {
    width: 100%;
  }
  
  .vector-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
  }
  
  .number-input {
    flex: 1;
    min-width: 0;
    padding: 3px 4px;
    background: var(--shade-weak);
    border: 1px solid var(--tint);
    border-radius: 3px;
    color: var(--text-bright);
    font-size: 11px;
    font-family: 'Monaco', 'Menlo', monospace;
    text-align: right;
    box-sizing: border-box;
  }
  
  .number-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .lock-button,
  .preset-button {
    padding: 4px;
    background: transparent;
    border: 1px solid var(--tint);
    border-radius: 3px;
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .lock-button:hover:not(:disabled),
  .preset-button:hover:not(:disabled) {
    background: var(--tint-weak);
    border-color: var(--tint-strong);
    color: var(--text-bright);
  }

  .lock-button.locked {
    background: var(--accent-tint-medium);
    border-color: var(--accent);
    color: var(--accent);
  }

  .number-input:disabled,
  .lock-button:disabled,
  .preset-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .preset-container {
    position: relative;
    flex-shrink: 0;
  }
  
  .preset-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 1000;
    background: var(--surface-popover);
    border: 1px solid var(--tint);
    border-radius: 4px;
    box-shadow: 0 4px 12px var(--shadow);
    min-width: 140px;
    padding: 4px;
    display: flex;
    flex-direction: column;
  }
  
  .preset-option {
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-radius: 3px;
    color: var(--text-muted);
    font-size: 11px;
    text-align: left;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .preset-option:hover {
    background: var(--tint-weak);
    color: var(--text-bright);
  }
  
  .preset-option:active {
    background: var(--accent-tint-medium);
    color: var(--accent);
  }
</style>
