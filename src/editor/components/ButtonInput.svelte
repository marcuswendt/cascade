<script lang="ts">
  import type { Prop } from '@/types/node.types';
  
  export let prop: Prop;
  export let id: string;
  export let onValueChange: (value: any) => void;
  
  let isLoading = false;
  
  $: disabled = typeof prop.disabled === 'function' ? prop.disabled() : prop.disabled;
  $: label = prop.displayName || 'Execute';
  
  async function handleClick() {
    if (typeof prop.value === 'function') {
      isLoading = true;
      try {
        await prop.value();
      } catch (error) {
        console.error('Button action error:', error);
      } finally {
        isLoading = false;
      }
    }
  }
</script>

<button
  id={id}
  class="button-input"
  disabled={disabled || isLoading}
  on:click={handleClick}
>
  {#if isLoading}
    <span class="loading-spinner"></span>
  {/if}
  <span>{label}</span>
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

