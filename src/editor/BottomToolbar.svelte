<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { getAvailableLibraries } from './nodeTemplates';
  import Icon from './Icon.svelte';
  import { MoveUpLeft, Hand } from 'lucide-svelte';
  
  export let activeLibrary: string | null = null;
  
  const dispatch = createEventDispatcher();
  
  // Get available libraries that have nodes
  $: libraries = getAvailableLibraries();
  
  const tools = [
    { id: 'select', label: 'Select', icon: 'MoveUpLeft', hotkey: 'V', component: MoveUpLeft },
    { id: 'hand', label: 'Hand', icon: 'Hand', hotkey: 'H', component: Hand }
  ];
  
  let activeTool = 'select';
  
  function handleLibraryClick(libraryId: string) {
    if (activeLibrary === libraryId) {
      dispatch('libraryToggle', null);
    } else {
      dispatch('libraryToggle', libraryId);
    }
  }
  
  function handleToolClick(toolId: string) {
    activeTool = toolId;
    dispatch('toolChange', toolId);
  }
</script>

<div class="toolbar">
  <div class="tools-section">
    {#each tools as tool}
      <button
        class="tool-button"
        class:active={activeTool === tool.id}
        on:click={() => handleToolClick(tool.id)}
        title="{tool.label} ({tool.hotkey})"
      >
        <span class="icon">
          <svelte:component this={tool.component} size={18} />
        </span>
        <span class="label">{tool.label}</span>
      </button>
    {/each}
  </div>
  
  <div class="divider"></div>
  
  <div class="libraries-section">
    {#each libraries as library}
      <button
        class="library-button"
        class:active={activeLibrary === library.id}
        on:click={() => handleLibraryClick(library.id)}
        title={library.label}
      >
        <span class="icon">
          <Icon name={library.icon} size={18} />
        </span>
        <span class="label">{library.label}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .toolbar {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    height: 56px;
    background: rgba(20, 20, 20, 0.95);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 12px;
    z-index: 100;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    /* Fit to content width */
    width: auto;
    min-width: fit-content;
  }
  
  .tools-section,
  .libraries-section,
  .settings-section {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  
  .divider {
    width: 1px;
    height: 32px;
    background: rgba(255, 255, 255, 0.1);
    margin: 0 4px;
  }
  
  .tool-button,
  .library-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 8px 10px;
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    color: #aaa;
    font-size: 11px;
    min-width: 44px;
    transition: all 0.15s ease;
  }
  
  .tool-button:hover,
  .library-button:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
  }
  
  .tool-button.active,
  .library-button.active {
    background: rgba(66, 133, 244, 0.25);
    color: #4a9eff;
  }
  
  .tool-button .icon,
  .library-button .icon {
    font-size: 18px;
    line-height: 1;
  }
  
  .tool-button .label,
  .library-button .label {
    font-size: 10px;
    font-weight: 500;
  }
  
  .settings-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    color: #aaa;
    font-size: 16px;
    transition: all 0.15s ease;
  }
  
  .settings-button:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
  }
</style>

