<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { dockviewStore, PANEL_TYPES } from './dockview-store.svelte';
  import { registerPanelComponent, setSharedContext } from './renderer';
  import type { PanelContext, PanelType } from './types';
  import type { Graph } from '@/core/engine/Graph';
  import type { Computation } from '@/core/engine/Computation';

  // Import panel components
  import GraphPanel from '../panels/GraphPanel.svelte';
  import InspectorPanel from '../panels/InspectorPanel.svelte';
  import ViewerPanel from '../panels/ViewerPanel.svelte';
  import LogPanel from '../panels/LogPanel.svelte';
  import CodePanel from '../panels/CodePanel.svelte';

  // Import Dockview styles
  import 'dockview-core/dist/styles/dockview.css';

  const dispatch = createEventDispatcher();

  // Add panel menu state
  let showAddPanelMenu = false;
  let addPanelMenuPosition = { x: 0, y: 0 };
  let addPanelTargetGroup = '';

  // Props from parent
  export let graph: Graph | undefined = undefined;
  export let selectedNode: Computation | null = null;
  export let selectedAnnotation: string | null = null;
  export let activeTool: string = 'select';
  export let activeLibrary: string | null = null;
  export let documentName: string = 'Untitled';
  export let presentationMode: boolean = false;
  export let onRecordHistory: (() => void) | undefined = undefined;

  let containerEl: HTMLElement;
  let saveInterval: ReturnType<typeof setInterval> | null = null;

  // Create shared context for panels
  $: context = {
    graph,
    selectedNode,
    selectedAnnotation,
    activeTool,
    activeLibrary,
    documentName,
    presentationMode,
    onRecordHistory,
    onNodeSelect: (node: Computation | null) => {
      dispatch('nodeSelect', { node });
    },
    onAnnotationSelect: (annotationId: string | null) => {
      dispatch('annotationSelect', { annotationId });
    },
    onToolChange: (tool: string) => {
      dispatch('toolChange', tool);
    },
    onLibraryToggle: (libraryId: string | null) => {
      dispatch('libraryToggle', libraryId);
    },
    onAction: (action: string) => {
      dispatch('action', action);
    },
    onNameChange: (name: string) => {
      dispatch('nameChange', name);
    },
    onOpenNodePanel: (position?: { x: number; y: number }) => {
      dispatch('openNodePanel', position);
    }
  } satisfies PanelContext;

  // Update shared context when props change
  $: setSharedContext(context);

  // Expose methods to parent via bind:this
  export function addNode(params: { type: string; category: string | null }) {
    const graphPanelEl = document.querySelector('[data-panel-type="graph"]');
    if (graphPanelEl) {
      graphPanelEl.dispatchEvent(new CustomEvent('addNode', { detail: params }));
    }
  }

  export function centerOnNodes() {
    // Dispatch to graph panel
    const graphPanelEl = document.querySelector('[data-panel-type="graph"]');
    if (graphPanelEl) {
      graphPanelEl.dispatchEvent(new CustomEvent('centerOnNodes'));
    }
  }

  export function selectAll() {
    const graphPanelEl = document.querySelector('[data-panel-type="graph"]');
    if (graphPanelEl) {
      graphPanelEl.dispatchEvent(new CustomEvent('selectAll'));
    }
  }

  export function deselectAll() {
    const graphPanelEl = document.querySelector('[data-panel-type="graph"]');
    if (graphPanelEl) {
      graphPanelEl.dispatchEvent(new CustomEvent('deselectAll'));
    }
  }

  export function deleteSelected() {
    const graphPanelEl = document.querySelector('[data-panel-type="graph"]');
    if (graphPanelEl) {
      graphPanelEl.dispatchEvent(new CustomEvent('deleteSelected'));
    }
  }

  export function openCodeEditor(nodeId: string, nodeTitle: string) {
    dockviewStore.openCodeEditor(nodeId, nodeTitle);
  }

  export function resetLayout() {
    dockviewStore.resetLayout();
  }

  export function focusPanel(panelId: string) {
    dockviewStore.focusPanel(panelId);
  }

  function handleAddPanelClick(groupId: string, position: { x: number; y: number }) {
    addPanelTargetGroup = groupId;
    addPanelMenuPosition = position;
    showAddPanelMenu = true;
  }

  function handleAddPanelSelect(type: PanelType) {
    dockviewStore.addPanelToGroup(type, addPanelTargetGroup);
    showAddPanelMenu = false;
  }

  function handleAddPanelMenuClose() {
    showAddPanelMenu = false;
  }

  onMount(() => {
    // Register all panel components
    registerPanelComponent('graph', GraphPanel, 'Graph');
    registerPanelComponent('inspector', InspectorPanel, 'Inspector');
    registerPanelComponent('viewer', ViewerPanel, 'Viewer');
    registerPanelComponent('log', LogPanel, 'Log');
    registerPanelComponent('code', CodePanel, 'Code');

    // Set callback for add panel button
    dockviewStore.onAddPanelClick = handleAddPanelClick;

    // Initialize Dockview
    dockviewStore.initialize(containerEl);

    // Auto-save layout on changes
    saveInterval = setInterval(() => {
      dockviewStore.saveLayout();
    }, 30000); // Save every 30 seconds
  });

  onDestroy(() => {
    if (saveInterval) {
      clearInterval(saveInterval);
    }
    dockviewStore.onAddPanelClick = null;
    dockviewStore.dispose();
  });
</script>

<svelte:window on:click={handleAddPanelMenuClose} />

