<script lang="ts">
  import type { Prop } from '@/types/node.types';
  import Icon from '../Icon.svelte';

  export let prop: Prop;
  export let id: string;
  export let onValueChange: (value: any) => void;

  let isLoading = false;

  $: disabled = typeof prop.disabled === 'function' ? prop.disabled() : prop.disabled;
  // Use prop.value as label if it's a string, otherwise use displayName
  $: label = typeof prop.value === 'string' ? prop.value : (prop.displayName || 'Execute');
  $: small = prop.params?.small ?? false;
  $: icon = prop.params?.icon as string | undefined;
  $: tooltip = prop.params?.tooltip as string | undefined;

  async function handleClick() {
    isLoading = true;
    try {
      onValueChange(true);
    } catch (error) {
      console.error('[ButtonInput] Error:', error);
    } finally {
      isLoading = false;
    }
  }
</script>

<button
  id={id}
  class="button-input"
  class:small
  class:icon-only={icon && !label}
  disabled={disabled || isLoading}
  on:click={handleClick}
  title={tooltip}
>
  {#if isLoading}
    <span class="loading-spinner"></span>
  {:else if icon}
    <Icon name={icon} size={small ? 14 : 16} />
    {#if label && !prop.params?.iconOnly}
      <span>{label}</span>
    {/if}
  {:else}
    <span>{label}</span>
  {/if}
</button>

<style>
  .button-input {
    width: 100%;
    padding: 8px 12px;
    background: var(--accent-tint-medium);
    border: 1px solid var(--accent);
    border-radius: 3px;
    color: var(--accent);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: all 0.15s ease;
  }
  
  .button-input:hover:not(:disabled) {
    background: var(--accent-tint-strong);
    border-color: var(--accent-hover);
    color: var(--accent-hover);
  }
  
  .button-input:active:not(:disabled) {
    background: var(--accent-tint-stronger);
  }
  
  .button-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .button-input.small {
    padding: 5px 10px;
    font-size: 11px;
  }

  .button-input.icon-only {
    padding: 6px 12px;
  }

  .loading-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--accent-tint-strong);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
