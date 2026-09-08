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
    /* Studio applies none of dockview's shipped `.dockview-theme-*` classes,
       so these two were undefined and the tab strip was sized by its tallest
       child instead — 30px with a lock button, 28px without. Pinned here, from
       theme.css, so one number owns the strip. */
    --dv-tabs-and-actions-container-height: var(--panel-tab-height);
    --dv-tabs-and-actions-container-font-size: var(--panel-tab-font-size);
  }

  /* The divider is drawn as an inset shadow, not a border, and on the whole
     strip rather than on the tab list. A 1px border on .dv-tabs-container —
     which dockview sizes at height: 100% and content-box — added a pixel the
     strip no longer has to give now that its height is pinned, and it only
     ever spanned the tabs rather than the group. */
  .dockview-container :global(.dv-tabs-and-actions-container) {
    box-shadow: inset 0 -1px 0 var(--border-divider);
  }

  .dockview-container :global(.dv-tabs-container) {
    background: var(--surface-raised);
    box-sizing: border-box;
  }

  .dockview-container :global(.dv-tab) {
    background: var(--surface-control-hover);
    color: var(--text-secondary);
    border: none;
    /* No vertical padding: the strip's own height is what sizes the tab now,
       and 6px top and bottom is what made it 30px. Horizontal padding and the
       font came down with it, so a 20px tab still reads as a label rather than
       as a clipped one. */
    padding: 0 var(--panel-tab-padding-x);
    font-size: var(--panel-tab-font-size);
    line-height: 1;
    min-width: 64px;
    height: var(--panel-tab-height);
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
    width: var(--panel-tab-glyph-size);
    height: var(--panel-tab-glyph-size);
    border: none;
    background: transparent;
    color: var(--text-subtle);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    transition: background 0.15s, color 0.15s;
  }

  /* The pointer target, held at 24px while the glyph shrank to 16px. It
     overflows the button and, vertically, the 20px strip — which is the point:
     the strip may not grow, but the target it hands the pointer can. Every
     small control in this header does this, and a shorter tab whose close
     button has become unclickable is a bug traded for space. */
  .dockview-container :global(.cascade-add-panel-btn)::after,
  .dockview-container :global(.cascade-fold-btn)::after,
  .dockview-container :global(.cascade-tab-close)::after,
  .dockview-container :global(.cascade-tab-lock)::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--panel-tab-hit-area);
    height: var(--panel-tab-hit-area);
    transform: translate(-50%, -50%);
  }

  .dockview-container :global(.cascade-add-panel-btn:hover) {
    background: var(--surface-active);
    color: var(--text-bright);
  }

  /* Custom tab styling */
  .dockview-container :global(.cascade-tab) {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 2px;
    height: 100%;
    min-width: 0;
  }

  .dockview-container :global(.cascade-tab-title) {
    cursor: pointer;
    user-select: none;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
    width: var(--panel-tab-glyph-size);
    height: var(--panel-tab-glyph-size);
    border: none;
    background: transparent;
    color: var(--text-subtle);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    flex-shrink: 0;
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
    width: var(--panel-tab-glyph-size);
    height: var(--panel-tab-glyph-size);
    position: relative;
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

  /* Fold button — the collapse control in each group's header */
  .dockview-container :global(.cascade-fold-btn) {
    width: var(--panel-tab-glyph-size);
    height: var(--panel-tab-glyph-size);
    border: none;
    background: transparent;
    color: var(--text-subtle);
    cursor: pointer;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s;
  }

  .dockview-container :global(.cascade-fold-btn:hover) {
    background: var(--surface-active);
    color: var(--text-bright);
  }

  /* ---- Folded group ----------------------------------------------------
   *
   * The group itself is sized to FOLDED_SIZE by dockview/fold.ts; this is only
   * what the chrome inside that hairline does. Two things have to hold. The
   * tabs must get out of the way, or a 20px tab strip renders clipped inside an
   * 8px group and looks broken rather than folded. And the strip must stay
   * clickable — so the header-actions container is stretched across the whole
   * width and the fold button fills it, making the entire strip one wide, short
   * button. 8px is far under any pointer-target floor in one dimension and
   * hundreds of pixels over it in the other, which is the only way a strip this
   * thin is honestly hittable. */
  .dockview-container :global(.dv-groupview.cascade-group-folded) {
    --dv-tabs-and-actions-container-height: var(--panel-tab-height-folded);
  }

  .dockview-container :global(.dv-groupview.cascade-group-folded .dv-tabs-and-actions-container) {
    position: relative;
    overflow: hidden;
    box-shadow: none;
  }

  .dockview-container :global(.dv-groupview.cascade-group-folded .dv-tabs-container),
  .dockview-container :global(.dv-groupview.cascade-group-folded .dv-scrollable),
  .dockview-container :global(.dv-groupview.cascade-group-folded .dv-void-container),
  .dockview-container :global(.dv-groupview.cascade-group-folded .cascade-add-panel-btn) {
    display: none;
  }

  .dockview-container :global(.dv-groupview.cascade-group-folded .dv-right-actions-container),
  .dockview-container :global(.dv-groupview.cascade-group-folded .cascade-header-actions) {
    position: absolute;
    inset: 0;
    padding: 0;
    display: block;
  }

  .dockview-container :global(.dv-groupview.cascade-group-folded .cascade-fold-btn) {
    width: 100%;
    height: 100%;
    border-radius: 0;
    background: var(--surface-raised);
    color: var(--text-subtle);
    /* The glyph does not fit in 8px and is not what gets clicked. A centred
       hairline is what reads as "there is a panel here, folded". */
    overflow: hidden;
  }

  .dockview-container :global(.dv-groupview.cascade-group-folded .cascade-fold-btn svg) {
    display: none;
  }

  .dockview-container :global(.dv-groupview.cascade-group-folded .cascade-fold-btn)::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 28px;
    height: 2px;
    border-radius: 1px;
    transform: translate(-50%, -50%);
    background: var(--text-faintest);
    transition: background 0.15s;
  }

  /* The hit area is the strip; the overflowing 24px square would otherwise
     stick out past an 8px group and swallow clicks meant for its neighbour. */
  .dockview-container :global(.dv-groupview.cascade-group-folded .cascade-fold-btn)::after {
    content: none;
  }

  .dockview-container :global(.dv-groupview.cascade-group-folded .cascade-fold-btn:hover) {
    background: var(--surface-active);
  }

  .dockview-container :global(.dv-groupview.cascade-group-folded .cascade-fold-btn:hover)::before {
    background: var(--accent-alt);
    width: 44px;
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
