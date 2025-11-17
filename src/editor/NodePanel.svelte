<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { nodeLibraries, getAllNodes, getNodesByLibraryAndCategory, type NodeTemplate } from './nodeTemplates';
  import Icon from './Icon.svelte';
  
  export let libraryId: string | null = null;
  export let categoryId: string | null = null;
  export let position: { x: number; y: number } = { x: 0, y: 0 };
  export let centerPosition: { x: number; y: number } = { x: 0, y: 0 };
  
  const dispatch = createEventDispatcher();
  
  let searchInput: HTMLInputElement;
  let searchQuery = '';
  
  // Get current library and category
  $: currentLibrary = libraryId ? nodeLibraries.find(lib => lib.id === libraryId) : null;
  $: currentCategory = currentLibrary && categoryId 
    ? currentLibrary.categories.find(cat => cat.id === categoryId) 
    : null;
  
  // Get nodes based on context
  $: nodes = searchQuery
    ? getAllNodes().filter(n => 
        n.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : categoryId && libraryId
      ? getNodesByLibraryAndCategory(libraryId, categoryId)
      : [];
  
  function handleNodeClick(node: NodeTemplate) {
    dispatch('addNode', { type: node.type, libraryId, categoryId });
  }
  
  function handleCategoryClick(libId: string, catId: string) {
    dispatch('selectCategory', { libraryId: libId, categoryId: catId });
  }
  
  function handleLibraryClick(libId: string) {
    dispatch('selectLibrary', { libraryId: libId });
  }
  
  function handleCustomNodeClick() {
    // Direct creation of custom node, bypassing library/category
    dispatch('addNode', { type: 'Custom', libraryId: null, categoryId: null });
  }
  
  function handleClose() {
    dispatch('close');
  }
  
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClose();
    }
  }
  
  // Auto-focus search input when panel opens
  $: if ((libraryId || categoryId) && searchInput) {
    setTimeout(() => {
      searchInput?.focus();
    }, 0);
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if libraryId || categoryId}
  <div class="node-panel" style="left: {centerPosition.x}px; top: {centerPosition.y}px">
    <div class="search">
      <input
        type="text"
        placeholder="Type to search..."
        bind:value={searchQuery}
        bind:this={searchInput}
        class="search-input"
      />
    </div>
    
    <div class="panel-content">
      <!-- Libraries column (left) -->
      <div class="libraries-column">
        {#each nodeLibraries.filter(lib => lib.categories.some(cat => cat.nodes.length > 0) && lib.id !== 'custom') as library}
          <button
            class="library-item"
            class:active={libraryId === library.id}
            on:click={() => handleLibraryClick(library.id)}
            on:mouseenter={() => handleLibraryClick(library.id)}
          >
            <span class="icon">
              <Icon name={library.icon} size={16} />
            </span>
            <span class="label">{library.label}</span>
          </button>
        {/each}
        
        <div class="hr-divider"></div>
        
        <!-- Custom Node button at bottom -->
        <button
          class="custom-node-button"
          on:click={handleCustomNodeClick}
        >
          <span class="icon">
            <Icon name="Zap" size={16} />
          </span>
          <span class="label">Custom</span>
        </button>
      </div>
      
      <!-- Categories column (middle) - only show if library is selected -->
      {#if currentLibrary && !searchQuery}
        <div class="divider"></div>
        <div class="categories-column">
          {#each currentLibrary.categories.filter(cat => cat.nodes.length > 0) as category}
            <button
              class="category-item"
              class:active={categoryId === category.id}
              on:click={() => handleCategoryClick(currentLibrary.id, category.id)}
              on:mouseenter={() => handleCategoryClick(currentLibrary.id, category.id)}
            >
              <span class="label">{category.label}</span>
            </button>
          {/each}
        </div>
      {/if}
      
      <!-- Nodes column (right) - only show if category is selected or search is active -->
      {#if (categoryId && currentCategory) || searchQuery}
        {#if currentLibrary && !searchQuery}
          <div class="divider"></div>
        {/if}
        <div class="nodes-column">
          {#each nodes as node}
            <button
              class="node-item"
              on:click={() => handleNodeClick(node)}
              title={node.description}
            >
              <span class="node-icon">
                <Icon name={node.icon} size={16} />
              </span>
              <span class="node-name">{node.name}</span>
            </button>
          {/each}
          
          {#if nodes.length === 0}
            <div class="empty-state">
              {#if searchQuery}
                No nodes found matching "{searchQuery}"
              {:else}
                No nodes in this category
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .node-panel {
    position: fixed;
    transform: translate(-50%, -50%);
    width: auto;
    min-width: 320px;
    max-width: 800px;
    max-height: 500px;
    background: rgba(30, 30, 30, 0.98);
    backdrop-filter: blur(20px);
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    z-index: 200;
    animation: fadeIn 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }
  
  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
  }
  
  .search {
    padding: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .search-input {
    width: 100%;
    padding: 6px 10px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 13px;
    box-sizing: border-box;
  }
  
  .search-input:focus {
    outline: none;
    border-color: #4a9eff;
  }
  
  .panel-content {
    display: flex;
    flex: 1;
    overflow: hidden;
    min-height: 300px;
  }
  
  .custom-node-button {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.1s ease;
    text-align: left;
    width: 100%;
    margin-top: 4px;
  }
  
  .custom-node-button:hover {
    background: rgba(66, 133, 244, 0.15);
  }
  
  .custom-node-button .icon {
    font-size: 16px;
    line-height: 1;
    flex-shrink: 0;
  }
  
  .custom-node-button .label {
    font-size: 13px;
    font-weight: 500;
    color: #fff;
    flex: 1;
  }
  
  .hr-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
    margin: 8px 0;
  }
  
  .libraries-column,
  .categories-column,
  .nodes-column {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 4px;
    min-width: 120px;
  }
  
  .libraries-column {
    border-right: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .categories-column {
    border-right: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .divider {
    width: 1px;
    background: rgba(255, 255, 255, 0.1);
  }
  
  .library-item,
  .category-item,
  .node-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.1s ease;
    text-align: left;
    width: 100%;
  }
  
  .library-item:hover,
  .category-item:hover,
  .node-item:hover {
    background: rgba(66, 133, 244, 0.15);
  }
  
  .library-item.active,
  .category-item.active {
    background: rgba(66, 133, 244, 0.25);
    color: #4a9eff;
  }
  
  .library-item .icon,
  .node-item .node-icon {
    font-size: 16px;
    line-height: 1;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
  }
  
  .custom-node-button .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
  }
  
  .library-item .label,
  .category-item .label,
  .node-item .node-name {
    font-size: 13px;
    font-weight: 400;
    color: #fff;
    flex: 1;
  }
  
  .category-item .label {
    font-weight: 500;
  }
  
  .empty-state {
    padding: 32px;
    text-align: center;
    color: #666;
    font-size: 14px;
  }
</style>
