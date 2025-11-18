<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Node } from '@/core/Node';
  
  interface Tab {
    id: string;
    type: 'graph' | 'editor' | 'viewer' | 'log' | 'inspector';
    label: string;
    windowId: string;
    node?: Node;
  }
  
  export let tabs: Tab[] = [];
  export let activeTabId: string | null = null;
  export let windowId: string = '';
  
  const dispatch = createEventDispatcher();
  
  function handleTabClick(tabId: string) {
    dispatch('tabSelect', { tabId });
  }
  
  function handleTabClose(tabId: string, e: MouseEvent) {
    e.stopPropagation();
    dispatch('tabClose', { tabId });
  }
  
  function handleTabDragStart(tabId: string, e: DragEvent) {
    e.stopPropagation();
    dispatch('tabDragStart', { tabId, event: e });
  }
</script>

{#if tabs.length > 0}
  <div class="tabs">
    {#each tabs as tab (tab.id)}
      <button
        class="tab"
        class:active={activeTabId === tab.id}
        draggable="true"
        on:click={() => handleTabClick(tab.id)}
        on:dragstart={(e) => handleTabDragStart(tab.id, e)}
        title={tab.label}
      >
        <span class="tab-label">{tab.label}</span>
        {#if tab.type === 'editor'}
          <button
            class="tab-close"
            on:click={(e) => handleTabClose(tab.id, e)}
            title="Close tab"
            aria-label="Close tab"
          >
            ×
          </button>
        {/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .tabs {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    background: transparent;
    border-bottom: none;
    padding: 0;
    overflow-x: auto;
    overflow-y: hidden;
    min-height: 32px;
    height: 32px;
  }
  
  .tabs::-webkit-scrollbar {
    height: 4px;
  }
  
  .tabs::-webkit-scrollbar-track {
    background: transparent;
  }
  
  .tabs::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
  }
  
  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: rgba(30, 30, 30, 0.6);
    border: none;
    border-top-left-radius: 6px;
    border-top-right-radius: 6px;
    border-bottom: 2px solid transparent;
    color: rgba(255, 255, 255, 0.7);
    cursor: move;
    transition: all 0.15s ease;
    white-space: nowrap;
    min-width: 120px;
    max-width: 200px;
    position: relative;
  }
  
  .tab[draggable="true"] {
    cursor: grab;
  }
  
  .tab[draggable="true"]:active {
    cursor: grabbing;
    opacity: 0.7;
  }
  
  .tab:hover {
    background: rgba(40, 40, 40, 0.8);
    color: rgba(255, 255, 255, 0.9);
  }
  
  .tab.active {
    background: rgba(20, 20, 20, 0.95);
    border-bottom-color: #4a9eff;
    color: #fff;
  }
  
  .tab-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
    user-select: none;
  }
  
  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 3px;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    transition: all 0.1s ease;
    font-size: 18px;
    line-height: 1;
    flex-shrink: 0;
  }
  
  .tab-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
  }
  
  .tab.active .tab-close:hover {
    background: rgba(255, 255, 255, 0.15);
  }
</style>

