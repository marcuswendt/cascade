<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { nodeLibraries, getAllNodes, getNodesByLibraryAndCategory, type NodeTemplate } from './nodeTemplates';
  import Icon from './Icon.svelte';
  
  import { onMount } from 'svelte';
  
  export let libraryId: string | null = null;
  export let categoryId: string | null = null;
  export let position: { x: number; y: number } = { x: 0, y: 0 };
  export let centerPosition: { x: number; y: number } = { x: 0, y: 0 };
  
  const dispatch = createEventDispatcher();
  
  let searchInput: HTMLInputElement;
  let searchQuery = '';
  let panelElement: HTMLDivElement;
  let calculatedPosition = { x: 0, y: 0 };
  let hasCalculated = false;
  
  // Navigation state
  let selectedLibraryIndex = -1;
  let selectedCategoryIndex = -1;
  let selectedNodeIndex = -1;
  let navigationMode: 'library' | 'category' | 'node' = 'library';
  
  // Calculate position relative to Graph window, centered on cursor, clamped to screen
  function calculatePosition() {
    if (!panelElement) {
      // Initialize with centerPosition if panel not yet mounted
      if (centerPosition.x !== 0 || centerPosition.y !== 0) {
        calculatedPosition = { x: centerPosition.x, y: centerPosition.y };
      }
      return;
    }
    
    // Get Graph window element
    const graphWindow = document.querySelector('[data-window-id="graph"]');
    if (!graphWindow) {
      // Fallback to viewport positioning centered on cursor
      const panelRect = panelElement.getBoundingClientRect();
      const panelWidth = panelRect.width || 400;
      const panelHeight = panelRect.height || 500;
      calculatedPosition = {
        x: centerPosition.x - (panelWidth / 2),
        y: centerPosition.y - (panelHeight / 2)
      };
      hasCalculated = true;
      return;
    }
    
    const graphRect = graphWindow.getBoundingClientRect();
    
    // Wait for panel to be measured, then recalculate
    const panelRect = panelElement.getBoundingClientRect();
    const panelWidth = panelRect.width || 400;
    const panelHeight = panelRect.height || 500;
    
    // Calculate centered position on cursor (relative to Graph window)
    // centerPosition is in viewport coordinates
    let x = centerPosition.x - graphRect.left - (panelWidth / 2);
    let y = centerPosition.y - graphRect.top - (panelHeight / 2);
    
    // Clamp to Graph window bounds with padding
    const padding = 10;
    const minX = padding;
    const maxX = graphRect.width - panelWidth - padding;
    const minY = padding;
    const maxY = graphRect.height - panelHeight - padding;
    
    x = Math.max(minX, Math.min(maxX, x));
    y = Math.max(minY, Math.min(maxY, y));
    
    // Convert back to viewport coordinates
    calculatedPosition = {
      x: graphRect.left + x,
      y: graphRect.top + y
    };
    hasCalculated = true;
  }
  
  // Recalculate when panel opens or centerPosition changes
  $: if ((libraryId || categoryId) && centerPosition) {
    // Use setTimeout to ensure DOM is updated after render
    setTimeout(() => {
      calculatePosition();
      // Recalculate again after a short delay to account for panel content rendering
      setTimeout(() => {
        calculatePosition();
      }, 50);
    }, 0);
  }
  
  // Also recalculate on window resize
  onMount(() => {
    const handleResize = () => {
      if (libraryId || categoryId) {
        calculatePosition();
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  });
  
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
  
  // Get available libraries and categories for navigation
  $: availableLibraries = nodeLibraries.filter(lib => lib.categories.some(cat => cat.nodes.length > 0) && lib.id !== 'custom');
  $: availableCategories = currentLibrary ? currentLibrary.categories.filter(cat => cat.nodes.length > 0) : [];
  
  // Initialize navigation when panel opens
  $: if (libraryId || categoryId) {
    if (searchQuery) {
      // In search mode, navigate nodes directly
      navigationMode = 'node';
      if (nodes.length > 0) {
        // Reset to first node if current selection is out of bounds
        if (selectedNodeIndex < 0 || selectedNodeIndex >= nodes.length) {
          selectedNodeIndex = 0;
        }
      } else {
        selectedNodeIndex = -1;
      }
    } else {
      if (libraryId && selectedLibraryIndex === -1) {
        selectedLibraryIndex = availableLibraries.findIndex(lib => lib.id === libraryId);
        if (selectedLibraryIndex === -1) selectedLibraryIndex = 0;
        navigationMode = categoryId ? 'node' : 'library';
      }
      if (categoryId && currentLibrary && selectedCategoryIndex === -1) {
        selectedCategoryIndex = availableCategories.findIndex(cat => cat.id === categoryId);
        if (selectedCategoryIndex === -1) selectedCategoryIndex = 0;
        if (categoryId) navigationMode = 'node';
      }
      if (selectedNodeIndex === -1 && nodes.length > 0 && navigationMode === 'node') {
        selectedNodeIndex = 0;
      } else if (navigationMode === 'node' && selectedNodeIndex >= nodes.length) {
        // Clamp node index if it's out of bounds
        selectedNodeIndex = Math.max(0, nodes.length - 1);
      }
    }
  }
  
  // Reset navigation when panel closes
  $: if (!libraryId && !categoryId) {
    selectedLibraryIndex = -1;
    selectedCategoryIndex = -1;
    selectedNodeIndex = -1;
    navigationMode = 'library';
  }
  
  // Scroll selected item into view
  $: if (navigationMode === 'library' && selectedLibraryIndex >= 0) {
    setTimeout(() => {
      const librariesColumn = panelElement?.querySelector('.libraries-column');
      const selectedButton = librariesColumn?.children[selectedLibraryIndex] as HTMLElement;
      if (selectedButton) {
        selectedButton.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 0);
  }
  
  $: if (navigationMode === 'category' && selectedCategoryIndex >= 0) {
    setTimeout(() => {
      const categoriesColumn = panelElement?.querySelector('.categories-column');
      const selectedButton = categoriesColumn?.children[selectedCategoryIndex] as HTMLElement;
      if (selectedButton) {
        selectedButton.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 0);
  }
  
  $: if (navigationMode === 'node' && selectedNodeIndex >= 0) {
    setTimeout(() => {
      const nodesColumn = panelElement?.querySelector('.nodes-column');
      const selectedButton = nodesColumn?.children[selectedNodeIndex] as HTMLElement;
      if (selectedButton) {
        selectedButton.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 0);
  }
  
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
    // Only handle keys if panel is open
    if (!libraryId && !categoryId) {
      return;
    }
    
    // Check if this is a navigation key we care about
    const isNavigationKey = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key);
    
    if (!isNavigationKey) {
      return;
    }
    
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleClose();
      return;
    }
    
    // Don't handle navigation if user is typing in search (unless it's Escape)
    if (document.activeElement === searchInput && e.key !== 'Escape') {
      // If search is active, allow navigation in nodes
      if (searchQuery && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter')) {
        // Allow navigation in search results
        e.preventDefault();
        e.stopPropagation();
        searchInput.blur();
      } else {
        return;
      }
    }
    
    // Prevent default and stop propagation for all navigation keys when panel is open
    e.preventDefault();
    e.stopPropagation();
    
    if (e.key === 'ArrowLeft') {
      if (searchQuery) {
        // In search mode, left arrow does nothing
        return;
      }
      if (navigationMode === 'category' && libraryId) {
        navigationMode = 'library';
        selectedCategoryIndex = -1;
      } else if (navigationMode === 'node' && categoryId) {
        navigationMode = 'category';
        selectedNodeIndex = -1;
      }
    } else if (e.key === 'ArrowRight') {
      if (searchQuery) {
        // In search mode, right arrow does nothing
        return;
      }
      if (navigationMode === 'library' && libraryId && availableCategories.length > 0) {
        navigationMode = 'category';
        if (selectedCategoryIndex === -1) selectedCategoryIndex = 0;
      } else if (navigationMode === 'category' && categoryId && nodes.length > 0) {
        navigationMode = 'node';
        if (selectedNodeIndex === -1) selectedNodeIndex = 0;
      }
    } else if (e.key === 'ArrowUp') {
      if (searchQuery) {
        // In search mode, navigate nodes
        navigationMode = 'node';
        selectedNodeIndex = Math.max(0, selectedNodeIndex - 1);
      } else if (navigationMode === 'library') {
        selectedLibraryIndex = Math.max(0, selectedLibraryIndex - 1);
        if (selectedLibraryIndex >= 0 && selectedLibraryIndex < availableLibraries.length) {
          handleLibraryClick(availableLibraries[selectedLibraryIndex].id);
        }
      } else if (navigationMode === 'category') {
        selectedCategoryIndex = Math.max(0, selectedCategoryIndex - 1);
        if (selectedCategoryIndex >= 0 && selectedCategoryIndex < availableCategories.length && libraryId) {
          handleCategoryClick(libraryId, availableCategories[selectedCategoryIndex].id);
        }
      } else if (navigationMode === 'node') {
        selectedNodeIndex = Math.max(0, selectedNodeIndex - 1);
      }
    } else if (e.key === 'ArrowDown') {
      if (searchQuery) {
        // In search mode, navigate nodes
        navigationMode = 'node';
        selectedNodeIndex = Math.min(nodes.length - 1, selectedNodeIndex + 1);
      } else if (navigationMode === 'library') {
        selectedLibraryIndex = Math.min(availableLibraries.length - 1, selectedLibraryIndex + 1);
        if (selectedLibraryIndex >= 0 && selectedLibraryIndex < availableLibraries.length) {
          handleLibraryClick(availableLibraries[selectedLibraryIndex].id);
        }
      } else if (navigationMode === 'category') {
        selectedCategoryIndex = Math.min(availableCategories.length - 1, selectedCategoryIndex + 1);
        if (selectedCategoryIndex >= 0 && selectedCategoryIndex < availableCategories.length && libraryId) {
          handleCategoryClick(libraryId, availableCategories[selectedCategoryIndex].id);
        }
      } else if (navigationMode === 'node') {
        selectedNodeIndex = Math.min(nodes.length - 1, selectedNodeIndex + 1);
      }
    } else if (e.key === 'Enter') {
      if (searchQuery) {
        // In search mode, Enter creates the selected node
        if (navigationMode === 'node' && selectedNodeIndex >= 0 && selectedNodeIndex < nodes.length) {
          handleNodeClick(nodes[selectedNodeIndex]);
        }
      } else if (navigationMode === 'node' && selectedNodeIndex >= 0 && selectedNodeIndex < nodes.length) {
        handleNodeClick(nodes[selectedNodeIndex]);
      } else if (navigationMode === 'category' && selectedCategoryIndex >= 0 && selectedCategoryIndex < availableCategories.length && libraryId) {
        handleCategoryClick(libraryId, availableCategories[selectedCategoryIndex].id);
        navigationMode = 'node';
        selectedNodeIndex = 0;
      } else if (navigationMode === 'library' && selectedLibraryIndex >= 0 && selectedLibraryIndex < availableLibraries.length) {
        handleLibraryClick(availableLibraries[selectedLibraryIndex].id);
        if (availableCategories.length > 0) {
          navigationMode = 'category';
          selectedCategoryIndex = 0;
        }
      }
    }
  }
  
  // Auto-focus search input when panel opens
  $: if ((libraryId || categoryId) && searchInput) {
    setTimeout(() => {
      searchInput?.focus();
    }, 0);
  }
  
  // Focus panel element when it opens (for keyboard navigation)
  $: if ((libraryId || categoryId) && panelElement) {
    setTimeout(() => {
      // Only focus if search input is not focused
      if (document.activeElement !== searchInput) {
        panelElement?.focus();
      }
    }, 50);
  }
</script>

<svelte:window on:keydown={handleKeyDown} capture={true} />

{#if libraryId || categoryId}
  <div 
    class="node-panel" 
    bind:this={panelElement} 
    style="left: {calculatedPosition.x}px; top: {calculatedPosition.y}px"
    tabindex="-1"
    on:keydown={handleKeyDown}
  >
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
        {#each availableLibraries as library, index}
          <button
            class="library-item"
            class:active={libraryId === library.id}
            class:keyboard-selected={navigationMode === 'library' && selectedLibraryIndex === index}
            on:click={() => {
              selectedLibraryIndex = index;
              handleLibraryClick(library.id);
            }}
            on:mouseenter={() => {
              selectedLibraryIndex = index;
              handleLibraryClick(library.id);
            }}
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
          {#each availableCategories as category, index}
            <button
              class="category-item"
              class:active={categoryId === category.id}
              class:keyboard-selected={navigationMode === 'category' && selectedCategoryIndex === index}
              on:click={() => {
                selectedCategoryIndex = index;
                handleCategoryClick(currentLibrary.id, category.id);
              }}
              on:mouseenter={() => {
                selectedCategoryIndex = index;
                handleCategoryClick(currentLibrary.id, category.id);
              }}
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
          {#each nodes as node, index}
            <button
              class="node-item"
              class:keyboard-selected={navigationMode === 'node' && selectedNodeIndex === index}
              on:click={() => {
                selectedNodeIndex = index;
                handleNodeClick(node);
              }}
              on:mouseenter={() => {
                selectedNodeIndex = index;
              }}
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
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
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
  
  .library-item.keyboard-selected,
  .category-item.keyboard-selected,
  .node-item.keyboard-selected {
    background: rgba(66, 133, 244, 0.3);
    outline: 2px solid #4a9eff;
    outline-offset: -2px;
  }
  
  .library-item.keyboard-selected.active,
  .category-item.keyboard-selected.active {
    background: rgba(66, 133, 244, 0.35);
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
