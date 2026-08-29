<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy, tick } from 'svelte';
  import type { Node } from '@/nodes/Node';
  import Icon from './Icon.svelte';
  import { ChevronDown, FileText, FolderOpen, Save, Copy, Package, Info } from '@lucide/svelte';

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
  export let documentName: string = 'Untitled';

  const dispatch = createEventDispatcher();

  let menuOpen = false;
  let menuButton: HTMLButtonElement;
  let documentTab: HTMLDivElement;
  let menuDropdown: HTMLDivElement;
  let portalTarget: HTMLElement | null = null;
  let isEditingName = false;
  let nameInput: HTMLInputElement;
  let tempName = documentName;
  let menuPosition = { top: 0, left: 0 };

  function handleTabClick(tabId: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
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
      const timeDelta = Date.now() - info.time;
      const posDelta = Math.sqrt(
        Math.pow(e.clientX - info.x, 2) +
        Math.pow(e.clientY - info.y, 2)
      );

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

  function toggleMenu(e: MouseEvent) {
    e.stopPropagation();
    if (!menuOpen && documentTab) {
      const rect = documentTab.getBoundingClientRect();
      menuPosition = {
        top: rect.bottom + 4,
        left: rect.left
      };
    }
    menuOpen = !menuOpen;
  }

  function handleMenuAction(action: string) {
    menuOpen = false;
    dispatch('action', action);
  }

  function startEditingName(e: MouseEvent) {
    e.stopPropagation();
    isEditingName = true;
    tempName = documentName;
    setTimeout(() => {
      nameInput?.focus();
      nameInput?.select();
    }, 0);
  }

  function saveName() {
    if (tempName.trim()) {
      documentName = tempName.trim();
      dispatch('nameChange', documentName);
    } else {
      tempName = documentName;
    }
    isEditingName = false;
  }

  function cancelEdit() {
    tempName = documentName;
    isEditingName = false;
  }

  function handleNameKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveName();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  }

  // Update tempName when documentName changes externally
  $: if (documentName && !isEditingName) {
    tempName = documentName;
  }

  function handleClickOutside(event: MouseEvent) {
    if (menuButton && !menuButton.contains(event.target as globalThis.Node)) {
      if (menuDropdown && !menuDropdown.contains(event.target as globalThis.Node)) {
        menuOpen = false;
      }
    }
  }

  // Move dropdown to body when it opens
  async function moveDropdownToBody() {
    await tick();
    if (menuDropdown && typeof document !== 'undefined') {
      document.body.appendChild(menuDropdown);
    }
  }

  // Move dropdown back when it closes
  function moveDropdownBack() {
    if (menuDropdown && portalTarget && menuDropdown.parentElement === document.body) {
      portalTarget.appendChild(menuDropdown);
    }
  }

  $: if (menuOpen) {
    moveDropdownToBody();
  }

  onMount(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('click', handleClickOutside);
    }
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('click', handleClickOutside);
    }
    // Clean up portal element
    if (menuDropdown && menuDropdown.parentElement === document.body) {
      document.body.removeChild(menuDropdown);
    }
  });

  // Find the graph tab (always first)
  $: graphTab = tabs.find(t => t.type === 'graph');
  $: otherTabs = tabs.filter(t => t.type !== 'graph');
</script>

