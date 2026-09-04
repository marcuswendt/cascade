<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { nodeLibraries, projectNodeLibrary, getNodePathShort, customNodeTemplate, codeTemplates, type NodeTemplate, type Category } from './nodeTemplates';
  import { iconByModule, projectNodeModules } from './stores/executionLocus';
  import Icon from './Icon.svelte';
  import { typeToPackagePath } from '@/utils/nodeTypeUtils';
  import { nodeHistoryStore } from './stores/nodeHistoryStore';
  import CustomNodeDialog from './CustomNodeDialog.svelte';

  import { onMount } from 'svelte';

  // Custom node dialog state
  let showCustomNodeDialog = false;
  
  export let libraryId: string | null = null;
  export let categoryId: string | null = null;
  export let position: { x: number; y: number } = { x: 0, y: 0 };
  export let centerPosition: { x: number; y: number } = { x: 0, y: 0 };
  // When set, positions panel at this exact location (for dropdown menus)
  export let fixedPosition: { x: number; y: number } | null = null;
  
  const dispatch = createEventDispatcher();
  
  let searchInput: HTMLInputElement;
  let searchQuery = '';
  let panelElement: HTMLDivElement;
  let submenuElement: HTMLDivElement;
  let calculatedPosition = { x: 0, y: 0 };
  let hasCalculated = false;
  let mainColumnWidth = 160; // Default width, updated dynamically
  let submenuColumnWidth = 180; // Width of submenu column for third-level positioning

  // Navigation state
  let selectedLibraryIndex = -1;
  let selectedCategoryIndex = -1;
  let selectedNodeIndex = -1;
  let navigationMode: 'library' | 'category' | 'node' = 'library';
  let hoveredLibraryId: string | null | undefined = undefined; // undefined = no hover, null = "All", string = library id
  let hoveredCategoryId: string | null = null; // null = no category hovered
  let hoveredLibraryY: number = 0; // Y position of hovered library item
  let hoveredCategoryY: number = 0; // Y position of hovered category item

  $: effectiveLibraries = [
    ...nodeLibraries,
    ...($projectNodeModules.length ? [projectNodeLibrary($projectNodeModules, $iconByModule)] : []),
  ];
  
  // Calculate position relative to Graph window, centered on cursor, clamped to screen
  function calculatePosition() {
    // If fixedPosition is set, use it directly (for dropdown menus)
    if (fixedPosition) {
      calculatedPosition = { x: fixedPosition.x, y: fixedPosition.y };
      hasCalculated = true;
      return;
    }

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
      const panelWidth = 160;
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
    const panelWidth = panelRect.width || 160;
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
  
  // Recalculate when panel opens or position props change
  $: if (libraryId || categoryId) {
    // If fixedPosition is set, use it immediately without recalculation delays
    if (fixedPosition) {
      calculatedPosition = { x: fixedPosition.x, y: fixedPosition.y };
      hasCalculated = true;
    } else {
      // Use setTimeout to ensure DOM is updated after render for mouse-based positioning
      setTimeout(() => {
        calculatePosition();
        // Recalculate again after a short delay to account for panel content rendering
        setTimeout(() => {
          calculatePosition();
        }, 50);
      }, 0);
    }
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
      // Don't close if dialog is open
      if (showCustomNodeDialog) {
        return;
      }
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
        // Also check if click is inside the dialog
        const dialogOverlay = document.querySelector('.dialog-overlay');
        if (dialogOverlay?.contains(target)) {
          clickedInside = true;
        }
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
  $: currentLibrary = libraryId && libraryId !== 'all' ? effectiveLibraries.find(lib => lib.id === libraryId) : null;
  $: currentCategory = currentLibrary && categoryId 
    ? currentLibrary.categories.find(cat => cat.id === categoryId) 
    : null;
  
  // Get all nodes from a library (flattened from all categories)
  function getNodesFromLibrary(libId: string): NodeTemplate[] {
    const library = effectiveLibraries.find(lib => lib.id === libId);
    if (!library) return [];
    const all: NodeTemplate[] = [];
    library.categories.forEach(category => {
      all.push(...category.nodes);
    });
    return all;
  }
  
  // Get the hovered library object
  $: hoveredLibrary = hoveredLibraryId && hoveredLibraryId !== 'all'
    ? effectiveLibraries.find(lib => lib.id === hoveredLibraryId)
    : null;

  // Check if library has only one category - if so, flatten it
  $: hoveredLibraryHasSingleCategory = hoveredLibrary
    ? hoveredLibrary.categories.length === 1
    : false;

  // Get categories for hovered library, separating multi-node and single-node categories
  // If library has only one category, don't show it as a category (flatten it)
  $: hoveredLibraryCategories = hoveredLibrary
    ? (hoveredLibraryHasSingleCategory
        ? []
        : hoveredLibrary.categories.filter(cat => cat.nodes.length > 1))
    : [];

  // Get direct nodes (from single-node categories) for hovered library
  // If library has only one category, show all its nodes directly
  $: hoveredLibraryDirectNodes = hoveredLibrary
    ? (hoveredLibraryHasSingleCategory
        ? hoveredLibrary.categories[0].nodes
        : hoveredLibrary.categories
            .filter(cat => cat.nodes.length === 1)
            .map(cat => cat.nodes[0]))
    : [];

  // Get nodes for the hovered category (third level)
  $: hoveredCategoryNodes = hoveredCategoryId && hoveredLibrary
    ? (hoveredLibrary.categories.find(cat => cat.id === hoveredCategoryId)?.nodes || [])
    : [];

  // For "All" option - show all nodes flattened
  $: hoveredNodes = hoveredLibraryId === null
    ? effectiveLibraries.flatMap(library => library.categories.flatMap(category => category.nodes)).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  // Update main column width when submenu is about to show
  $: if (hoveredLibraryId !== undefined && panelElement) {
    mainColumnWidth = panelElement.getBoundingClientRect().width;
  }

  // Update submenu column width when category submenu is about to show
  $: if (hoveredCategoryId && submenuElement) {
    submenuColumnWidth = submenuElement.getBoundingClientRect().width;
  }

  // Reset category hover when library changes
  $: if (hoveredLibraryId) {
    hoveredCategoryId = null;
  }

  // Get nodes based on context
  $: nodes = searchQuery
    ? effectiveLibraries.flatMap(library => library.categories.flatMap(category => category.nodes))
        .filter(n => 
          n.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          n.description.toLowerCase().includes(searchQuery.toLowerCase())
        )
        .sort((a, b) => a.name.localeCompare(b.name))
    : libraryId === 'all' || (libraryId === null && !categoryId)
      ? effectiveLibraries.flatMap(library => library.categories.flatMap(category => category.nodes)).sort((a, b) => a.name.localeCompare(b.name))
      : libraryId && !categoryId
        ? getNodesFromLibrary(libraryId).sort((a, b) => a.name.localeCompare(b.name))
        : categoryId && libraryId
          ? (effectiveLibraries.find(library => library.id === libraryId)?.categories
              .find(category => category.id === categoryId)?.nodes ?? []).sort((a, b) => a.name.localeCompare(b.name))
          : [];
  
  // Get available libraries and categories for navigation (sorted alphabetically, excluding custom)
  $: availableLibraries = effectiveLibraries
    .filter(lib => lib.categories.some(cat => cat.nodes.length > 0))
    .sort((a, b) => a.label.localeCompare(b.label));
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
    // Annotation types use colon prefix (e.g., "annotation:text") - pass as-is
    // Other types get converted to package path format
    const nodeType = node.type.startsWith('annotation:')
      ? node.type
      : typeToPackagePath(node.type);

    // Add to history (store the original node template, not the converted type)
    nodeHistoryStore.addToHistory({ name: node.name, icon: node.icon, description: node.description, type: node.type });

    dispatch('addNode', { type: nodeType, libraryId, categoryId: nodeCategoryId });
  }
  
  function handleCategoryClick(libId: string, catId: string) {
    dispatch('selectCategory', { libraryId: libId, categoryId: catId });
  }

  function handleCustomNodeCreate(e: CustomEvent<{ name: string; modulePath: string; baseClass: string; template: string }>) {
    const { name, modulePath, baseClass, template } = e.detail;

    // Get the code template for the selected base class
    const templateFn = codeTemplates[template] || codeTemplates.node;
    const code = templateFn(name);

    // Add to history
    nodeHistoryStore.addToHistory({
      name,
      icon: 'Zap',
      description: `Custom node based on ${baseClass}`,
      type: modulePath
    });

    // Dispatch with custom node config
    dispatch('addNode', {
      type: modulePath,
      libraryId: null,
      categoryId: null,
      customConfig: {
        name,
        modulePath,
        baseClass,
        code
      }
    });

    showCustomNodeDialog = false;
    handleClose();
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

  function handleSearchKeyDown(e: KeyboardEvent) {
    // Canvas owns single-key tools, so search keystrokes must not escape to
    // its window listener. Keep arrows for caret movement; only the result
    // navigation keys enter the panel handler.
    e.stopPropagation();
    if (['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key)) {
      handleKeyDown(e);
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
      // Only close if not moving to a submenu or dialog
      setTimeout(() => {
        if (showCustomNodeDialog) return;
        const activeHover = document.querySelector('.menu-column:hover');
        const dialogOpen = document.querySelector('.dialog-overlay');
        if (!activeHover && !dialogOpen) {
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
        on:keydown={handleSearchKeyDown}
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
          <span class="node-path">{getNodePathShort(node.type)}</span>
        </button>
      {/each}

      {#if nodes.length === 0}
        <div class="empty-state">
          No nodes found
        </div>
      {/if}
    {:else}
      <!-- Libraries list (alphabetically sorted) -->
      {#each availableLibraries as library, index}
        <button
          class="library-item"
          class:active={hoveredLibraryId === library.id}
          class:keyboard-selected={navigationMode === 'library' && selectedLibraryIndex === index}
          on:click={() => {
            selectedLibraryIndex = index;
            handleLibraryClick(library.id);
          }}
          on:mouseenter={(e) => {
            selectedLibraryIndex = index;
            hoveredLibraryId = library.id;
            hoveredLibraryY = (e.currentTarget as HTMLElement).getBoundingClientRect().top;
          }}
        >
          <span class="label">{library.label}</span>
          <span class="arrow-icon">
            <Icon name="ChevronRight" size={12} />
          </span>
        </button>
      {/each}

      <div class="separator"></div>

      <!-- All nodes option -->
      <button
        class="library-item"
        class:active={hoveredLibraryId === null}
        class:keyboard-selected={navigationMode === 'library' && selectedLibraryIndex === availableLibraries.length}
        on:click={() => {
          selectedLibraryIndex = availableLibraries.length;
          handleLibraryClick('all');
        }}
        on:mouseenter={(e) => {
          selectedLibraryIndex = availableLibraries.length;
          hoveredLibraryId = null;
          hoveredLibraryY = (e.currentTarget as HTMLElement).getBoundingClientRect().top;
        }}
      >
        <span class="label">All</span>
        <span class="arrow-icon">
          <Icon name="ChevronRight" size={12} />
        </span>
      </button>

      <div class="separator"></div>

      <!-- Custom button -->
      <button
        class="library-item"
        on:click={() => {
          showCustomNodeDialog = true;
        }}
        title={customNodeTemplate.description}
      >
        <span class="node-icon">
          <Icon name={customNodeTemplate.icon} size={16} />
        </span>
        <span class="label">{customNodeTemplate.name}</span>
      </button>

      <!-- History section -->
      {#if $nodeHistoryStore.length > 0}
        <div class="separator"></div>
        <div class="section-label">Recent</div>
        {#each $nodeHistoryStore as node, index}
          <button
            class="node-item history-item"
            on:click={() => handleNodeClick(node)}
            title={node.description}
          >
            <span class="node-icon">
              <Icon name={node.icon} size={16} />
            </span>
            <span class="node-name">{node.name}</span>
            <span class="node-path">{getNodePathShort(node.type)}</span>
          </button>
        {/each}
      {/if}
    {/if}
  </div>
  
  <!-- Submenu column for library hover -->
  {#if !searchQuery && hoveredLibraryId !== undefined}
    <!-- For "All" - show flattened nodes -->
    {#if hoveredLibraryId === null && hoveredNodes.length > 0}
      <div
        class="menu-column submenu-column"
        style="left: {calculatedPosition.x + mainColumnWidth}px; top: {hoveredLibraryY}px; max-height: {Math.max(200, window.innerHeight - hoveredLibraryY - 20)}px;"
        on:mouseenter={() => {}}
        on:mouseleave|self={() => {
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
            <span class="node-path">{getNodePathShort(node.type)}</span>
          </button>
        {/each}
      </div>
    <!-- For specific library - show categories and direct nodes -->
    {:else if hoveredLibrary && (hoveredLibraryCategories.length > 0 || hoveredLibraryDirectNodes.length > 0)}
      <div
        bind:this={submenuElement}
        class="menu-column submenu-column"
        style="left: {calculatedPosition.x + mainColumnWidth}px; top: {hoveredLibraryY}px; max-height: {Math.max(200, window.innerHeight - hoveredLibraryY - 20)}px;"
        on:mouseenter={() => {}}
        on:mouseleave|self={() => {
          setTimeout(() => {
            const activeHover = document.querySelector('.menu-column:hover');
            if (!activeHover) {
              hoveredLibraryId = undefined;
              hoveredCategoryId = null;
            }
          }, 50);
        }}
      >
        <!-- Multi-node categories (expandable) -->
        {#each hoveredLibraryCategories as category}
          <button
            class="library-item"
            class:active={hoveredCategoryId === category.id}
            on:click={() => {
              // Click on category could expand it, or we can make it just hover
            }}
            on:mouseenter={(e) => {
              hoveredCategoryId = category.id;
              hoveredCategoryY = (e.currentTarget as HTMLElement).getBoundingClientRect().top;
            }}
          >
            <span class="label">{category.label}</span>
            <span class="arrow-icon">
              <Icon name="ChevronRight" size={12} />
            </span>
          </button>
        {/each}

        <!-- Separator if we have both categories and direct nodes -->
        {#if hoveredLibraryCategories.length > 0 && hoveredLibraryDirectNodes.length > 0}
          <div class="separator"></div>
        {/if}

        <!-- Single-node categories shown as direct nodes -->
        {#each hoveredLibraryDirectNodes as node}
          <button
            class="node-item"
            on:click={() => handleNodeClick(node)}
            on:mouseenter={() => {
              hoveredCategoryId = null;
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

      <!-- Third level: nodes for hovered category -->
      {#if hoveredCategoryId && hoveredCategoryNodes.length > 0}
        <div
          class="menu-column submenu-column nodes-submenu"
          style="left: {calculatedPosition.x + mainColumnWidth + submenuColumnWidth}px; top: {hoveredCategoryY}px; max-height: {Math.max(200, window.innerHeight - hoveredCategoryY - 20)}px;"
          on:mouseenter={() => {}}
          on:mouseleave|self={() => {
            setTimeout(() => {
              const activeHover = document.querySelector('.menu-column:hover');
              if (!activeHover) {
                hoveredCategoryId = null;
              }
            }, 50);
          }}
        >
          {#each hoveredCategoryNodes as node, index}
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
  {/if}
{/if}

<!-- Custom Node Creation Dialog -->
<CustomNodeDialog
  bind:open={showCustomNodeDialog}
  on:create={handleCustomNodeCreate}
  on:close={() => showCustomNodeDialog = false}
/>

<style>
  .menu-column {
    position: fixed;
    min-width: 160px;
    max-height: 400px;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    background: var(--surface-raised);
    border-radius: 6px;
    border: 1px solid var(--border-divider);
    box-shadow: 0 8px 24px var(--shadow-soft);
    z-index: 200;
    padding: 4px 0;
    animation: fadeIn 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .main-column {
    z-index: 201;
  }

  .submenu-column {
    z-index: 200;
    min-width: 180px;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .nodes-submenu {
    z-index: 199;
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

  .search {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-divider);
    flex-shrink: 0;
    margin-bottom: 4px;
  }

  .search-input {
    width: 100%;
    padding: 5px 8px;
    background: var(--surface-input);
    border: 1px solid var(--border-divider);
    border-radius: 4px;
    color: var(--text-bright);
    font-size: 13px;
    box-sizing: border-box;
  }

  .search-input:focus {
    outline: none;
    border-color: var(--accent-alt);
    background: var(--surface-hover);
  }

  .search-input::placeholder {
    color: var(--text-subtle);
  }

  .library-item .arrow-icon {
    color: var(--text-subtle);
    margin-left: auto;
    display: flex;
    align-items: center;
  }

  .library-item:hover .arrow-icon,
  .library-item.active .arrow-icon {
    color: var(--text-bright);
  }

  .library-item,
  .node-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background 0.1s;
    text-align: left;
    width: 100%;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .library-item:hover,
  .node-item:hover {
    background: var(--accent-alt);
    color: var(--text-on-accent);
  }

  .library-item.active {
    background: var(--accent-alt);
    color: var(--text-on-accent);
  }

  .library-item.keyboard-selected,
  .node-item.keyboard-selected {
    background: var(--accent-alt);
    color: var(--text-on-accent);
  }

  .library-item.keyboard-selected.active {
    background: var(--accent-alt);
  }

  .node-item .node-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    flex-shrink: 0;
    color: var(--text-subtle);
  }

  .node-item:hover .node-icon,
  .node-item.keyboard-selected .node-icon {
    color: var(--text-bright);
  }

  .library-item .label,
  .node-item .node-name {
    font-size: 13px;
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .node-path {
    font-size: 10px;
    color: var(--text-faintest);
    margin-left: auto;
    padding-left: 8px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .node-item:hover .node-path,
  .node-item.keyboard-selected .node-path {
    color: var(--text-tint-half);
  }

  .separator {
    height: 1px;
    background: var(--surface-active);
    margin: 4px 8px;
  }

  .section-label {
    font-size: 11px;
    color: var(--text-subtle);
    padding: 4px 12px 2px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .history-item {
    color: var(--text-dim);
  }

  .history-item:hover {
    color: var(--text-bright);
  }

  .empty-state {
    padding: 24px 12px;
    text-align: center;
    color: var(--text-subtle);
    font-size: 13px;
  }
</style>
