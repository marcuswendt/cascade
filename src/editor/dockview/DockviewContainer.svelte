<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher, tick } from 'svelte';
  import { dockviewStore, panelTypes, setProjectPanelTypes } from './dockview-store.svelte';
  import { registerPanelComponent, registerLazyPanelComponent, setSharedContext } from './renderer';
  import type { PanelContext, PanelType } from './types';
  import type { Graph } from '@/nodes/Graph';
  import type { Node } from '@/nodes/Node';

  // Import panel components
  import GraphPanel from '../panels/GraphPanel.svelte';
  import InspectorPanel from '../panels/InspectorPanel.svelte';
  import ViewerPanel from '../panels/ViewerPanel.svelte';
  import LogPanel from '../panels/LogPanel.svelte';
  import AgentPanel from '../panels/AgentPanel.svelte';
  // CodePanel is intentionally NOT statically imported — round 32: "load
  // Monaco only on demand when someone opens that editor view (mostly
  // they don't)". It (and CodeEditor.svelte, and monaco-editor itself)
  // are only fetched the first time a 'code' panel is actually created —
  // see registerLazyPanelComponent below and renderer.ts's own note.
  import DefinitionPanel from '../panels/DefinitionPanel.svelte';
  import CookInfoPanel from '../panels/CookInfoPanel.svelte';
  import TimelinePanel from '../panels/TimelinePanel.svelte';
  import ProjectPanelHost from '../panels/ProjectPanelHost.svelte';
  import { discoverProjectPanels } from '../projectPanels';
  import { clampToViewport } from '../menuPlacement';
  import { registerProjectTypeRenderer } from '../components/typeRenderers';
  import PanelIcon from '../components/PanelIcon.svelte';

  // Import Dockview styles
  import 'dockview/dist/styles/dockview.css';

  const dispatch = createEventDispatcher();

  // Add panel menu state
  let showAddPanelMenu = false;
  let addPanelMenuPosition = { x: 0, y: 0 };
  let addPanelMenuEl: HTMLDivElement | undefined;
  let addPanelMenuStyle = '';
  let addPanelTargetGroup = '';

  // Props from parent
  export let graph: Graph | undefined = undefined;
  export let selectedNode: Node | null = null;
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
    onNodeSelect: (node: Node | null) => {
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
    },
    onPanelAction: (action: string, nodeId: string) => {
      if (action.startsWith('panel:')) dockviewStore.openProjectPanel(action.slice('panel:'.length), nodeId);
      else dispatch('action', { action, nodeId });
    }
  } satisfies PanelContext;

  // Update shared context when props change
  $: setSharedContext(context);

  // Expose methods to parent via bind:this
  export function addNode(params: { type: string; category: string | null; customConfig?: { name: string; modulePath: string; baseClass: string; code: string } }) {
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

  async function handleAddPanelClick(groupId: string, position: { x: number; y: number }) {
    addPanelTargetGroup = groupId;
    addPanelMenuPosition = position;
    showAddPanelMenu = true;
    await placeAddPanelMenu();
  }

  /**
   * Keep the menu inside the window.
   *
   * It is positioned fixed at the + button's own left edge, and that button
   * sits at the right edge of its group — so for the right-most group the menu
   * opened off-screen and adding a panel there looked broken. Measured rather
   * than assumed, because its width depends on how many panel types a project
   * contributes. Hidden for the one frame it takes to measure, so the reader
   * never sees it jump.
   */
  async function placeAddPanelMenu() {
    addPanelMenuStyle = `left: ${addPanelMenuPosition.x}px; top: ${addPanelMenuPosition.y}px; visibility: hidden`;
    await tick();
    if (!addPanelMenuEl) return;
    const { width, height } = addPanelMenuEl.getBoundingClientRect();
    const placed = clampToViewport(
      addPanelMenuPosition,
      { width, height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    addPanelMenuStyle = `left: ${placed.x}px; top: ${placed.y}px`;
  }

  function handleAddPanelSelect(type: PanelType) {
    dockviewStore.addPanelToGroup(type, addPanelTargetGroup);
    showAddPanelMenu = false;
  }

  function handleAddPanelMenuClose() {
    showAddPanelMenu = false;
  }

  onMount(async () => {
    // Register all panel components
    registerPanelComponent('graph', GraphPanel, 'Graph');
    // The component name stays 'inspector' — it is written into every saved
    // dockview layout and into the layout a .cascade file carries, so renaming
    // it would silently drop the panel from existing documents. Only the title
    // is the reader-facing half, and that is what changed.
    registerPanelComponent('inspector', InspectorPanel, 'Parameters');
    registerPanelComponent('definition', DefinitionPanel, 'Definition');
    registerPanelComponent('viewer', ViewerPanel, 'Viewer');
    registerPanelComponent('log', LogPanel, 'Log');
    registerPanelComponent('agent', AgentPanel, 'Agent');
    registerLazyPanelComponent('code', () => import('../panels/CodePanel.svelte'), 'Code');
    registerPanelComponent('info', CookInfoPanel, 'Node Info');
    registerPanelComponent('timeline', TimelinePanel, 'Timeline');

    try {
      const panels = await discoverProjectPanels();
      setProjectPanelTypes(panels);
      for (const panel of panels) {
        registerPanelComponent(`project:${panel.name}`, ProjectPanelHost, panel.title);
        for (const type of panel.rendererTypes ?? []) registerProjectTypeRenderer(type, panel.name);
      }
    } catch (error) {
      console.warn('Failed to discover project panels:', error);
      setProjectPanelTypes([]);
    }

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
    bind:this={addPanelMenuEl}
    style={addPanelMenuStyle}
    on:click|stopPropagation
  >
    {#each $panelTypes as panelType}
      <button
        class="add-panel-option"
        on:click={() => handleAddPanelSelect(panelType.type)}
      >
        <PanelIcon icon={panelType.icon} size={14} class="panel-icon" />
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

  /* Cascade theme overrides */
  .dockview-container :global(.dv-dockview) {
    --dv-paneview-active-outline-color: transparent;
    --dv-group-view-background-color: var(--surface-panel);
    --dv-tabs-and-actions-container-background-color: var(--surface-raised);
    --dv-activegroup-visiblepanel-tab-background-color: var(--surface-panel);
    --dv-activegroup-hiddenpanel-tab-background-color: var(--surface-control-hover);
    --dv-inactivegroup-visiblepanel-tab-background-color: var(--surface-control-hover);
    --dv-inactivegroup-hiddenpanel-tab-background-color: var(--surface-raised);
    --dv-tab-divider-color: var(--border-divider);
    --dv-activegroup-visiblepanel-tab-color: var(--text-bright);
    --dv-activegroup-hiddenpanel-tab-color: var(--text-subtle);
    --dv-inactivegroup-visiblepanel-tab-color: var(--text-secondary);
    --dv-inactivegroup-hiddenpanel-tab-color: var(--text-subtle);
    --dv-separator-border: var(--border-divider);
    --dv-paneview-header-border-color: var(--border-divider);
  }

  .dockview-container :global(.dv-tabs-container) {
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border-divider);
  }

  .dockview-container :global(.dv-tab) {
    background: var(--surface-control-hover);
    color: var(--text-secondary);
    border: none;
    padding: 6px 12px;
    font-size: 12px;
    min-width: 80px;
  }

  .dockview-container :global(.dv-tab.dv-active-tab) {
    background: var(--surface-panel);
    color: var(--text-bright);
  }

  .dockview-container :global(.dv-tab:hover:not(.dv-active-tab)) {
    background: var(--surface-hover);
  }

  .dockview-container :global(.dv-resize-container-handle) {
    background: var(--surface-active);
  }

  .dockview-container :global(.dv-resize-container-handle:hover) {
    background: var(--accent-alt);
  }

  .dockview-container :global(.dv-groupview) {
    background: var(--surface-panel);
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
    background: var(--accent-alt-tint);
    border: 2px dashed var(--accent-alt);
  }

  /* Panel content styling */
  .dockview-container :global(.dockview-panel-content) {
    background: var(--surface-panel);
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
    color: var(--text-subtle);
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
    background: var(--surface-active);
    color: var(--text-bright);
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

  .dockview-container :global(.cascade-tab-icon) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .dockview-container :global(.cascade-tab-title:hover) {
    color: var(--text-bright);
  }

  .dockview-container :global(.cascade-tab-close) {
    width: 16px;
    height: 16px;
    border: none;
    background: transparent;
    color: var(--text-subtle);
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
    background: var(--surface-active);
    color: var(--text-bright);
  }

  /* Lock button in tab */
  .dockview-container :global(.cascade-tab-lock) {
    width: 18px;
    height: 18px;
    border: none;
    background: transparent;
    color: var(--text-faintest);
    cursor: pointer;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
  }

  .dockview-container :global(.cascade-tab-lock:hover:not(:disabled)) {
    background: var(--surface-active);
    color: var(--text-secondary);
  }

  .dockview-container :global(.cascade-tab-lock:disabled) {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .dockview-container :global(.cascade-tab-lock.locked) {
    color: var(--accent);
  }

  .dockview-container :global(.cascade-tab-lock.locked:hover) {
    background: var(--surface-active);
    color: var(--accent-hover);
  }

  /* Add panel dropdown menu */
  .add-panel-menu {
    position: fixed;
    background: var(--surface-raised);
    border: 1px solid var(--border-divider);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 8px 24px var(--shadow-soft);
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
    color: var(--text-secondary);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }

  .add-panel-option:hover {
    background: var(--accent-alt);
    color: var(--text-on-accent);
  }

  :global(.panel-icon) {
    font-size: 14px;
    width: 20px;
    text-align: center;
  }

  .panel-label {
    flex: 1;
  }
</style>