<div class="graph-tabs">
  <!-- Document name with dropdown menu (replaces graph tab) -->
  <div class="document-tab" class:active={activeTabId === graphTab?.id} bind:this={documentTab}>
    <button
      class="menu-trigger"
      bind:this={menuButton}
      on:click={toggleMenu}
      title="Document menu"
    >
      <span class="chevron" class:open={menuOpen}>
        <ChevronDown size={12} />
      </span>
    </button>

    {#if isEditingName}
      <input
        type="text"
        class="document-name-input"
        bind:this={nameInput}
        bind:value={tempName}
        on:blur={saveName}
        on:keydown={handleNameKeyDown}
        on:click|stopPropagation
      />
    {:else}
      <button
        class="document-name-button"
        on:click={(e) => {
          if (graphTab) {
            handleTabClick(graphTab.id, e);
          }
        }}
        on:dblclick={startEditingName}
        title="Click to switch to Graph, double-click to rename"
      >
        {documentName}
      </button>
    {/if}

    <div bind:this={portalTarget} style="display: none;"></div>
    {#if menuOpen}
      <div class="menu-dropdown" bind:this={menuDropdown} style="top: {menuPosition.top}px; left: {menuPosition.left}px;">
        <div class="menu-section">
          <button class="menu-item" on:click={() => handleMenuAction('new')}>
            <span class="icon">
              <FileText size={16} />
            </span>
            <span class="label">New</span>
            <span class="shortcut">&#8984;N</span>
          </button>
          <button class="menu-item" on:click={() => handleMenuAction('open')}>
            <span class="icon">
              <FolderOpen size={16} />
            </span>
            <span class="label">Open</span>
            <span class="shortcut">&#8984;O</span>
          </button>
          <button class="menu-item" on:click={() => handleMenuAction('save')}>
            <span class="icon">
              <Save size={16} />
            </span>
            <span class="label">Save</span>
            <span class="shortcut">&#8984;S</span>
          </button>
          <button class="menu-item" on:click={() => handleMenuAction('saveAs')}>
            <span class="icon">
              <Save size={16} />
            </span>
            <span class="label">Save As...</span>
            <span class="shortcut">&#8984;&#8679;S</span>
          </button>
        </div>

        <div class="menu-divider"></div>

        <div class="menu-section">
          <button class="menu-item" on:click={() => handleMenuAction('duplicate')}>
            <span class="icon">
              <Copy size={16} />
            </span>
            <span class="label">Duplicate</span>
            <span class="shortcut">&#8984;D</span>
          </button>
          <button class="menu-item" on:click={() => handleMenuAction('export')}>
            <span class="icon">
              <Package size={16} />
            </span>
            <span class="label">Export HTML</span>
            <span class="shortcut">&#8984;E</span>
          </button>
        </div>

        <div class="menu-divider"></div>

        <div class="menu-section">
          <button class="menu-item" on:click={() => handleMenuAction('about')}>
            <span class="icon">
              <Info size={16} />
            </span>
            <span class="label">About Cascade</span>
          </button>
        </div>
      </div>
    {/if}
  </div>

  <!-- Other tabs (editor tabs) -->
  {#each otherTabs as tab (tab.id)}
    <button
      class="tab"
      class:active={activeTabId === tab.id}
      draggable="true"
      on:mousedown={(e) => handleMouseDown(tab.id, e)}
      on:mouseup={() => handleMouseUp(tab.id)}
      on:click={(e) => handleTabClick(tab.id, e)}
      on:dragstart={(e) => handleTabDragStart(tab.id, e)}
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
          &times;
        </button>
      {/if}
    </button>
  {/each}
</div>

<style>
  .graph-tabs {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    background: transparent;
    border-bottom: none;
    padding: 0;
    overflow: visible;
    min-height: 32px;
    height: 32px;
    position: relative;
    z-index: 100;
  }

  .graph-tabs::-webkit-scrollbar {
    height: 4px;
  }

  .graph-tabs::-webkit-scrollbar-track {
    background: transparent;
  }

  .graph-tabs::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
  }

  .document-tab {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px;
    background: rgba(30, 30, 30, 0.6);
    border-top-left-radius: 6px;
    border-top-right-radius: 6px;
    border-bottom: 2px solid transparent;
    position: relative;
    min-width: 120px;
    max-width: 250px;
  }

  .document-tab.active {
    background: rgba(20, 20, 20, 0.95);
    border-bottom-color: #4a9eff;
  }

  .menu-trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    color: #aaa;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .menu-trigger:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .chevron {
    display: flex;
    align-items: center;
    transition: transform 0.2s ease;
  }

  .chevron.open {
    transform: rotate(180deg);
  }

  .document-name-button {
    flex: 1;
    background: transparent;
    border: none;
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    transition: background 0.15s ease;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .document-name-button:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .document-name-input {
    flex: 1;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid #4a9eff;
    border-radius: 3px;
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    padding: 2px 6px;
    min-width: 80px;
    outline: none;
    font-family: inherit;
  }

  .document-name-input:focus {
    border-color: #4a9eff;
    background: rgba(0, 0, 0, 0.5);
  }

  .menu-dropdown {
    position: fixed;
    min-width: 220px;
    background: rgba(30, 30, 30, 0.98);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    padding: 4px;
    animation: fadeIn 0.15s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 999999;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .menu-section {
    display: flex;
    flex-direction: column;
  }

  .menu-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
    margin: 4px 0;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    color: #fff;
    font-size: 13px;
    text-align: left;
    width: 100%;
    transition: background 0.1s ease;
  }

  .menu-item:hover {
    background: rgba(66, 133, 244, 0.15);
  }

  .menu-item .icon {
    font-size: 16px;
    line-height: 1;
    width: 20px;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
  }

  .menu-item .label {
    flex: 1;
  }

  .menu-item .shortcut {
    color: #666;
    font-size: 11px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace;
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
    color: rgba(255, 255, 255, 0.5);
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
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.9);
  }

  .tab.active .tab-close:hover {
    background: rgba(255, 255, 255, 0.15);
  }
</style>
