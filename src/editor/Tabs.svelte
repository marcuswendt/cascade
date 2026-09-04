<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Node } from '@/nodes/Node';
  import Icon from './Icon.svelte';

  interface Tab {
    id: string;
    type: 'graph' | 'editor' | 'viewer' | 'log' | 'inspector';
    label: string;
    windowId: string;
    node?: Node;
    icon?: string;
  }
  
  export let tabs: Tab[] = [];
  export let activeTabId: string | null = null;
  export let windowId: string = '';
  
  const dispatch = createEventDispatcher();
  
  function handleTabClick(tabId: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    console.log('Tab click:', tabId);
    dispatch('tabSelect', { tabId });
  }
  
  function handleTabClose(tabId: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    dispatch('tabClose', { tabId });
  }
  
  const mouseDownInfo = new Map<string, { x: number; y: number; time: number }>();
  
  function handleTabDragStart(tabId: string, e: DragEvent) {
    const info = mouseDownInfo.get(tabId);
    if (info) {
      // Check if this was actually a drag or just a click
      const timeDelta = Date.now() - info.time;
      const posDelta = Math.sqrt(
        Math.pow(e.clientX - info.x, 2) + 
        Math.pow(e.clientY - info.y, 2)
      );
      
      // If it was a quick click with little movement, cancel the drag
      if (timeDelta < 300 && posDelta < 5) {
        console.log('Canceling drag - was a click');
        e.preventDefault();
        e.stopPropagation();
        mouseDownInfo.delete(tabId);
        return;
      }
    }
    
    e.stopPropagation();
    dispatch('tabDragStart', { tabId, event: e });
  }
  
  function handleMouseDown(tabId: string, e: MouseEvent) {
    if (e.button === 0) {
      mouseDownInfo.set(tabId, { x: e.clientX, y: e.clientY, time: Date.now() });
    }
  }
  
  function handleMouseUp(tabId: string) {
    mouseDownInfo.delete(tabId);
  }
</script>

{#if tabs.length > 0}
  <div class="tabs">
    {#each tabs as tab (tab.id)}
      <button
        class="tab"
        class:active={activeTabId === tab.id}
        draggable="true"
        on:mousedown={(e) => handleMouseDown(tab.id, e)}
        on:mouseup={() => handleMouseUp(tab.id)}
        on:click={(e) => {
          console.log('Tab button clicked:', tab.id);
          handleTabClick(tab.id, e);
        }}
        on:dragstart={(e) => {
          console.log('Drag start on tab:', tab.id);
          handleTabDragStart(tab.id, e);
        }}
        title={tab.label}
      >
        {#if tab.icon}
          <span class="tab-icon">
            <Icon name={tab.icon} size={14} />
          </span>
        {/if}
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
    background: var(--tint-strong);
    border-radius: 2px;
  }
  
  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: var(--surface-popover-soft);
    border: none;
    border-top-left-radius: 6px;
    border-top-right-radius: 6px;
    border-bottom: 2px solid transparent;
    color: var(--text-tint-strong);
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
    background: var(--surface-veil);
    color: var(--text-tint-bright);
  }
  
  .tab.active {
    background: var(--surface-popover);
    border-bottom-color: var(--accent);
    color: var(--text-bright);
  }
  
  .tab-icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
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
    color: var(--text-tint-half);
    cursor: pointer;
    transition: all 0.1s ease;
    font-size: 18px;
    line-height: 1;
    flex-shrink: 0;
    pointer-events: auto;
    position: relative;
    z-index: 1;
    -webkit-user-select: none;
    user-select: none;
  }
  
  .tab-close:hover {
    background: var(--tint);
    color: var(--text-tint-bright);
  }
  
  .tab.active .tab-close:hover {
    background: var(--tint-medium);
  }
</style>

