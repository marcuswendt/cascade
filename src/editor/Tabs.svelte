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
    dispatch('tabSelect', { tabId });
  }

  function handleTabKeydown(tabId: string, e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      dispatch('tabSelect', { tabId });
      return;
    }

    const tablist = (e.currentTarget as HTMLElement).closest('[role="tablist"]');
    const tabElements = tablist
      ? Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'))
      : [];
    const currentIndex = tabElements.indexOf(e.currentTarget as HTMLElement);
    if (currentIndex < 0 || tabElements.length < 2) return;

    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabElements.length;
    if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabElements.length) % tabElements.length;
    if (e.key === 'Home') nextIndex = 0;
    if (e.key === 'End') nextIndex = tabElements.length - 1;
    if (nextIndex === null) return;

    e.preventDefault();
    e.stopPropagation();
    const nextTab = tabElements[nextIndex];
    nextTab.focus();
    const nextTabId = nextTab.dataset.tabId;
    if (nextTabId) dispatch('tabSelect', { tabId: nextTabId });
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
  <div class="tabs" role="tablist" aria-label="Open views">
    {#each tabs as tab, index (tab.id)}
      <div
        class="tab"
        class:active={activeTabId === tab.id}
        title={tab.label}
      >
        <div
          class="tab-target"
          role="tab"
          tabindex={activeTabId === tab.id || (activeTabId === null && index === 0) ? 0 : -1}
          aria-selected={activeTabId === tab.id}
          data-tab-id={tab.id}
          draggable="true"
          on:mousedown={(e) => handleMouseDown(tab.id, e)}
          on:mouseup={() => handleMouseUp(tab.id)}
          on:click={(e) => handleTabClick(tab.id, e)}
          on:keydown={(e) => handleTabKeydown(tab.id, e)}
          on:dragstart={(e) => handleTabDragStart(tab.id, e)}
        >
          {#if tab.icon}
            <span class="tab-icon">
              <Icon name={tab.icon} size={14} />
            </span>
          {/if}
          <span class="tab-label">{tab.label}</span>
        </div>
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
      </div>
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
  
  .tab-target[draggable="true"] {
    cursor: grab;
  }
  
  .tab-target[draggable="true"]:active {
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

  .tab-target {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    color: inherit;
    outline: none;
  }

  .tab-target:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 3px;
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
