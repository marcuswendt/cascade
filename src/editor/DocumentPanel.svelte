<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import type { Graph } from '@/core/Graph';

  export let graph: Graph;
  export let documentName: string = 'Untitled';

  const dispatch = createEventDispatcher();

  let menuOpen = false;
  let menuButton: HTMLButtonElement;
  let isEditingName = false;
  let nameInput: HTMLInputElement;
  let tempName = documentName;

  function toggleMenu() {
    menuOpen = !menuOpen;
  }

  function handleMenuAction(action: string) {
    menuOpen = false;
    dispatch('action', action);
  }

  function startEditingName() {
    isEditingName = true;
    tempName = documentName;
    // Focus the input after it's rendered
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
      tempName = documentName; // Revert if empty
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
    if (menuButton && !menuButton.contains(event.target as Node)) {
      const menu = document.querySelector('.menu-dropdown');
      if (menu && !menu.contains(event.target as Node)) {
        menuOpen = false;
      }
    }
  }

  onMount(() => {
    // Close menu when clicking outside
    if (typeof window !== 'undefined') {
      window.addEventListener('click', handleClickOutside);
    }
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('click', handleClickOutside);
    }
  });
</script>

<div class="document-panel">
  <button
    class="logo-button"
    bind:this={menuButton}
    on:click={toggleMenu}
    title="Document menu"
  >
    <span class="logo">🌊</span>
    <span class="chevron" class:open={menuOpen}>▼</span>
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
    <div 
      class="document-name"
      on:click|stopPropagation={startEditingName}
      title="Click to rename"
    >
      {documentName}
    </div>
  {/if}

  {#if menuOpen}
    <div class="menu-dropdown">
      <div class="menu-section">
        <button class="menu-item" on:click={() => handleMenuAction('new')}>
          <span class="icon">📄</span>
          <span class="label">New</span>
          <span class="shortcut">⌘N</span>
        </button>
        <button class="menu-item" on:click={() => handleMenuAction('open')}>
          <span class="icon">📂</span>
          <span class="label">Open</span>
          <span class="shortcut">⌘O</span>
        </button>
        <button class="menu-item" on:click={() => handleMenuAction('save')}>
          <span class="icon">💾</span>
          <span class="label">Save</span>
          <span class="shortcut">⌘S</span>
        </button>
        <button class="menu-item" on:click={() => handleMenuAction('saveAs')}>
          <span class="icon">💾</span>
          <span class="label">Save As...</span>
          <span class="shortcut">⌘⇧S</span>
        </button>
      </div>

      <div class="menu-divider"></div>

      <div class="menu-section">
        <button class="menu-item" on:click={() => handleMenuAction('duplicate')}>
          <span class="icon">📋</span>
          <span class="label">Duplicate</span>
          <span class="shortcut">⌘D</span>
        </button>
        <button class="menu-item" on:click={() => handleMenuAction('export')}>
          <span class="icon">📦</span>
          <span class="label">Export HTML</span>
          <span class="shortcut">⌘E</span>
        </button>
      </div>

      <div class="menu-divider"></div>

      <div class="menu-section">
        <button class="menu-item" on:click={() => handleMenuAction('about')}>
          <span class="icon">ℹ️</span>
          <span class="label">About Cascade</span>
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .document-panel {
    position: fixed;
    top: 20px;
    left: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 200;
    background: rgba(20, 20, 20, 0.95);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 8px 12px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  }

  .logo-button {
    display: flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    transition: background 0.15s ease;
  }

  .logo-button:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .logo {
    font-size: 20px;
    line-height: 1;
  }

  .chevron {
    font-size: 10px;
    color: #aaa;
    transition: transform 0.2s ease;
    line-height: 1;
  }

  .chevron.open {
    transform: rotate(180deg);
  }

  .document-name {
    color: #fff;
    font-size: 14px;
    font-weight: 500;
    user-select: none;
    min-width: 80px;
    cursor: text;
    padding: 2px 4px;
    border-radius: 3px;
    transition: background 0.15s ease;
  }

  .document-name:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .document-name-input {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid #4a9eff;
    border-radius: 3px;
    color: #fff;
    font-size: 14px;
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
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    min-width: 220px;
    background: rgba(30, 30, 30, 0.98);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    padding: 4px;
    animation: fadeIn 0.15s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 1000;
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
  }

  .menu-item .label {
    flex: 1;
  }

  .menu-item .shortcut {
    color: #666;
    font-size: 11px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace;
  }
</style>

