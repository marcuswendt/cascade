<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { nodeLibraries, getAllNodes, getNodesByLibraryAndCategory, type NodeTemplate, type Category } from './nodeTemplates';
  import Icon from './Icon.svelte';
  import { typeToPackagePath } from '@/utils/nodeTypeUtils';
  
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
  let hoveredLibraryId: string | null | undefined = undefined; // undefined = no hover, null = "All", string = library id
  
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
      const panelWidth = 100;
      const panelHeight = 400;
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
      const panelWidth = panelRect.width || 100;
      const panelHeight = panelRect.height || 400;
    
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
    
    // Handle click outside to close menu
    const handleDocumentClick = (e: MouseEvent) => {
      if (libraryId || categoryId) {
        const target = e.target as HTMLElement;
        // Check if click is outside all menu columns
        const menuColumns = document.querySelectorAll('.menu-column');
        let clickedInside = false;
        menuColumns.forEach(column => {
          if (column.contains(target)) {
            clickedInside = true;
          }
        });
        if (!clickedInside) {
          handleClose();
        }
      }
    };
    
    // Use capture phase to catch clicks before they bubble
    document.addEventListener('mousedown', handleDocumentClick, true);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('mousedown', handleDocumentClick, true);
    };
  });
  
  // Get current library and category
  $: currentLibrary = libraryId && libraryId !== 'all' ? nodeLibraries.find(lib => lib.id === libraryId) : null;
  $: currentCategory = currentLibrary && categoryId 
    ? currentLibrary.categories.find(cat => cat.id === categoryId) 
    : null;
  
  // Get all nodes from a library (flattened from all categories)
  function getNodesFromLibrary(libId: string): NodeTemplate[] {
    const library = nodeLibraries.find(lib => lib.id === libId);
    if (!library) return [];
    const all: NodeTemplate[] = [];
    library.categories.forEach(category => {
      all.push(...category.nodes);
    });
    return all;
  }
  
  // Get nodes for the hovered library (for submenu)
  $: hoveredNodes = hoveredLibraryId === null
    ? getAllNodes().sort((a, b) => a.name.localeCompare(b.name))
    : hoveredLibraryId !== undefined
      ? getNodesFromLibrary(hoveredLibraryId).sort((a, b) => a.name.localeCompare(b.name))
      : [];
  
  // Get nodes based on context
  $: nodes = searchQuery
    ? getAllNodes()
        .filter(n => 
          n.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          n.description.toLowerCase().includes(searchQuery.toLowerCase())
        )
        .sort((a, b) => a.name.localeCompare(b.name))
    : libraryId === 'all' || (libraryId === null && !categoryId)
      ? getAllNodes().sort((a, b) => a.name.localeCompare(b.name))
      : libraryId && !categoryId
        ? getNodesFromLibrary(libraryId).sort((a, b) => a.name.localeCompare(b.name))
        : categoryId && libraryId
          ? getNodesByLibraryAndCategory(libraryId, categoryId).sort((a, b) => a.name.localeCompare(b.name))
          : [];
  
  // Get available libraries and categories for navigation
  $: availableLibraries = nodeLibraries.filter(lib => lib.categories.some(cat => cat.nodes.length > 0) && lib.id !== 'custom');
  // Filter categories: show only categories with multiple nodes, single-entry categories are flattened
  $: availableCategories = currentLibrary ? currentLibrary.categories.filter(cat => cat.nodes.length > 1) : [];
  // Get direct nodes from single-entry categories (to be shown when library is selected)
  $: directNodes = currentLibrary && !categoryId && !searchQuery
    ? currentLibrary.categories
        .filter(cat => cat.nodes.length === 1)
        .map(cat => ({ ...cat.nodes[0], categoryId: cat.id }))
    : [];
  // Combined list of all items in the categories column (categories + direct nodes)
  $: categoryColumnItems = currentLibrary && !categoryId && !searchQuery
    ? [
        ...availableCategories.map(cat => ({ type: 'category', data: cat })),
        ...directNodes.map(node => ({ type: 'node', data: node }))
      ]
    : [];
  
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
      // Always start in library mode to show libraries list
      if (selectedLibraryIndex === -1) {
        if (libraryId && libraryId !== 'all') {
          selectedLibraryIndex = availableLibraries.findIndex(lib => lib.id === libraryId);
          if (selectedLibraryIndex === -1) selectedLibraryIndex = 0;
        } else {
          selectedLibraryIndex = 0;
        }
        // Start in library mode - user must click to see nodes
        navigationMode = 'library';
      }
      if (categoryId && currentLibrary && selectedCategoryIndex === -1) {
        selectedCategoryIndex = availableCategories.findIndex(cat => cat.id === categoryId);
        if (selectedCategoryIndex === -1) selectedCategoryIndex = 0;
        if (categoryId) navigationMode = 'node';
      }
      // Update category index for the combined categories column
      if (selectedCategoryIndex === -1 && categoryColumnItems.length > 0 && navigationMode === 'category' && !categoryId) {
        selectedCategoryIndex = 0;
      } else if (navigationMode === 'category' && selectedCategoryIndex >= categoryColumnItems.length) {
        selectedCategoryIndex = Math.max(0, categoryColumnItems.length - 1);
      }
      // Update node index for the nodes column (when a category is selected)
      if (selectedNodeIndex === -1 && nodes.length > 0 && navigationMode === 'node' && categoryId) {
        selectedNodeIndex = 0;
      } else if (navigationMode === 'node' && selectedNodeIndex >= nodes.length && categoryId) {
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
      const mainColumn = panelElement?.querySelector('.main-column .column-content');
      const selectedButton = mainColumn?.children[selectedLibraryIndex + 1] as HTMLElement; // +1 for search bar
      if (selectedButton) {
        selectedButton.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 0);
  }
  
  $: if (navigationMode === 'category' && selectedCategoryIndex >= 0 && !categoryId) {
    setTimeout(() => {
      const mainColumn = panelElement?.querySelector('.main-column .column-content');
      const selectedButton = mainColumn?.children[selectedCategoryIndex] as HTMLElement;
      if (selectedButton) {
        selectedButton.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 0);
  }
  
  $: if (navigationMode === 'node' && selectedNodeIndex >= 0) {
    setTimeout(() => {
      const nodesColumn = document.querySelector('.nodes-column .column-content');
      if (!nodesColumn) {
        // Fallback to main column if searching
        const mainColumn = panelElement?.querySelector('.main-column .column-content');
        const selectedButton = mainColumn?.children[selectedNodeIndex] as HTMLElement;
        if (selectedButton) {
          selectedButton.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      } else {
        const selectedButton = nodesColumn.children[selectedNodeIndex] as HTMLElement;
        if (selectedButton) {
          selectedButton.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    }, 0);
  }
  
  function handleNodeClick(node: NodeTemplate & { categoryId?: string }) {
    // Use the categoryId from direct nodes if available, otherwise use the current categoryId
    const nodeCategoryId = node.categoryId || categoryId;
    // Convert to package path format
    const packagePath = typeToPackagePath(node.type);
    dispatch('addNode', { type: packagePath, libraryId, categoryId: nodeCategoryId });
  }
  
  function handleCategoryClick(libId: string, catId: string) {
    dispatch('selectCategory', { libraryId: libId, categoryId: catId });
  }
  
  function handleLibraryClick(libId: string) {
    if (libId === 'all') {
      // Show all nodes from all libraries
      dispatch('selectLibrary', { libraryId: null });
      navigationMode = 'node';
    } else {
      dispatch('selectLibrary', { libraryId: libId });
      navigationMode = 'node';
    }
  }
  
  function handleCustomNodeClick() {
    // Direct creation of custom node, bypassing library/category
    // Custom nodes don't have package paths, use as-is
    dispatch('addNode', { type: 'Custom', libraryId: null, categoryId: null });
  }
  
  function handleClose() {
    dispatch('close');
  }
  
  
  // Helper functions for type casting in templates
  function getCategory(item: { type: string; data: any }): Category {
    return item.data as Category;
  }
  
  function getNode(item: { type: string; data: any }): NodeTemplate & { categoryId?: string } {
    return item.data as NodeTemplate & { categoryId?: string };
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
        if (categoryId) {
          // Go back from nodes column to categories column
          navigationMode = 'category';
          selectedNodeIndex = -1;
          categoryId = null;
        } else {
          // Go back from categories column to library column
          navigationMode = 'library';
          selectedCategoryIndex = -1;
        }
      } else if (navigationMode === 'node' && categoryId) {
        navigationMode = 'category';
        selectedNodeIndex = -1;
      }
    } else if (e.key === 'ArrowRight') {
      if (searchQuery) {
        // In search mode, right arrow does nothing
        return;
      }
      if (navigationMode === 'library' && libraryId) {
        if (availableCategories.length > 0 || directNodes.length > 0) {
          navigationMode = 'category';
          if (selectedCategoryIndex === -1) selectedCategoryIndex = 0;
        }
      } else if (navigationMode === 'category' && !categoryId) {
        // In categories column, check if selected item is a category (not a direct node)
        if (selectedCategoryIndex >= 0 && selectedCategoryIndex < categoryColumnItems.length) {
          const item = categoryColumnItems[selectedCategoryIndex];
          if (item.type === 'category' && 'id' in item.data) {
            // Select the category to show its nodes
            if (libraryId && 'id' in item.data) {
              handleCategoryClick(libraryId, item.data.id);
            }
            navigationMode = 'node';
            if (selectedNodeIndex === -1) selectedNodeIndex = 0;
          }
        }
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
        if (categoryId) {
          // Navigating within a selected category's nodes
          selectedNodeIndex = Math.max(0, selectedNodeIndex - 1);
        } else {
          // Navigating within the categories column (categories + direct nodes)
          selectedCategoryIndex = Math.max(0, selectedCategoryIndex - 1);
          if (selectedCategoryIndex >= 0 && selectedCategoryIndex < categoryColumnItems.length && libraryId) {
            const item = categoryColumnItems[selectedCategoryIndex];
            if (item.type === 'category' && 'id' in item.data) {
              handleCategoryClick(libraryId, item.data.id);
            }
          }
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
        if (categoryId) {
          // Navigating within a selected category's nodes
          selectedNodeIndex = Math.min(nodes.length - 1, selectedNodeIndex + 1);
        } else {
          // Navigating within the categories column (categories + direct nodes)
          selectedCategoryIndex = Math.min(categoryColumnItems.length - 1, selectedCategoryIndex + 1);
          if (selectedCategoryIndex >= 0 && selectedCategoryIndex < categoryColumnItems.length && libraryId) {
            const item = categoryColumnItems[selectedCategoryIndex];
            if (item.type === 'category' && 'id' in item.data) {
              handleCategoryClick(libraryId, item.data.id);
            }
          }
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
      } else if (navigationMode === 'node' && categoryId) {
        if (selectedNodeIndex >= 0 && selectedNodeIndex < nodes.length) {
          handleNodeClick(nodes[selectedNodeIndex]);
        }
      } else if (navigationMode === 'category' && !categoryId) {
        // In categories column, handle both categories and direct nodes
        if (selectedCategoryIndex >= 0 && selectedCategoryIndex < categoryColumnItems.length && libraryId) {
          const item = categoryColumnItems[selectedCategoryIndex];
          if (item.type === 'category' && 'id' in item.data) {
            handleCategoryClick(libraryId, item.data.id);
            navigationMode = 'node';
            selectedNodeIndex = 0;
          } else if (item.type === 'computation') {
            // Direct node - create it immediately
            handleNodeClick(getNode(item));
          }
        }
      } else if (navigationMode === 'library' && selectedLibraryIndex >= 0 && selectedLibraryIndex < availableLibraries.length) {
        handleLibraryClick(availableLibraries[selectedLibraryIndex].id);
        if (availableCategories.length > 0 || directNodes.length > 0) {
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

<svelte:window on:keydown={handleKeyDown} />

{#if libraryId || categoryId}
  <!-- Main column with libraries -->
  <div 
    class="menu-column main-column" 
    bind:this={panelElement} 
    style="left: {calculatedPosition.x}px; top: {calculatedPosition.y}px"
    tabindex="-1"
    on:keydown={handleKeyDown}
    on:mouseleave|self={(e) => {
      // Only close if not moving to a submenu
      setTimeout(() => {
        const activeHover = document.querySelector('.menu-column:hover');
        if (!activeHover) {
          handleClose();
        }
      }, 100);
    }}
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
    
    {#if searchQuery}
      <!-- Show search results -->
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
          No nodes found
        </div>
      {/if}
    {:else}
      <!-- Libraries list -->
      {#each availableLibraries as library, index}
        <button
          class="library-item"
          class:active={hoveredLibraryId === library.id}
          class:keyboard-selected={navigationMode === 'library' && selectedLibraryIndex === index}
          on:click={() => {
            selectedLibraryIndex = index;
            handleLibraryClick(library.id);
          }}
          on:mouseenter={() => {
            selectedLibraryIndex = index;
            hoveredLibraryId = library.id;
          }}
        >
          <span class="label">{library.label}</span>
          <span class="arrow-icon">
            <Icon name="ChevronRight" size={12} />
          </span>
        </button>
      {/each}
      
      <!-- All nodes option -->
      <button
        class="library-item"
        class:active={hoveredLibraryId === null}
        class:keyboard-selected={navigationMode === 'library' && selectedLibraryIndex === availableLibraries.length}
        on:click={() => {
          selectedLibraryIndex = availableLibraries.length;
          handleLibraryClick('all');
        }}
        on:mouseenter={() => {
          selectedLibraryIndex = availableLibraries.length;
          hoveredLibraryId = null;
        }}
      >
        <span class="label">All</span>
        <span class="arrow-icon">
          <Icon name="ChevronRight" size={12} />
        </span>
      </button>
      
      <!-- Custom button -->
      <button
        class="library-item custom-button"
        on:click={handleCustomNodeClick}
      >
        <span class="label">Custom</span>
      </button>
    {/if}
  </div>
  
  <!-- Nodes submenu column (appears when library is hovered) -->
  {#if !searchQuery && hoveredLibraryId !== undefined && hoveredNodes.length > 0}
    <div 
      class="menu-column submenu-column"
      style="left: {calculatedPosition.x + 108}px; top: {calculatedPosition.y}px"
      on:mouseenter={() => {
        // Keep submenu open when hovering over it
      }}
      on:mouseleave|self={() => {
        // Close submenu when leaving it
        setTimeout(() => {
          const activeHover = document.querySelector('.menu-column:hover');
          if (!activeHover) {
            hoveredLibraryId = undefined;
          }
        }, 50);
      }}
    >
      {#each hoveredNodes as node, index}
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
    </div>
  {/if}
{/if}

<style>
  
  .menu-column {
    position: fixed;
    width: 100px;
    max-height: 400px;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    background: rgba(30, 30, 30, 0.98);
    backdrop-filter: blur(20px);
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    z-index: 200;
    padding: 2px;
    animation: fadeIn 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }
  
  .main-column {
    z-index: 201;
  }
  
  .submenu-column {
    z-index: 200;
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
    padding: 4px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    flex-shrink: 0;
    margin-bottom: 2px;
  }
  
  .search-input {
    width: 100%;
    padding: 2px 4px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    color: #fff;
    font-size: 11px;
    box-sizing: border-box;
  }
  
  .search-input:focus {
    outline: none;
    border-color: #4a9eff;
    background: rgba(255, 255, 255, 0.08);
  }
  
  
  
  .library-item .arrow-icon {
    opacity: 0.5;
    margin-left: auto;
    display: flex;
    align-items: center;
  }
  
  .library-item.active .arrow-icon {
    opacity: 0.8;
  }
  
  
  .library-item,
  .node-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px;
    background: transparent;
    border: none;
    border-radius: 2px;
    cursor: pointer;
    transition: all 0.1s ease;
    text-align: left;
    width: 100%;
    font-size: 11px;
    min-height: 18px;
  }
  
  .library-item:hover,
  .node-item:hover {
    background: rgba(66, 133, 244, 0.15);
  }
  
  .library-item.active {
    background: rgba(66, 133, 244, 0.25);
    color: #4a9eff;
  }
  
  .library-item.keyboard-selected,
  .node-item.keyboard-selected {
    background: rgba(66, 133, 244, 0.3);
    outline: 2px solid #4a9eff;
    outline-offset: -2px;
  }
  
  .library-item.keyboard-selected.active {
    background: rgba(66, 133, 244, 0.35);
  }
  
  .node-item .node-icon {
    font-size: 12px;
    line-height: 1;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
  }
  
  .library-item .label,
  .node-item .node-name {
    font-size: 11px;
    font-weight: 400;
    color: #fff;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .custom-button {
    margin-top: 0;
  }
  
  .empty-state {
    padding: 32px;
    text-align: center;
    color: #666;
    font-size: 14px;
  }
</style>