<div
  bind:this={containerEl}
  class="dockview-container cascade-theme"
></div>

{#if showAddPanelMenu}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="add-panel-menu"
    style="left: {addPanelMenuPosition.x}px; top: {addPanelMenuPosition.y}px"
    on:click|stopPropagation
  >
    {#each PANEL_TYPES as panelType}
      <button
        class="add-panel-option"
        on:click={() => handleAddPanelSelect(panelType.type)}
      >
        <span class="panel-icon">{panelType.icon}</span>
        <span class="panel-label">{panelType.label}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .dockview-container {
    width: 100%;
    height: 100%;
    position: relative;
  }

  /* Cascade dark theme overrides */
  .dockview-container :global(.dv-dockview) {
    --dv-paneview-active-outline-color: transparent;
    --dv-group-view-background-color: #1a1a1a;
    --dv-tabs-and-actions-container-background-color: #252525;
    --dv-activegroup-visiblepanel-tab-background-color: #1a1a1a;
    --dv-activegroup-hiddenpanel-tab-background-color: #2d2d2d;
    --dv-inactivegroup-visiblepanel-tab-background-color: #2d2d2d;
    --dv-inactivegroup-hiddenpanel-tab-background-color: #252525;
    --dv-tab-divider-color: #404040;
    --dv-activegroup-visiblepanel-tab-color: #ffffff;
    --dv-activegroup-hiddenpanel-tab-color: #888888;
    --dv-inactivegroup-visiblepanel-tab-color: #cccccc;
    --dv-inactivegroup-hiddenpanel-tab-color: #888888;
    --dv-separator-border: #404040;
    --dv-paneview-header-border-color: #404040;
  }

  .dockview-container :global(.dv-tabs-container) {
    background: #252525;
    border-bottom: 1px solid #404040;
  }

  .dockview-container :global(.dv-tab) {
    background: #2d2d2d;
    color: #cccccc;
    border: none;
    padding: 6px 12px;
    font-size: 12px;
    min-width: 80px;
  }

  .dockview-container :global(.dv-tab.dv-active-tab) {
    background: #1a1a1a;
    color: #ffffff;
  }

  .dockview-container :global(.dv-tab:hover:not(.dv-active-tab)) {
    background: #383838;
  }

  .dockview-container :global(.dv-resize-container-handle) {
    background: #404040;
  }

  .dockview-container :global(.dv-resize-container-handle:hover) {
    background: #0078d4;
  }

  .dockview-container :global(.dv-groupview) {
    background: #1a1a1a;
  }

  .dockview-container :global(.dv-default-tab-content) {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .dockview-container :global(.dv-tab .dv-default-tab-action) {
    opacity: 0;
    transition: opacity 0.15s;
  }

  .dockview-container :global(.dv-tab:hover .dv-default-tab-action) {
    opacity: 1;
  }

  .dockview-container :global(.dv-drop-target-dropzone) {
    background: rgba(0, 120, 212, 0.2);
    border: 2px dashed #0078d4;
  }

  /* Panel content styling */
  .dockview-container :global(.dockview-panel-content) {
    background: #1a1a1a;
    height: 100%;
    width: 100%;
  }

  /* Add panel button in header */
  .dockview-container :global(.cascade-header-actions) {
    display: flex;
    align-items: center;
    padding: 0 4px;
  }

  .dockview-container :global(.cascade-add-panel-btn) {
    width: 20px;
    height: 20px;
    border: none;
    background: transparent;
    color: #888;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }

  .dockview-container :global(.cascade-add-panel-btn:hover) {
    background: #404040;
    color: #fff;
  }

  /* Custom tab styling */
  .dockview-container :global(.cascade-tab) {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px;
    height: 100%;
  }

  .dockview-container :global(.cascade-tab-title) {
    cursor: pointer;
    user-select: none;
    transition: color 0.15s;
  }

  .dockview-container :global(.cascade-tab-title:hover) {
    color: #fff;
  }

  .dockview-container :global(.cascade-tab-close) {
    width: 16px;
    height: 16px;
    border: none;
    background: transparent;
    color: #888;
    font-size: 14px;
    cursor: pointer;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s, background 0.15s, color 0.15s;
  }

  .dockview-container :global(.dv-tab:hover .cascade-tab-close) {
    opacity: 1;
  }

  .dockview-container :global(.cascade-tab-close:hover) {
    background: #404040;
    color: #fff;
  }

  /* Horizontally collapsed group - rotate tabs 90 degrees */
  .dockview-container :global(.cascade-collapsed-horizontal) {
    position: relative !important;
    overflow: visible !important;
  }

  .dockview-container :global(.cascade-collapsed-horizontal .dv-tabs-and-actions-container) {
    transform: rotate(90deg) !important;
    transform-origin: left top !important;
    position: absolute !important;
    left: 35px !important;
    top: 0 !important;
    width: max-content !important;
    height: 35px !important;
    white-space: nowrap !important;
    border-bottom: none !important;
    background: #252525 !important;
  }

  .dockview-container :global(.cascade-collapsed-horizontal .dv-content-container) {
    display: none !important;
  }

  /* Add panel dropdown menu */
  .add-panel-menu {
    position: fixed;
    background: #252525;
    border: 1px solid #404040;
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 10000;
    min-width: 140px;
  }

  .add-panel-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    color: #ccc;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }

  .add-panel-option:hover {
    background: #0078d4;
    color: #fff;
  }

  .panel-icon {
    font-size: 14px;
    width: 20px;
    text-align: center;
  }

  .panel-label {
    flex: 1;
  }
</style>
