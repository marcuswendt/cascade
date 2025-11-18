<script lang="ts">
  import { onMount } from 'svelte';
  import Window from './Window.svelte';
  import Splitter from './Splitter.svelte';
  import Canvas from './Canvas.svelte';
  import Viewer from './Viewer.svelte';
  import Inspector from './Inspector.svelte';
  import Log from './Log.svelte';
  import BottomToolbar from './BottomToolbar.svelte';
  import Tabs from './Tabs.svelte';
  import CodeEditor from './CodeEditor.svelte';
  import type { Graph } from '@/core/Graph';
  import type { Node } from '@/core/Node';
  
  import { createEventDispatcher } from 'svelte';
  
  export let graph: Graph | undefined;
  export let selectedNode: Node | null = null;
  export let selectedAnnotation: string | null = null;
  export let activeTool: string = 'select';
  export let activeLibrary: string | null = null;
  export let presentationMode: boolean = false;
  
  const dispatch = createEventDispatcher();
  let canvasRef: any = null;
  let logRef: any = null;
  
  // Expose canvasRef to parent
  export { canvasRef };
  
  // Tab management for code editors - tabs can be in any window region
  interface Tab {
    id: string;
    type: 'graph' | 'editor' | 'viewer' | 'log' | 'inspector';
    label: string;
    windowId: string; // Which window region this tab belongs to: 'graph', 'viewer', 'log', 'inspector'
    node?: Node; // Only for editor tabs
  }
  
  const GRAPH_TAB_ID = 'graph-tab';
  const VIEWER_TAB_ID = 'viewer-tab';
  const LOG_TAB_ID = 'log-tab';
  const INSPECTOR_TAB_ID = 'inspector-tab';
  
  // Track tabs per window region
  let tabsByWindow: Map<string, Tab[]> = new Map([
    ['graph', []],
    ['viewer', []],
    ['log', []],
    ['inspector', []]
  ]);
  let activeTabIds: Map<string, string | null> = new Map([
    ['graph', null],
    ['viewer', null],
    ['log', null],
    ['inspector', null]
  ]);
  
  // Helper to get tabs for a window
  function getTabsForWindow(windowId: string): Tab[] {
    return tabsByWindow.get(windowId) || [];
  }
  
  // Helper to get active tab for a window
  function getActiveTabForWindow(windowId: string): Tab | null {
    const tabs = getTabsForWindow(windowId);
    const activeId = activeTabIds.get(windowId);
    return tabs.find(tab => tab.id === activeId) || null;
  }
  
  function getDefaultTabId(windowId: string): string {
    switch (windowId) {
      case 'graph': return GRAPH_TAB_ID;
      case 'viewer': return VIEWER_TAB_ID;
      case 'log': return LOG_TAB_ID;
      case 'inspector': return INSPECTOR_TAB_ID;
      default: return GRAPH_TAB_ID;
    }
  }
  
  function getDefaultTabType(windowId: string): 'graph' | 'viewer' | 'log' | 'inspector' {
    switch (windowId) {
      case 'graph': return 'graph';
      case 'viewer': return 'viewer';
      case 'log': return 'log';
      case 'inspector': return 'inspector';
      default: return 'graph';
    }
  }
  
  function ensureDefaultTab(windowId: string) {
    // Add default tab if it doesn't exist in this window
    const tabs = getTabsForWindow(windowId);
    const defaultTabId = getDefaultTabId(windowId);
    const defaultTab = tabs.find(tab => tab.id === defaultTabId);
    if (!defaultTab) {
      const defaultTabType = getDefaultTabType(windowId);
      const defaultLabel = windowId.charAt(0).toUpperCase() + windowId.slice(1);
      const newTabs = [
        { id: defaultTabId, type: defaultTabType, label: defaultLabel, windowId },
        ...tabs
      ];
      tabsByWindow.set(windowId, newTabs);
      // Set default tab as active if no active tab is set
      const currentActiveId = activeTabIds.get(windowId);
      if (!currentActiveId) {
        activeTabIds.set(windowId, defaultTabId);
        activeTabIds = new Map(activeTabIds);
      }
      tabsByWindow = new Map(tabsByWindow);
    }
  }
  
  function removeDefaultTab(windowId: string) {
    // Remove default tab if no editor tabs remain
    const tabs = getTabsForWindow(windowId);
    const defaultTabId = getDefaultTabId(windowId);
    const editorTabs = tabs.filter(tab => tab.type === 'editor');
    
    if (editorTabs.length === 0) {
      // No editor tabs, remove all tabs
      tabsByWindow.set(windowId, []);
      activeTabIds.set(windowId, null);
      tabsByWindow = new Map(tabsByWindow);
      activeTabIds = new Map(activeTabIds);
    } else {
      // Keep editor tabs, remove default tab
      const newTabs = tabs.filter(tab => tab.id !== defaultTabId);
      tabsByWindow.set(windowId, newTabs);
      tabsByWindow = new Map(tabsByWindow);
    }
  }
  
  function createWindowTab(type: 'viewer' | 'log' | 'inspector', targetWindowId: string) {
    const tabId = `${type}-tab-${Date.now()}`;
    const labels = {
      viewer: 'Viewer',
      log: 'Log',
      inspector: 'Inspector'
    };
    
    const newTab: Tab = {
      id: tabId,
      type,
      label: labels[type],
      windowId: targetWindowId
    };
    
    const tabs = getTabsForWindow(targetWindowId);
    const newTabs = [...tabs, newTab];
    tabsByWindow.set(targetWindowId, newTabs);
    activeTabIds.set(targetWindowId, tabId);
    tabsByWindow = new Map(tabsByWindow);
    activeTabIds = new Map(activeTabIds);
  }
  
  function openEditorTab(node: Node, targetWindowId: string = 'graph') {
    // Always ensure default tab exists when opening an editor
    ensureDefaultTab(targetWindowId);
    const tabs = getTabsForWindow(targetWindowId);
    
    // Check if tab already exists for this node in any window
    for (const [windowId, windowTabs] of tabsByWindow.entries()) {
      const existingTab = windowTabs.find(tab => tab.type === 'editor' && tab.node?.id === node.id);
      if (existingTab) {
        // Switch to the window containing this tab
        activeTabIds.set(windowId, existingTab.id);
        activeTabIds = new Map(activeTabIds);
        return;
      }
    }
    
    // Create new editor tab in target window
    const tabId = `editor-${node.id}`;
    const newTab: Tab = {
      id: tabId,
      type: 'editor',
      node,
      label: node.name,
      windowId: targetWindowId
    };
    
    const newTabs = [...tabs, newTab];
    tabsByWindow.set(targetWindowId, newTabs);
    activeTabIds.set(targetWindowId, tabId);
    tabsByWindow = new Map(tabsByWindow);
    activeTabIds = new Map(activeTabIds);
  }
  
  function closeTab(tabId: string, windowId: string) {
    // Don't allow closing default tabs
    const defaultTabId = getDefaultTabId(windowId);
    if (tabId === defaultTabId) {
      return;
    }
    
    const tabs = getTabsForWindow(windowId);
    const newTabs = tabs.filter(tab => tab.id !== tabId);
    tabsByWindow.set(windowId, newTabs);
    tabsByWindow = new Map(tabsByWindow);
    
    // If we closed the active tab, switch to another tab
    const activeId = activeTabIds.get(windowId);
    if (activeId === tabId) {
      if (newTabs.length > 0) {
        activeTabIds.set(windowId, newTabs[newTabs.length - 1].id);
      } else {
        activeTabIds.set(windowId, null);
      }
      activeTabIds = new Map(activeTabIds);
    }
    
    // Remove default tab if no editor tabs remain
    const hasEditorTabs = newTabs.some(tab => tab.type === 'editor');
    if (!hasEditorTabs) {
      removeDefaultTab(windowId);
    }
  }
  
  function selectTab(tabId: string, windowId: string) {
    activeTabIds.set(windowId, tabId);
    activeTabIds = new Map(activeTabIds);
  }
  
  function moveTab(tabId: string, fromWindowId: string, toWindowId: string) {
    const fromTabs = getTabsForWindow(fromWindowId);
    const tab = fromTabs.find(t => t.id === tabId);
    if (!tab) return;
    
    // Remove from source window
    const newFromTabs = fromTabs.filter(t => t.id !== tabId);
    tabsByWindow.set(fromWindowId, newFromTabs);
    
    // Add to target window
    const toTabs = getTabsForWindow(toWindowId);
    const newTab = { ...tab, windowId: toWindowId };
    const newToTabs = [...toTabs, newTab];
    tabsByWindow.set(toWindowId, newToTabs);
    
    // Update active tab in source window
    const fromActiveId = activeTabIds.get(fromWindowId);
    if (fromActiveId === tabId) {
      if (newFromTabs.length > 0) {
        activeTabIds.set(fromWindowId, newFromTabs[newFromTabs.length - 1].id);
      } else {
        activeTabIds.set(fromWindowId, null);
      }
    }
    
    // Set as active in target window
    activeTabIds.set(toWindowId, tabId);
    
    tabsByWindow = new Map(tabsByWindow);
    activeTabIds = new Map(activeTabIds);
    
    // Ensure default tab in target window if needed
    if (tab.type === 'editor' && toTabs.length === 0) {
      ensureDefaultTab(toWindowId);
    }
    
    // Remove default tab from source if no editor tabs remain
    const hasEditorTabs = newFromTabs.some(t => t.type === 'editor');
    if (!hasEditorTabs) {
      removeDefaultTab(fromWindowId);
    }
  }
  
  function handleNodeEdit(e: CustomEvent<{ node: Node }>) {
    openEditorTab(e.detail.node, 'graph');
  }
  
  function handleTabDragStart(e: CustomEvent<{ tabId: string; event: DragEvent }>, windowId: string) {
    const dragEvent = e.detail.event;
    const tabId = e.detail.tabId;
    if (dragEvent.dataTransfer) {
      dragEvent.dataTransfer.effectAllowed = 'move';
      dragEvent.dataTransfer.setData('text/plain', JSON.stringify({ tabId, windowId }));
    }
  }
  
  function handleTabDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
  }
  
  function handleTabDrop(e: DragEvent, targetWindowId: string) {
    e.preventDefault();
    e.stopPropagation();
    
    const data = e.dataTransfer?.getData('text/plain');
    if (!data) return;
    
    try {
      const { tabId, windowId: sourceWindowId } = JSON.parse(data);
      if (sourceWindowId !== targetWindowId) {
        moveTab(tabId, sourceWindowId, targetWindowId);
      }
    } catch (err) {
      console.error('Error parsing drag data:', err);
    }
  }
  
  // Track mouse position to determine if graph window is active
  let graphWindowActive = false;
  let graphWindowElement: HTMLElement | null = null;
  
  function handleGraphWindowMouseEnter() {
    graphWindowActive = true;
  }
  
  function handleGraphWindowMouseLeave() {
    graphWindowActive = false;
  }
  
  function handleNumberKeyPress(e: KeyboardEvent) {
    // Only handle if graph window is active and not typing in an input
    if (!graphWindowActive) return;
    
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }
    
    // Check if it's a number key (1-9)
    const key = e.key;
    const number = parseInt(key);
    
    if (!isNaN(number) && number >= 1 && number <= 9) {
      const tabs = getTabsForWindow('graph');
      const tabIndex = number - 1; // Convert to 0-based index
      
      if (tabIndex < tabs.length) {
        e.preventDefault();
        selectTab(tabs[tabIndex].id, 'graph');
      }
    }
  }
  
  // Method to add node (called from parent)
  export function addNode(detail: { type: string; category: string | null }) {
    if (canvasRef && canvasRef.handleAddNode) {
      canvasRef.handleAddNode(detail);
    }
  }
  
  // Method to initialize default nodes
  export function initializeDefaultNodes() {
    if (canvasRef && canvasRef.initializeDefaultNodes) {
      canvasRef.initializeDefaultNodes();
    }
  }
  
  // Method to center on nodes
  export function centerOnNodes() {
    if (canvasRef && canvasRef.centerOnNodes) {
      canvasRef.centerOnNodes();
    }
  }
  
  interface WindowState {
    width?: number;
    height?: number;
    minimized: boolean;
    previousSize?: { width?: number; height?: number };
  }
  
  const STORAGE_KEY = 'cascade-window-layout';
  
  // Default layout percentages (matching Nodes.IO)
  let windowStates: Map<string, WindowState> = new Map([
    ['graph', { minimized: false }],
    ['viewer', { height: 80, minimized: false }], // 80% of middle column
    ['log', { height: 20, minimized: false }], // 20% of middle column
    ['inspector', { width: 25, minimized: false }] // 25% of total width
  ]);
  
  // Layout state
  let graphWidth = 50; // percentage
  let inspectorWidth = 25; // percentage
  let viewerHeight = 80; // percentage of middle column
  let logHeight = 20; // percentage of middle column
  
  // Middle column width is calculated: 100 - graphWidth - inspectorWidth
  $: middleWidth = 100 - graphWidth - inspectorWidth;
  
  function loadLayout() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.graphWidth !== undefined) graphWidth = parsed.graphWidth;
        if (parsed.inspectorWidth !== undefined) inspectorWidth = parsed.inspectorWidth;
        if (parsed.viewerHeight !== undefined) viewerHeight = parsed.viewerHeight;
        if (parsed.logHeight !== undefined) logHeight = parsed.logHeight;
        // Ensure viewer and log add up to 100%
        if (parsed.viewerHeight !== undefined || parsed.logHeight !== undefined) {
          const total = viewerHeight + logHeight;
          if (total !== 100) {
            // Normalize to 100%
            viewerHeight = (viewerHeight / total) * 100;
            logHeight = (logHeight / total) * 100;
          }
        }
        if (parsed.windowStates) {
          windowStates = new Map(Object.entries(parsed.windowStates));
        }
      }
    } catch (e) {
      console.warn('Failed to load window layout:', e);
    }
  }
  
  function saveLayout() {
    try {
      const data = {
        graphWidth,
        inspectorWidth,
        viewerHeight,
        logHeight,
        windowStates: Object.fromEntries(windowStates)
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save window layout:', e);
    }
  }
  
  function handleMinimize(e: CustomEvent<{ windowId: string }>) {
    const state = windowStates.get(e.detail.windowId);
    if (state && !state.minimized) {
      state.previousSize = {
        width: state.width,
        height: state.height
      };
      state.minimized = true;
      windowStates.set(e.detail.windowId, state);
      windowStates = new Map(windowStates); // Trigger reactivity
      saveLayout();
    }
  }
  
  function handleRestore(e: CustomEvent<{ windowId: string }>) {
    const state = windowStates.get(e.detail.windowId);
    if (state && state.minimized) {
      state.minimized = false;
      if (state.previousSize) {
        state.width = state.previousSize.width;
        state.height = state.previousSize.height;
      }
      windowStates.set(e.detail.windowId, state);
      windowStates = new Map(windowStates); // Trigger reactivity
      saveLayout();
    }
  }
  
  let layoutContainer: HTMLDivElement;
  
  function handleResize(e: CustomEvent<{ splitterId: string; delta: number; direction: 'horizontal' | 'vertical' }>) {
    const { splitterId, delta, direction } = e.detail;
    
    if (!layoutContainer) return;
    
    if (splitterId === 'graph-middle') {
      // Resize between graph and middle column (vertical splitter)
      const containerWidth = layoutContainer.clientWidth;
      const deltaPercent = (delta / containerWidth) * 100;
      graphWidth = Math.max(20, Math.min(70, graphWidth + deltaPercent));
      middleWidth = 100 - graphWidth - inspectorWidth;
      saveLayout();
    } else if (splitterId === 'middle-inspector') {
      // Resize between middle column and inspector (vertical splitter)
      const containerWidth = layoutContainer.clientWidth;
      const deltaPercent = (delta / containerWidth) * 100;
      inspectorWidth = Math.max(15, Math.min(50, inspectorWidth - deltaPercent));
      middleWidth = 100 - graphWidth - inspectorWidth;
      saveLayout();
    } else if (splitterId === 'viewer-log') {
      // Resize between viewer and log (horizontal splitter)
      const containerHeight = layoutContainer.clientHeight;
      const deltaPercent = (delta / containerHeight) * 100;
      viewerHeight = Math.max(10, Math.min(90, viewerHeight + deltaPercent));
      logHeight = 100 - viewerHeight; // Ensure they always add up to 100%
      saveLayout();
    }
  }
  
  // Reactive statements to compute active tabs - explicitly reference Maps for reactivity
  let graphActiveTab: Tab | null = null;
  let viewerActiveTab: Tab | null = null;
  let logActiveTab: Tab | null = null;
  let inspectorActiveTab: Tab | null = null;
  
  // Reactive statements for tab counts and tab arrays (for showTabs prop and Tabs component)
  $: graphTabs = tabsByWindow.get('graph') || [];
  $: graphTabsCount = graphTabs.length;
  $: graphActiveTabId = activeTabIds.get('graph');
  $: viewerTabs = tabsByWindow.get('viewer') || [];
  $: viewerTabsCount = viewerTabs.length;
  $: viewerActiveTabId = activeTabIds.get('viewer');
  $: logTabs = tabsByWindow.get('log') || [];
  $: logTabsCount = logTabs.length;
  $: logActiveTabId = activeTabIds.get('log');
  $: inspectorTabs = tabsByWindow.get('inspector') || [];
  $: inspectorTabsCount = inspectorTabs.length;
  $: inspectorActiveTabId = activeTabIds.get('inspector');
  
  // Force reactivity by explicitly accessing Maps in the reactive statement
  $: {
    tabsByWindow.get('graph'); activeTabIds.get('graph'); // Force reactivity by accessing Maps
    graphActiveTab = getActiveTabForWindow('graph');
  }
  $: {
    tabsByWindow.get('viewer'); activeTabIds.get('viewer'); // Force reactivity by accessing Maps
    viewerActiveTab = getActiveTabForWindow('viewer');
  }
  $: {
    tabsByWindow.get('log'); activeTabIds.get('log'); // Force reactivity by accessing Maps
    logActiveTab = getActiveTabForWindow('log');
  }
  $: {
    tabsByWindow.get('inspector'); activeTabIds.get('inspector'); // Force reactivity by accessing Maps
    inspectorActiveTab = getActiveTabForWindow('inspector');
  }
  
  onMount(() => {
    loadLayout();
    
    // Force initial computation of reactive tab variables
    graphActiveTab = getActiveTabForWindow('graph');
    viewerActiveTab = getActiveTabForWindow('viewer');
    logActiveTab = getActiveTabForWindow('log');
    inspectorActiveTab = getActiveTabForWindow('inspector');
    
    // Set up keyboard listener for number key tab switching
    window.addEventListener('keydown', handleNumberKeyPress);
    
    return () => {
      window.removeEventListener('keydown', handleNumberKeyPress);
    };
  });
  
  $: graphMinimized = windowStates.get('graph')?.minimized ?? false;
  $: viewerMinimized = windowStates.get('viewer')?.minimized ?? false;
  $: logMinimized = windowStates.get('log')?.minimized ?? false;
  $: inspectorMinimized = windowStates.get('inspector')?.minimized ?? false;
</script>

<div class="window-manager" style="--graph-width: {graphWidth}%; --middle-width: {middleWidth}%; --inspector-width: {inspectorWidth}%; --viewer-height: {viewerHeight}%; --log-height: {logHeight}%;">
  <div class="layout-grid" bind:this={layoutContainer}>
    <!-- Graph Window (Left) -->
    <Window
      title="Graph"
      windowId="graph"
      minimized={graphMinimized}
      showTabs={graphTabsCount > 0}
      on:minimize={handleMinimize}
      on:restore={handleRestore}
      on:dragover={(e) => handleTabDragOver(e.detail.event)}
      on:drop={(e) => handleTabDrop(e.detail.event, 'graph')}
    >
      <Tabs
        slot="tabs"
        tabs={graphTabs}
        activeTabId={graphActiveTabId}
        windowId="graph"
        on:tabSelect={(e) => selectTab(e.detail.tabId, 'graph')}
        on:tabClose={(e) => closeTab(e.detail.tabId, 'graph')}
        on:tabDragStart={(e) => handleTabDragStart(e, 'graph')}
      />
      
      <div 
        class="graph-container"
        on:mouseenter={handleGraphWindowMouseEnter}
        on:mouseleave={handleGraphWindowMouseLeave}
        bind:this={graphWindowElement}
      >
        {#if graphActiveTab && graphActiveTab.type === 'editor' && graphActiveTab.node}
          <!-- Code Editor Tab -->
          {@const tab = graphActiveTab}
          {@const tabId = tab.id}
          {@const editorNode = tab.node}
          <div class="tab-content">
            {#if editorNode}
              <CodeEditor
                node={editorNode}
                packageManager={graph?.packageManager || null}
                onClose={() => closeTab(tabId, 'graph')}
                showCloseButton={false}
              />
            {/if}
          </div>
        {:else if graphActiveTab && graphActiveTab.type === 'viewer'}
          <!-- Viewer Tab -->
          <div class="tab-content">
            <Viewer {graph} {selectedNode} />
          </div>
        {:else if graphActiveTab && graphActiveTab.type === 'log'}
          <!-- Log Tab -->
          <div class="tab-content">
            <Log bind:this={logRef} />
          </div>
        {:else if graphActiveTab && graphActiveTab.type === 'inspector'}
          <!-- Inspector Tab -->
          <div class="tab-content">
            {#if selectedNode}
              <Inspector node={selectedNode} position="right" skipAnimation={false} />
            {:else if selectedAnnotation && graph}
              {@const annotation = graph.getAnnotation(selectedAnnotation)}
              {#if annotation}
                <Inspector annotation={annotation} {graph} position="right" skipAnimation={false} />
              {/if}
            {/if}
          </div>
        {:else if graphActiveTab && graphActiveTab.type === 'graph'}
          <!-- Graph Tab (default) -->
          <div class="tab-content">
            <Canvas
              bind:this={canvasRef}
              bind:graph={graph}
              {activeTool}
              bind:selectedNode={selectedNode}
              bind:selectedAnnotation={selectedAnnotation}
              on:nodeSelect={(e) => dispatch('nodeSelect', e.detail)}
              on:annotationSelect={(e) => dispatch('annotationSelect', e.detail)}
              on:openNodePanel={(e) => dispatch('openNodePanel', e.detail)}
              on:nodeEdit={handleNodeEdit}
            />
            {#if !presentationMode}
              <BottomToolbar
                {activeLibrary}
                bind:activeTool={activeTool}
                on:libraryToggle={(e) => dispatch('libraryToggle', e.detail)}
                on:toolChange={(e) => dispatch('toolChange', e.detail)}
              />
            {/if}
          </div>
        {:else}
          <!-- No tabs - show Canvas view -->
          <Canvas
            bind:this={canvasRef}
            bind:graph={graph}
            {activeTool}
            bind:selectedNode={selectedNode}
            bind:selectedAnnotation={selectedAnnotation}
            on:nodeSelect={(e) => dispatch('nodeSelect', e.detail)}
            on:annotationSelect={(e) => dispatch('annotationSelect', e.detail)}
            on:openNodePanel={(e) => dispatch('openNodePanel', e.detail)}
            on:nodeEdit={handleNodeEdit}
          />
          {#if !presentationMode}
            <BottomToolbar
              {activeLibrary}
              bind:activeTool={activeTool}
              on:libraryToggle={(e) => dispatch('libraryToggle', e.detail)}
              on:toolChange={(e) => dispatch('toolChange', e.detail)}
            />
          {/if}
        {/if}
      </div>
    </Window>
    
    <!-- Vertical Splitter between Graph and Middle Column -->
    <Splitter
      direction="vertical"
      splitterId="graph-middle"
      on:resize={handleResize}
    />
    
    <!-- Middle Column (Viewer + Log) -->
    <div class="middle-column">
      <!-- Viewer Window (Top) -->
      <Window
        title="Viewer"
        windowId="viewer"
        minimized={viewerMinimized}
        showTabs={viewerTabsCount > 0}
        on:minimize={handleMinimize}
        on:restore={handleRestore}
        on:dragover={(e) => handleTabDragOver(e.detail.event)}
        on:drop={(e) => handleTabDrop(e.detail.event, 'viewer')}
      >
        <Tabs
          slot="tabs"
          tabs={viewerTabs}
          activeTabId={viewerActiveTabId}
          windowId="viewer"
          on:tabSelect={(e) => selectTab(e.detail.tabId, 'viewer')}
          on:tabClose={(e) => closeTab(e.detail.tabId, 'viewer')}
          on:tabDragStart={(e) => handleTabDragStart(e, 'viewer')}
        />
        
        {#if viewerActiveTab && viewerActiveTab.type === 'editor' && viewerActiveTab.node}
          {@const tab = viewerActiveTab}
          {@const tabId = tab.id}
          {@const editorNode = tab.node}
          <div class="tab-content">
            {#if editorNode}
              <CodeEditor
                node={editorNode}
                packageManager={graph?.packageManager || null}
                onClose={() => closeTab(tabId, 'viewer')}
                showCloseButton={false}
              />
            {/if}
          </div>
        {:else if viewerActiveTab && viewerActiveTab.type === 'graph'}
          <div class="tab-content">
            <Canvas
              bind:this={canvasRef}
              bind:graph={graph}
              {activeTool}
              bind:selectedNode={selectedNode}
              bind:selectedAnnotation={selectedAnnotation}
              on:nodeSelect={(e) => dispatch('nodeSelect', e.detail)}
              on:annotationSelect={(e) => dispatch('annotationSelect', e.detail)}
              on:openNodePanel={(e) => dispatch('openNodePanel', e.detail)}
              on:nodeEdit={(e) => openEditorTab(e.detail.node, 'viewer')}
            />
          </div>
        {:else if viewerActiveTab && viewerActiveTab.type === 'log'}
          <div class="tab-content">
            <Log bind:this={logRef} />
          </div>
        {:else if viewerActiveTab && viewerActiveTab.type === 'inspector'}
          <div class="tab-content">
            {#if selectedNode}
              <Inspector node={selectedNode} position="right" skipAnimation={false} />
            {:else if selectedAnnotation && graph}
              {@const annotation = graph.getAnnotation(selectedAnnotation)}
              {#if annotation}
                <Inspector annotation={annotation} {graph} position="right" skipAnimation={false} />
              {/if}
            {/if}
          </div>
        {:else if viewerActiveTab && viewerActiveTab.type === 'viewer'}
          <!-- Viewer Tab (default) -->
          <div class="tab-content">
            <Viewer {graph} {selectedNode} />
          </div>
        {:else}
          <!-- No tabs - show Viewer -->
          <Viewer {graph} {selectedNode} />
        {/if}
      </Window>
      
      <!-- Horizontal Splitter between Viewer and Log -->
      <Splitter
        direction="horizontal"
        splitterId="viewer-log"
        on:resize={handleResize}
      />
      
      <!-- Log Window (Bottom) -->
      <Window
        title="Log"
        windowId="log"
        minimized={logMinimized}
        showTabs={logTabsCount > 0}
        on:minimize={handleMinimize}
        on:restore={handleRestore}
        on:dragover={(e) => handleTabDragOver(e.detail.event)}
        on:drop={(e) => handleTabDrop(e.detail.event, 'log')}
      >
        <Tabs
          slot="tabs"
          tabs={logTabs}
          activeTabId={logActiveTabId}
          windowId="log"
          on:tabSelect={(e) => selectTab(e.detail.tabId, 'log')}
          on:tabClose={(e) => closeTab(e.detail.tabId, 'log')}
          on:tabDragStart={(e) => handleTabDragStart(e, 'log')}
        />
        
        <svelte:fragment slot="actions">
          {#if getActiveTabForWindow('log')?.type === 'log' || getTabsForWindow('log').length === 0}
            <button class="clear-button" on:click={() => {
              if (logRef) {
                logRef.clearLog();
              }
            }} title="Clear log">
              Clear
            </button>
          {/if}
        </svelte:fragment>
        
        {#if logActiveTab && logActiveTab.type === 'editor' && logActiveTab.node}
          {@const tab = logActiveTab}
          {@const tabId = tab.id}
          {@const editorNode = tab.node}
          <div class="tab-content">
            {#if editorNode}
              <CodeEditor
                node={editorNode}
                packageManager={graph?.packageManager || null}
                onClose={() => closeTab(tabId, 'log')}
                showCloseButton={false}
              />
            {/if}
          </div>
        {:else if logActiveTab && logActiveTab.type === 'graph'}
          <div class="tab-content">
            <Canvas
              bind:this={canvasRef}
              bind:graph={graph}
              {activeTool}
              bind:selectedNode={selectedNode}
              bind:selectedAnnotation={selectedAnnotation}
              on:nodeSelect={(e) => dispatch('nodeSelect', e.detail)}
              on:annotationSelect={(e) => dispatch('annotationSelect', e.detail)}
              on:openNodePanel={(e) => dispatch('openNodePanel', e.detail)}
              on:nodeEdit={(e) => openEditorTab(e.detail.node, 'log')}
            />
          </div>
        {:else if logActiveTab && logActiveTab.type === 'viewer'}
          <div class="tab-content">
            <Viewer {graph} {selectedNode} />
          </div>
        {:else if logActiveTab && logActiveTab.type === 'inspector'}
          <div class="tab-content">
            {#if selectedNode}
              <Inspector node={selectedNode} position="right" skipAnimation={false} />
            {:else if selectedAnnotation && graph}
              {@const annotation = graph.getAnnotation(selectedAnnotation)}
              {#if annotation}
                <Inspector annotation={annotation} {graph} position="right" skipAnimation={false} />
              {/if}
            {/if}
          </div>
        {:else if logActiveTab && logActiveTab.type === 'log'}
          <!-- Log Tab (default) -->
          <div class="tab-content">
            <Log bind:this={logRef} />
          </div>
        {:else}
          <!-- No tabs - show Log -->
          <Log bind:this={logRef} />
        {/if}
      </Window>
    </div>
    
    <!-- Vertical Splitter between Middle Column and Inspector -->
    <Splitter
      direction="vertical"
      splitterId="middle-inspector"
      on:resize={handleResize}
    />
    
    <!-- Inspector Window (Right) -->
    {#if selectedNode}
      {@const inspectorTitle = selectedNode.name}
      <Window
        title={inspectorTitle}
        windowId="inspector"
        minimized={inspectorMinimized}
        showTabs={inspectorTabsCount > 0}
        on:minimize={handleMinimize}
        on:restore={handleRestore}
        on:dragover={(e) => handleTabDragOver(e.detail.event)}
        on:drop={(e) => handleTabDrop(e.detail.event, 'inspector')}
      >
        <Tabs
          slot="tabs"
          tabs={inspectorTabs}
          activeTabId={inspectorActiveTabId}
          windowId="inspector"
          on:tabSelect={(e) => selectTab(e.detail.tabId, 'inspector')}
          on:tabClose={(e) => closeTab(e.detail.tabId, 'inspector')}
          on:tabDragStart={(e) => handleTabDragStart(e, 'inspector')}
        />
        
        {#if inspectorActiveTab && inspectorActiveTab.type === 'editor' && inspectorActiveTab.node}
          {@const tab = inspectorActiveTab}
          {@const tabId = tab.id}
          {@const editorNode = tab.node}
          <div class="tab-content">
            {#if editorNode}
              <CodeEditor
                node={editorNode}
                packageManager={graph?.packageManager || null}
                onClose={() => closeTab(tabId, 'inspector')}
                showCloseButton={false}
              />
            {/if}
          </div>
        {:else if inspectorActiveTab && inspectorActiveTab.type === 'graph'}
          <div class="tab-content">
            <Canvas
              bind:this={canvasRef}
              bind:graph={graph}
              {activeTool}
              bind:selectedNode={selectedNode}
              bind:selectedAnnotation={selectedAnnotation}
              on:nodeSelect={(e) => dispatch('nodeSelect', e.detail)}
              on:annotationSelect={(e) => dispatch('annotationSelect', e.detail)}
              on:openNodePanel={(e) => dispatch('openNodePanel', e.detail)}
              on:nodeEdit={(e) => openEditorTab(e.detail.node, 'inspector')}
            />
          </div>
        {:else if inspectorActiveTab && inspectorActiveTab.type === 'viewer'}
          <div class="tab-content">
            <Viewer {graph} {selectedNode} />
          </div>
        {:else if inspectorActiveTab && inspectorActiveTab.type === 'log'}
          <div class="tab-content">
            <Log bind:this={logRef} />
          </div>
        {:else if inspectorActiveTab && inspectorActiveTab.type === 'inspector'}
          <!-- Inspector Tab (default) -->
          <div class="tab-content">
            <Inspector
              node={selectedNode}
              position="right"
              skipAnimation={false}
            />
          </div>
        {:else}
          <!-- No tabs - show Inspector -->
          <Inspector
            node={selectedNode}
            position="right"
            skipAnimation={false}
          />
        {/if}
      </Window>
    {:else if selectedAnnotation && graph}
      {#if true}
        {@const annotation = graph.getAnnotation(selectedAnnotation)}
        {@const inspectorTitle = annotation ? (annotation.type === 'text' ? 'Text' : annotation.type || 'Inspector') : 'Inspector'}
        {#if annotation}
        <Window
          title={inspectorTitle}
          windowId="inspector"
          minimized={inspectorMinimized}
          showTabs={inspectorTabsCount > 0}
          on:minimize={handleMinimize}
          on:restore={handleRestore}
          on:dragover={(e) => handleTabDragOver(e.detail.event)}
          on:drop={(e) => handleTabDrop(e.detail.event, 'inspector')}
        >
          <Tabs
            slot="tabs"
            tabs={inspectorTabs}
            activeTabId={inspectorActiveTabId}
            windowId="inspector"
            on:tabSelect={(e) => selectTab(e.detail.tabId, 'inspector')}
            on:tabClose={(e) => closeTab(e.detail.tabId, 'inspector')}
            on:tabDragStart={(e) => handleTabDragStart(e, 'inspector')}
          />
          
          {#if inspectorActiveTab && inspectorActiveTab.type === 'editor' && inspectorActiveTab.node}
            {@const tab = inspectorActiveTab}
            {@const tabId = tab.id}
            {@const editorNode = tab.node}
            <div class="tab-content">
              {#if editorNode}
                <CodeEditor
                  node={editorNode}
                  packageManager={graph?.packageManager || null}
                  onClose={() => closeTab(tabId, 'inspector')}
                  showCloseButton={false}
                />
              {/if}
            </div>
          {:else if inspectorActiveTab && inspectorActiveTab.type === 'graph'}
            <div class="tab-content">
              <Canvas
                bind:this={canvasRef}
                bind:graph={graph}
                {activeTool}
                bind:selectedNode={selectedNode}
                bind:selectedAnnotation={selectedAnnotation}
                on:nodeSelect={(e) => dispatch('nodeSelect', e.detail)}
                on:annotationSelect={(e) => dispatch('annotationSelect', e.detail)}
                on:openNodePanel={(e) => dispatch('openNodePanel', e.detail)}
                on:nodeEdit={(e) => openEditorTab(e.detail.node, 'inspector')}
              />
            </div>
          {:else if inspectorActiveTab && inspectorActiveTab.type === 'viewer'}
            <div class="tab-content">
              <Viewer {graph} {selectedNode} />
            </div>
          {:else if inspectorActiveTab && inspectorActiveTab.type === 'log'}
            <div class="tab-content">
              <Log bind:this={logRef} />
            </div>
          {:else if inspectorActiveTab && inspectorActiveTab.type === 'inspector'}
            <!-- Inspector Tab (default) -->
            <div class="tab-content">
              <Inspector
                annotation={annotation}
                {graph}
                position="right"
                skipAnimation={false}
              />
            </div>
          {:else}
            <!-- No tabs - show Inspector -->
            <Inspector
              annotation={annotation}
              {graph}
              position="right"
              skipAnimation={false}
            />
          {/if}
        </Window>
      {/if}
      {/if}
    {:else}
      <Window
        title="Inspector"
        windowId="inspector"
        minimized={inspectorMinimized}
        showTabs={inspectorTabsCount > 0}
        on:minimize={handleMinimize}
        on:restore={handleRestore}
        on:dragover={(e) => handleTabDragOver(e.detail.event)}
        on:drop={(e) => handleTabDrop(e.detail.event, 'inspector')}
      >
        <Tabs
          slot="tabs"
          tabs={inspectorTabs}
          activeTabId={inspectorActiveTabId}
          windowId="inspector"
          on:tabSelect={(e) => selectTab(e.detail.tabId, 'inspector')}
          on:tabClose={(e) => closeTab(e.detail.tabId, 'inspector')}
          on:tabDragStart={(e) => handleTabDragStart(e, 'inspector')}
        />
        
        {#if inspectorActiveTab && inspectorActiveTab.type === 'editor' && inspectorActiveTab.node}
          {@const tab = inspectorActiveTab}
          {@const tabId = tab.id}
          {@const editorNode = tab.node}
          <div class="tab-content">
            {#if editorNode}
              <CodeEditor
                node={editorNode}
                packageManager={graph?.packageManager || null}
                onClose={() => closeTab(tabId, 'inspector')}
                showCloseButton={false}
              />
            {/if}
          </div>
        {:else if inspectorActiveTab && inspectorActiveTab.type === 'graph'}
          <div class="tab-content">
            <Canvas
              bind:this={canvasRef}
              bind:graph={graph}
              {activeTool}
              bind:selectedNode={selectedNode}
              bind:selectedAnnotation={selectedAnnotation}
              on:nodeSelect={(e) => dispatch('nodeSelect', e.detail)}
              on:annotationSelect={(e) => dispatch('annotationSelect', e.detail)}
              on:openNodePanel={(e) => dispatch('openNodePanel', e.detail)}
              on:nodeEdit={(e) => openEditorTab(e.detail.node, 'inspector')}
            />
          </div>
        {:else if inspectorActiveTab && inspectorActiveTab.type === 'viewer'}
          <div class="tab-content">
            <Viewer {graph} {selectedNode} />
          </div>
        {:else if inspectorActiveTab && inspectorActiveTab.type === 'log'}
          <div class="tab-content">
            <Log bind:this={logRef} />
          </div>
        {:else if inspectorActiveTab && inspectorActiveTab.type === 'inspector'}
          <!-- Inspector Tab (default) -->
          <div class="tab-content">
            {#if selectedNode}
              <Inspector node={selectedNode} position="right" skipAnimation={false} />
            {:else if selectedAnnotation && graph}
              {@const annotation = graph.getAnnotation(selectedAnnotation)}
              {#if annotation}
                <Inspector annotation={annotation} {graph} position="right" skipAnimation={false} />
              {/if}
            {/if}
          </div>
        {:else}
          <!-- No tabs - show Inspector if available -->
          {#if selectedNode}
            <Inspector node={selectedNode} position="right" skipAnimation={false} />
          {:else if selectedAnnotation && graph}
            {@const annotation = graph.getAnnotation(selectedAnnotation)}
            {#if annotation}
              <Inspector annotation={annotation} {graph} position="right" skipAnimation={false} />
            {/if}
          {/if}
        {/if}
      </Window>
    {/if}
  </div>
</div>

<style>
  .window-manager {
    width: 100vw;
    height: 100vh;
    display: flex;
    overflow: hidden;
    background: #0a0a0a;
  }
  
  .layout-grid {
    display: grid;
    width: 100%;
    height: 100%;
    grid-template-columns: 
      var(--graph-width) 
      2px 
      var(--middle-width) 
      2px 
      var(--inspector-width);
    grid-template-rows: 1fr;
  }
  
  .middle-column {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    height: 100%;
  }
  
  .middle-column > :global(.window) {
    flex-shrink: 0;
  }
  
  .middle-column > :global(.window:first-child) {
    flex: 0 0 var(--viewer-height);
    min-height: 0;
    overflow: hidden;
  }
  
  .middle-column > :global(.window:last-child) {
    flex: 0 0 var(--log-height);
    min-height: 0;
    overflow: hidden;
  }
  
  .middle-column > :global(.window.minimized) {
    flex-basis: 32px !important;
    min-height: 32px !important;
  }
  
  .graph-container {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  
  .tab-content {
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    position: relative;
  }
  
  .graph-container {
    position: relative;
    width: 100%;
    height: 100%;
  }
  
  :global(.clear-button) {
    padding: 4px 8px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #aaa;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s ease;
    margin-right: 4px;
  }
  
  :global(.clear-button:hover) {
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
  }
  
  :global(.add-tab-button) {
    padding: 4px 8px;
    background: rgba(74, 158, 255, 0.2);
    border: 1px solid rgba(74, 158, 255, 0.3);
    border-radius: 4px;
    color: #4a9eff;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.15s ease;
    margin-right: 4px;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  :global(.add-tab-button:hover) {
    background: rgba(74, 158, 255, 0.3);
    border-color: #4a9eff;
  }
</style>

