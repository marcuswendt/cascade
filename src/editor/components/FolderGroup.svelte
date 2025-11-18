<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  
  export let folderName: string;
  export let isExpanded: boolean = true;
  
  const dispatch = createEventDispatcher();
  
  function handleToggle() {
    dispatch('toggle');
  }
</script>

<div class="folder-group">
  <button class="folder-header" on:click={handleToggle}>
    <svg
      class="folder-icon"
      class:expanded={isExpanded}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
    >
      <path d="M2 3L5 1L8 3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span class="folder-name">{folderName}</span>
  </button>
  {#if isExpanded}
    <div class="folder-content">
      <slot />
    </div>
  {/if}
</div>

<style>
  .folder-group {
    margin-bottom: 8px;
  }
  
  .folder-header {
    width: 100%;
    padding: 6px 8px;
    background: transparent;
    border: none;
    color: #888;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: color 0.15s ease;
    text-align: left;
  }
  
  .folder-header:hover {
    color: #aaa;
  }
  
  .folder-icon {
    flex-shrink: 0;
    transition: transform 0.15s ease;
    color: #666;
  }
  
  .folder-icon.expanded {
    transform: rotate(90deg);
  }
  
  .folder-name {
    flex: 1;
  }
  
  .folder-content {
    padding-left: 16px;
    margin-top: 4px;
  }
</style>

