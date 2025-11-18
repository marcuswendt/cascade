<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from './Icon.svelte';
  
  export let title: string;
  export let icon: string | null = null;
  export let minimized: boolean = false;
  export let windowId: string;
  export let showTabs: boolean = false;
  
  const dispatch = createEventDispatcher();
  
  function handleMinimize() {
    dispatch('minimize', { windowId });
  }
  
  function handleRestore() {
    dispatch('restore', { windowId });
  }
  
  function handleDragOver(e: DragEvent) {
    dispatch('dragover', { event: e });
  }
  
  function handleDrop(e: DragEvent) {
    dispatch('drop', { event: e });
  }
</script>

<div 
  class="window" 
  class:minimized 
  data-window-id={windowId}
  on:dragover|stopPropagation={handleDragOver}
  on:drop|stopPropagation={handleDrop}
>
  <div class="title-bar">
    {#if showTabs}
      <div class="tabs-slot">
        <slot name="tabs" />
      </div>
    {:else}
      <span class="title">
        {#if icon}
          <span class="title-icon">
            <Icon name={icon} size={14} />
          </span>
        {/if}
        {title}
      </span>
    {/if}
    <div class="title-actions">
      <slot name="actions" />
      {#if minimized}
        <button 
          class="icon-button" 
          title="Restore"
          aria-label="Restore window"
          on:click={handleRestore}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 6H10M6 2V10" stroke-linecap="round"/>
          </svg>
        </button>
      {:else}
        <button 
          class="icon-button" 
          title="Minimize"
          aria-label="Minimize window"
          on:click={handleMinimize}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M2 6H10" stroke-linecap="round"/>
          </svg>
        </button>
      {/if}
    </div>
  </div>
  {#if !minimized}
    <div class="content">
      <slot />
    </div>
  {/if}
</div>

<style>
  .window {
    display: flex;
    flex-direction: column;
    background: rgba(20, 20, 20, 0.95);
    border: none;
    overflow: hidden;
    transition: height 0.2s ease;
  }
  
  .window.minimized {
    height: 32px;
  }
  
  .title-bar {
    height: 32px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(10, 10, 10, 0.8);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    flex-shrink: 0;
    gap: 12px;
  }
  
  .title {
    font-size: 12px;
    font-weight: 600;
    color: #fff;
    user-select: none;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  
  .title-icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }
  
  .tabs-slot {
    flex: 1;
    display: flex;
    align-items: center;
    overflow: hidden;
  }
  
  .title-actions {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  
  .icon-button {
    width: 20px;
    height: 20px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 3px;
    color: #aaa;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }
  
  .icon-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
  
  .content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
</style>

