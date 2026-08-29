<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let documentName: string = 'Untitled';
  export let canUndo: boolean = false;
  export let canRedo: boolean = false;

  const dispatch = createEventDispatcher();

  let activeMenu: string | null = null;
  let editingName = false;
  let nameInput: HTMLInputElement;
  let editedName = documentName;
  let createButtonElement: HTMLButtonElement;

  $: editedName = documentName;

  function handleMenuClick(menu: string) {
    if (activeMenu === menu) {
      activeMenu = null;
    } else {
      activeMenu = menu;
    }
  }

  function handleMenuItemClick(action: string) {
    dispatch('action', action);
    activeMenu = null;
  }

  function handleCreateClick() {
    // Get position of Create button to position NodePanel below it
    if (createButtonElement) {
      const rect = createButtonElement.getBoundingClientRect();
      dispatch('openNodePanel', { x: rect.left, y: rect.bottom + 4 });
    } else {
      dispatch('action', 'addNode');
    }
    activeMenu = null;
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.menu-bar')) {
      activeMenu = null;
    }
  }

  function startEditingName() {
    editingName = true;
    editedName = documentName;
    setTimeout(() => {
      nameInput?.focus();
      nameInput?.select();
    }, 0);
  }

  function finishEditingName() {
    editingName = false;
    if (editedName.trim() && editedName !== documentName) {
      dispatch('nameChange', editedName.trim());
    }
  }

  function handleNameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      finishEditingName();
    } else if (e.key === 'Escape') {
      editingName = false;
      editedName = documentName;
    }
  }

  // File shortcuts use Alt to avoid conflicting with browser shortcuts.
  const fileModKey = '⌥';

  $: fileMenuItems = [
    { label: 'New Project', action: 'new', shortcut: `${fileModKey}N` },
    { label: 'Open...', action: 'open', shortcut: `${fileModKey}O` },
    { type: 'separator' },
    { label: 'Save', action: 'save', shortcut: `${fileModKey}S` },
    { label: 'Save As...', action: 'saveAs', shortcut: `⇧${fileModKey}S` },
    { label: 'Version History...', action: 'versionHistory' },
    { type: 'separator' },
    { label: 'Export...', action: 'export', shortcut: '⌘E' },
    { type: 'separator' },
    { label: 'Project Settings...', action: 'projectSettings', shortcut: '⇧⌘,' },
    { label: 'Settings...', action: 'settings', shortcut: '⌘,' },
    { type: 'separator' },
    { label: 'About Cascade', action: 'about' }
  ];

  $: editMenuItems = [
    { label: 'Undo', action: 'undo', shortcut: '⌘Z', disabled: !canUndo },
    { label: 'Redo', action: 'redo', shortcut: '⇧⌘Z', disabled: !canRedo },
    { type: 'separator' },
    { label: 'Select All', action: 'selectAll', shortcut: '⌘A' },
    { label: 'Deselect All', action: 'deselectAll', shortcut: '⇧⌘A' },
    { type: 'separator' },
    { label: 'Delete Selected', action: 'delete', shortcut: '⌫' }
  ];

  const viewMenuItems = [
    { label: 'Clean Up Layout', action: 'cleanUpLayout', shortcut: '⇧L' },
    { label: 'Center on Nodes', action: 'centerOnNodes', shortcut: 'H' },
    { label: 'Reset Layout', action: 'resetLayout', shortcut: '⇧⌘P' },
    { type: 'separator' },
    { label: 'Maximize Tab', action: 'maximizeTab', shortcut: '⌘B' },
    { label: 'Presentation Mode', action: 'presentationMode', shortcut: '⌘.' },
    { type: 'separator' },
    { label: 'Focus Graph', action: 'focusGraph', shortcut: '⌘1' },
    { label: 'Focus Viewer', action: 'focusViewer', shortcut: '⌘2' },
    { label: 'Focus Inspector', action: 'focusInspector', shortcut: '⌘3' },
    { label: 'Focus Log', action: 'focusLog', shortcut: '⌘4' }
  ];
</script>

<svelte:window on:click={handleClickOutside} />

