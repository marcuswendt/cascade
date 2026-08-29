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
    console.log('[ButtonInput] Click triggered, prop:', prop.displayName || prop.value);
    isLoading = true;
    try {
      // Trigger onChange via onValueChange
      console.log('[ButtonInput] Calling onValueChange');
      onValueChange(true);
      console.log('[ButtonInput] onValueChange called');
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
    background: rgba(74, 158, 255, 0.2);
    border: 1px solid #4a9eff;
    border-radius: 3px;
    color: #4a9eff;
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
    background: rgba(74, 158, 255, 0.3);
    border-color: #6bb6ff;
    color: #6bb6ff;
  }
  
  .button-input:active:not(:disabled) {
    background: rgba(74, 158, 255, 0.4);
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
    border: 2px solid rgba(74, 158, 255, 0.3);
    border-top-color: #4a9eff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>