<div class="menu-bar">
  <div class="menu-left">
      <!-- File Menu -->
      <div class="menu-item" class:active={activeMenu === 'file'}>
        <button class="menu-button" on:click={() => handleMenuClick('file')}>
          File
        </button>
        {#if activeMenu === 'file'}
          <div class="dropdown">
            {#each fileMenuItems as item}
              {#if item.type === 'separator'}
                <div class="separator"></div>
              {:else}
                <button
                  class="dropdown-item"
                  on:click={() => item.action && handleMenuItemClick(item.action)}
                >
                  <span class="item-label">{item.label}</span>
                  {#if item.shortcut}
                    <span class="item-shortcut">{item.shortcut}</span>
                  {/if}
                </button>
              {/if}
            {/each}
          </div>
        {/if}
      </div>

      <!-- Edit Menu -->
      <div class="menu-item" class:active={activeMenu === 'edit'}>
        <button class="menu-button" on:click={() => handleMenuClick('edit')}>
          Edit
        </button>
        {#if activeMenu === 'edit'}
          <div class="dropdown">
            {#each editMenuItems as item}
              {#if item.type === 'separator'}
                <div class="separator"></div>
              {:else}
                <button
                  class="dropdown-item"
                  class:disabled={item.disabled}
                  disabled={item.disabled}
                  on:click={() => !item.disabled && item.action && handleMenuItemClick(item.action)}
                >
                  <span class="item-label">{item.label}</span>
                  {#if item.shortcut}
                    <span class="item-shortcut">{item.shortcut}</span>
                  {/if}
                </button>
              {/if}
            {/each}
          </div>
        {/if}
      </div>

    <!-- Create Menu - always shown, opens NodePanel directly -->
    <div class="menu-item">
      <button
        class="menu-button"
        bind:this={createButtonElement}
        on:click={handleCreateClick}
      >
        Create
      </button>
    </div>

      <!-- View Menu -->
      <div class="menu-item" class:active={activeMenu === 'view'}>
        <button class="menu-button" on:click={() => handleMenuClick('view')}>
          View
        </button>
        {#if activeMenu === 'view'}
          <div class="dropdown">
            {#each viewMenuItems as item}
              {#if item.type === 'separator'}
                <div class="separator"></div>
              {:else}
                <button
                  class="dropdown-item"
                  on:click={() => item.action && handleMenuItemClick(item.action)}
                >
                  <span class="item-label">{item.label}</span>
                  {#if item.shortcut}
                    <span class="item-shortcut">{item.shortcut}</span>
                  {/if}
                </button>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
  </div>

  <div class="menu-center">
    {#if editingName}
      <input
        bind:this={nameInput}
        bind:value={editedName}
        class="name-input"
        type="text"
        on:blur={finishEditingName}
        on:keydown={handleNameKeydown}
      />
    {:else}
      <button class="document-name" on:click={startEditingName} title="Click to rename">
        {documentName}
      </button>
    {/if}
  </div>

  <div class="menu-right">
    <!-- Placeholder for window controls or additional actions -->
  </div>
</div>

<style>
  .menu-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 32px;
    background: #1a1a1a;
    border-bottom: 1px solid #333;
    padding: 0 8px;
    user-select: none;
  }

  .menu-left {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .menu-center {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
  }

  .menu-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .menu-item {
    position: relative;
  }

  .menu-button {
    background: transparent;
    border: none;
    color: #ccc;
    font-size: 13px;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .menu-button:hover {
    background: #333;
    color: #fff;
  }

  .menu-item.active .menu-button {
    background: #333;
    color: #fff;
  }

  .dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    min-width: 200px;
    background: #252525;
    border: 1px solid #404040;
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 1000;
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 6px 12px;
    background: transparent;
    border: none;
    color: #ccc;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
    gap: 8px;
  }

  .dropdown-item:hover:not(.disabled) {
    background: #0078d4;
    color: #fff;
  }

  .dropdown-item.disabled {
    color: #666;
    cursor: not-allowed;
  }

  .item-label {
    flex: 1;
  }

  .item-shortcut {
    color: #888;
    font-size: 12px;
    margin-left: auto;
    padding-left: 16px;
  }

  .dropdown-item:hover:not(.disabled) .item-shortcut {
    color: rgba(255, 255, 255, 0.7);
  }

  .separator {
    height: 1px;
    background: #404040;
    margin: 4px 8px;
  }

  .document-name {
    background: transparent;
    border: none;
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .document-name:hover {
    background: #333;
  }

  .name-input {
    background: #333;
    border: 1px solid #0078d4;
    border-radius: 4px;
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    padding: 3px 11px;
    text-align: center;
    outline: none;
    min-width: 150px;
  }
</style>
