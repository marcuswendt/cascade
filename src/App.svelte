<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import DockviewContainer from './editor/dockview/DockviewContainer.svelte';
  import MenuBar from './editor/MenuBar.svelte';
  import NodePanel from './editor/NodePanel.svelte';
  import { dockviewStore } from './editor/dockview/dockview-store.svelte';
  import { settingsDialogRequest, clearSettingsDialogRequest } from './editor/stores/uiEventStore';
  import { loadExecutionLocus } from './editor/stores/executionLocus';
  import ColorPalette from './editor/components/ColorPalette.svelte';
  import { bumpGraphStructure } from './editor/stores/graphStructure';
  import { watchNodeSources } from './engine/nodeSourceWatch';
  import { watchBuild } from './editor/buildWatch';
  import { layoutTopDown, edgesFromConnections } from '@/utils/autoLayout';
  import CookStatusStrip from './editor/CookStatusStrip.svelte';
  import type { CookStatus } from '@/nodes/CookScheduler';

  // Lazy-loaded dialog components
  let ExportDialog: any = null;
  let SettingsDialog: any = null;
  let VersionHistoryDialog: any = null;
  let ProjectSettings: any = null;

  async function loadVersionHistoryDialog() {
    if (!VersionHistoryDialog) {
      const module = await import('./editor/VersionHistoryDialog.svelte');
      VersionHistoryDialog = module.default;
    }
  }

  async function loadExportDialog() {
    if (!ExportDialog) {
      const module = await import('./editor/ExportDialog.svelte');
      ExportDialog = module.default;
    }
  }

  async function loadSettingsDialog() {
    if (!SettingsDialog) {
      const module = await import('./editor/SettingsDialog.svelte');
      SettingsDialog = module.default;
    }
  }
  async function loadProjectSettingsDialog() {
    if (!ProjectSettings) ProjectSettings = (await import('./editor/panels/ProjectSettings.svelte')).default;
  }
  import { serializeGraph, saveGraphWithPicker, loadGraphFromFile, triggerFileInput, removeExtension } from '@/utils/fileSystem';
  import { Graph } from '@/nodes/Graph';
  import { Node } from '@/nodes/Node';
  import { GraphEditorAdapter } from './editor/GraphEditorAdapter';
  import { StudioGraphController } from './editor/StudioGraphController';
  import { incrementPropUpdateCounter } from './editor/stores/propUpdateStore';
  import { selectedNodeIds, selectedNodesOf } from './editor/stores/selectionStore';
  import {
    recordSnapshotImmediate,
    popUndo,
    popRedo,
    clearHistory,
    canUndo,
    canRedo,
    type GraphSnapshot
  } from './editor/stores/historyStore';

  let presentationMode = false;
  let activeLibrary: string | null = null;
  let activeCategory: string | null = null;
  let selectedNode: Node | null = null;
  let selectedAnnotation: string | null = null;
  let inspectorWasVisible = false;
  
  $: inspectorIsVisible = selectedNode !== null || selectedAnnotation !== null;
  $: shouldSkipAnimation = inspectorWasVisible && inspectorIsVisible;
  $: inspectorWasVisible = inspectorIsVisible;
  let nodePanelFixedPosition: { x: number; y: number } | null = null; // For dropdown menu positioning
  let activeTool = 'select';
  let mousePosition = { x: 0, y: 0 };
  let globalMousePosition = { x: 0, y: 0 }; // Track mouse position globally
  let exportDialogOpen = false;
  let settingsDialogOpen = false;
  let projectSettingsOpen = false;
  let graph: Graph | undefined = undefined;
  const studioGraph = new StudioGraphController(() => graph);
  let isGraphLoading = true;
  let subscribedGraph: Graph | undefined;
  let unsubscribeCookStatus: (() => void) | undefined;
  let cookStatus: Readonly<CookStatus> = {
    phase: 'idle',
    total: 0,
    completed: 0,
    currentNode: null,
    startedAt: null,
    elapsed: 0
  };

  // Scheduler progress is the graph-level source of truth. Rebind whenever a
  // document replaces the Graph instance and keep no parallel cook state here.
  $: if (graph !== subscribedGraph) {
    unsubscribeCookStatus?.();
    subscribedGraph = graph;
    cookStatus = graph?.scheduler.status ?? {
      phase: 'idle',
      total: 0,
      completed: 0,
      currentNode: null,
      startedAt: null,
      elapsed: 0
    };
    unsubscribeCookStatus = graph?.scheduler.subscribe(status => {
      cookStatus = status;
    });
  }

  onDestroy(() => unsubscribeCookStatus?.());
  let documentName = 'Untitled';
  let currentFilePath: string | null = null;
  // Set when the graph was opened from the `cascade` server (the project's own
  // .cascade file). Save writes back to it through the API; cleared the moment
  // the editor moves to any other document, so an unrelated graph can never
  // overwrite the project file.
  let projectGraphFile: string | null = null;
  let versionHistoryOpen = false;
  let buildIsStale = false;
  let missingProjectCredentials: string[] = [];
  let projectManifestName = '';
  let colorPaletteOpen = false;

  /**
   * Paint the selected nodes. Stored on the node and saved with the graph, so a
   * grouping survives the file — the point is to make a pipeline readable
   * tomorrow, not just for the rest of this session.
   */
  function applyNodeColor(color: string | null) {
    if (!graph) return;
    const targets = selectedNodesOf(graph, $selectedNodeIds, selectedNode);
    if (targets.length === 0) return;
    recordHistory();
    targets.forEach((n: any) => {
      if (color) n.color = color;
      else delete n.color;
    });
    graph.elements = [...graph.elements];
    hasUnsavedChanges = true;
    updateWindowTitle();
  }
  let hasUnsavedChanges = false;

  // Computed display name with dirty indicator
  // Show * for unsaved changes OR new files that haven't been saved yet
  $: displayName = (hasUnsavedChanges || currentFilePath === null) ? `${documentName} *` : documentName;

  function togglePresentationMode() {
    presentationMode = !presentationMode;
    if (presentationMode) {
      activeLibrary = null;
      activeCategory = null;
    }
  }
  
  function handleLibraryToggle(libraryId: string | null) {
    activeLibrary = libraryId;
    activeCategory = null; // Reset category when library changes
  }
  
  function handleCategorySelect(e: CustomEvent<{ libraryId: string; categoryId: string }>) {
    activeLibrary = e.detail.libraryId;
    activeCategory = e.detail.categoryId;
  }
  
  function handleLibrarySelect(e: CustomEvent<{ libraryId: string }>) {
    activeLibrary = e.detail.libraryId;
    activeCategory = null;
  }
  
  function handleToolChange(tool: string) {
    activeTool = tool;
  }
  
  let canvasRef: any = null;
  let dockviewContainerRef: any = null;

  function handleAddNode(e: CustomEvent<{ type: string; libraryId: string | null; categoryId: string | null; customConfig?: { name: string; modulePath: string; baseClass: string; code: string } }>) {
    if (dockviewContainerRef && dockviewContainerRef.addNode) {
      dockviewContainerRef.addNode({
        type: e.detail.type,
        category: e.detail.categoryId,
        customConfig: e.detail.customConfig
      });
    }
    activeLibrary = null;
    activeCategory = null;
  }
  
  function handleNodeSelect(node: Node | null) {
    selectedNode = node;
    if (node) {
      selectedAnnotation = null;
    }
  }
  
  function handleAnnotationSelect(e: CustomEvent<{ annotationId: string | null }>) {
    selectedAnnotation = e.detail.annotationId;
    if (e.detail.annotationId) {
      selectedNode = null;
    }
  }

  function handleMenuAction(action: string) {
    switch (action) {
      // File menu
      case 'new':
        handleNewProject();
        break;
      case 'open':
        handleOpenProject();
        break;
      case 'save':
        handleSave();
        break;
      case 'versionHistory':
        if (!projectGraphFile) {
          alert('Version history is for a project opened by the cascade CLI — this document has none.');
          break;
        }
        loadVersionHistoryDialog().then(() => versionHistoryOpen = true);
        break;
      case 'saveAs':
        handleSaveAs();
        break;
      case 'duplicate':
        handleDuplicate();
        break;
      case 'export':
        loadExportDialog().then(() => exportDialogOpen = true);
        break;
      case 'settings':
        loadSettingsDialog().then(() => settingsDialogOpen = true);
        break;
      case 'projectSettings':
        loadProjectSettingsDialog().then(() => projectSettingsOpen = true);
        break;
      case 'about':
        alert('Cascade - Visual Programming Framework\nVersion 1.0.0');
        break;

      // Edit menu
      case 'undo':
        handleUndo();
        break;
      case 'redo':
        handleRedo();
        break;
      case 'selectAll':
        if (dockviewContainerRef?.selectAll) {
          dockviewContainerRef.selectAll();
        }
        break;
      case 'deselectAll':
        if (dockviewContainerRef?.deselectAll) {
          dockviewContainerRef.deselectAll();
        }
        selectedNode = null;
        selectedAnnotation = null;
        break;
      case 'delete':
        if (dockviewContainerRef?.deleteSelected) {
          dockviewContainerRef.deleteSelected();
        }
        selectedNode = null;
        selectedAnnotation = null;
        break;

      // Create menu
      case 'addNode':
        nodePanelFixedPosition = null;
        activeLibrary = 'core';
        mousePosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        break;
      case 'addText':
        activeTool = 'text';
        break;
      case 'addImage':
        activeTool = 'image';
        break;
      case 'addGroup':
        activeTool = 'group';
        break;
      case 'addLine':
        activeTool = 'line';
        break;
      case 'addPolyline':
        activeTool = 'polyline';
        break;

      // View menu
      case 'cleanUpLayout':
        cleanUpLayout();
        break;
      case 'centerOnNodes':
        if (dockviewContainerRef?.centerOnNodes) {
          dockviewContainerRef.centerOnNodes();
        }
        break;
      case 'resetLayout':
        dockviewStore.resetLayout();
        break;
      case 'presentationMode':
        togglePresentationMode();
        break;
      case 'maximizeTab':
        dockviewStore.toggleMaximizeActivePanel();
        break;
      case 'focusGraph':
        dockviewStore.focusPanel('graph-main');
        break;
      case 'focusViewer':
        dockviewStore.focusPanel('viewer-main');
        break;
      case 'focusInspector':
        dockviewStore.focusPanel('inspector-main');
        break;
      case 'focusLog':
        dockviewStore.focusPanel('log-main');
        break;
    }
  }

  async function prepareGraphCandidate(json: any): Promise<Graph> {
    const candidate = GraphEditorAdapter.fromJSON(json).getGraph();
    try {
      await candidate.waitForAnnotationPorts();

      for (const node of candidate.nodes) {
        if (!node.code) continue;
        try {
          const wrappedCode = `return (async function(node, graph) {\n${node.code}\n})(node, graph);`;
          const nodeFunction = new Function('node', 'graph', wrappedCode) as (node: any, graph: any) => Promise<any>;
          node.setFunction(nodeFunction);
        } catch (error) {
          console.warn(`Failed to set function for node ${node.id}:`, error);
        }
      }
    } catch (error) {
      destroyGraph(candidate);
      throw error;
    }

    return candidate;
  }

  function destroyGraph(target: Graph): void {
    target.nodes.forEach(node => {
      try {
        node.onDestroy?.();
      } catch (error) {
        console.warn(`Failed to dispose node ${node.id}:`, error);
      }
    });
  }

  async function replaceGraph(candidate: Graph, resetHistory = false): Promise<void> {
    const previous = graph;
    graph = candidate;

    try {
      studioGraph.restoreConnections();
      await tick();
    } catch (error) {
      graph = previous;
      destroyGraph(candidate);
      throw error;
    }

    if (resetHistory) clearHistory();
    if (previous) destroyGraph(previous);
  }

  async function handleNewProject() {
    if (graph && confirm('Create a new project? Unsaved changes will be lost.')) {
      // User confirmed, proceed with new project
    } else if (!graph) {
      // No existing graph, just create new one
    } else {
      // User cancelled
      return;
    }

    // Load default graph from file
    try {
      const response = await fetch('/graphs/default.cascade');
      if (!response.ok) {
        throw new Error('Failed to load default graph');
      }
      const json = await response.json();
      const candidate = await prepareGraphCandidate(json);
      await replaceGraph(candidate, true);
      documentName = 'Untitled';
      currentFilePath = null;
      projectGraphFile = null;
      hasUnsavedChanges = false;
      updateWindowTitle();

      // Cook the graph in dependency order. Two reasons this is no longer a
      // parallel map: `n.code` is empty for project-source nodes (their module is
      // fetched compiled from the server, so the filter skipped every one of them
      // and the graph never cooked at all), and running them all at once executes
      // each node before its inputs exist, so everything downstream of a source
      // bails out on the first pass. graph.execute() walks the topological order
      // the engine already computes.
      cookGraph().catch(err => console.warn('Graph execution failed:', err));

      setTimeout(() => {
        if (dockviewContainerRef && dockviewContainerRef.centerOnNodes) {
          dockviewContainerRef.centerOnNodes();
        }
      }, 100);
    } catch (error) {
      console.error('Failed to load default graph:', error);
      if (!graph) {
        graph = GraphEditorAdapter.create().getGraph();
        documentName = 'Untitled';
        currentFilePath = null;
        projectGraphFile = null;
        hasUnsavedChanges = false;
        updateWindowTitle();
      }
    }
  }

  async function handleOpenProject() {
    try {
      const file = await triggerFileInput('.cascade');
      if (!file) return;

      const json = await loadGraphFromFile(file);
      const candidate = await prepareGraphCandidate(json);
      await replaceGraph(candidate, true);
      documentName = removeExtension(file.name);
      currentFilePath = file.name;
      projectGraphFile = null;
      hasUnsavedChanges = false;
      updateWindowTitle();

        // Cook the graph in dependency order. Two reasons this is no longer a
        // parallel map: `n.code` is empty for project-source nodes (their module is
        // fetched compiled from the server, so the filter skipped every one of them
        // and the graph never cooked at all), and running them all at once executes
        // each node before its inputs exist, so everything downstream of a source
        // bails out on the first pass. graph.execute() walks the topological order
        // the engine already computes.
      await cookGraph().catch(err => console.warn('Graph execution failed:', err));

      setTimeout(() => {
        if (dockviewContainerRef && dockviewContainerRef.centerOnNodes) {
          dockviewContainerRef.centerOnNodes();
        }
      }, 100);
    } catch (error) {
      alert('Failed to open project: ' + (error as Error).message);
    }
  }

  async function handleSave() {
    if (!graph) return;

    if (currentFilePath) {
      if (projectGraphFile) {
        // Served by the `cascade` CLI: write back to the project file itself
        // rather than through a download picker. The server commits the file
        // on every save, which is what File > Version History reads.
        const response = await fetch(`/api/graph/${encodeURIComponent(projectGraphFile)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: serializeGraph(graph)
        });
        if (!response.ok) {
          const detail = await response.text();
          alert(`Failed to save ${projectGraphFile}: ${detail}`);
          return;
        }
      } else {
        const savedFilename = await saveGraphWithPicker(graph, currentFilePath);
        if (!savedFilename) return;
      }
      hasUnsavedChanges = false;
      updateWindowTitle();
    } else {
      // No file path - prompt for name
      handleSaveAs();
    }
  }

  async function handleSaveAs() {
    if (!graph) return;

    const suggestedName = documentName === 'Untitled' ? 'my-project.cascade' : `${documentName}.cascade`;
    const savedFilename = await saveGraphWithPicker(graph, suggestedName);
    if (!savedFilename) return;

    documentName = savedFilename.replace(/\.cascade$/, '');
    currentFilePath = savedFilename;
    projectGraphFile = null;

    hasUnsavedChanges = false;
    updateWindowTitle();
  }

  function handleDuplicate() {
    if (!graph) return;
    
    // Create a copy of the current graph
    const json = graph.toJSON();
    const adapter = GraphEditorAdapter.fromJSON(json);
    const newGraph = adapter.getGraph();
    
    // Offset all nodes slightly
    newGraph.nodes.forEach(node => {
      node.position.x += 50;
      node.position.y += 50;
    });
    
    graph = newGraph;
    documentName = documentName + ' Copy';
    currentFilePath = null;
    projectGraphFile = null;
    updateWindowTitle();
    
    // Execute all nodes to initialize them
    newGraph.nodes.forEach(node => {
      if (node.code) {
        try {
          const nodeFunction = new Function('node', 'graph', node.code);
          node.setFunction(nodeFunction);
        } catch (err) {
          console.warn('Failed to execute node ' + node.id + ':', err);
        }
      }
    });
    void cookGraph().catch(err => console.warn('Failed to initialize duplicated graph:', err));
    
    // Center canvas on nodes after duplicating
    setTimeout(() => {
      if (dockviewContainerRef && dockviewContainerRef.centerOnNodes) {
        dockviewContainerRef.centerOnNodes();
      }
    }, 100);
  }

  function updateWindowTitle() {
    if (typeof document !== 'undefined') {
      const dirtyIndicator = hasUnsavedChanges ? ' *' : '';

      /**
       * The project's name comes first, because that is what a tab is being
       * scanned for — a row of tabs all reading "Cascade - …" is a row you
       * have to read to the end of. The app's name still follows, so the tab
       * says what it is.
       *
       * The graph's own `metadata.name` wins when it has one; otherwise the
       * file name, which is what an unnamed graph is actually known by.
       */
      const projectName =
        graph?.project?.name && graph.project.name !== 'Cascade Graph'
          ? graph.project.name
          : projectManifestName
            ? projectManifestName
          : documentName && documentName !== 'Untitled'
            ? documentName
            : 'Untitled';
      document.title = `${projectName}${dirtyIndicator} - Cascade`;
    }
  }

  /**
   * Restore graph from a history snapshot (for undo/redo)
   */
  async function restoreFromSnapshot(snapshot: GraphSnapshot) {
    if (!graph) return;
    const candidate = await prepareGraphCandidate(snapshot.json);
    await replaceGraph(candidate);

    // Restore selection
    selectedNode = snapshot.selectedNodeId ? graph.getNode(snapshot.selectedNodeId) : null;
    selectedAnnotation = snapshot.selectedAnnotationId;

    // Cook the graph in dependency order. Two reasons this is no longer a
    // parallel map: `n.code` is empty for project-source nodes (their module is
    // fetched compiled from the server, so the filter skipped every one of them
    // and the graph never cooked at all), and running them all at once executes
    // each node before its inputs exist, so everything downstream of a source
    // bails out on the first pass. graph.execute() walks the topological order
    // the engine already computes.
    cookGraph().catch(err => console.warn('Graph execution failed:', err));
  }

  /**
   * Handle undo action
   */
  async function handleUndo() {
    if (!graph) return;
    const snapshot = popUndo(graph, selectedNode?.id || null, selectedAnnotation);
    if (snapshot) {
      await restoreFromSnapshot(snapshot);
    }
  }

  /**
   * Handle redo action
   */
  async function handleRedo() {
    if (!graph) return;
    const snapshot = popRedo(graph, selectedNode?.id || null, selectedAnnotation);
    if (snapshot) {
      await restoreFromSnapshot(snapshot);
    }
  }

  /**
   * Record current state to history (called before edits)
   */
  function recordHistory() {
    if (!graph) return;
    recordSnapshotImmediate(graph, selectedNode?.id || null, selectedAnnotation);
    hasUnsavedChanges = true;
    updateWindowTitle();
  }

  // Update window title when document name changes
  $: if (documentName) {
    updateWindowTitle();
  }

  // Update window title when unsaved changes state changes
  $: if (typeof hasUnsavedChanges !== 'undefined') {
    updateWindowTitle();
  }

  /**
   * Cook the whole graph, repeatedly, until it stops producing anything new.
   *
   * A single pass is not enough, and the reason is structural: a node's PORTS
   * are created by running its code, so before a node has ever executed it has
   * no output ports — which means the engine's dependency walk can't see past
   * it, and every node looks like an entry point with no inputs. One pass
   * therefore only ever advances the graph by a level or so, and the stages
   * downstream bail out on missing inputs.
   *
   * Repeating until the number of resolved outputs stops growing settles it.
   * That is affordable only because the stages cache their results — a repeat
   * pass over already-computed nodes costs close to nothing.
   */
  async function cookGraph(maxPasses = 16): Promise<void> {
    if (!graph) return;
    let previous = -1;
    let previousPending = -1;
    for (let pass = 0; pass < maxPasses; pass++) {
      await graph.execute();
      // Ports that appeared during this pass may let more connections bind.
      studioGraph.restoreConnections();

      // The Studio controller publishes any ports and wires created this pass.
      await tick();

      const resolved = graph.nodes.reduce(
        (total: number, node: any) =>
          total + node.outputs.filter((port: any) => port.value !== undefined && port.value !== null).length,
        0
      );
      const pending = ((graph as any)._connectionsToRestore ?? []).length;
      // Settled only when NEITHER measure moved. Watching the resolved count
      // alone stopped a pass too early: a node can become runnable on the very
      // pass that bound its last connection, and that pass adds a connection
      // without yet adding an output.
      if (resolved === previous && pending === previousPending) {
        console.log(`[Cook] settled after ${pass + 1} passes: ${resolved} outputs` +
          (pending ? `, ${pending} connections unresolved (bypassed or unrunnable upstream)` : ''));
        if (pending) {
          console.log('[Cook] unresolved:', ((graph as any)._connectionsToRestore ?? [])
            .map((c: any) => `${c[0][0]}.${c[0][2] ?? c[0][1]}->${c[1][0]}.${c[1][2] ?? c[1][1]}`).join(' '));
        }
        return;
      }
      previous = resolved;
      previousPending = pending;
    }
    console.warn(`[Cook] still changing after ${maxPasses} passes — stopping`);
  }

  /**
   * Ask the `cascade` server which graph this project opens with, and fetch it.
   * Returns null when the app isn't served by the CLI or when the project has
   * no unambiguous default; startup then falls through to the bundled graph.
   */
  async function loadProjectGraph(): Promise<{ filename: string; json: any } | null> {
    try {
      const listing = await fetch('/api/graph');
      if (!listing.ok) return null;
      const { default: filename } = await listing.json();
      if (!filename) return null;

      const response = await fetch(`/api/graph/${encodeURIComponent(filename)}`);
      if (!response.ok) return null;
      return { filename, json: await response.json() };
    } catch (err) {
      console.warn('[Startup] No project graph available from the server:', err);
      return null;
    }
  }

  /**
   * Load a past version into the editor. Deliberately NOT a git operation:
   * the old graph becomes the current unsaved document, so nothing on disk
   * changes until Marcus saves, and saving it writes the next version on top
   * rather than rewriting anything. Reverting a revert is just another restore.
   */
  async function handleRestoreVersion(event: CustomEvent<{ json: any; version: { shortSha: string } }>) {
    const { json, version } = event.detail;
    const restoredFile = projectGraphFile;
    const candidate = await prepareGraphCandidate(json);
    await replaceGraph(candidate, true);
    versionHistoryOpen = false;
    // Still the same project file — saving writes the restored graph forward.
    projectGraphFile = restoredFile;
    currentFilePath = restoredFile;
    hasUnsavedChanges = true;
    updateWindowTitle();

    // Cook the graph in dependency order. Two reasons this is no longer a
    // parallel map: `n.code` is empty for project-source nodes (their module is
    // fetched compiled from the server, so the filter skipped every one of them
    // and the graph never cooked at all), and running them all at once executes
    // each node before its inputs exist, so everything downstream of a source
    // bails out on the first pass. graph.execute() walks the topological order
    // the engine already computes.
    cookGraph().catch(err => console.warn('Graph execution failed:', err));

    console.log(`[Version] Restored ${restoredFile} at ${version.shortSha} — unsaved until you save`);
  }

  /**
   * Re-lay the graph top to bottom. Cascade puts a node's inputs on its top edge
   * and its outputs on the bottom, so a downward flow means every wire leaves a
   * bottom and arrives at a top — no wire has to double back, and far fewer
   * cross.
   */
  async function cleanUpLayout() {
    if (!graph) return;
    recordHistory();
    // Measure what is actually on screen: node widths vary with port count and
    // a variadic list, and spacing by a fixed pitch overlapped the wide ones.
    // The WHOLE node: control box plus the name label beside it. Measuring only
    // the box packed columns to the box width, so long names ran straight over
    // the next node and became unreadable — which is the width that matters,
    // since the name is what you navigate by.
    const widths = new Map<string, number>();
    document.querySelectorAll('.node').forEach((el) => {
      const name = el.querySelector('.node-name')?.textContent?.trim();
      if (!name) return;
      // offsetWidth, not getBoundingClientRect: the canvas is CSS-transformed,
      // so a bounding rect is in SCREEN pixels and depends on the current zoom,
      // while positions are in graph pixels. Dividing by a zoom read from the
      // wrong place is how the widths came out too small and the nodes packed
      // on top of each other. offsetWidth is the untransformed layout width.
      //
      // The whole node element — box plus label — because that is the footprint
      // that must not collide, and the label is what you read.
      widths.set(name, Math.max((el as HTMLElement).offsetWidth, 90));
    });

    const positions = layoutTopDown(
      graph.nodes.map((n: any) => n.id),
      edgesFromConnections(graph.connections),
      { widths }
    );
    graph.nodes.forEach((node: any) => {
      const next = positions.get(node.id);
      if (next) node.position = next;
    });
    graph.elements = [...graph.elements];
    bumpGraphStructure();

    /**
     * Then again after the DOM has caught up.
     *
     * Wire geometry is measured from where the port dots actually are on
     * screen, so the first recompute reads the positions the nodes had a moment
     * ago — the nodes jump and the wires stay behind, until a pan happens to
     * recompute them. One tick, then ask again.
     */
    hasUnsavedChanges = true;
    updateWindowTitle();

    /**
     * Then again once the browser has actually laid the nodes out.
     *
     * Wire geometry is measured from where the port dots are on screen, and a
     * Svelte tick is not enough: the SVG renders in the same flush as the nodes
     * move, so it reads positions one frame stale. Measured — 78 of 131 wires
     * shifted, some by 350px, the moment you panned and forced a recompute.
     * Two animation frames puts the measurement after real layout.
     */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bumpGraphStructure();
      dockviewContainerRef?.centerOnNodes?.();
      // Centring moves the canvas transform the measurements are relative to,
      // so ask once more after that has settled too.
      requestAnimationFrame(() => requestAnimationFrame(() => bumpGraphStructure()));
    }));
  }

  // Set initial window title
  onMount(() => {
    // Wire up Node's prop params change callback to editor's store
    Node.onPropParamsChanged = incrementPropUpdateCounter;

    updateWindowTitle();

    // Which node modules run server-side vs in the page — drives the badge on
    // each node. Fire and forget: no badge is a fine outcome if it fails.
    loadExecutionLocus();

    // Node sources changing on disk restale the nodes using them, so an edit
    // in an external editor shows up on the next cook instead of needing the
    // whole app reloaded.
    const unsubNodeSources = watchNodeSources({ getTarget: () => graph ?? null });

    // Say so rather than reload: an unsaved graph must not be thrown away by
    // the app deciding for itself.
    const unsubBuild = watchBuild(() => { buildIsStale = true; });

    // Subscribe to settings dialog requests from nodes/components
    const unsubSettingsRequest = settingsDialogRequest.subscribe(requested => {
      if (requested) {
        loadSettingsDialog().then(() => settingsDialogOpen = true);
        clearSettingsDialogRequest();
      }
    });

    // Load default graph on startup (async IIFE to avoid onMount return type issues)
    (async () => {
    if (!graph) {
      try {
        let json: any;
        let nextDocumentName = 'Untitled';
        let nextFilePath: string | null = null;
        let nextProjectGraphFile: string | null = null;

        // Served by the `cascade` CLI: open the project's own graph. The
        // server resolves which one — the file named on the command line
        // (`cascade artwork.cascade`), else `index.cascade`, else the
        // sole `.cascade` file in the directory `cascade` was launched in.
        const projectGraph = await loadProjectGraph();
        if (projectGraph) {
          console.log('[Startup] Loading project graph from server:', projectGraph.filename);
          json = projectGraph.json;
          nextFilePath = projectGraph.filename;
          nextDocumentName = projectGraph.filename;
          nextProjectGraphFile = projectGraph.filename;
        }

        // Fall back to default graph
        if (!json) {
          const response = await fetch('/graphs/default.cascade');
          if (!response.ok) {
            throw new Error('Failed to load default graph');
          }
          json = await response.json();
        }

        const candidate = await prepareGraphCandidate(json);
        await replaceGraph(candidate);
        documentName = nextDocumentName;
        currentFilePath = nextFilePath;
        projectGraphFile = nextProjectGraphFile;
        hasUnsavedChanges = false;
        updateWindowTitle();
        if (projectGraphFile) {
          try {
            const { loadProjectSettings } = await import('./editor/projectSettingsApi');
            const projectState = await loadProjectSettings();
            missingProjectCredentials = projectState.missingCredentials;
            projectManifestName = projectState.manifest.name;
            updateWindowTitle();
          } catch { missingProjectCredentials = []; }
        }

        // Cook in dependency order — see the note on the other call sites: the
        // n.code filter skips every project-source node, and a parallel map runs
        // each node before its inputs exist.
        if (missingProjectCredentials.length === 0) {
          await cookGraph().catch(err => console.warn('Graph execution failed:', err));
        } else {
          console.warn(`[Startup] Cook deferred until required credentials are set: ${missingProjectCredentials.join(', ')}`);
        }

        // Center canvas on nodes after loading
        setTimeout(() => {
          if (dockviewContainerRef && dockviewContainerRef.centerOnNodes) {
            dockviewContainerRef.centerOnNodes();
          }
        }, 100);
      } catch (error) {
        console.error('Failed to load default graph:', error);
        // Fallback: create empty graph
        const adapter = GraphEditorAdapter.create();
        graph = adapter.getGraph();
        documentName = 'Untitled';
        currentFilePath = null;
        projectGraphFile = null;
        updateWindowTitle();
      }
    }
    isGraphLoading = false;
    })(); // End of async IIFE for graph loading

    // Track global mouse position
    function handleMouseMove(e: MouseEvent) {
      globalMousePosition = { x: e.clientX, y: e.clientY };
    }
    window.addEventListener('mousemove', handleMouseMove);
    
    // Keyboard shortcuts
    function handleKeyDown(e: KeyboardEvent) {
    // C — the node colour palette. This key was the cook toggle; cook moved to
    // K, which is free and still has a button on every node. Colour earns the
    // shorter key: it is the grouping you reach for while reading a graph.
    if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      const target = e.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
        e.preventDefault();
        colorPaletteOpen = !colorPaletteOpen;
        return;
      }
    }

      // Presentation mode toggle (⌘. or Ctrl.)
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        togglePresentationMode();
      }

      // ⌘Z - Undo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }

      // ⌘Shift+Z - Redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Tool shortcuts
      const toolTarget = e.target as HTMLElement;
      if (toolTarget.tagName !== 'INPUT' && toolTarget.tagName !== 'TEXTAREA') {
        // V - Select tool
        if (e.key === 'v' || e.key === 'V') {
          if (!e.metaKey && !e.ctrlKey) {
            activeTool = 'select';
          }
        }
        
        // H - Center canvas on home position (same as cmd-0)
        if ((e.key === 'h' || e.key === 'H') && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          if (dockviewContainerRef && dockviewContainerRef.centerOnNodes) {
            dockviewContainerRef.centerOnNodes();
          }
        }
        
        // Annotation shortcuts (Alt + key)
        if (e.altKey && !e.metaKey && !e.ctrlKey) {
          if (e.key === 't' || e.key === 'T') {
            e.preventDefault();
            activeTool = 'text';
          }
          if (e.key === 'i' || e.key === 'I') {
            e.preventDefault();
            activeTool = 'image';
          }
          if (e.key === 'g' || e.key === 'G') {
            e.preventDefault();
            activeTool = 'group';
          }
          if (e.key === 'l' || e.key === 'L') {
            e.preventDefault();
            activeTool = 'line';
          }
          if (e.key === 'p' || e.key === 'P') {
            e.preventDefault();
            activeTool = 'polyline';
          }
        }
      }
      
      // Open node panel with Tab
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Only if not typing in an input field
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          if (activeLibrary || activeCategory) {
            activeLibrary = null;
            activeCategory = null;
            nodePanelFixedPosition = null;
          } else {
            // Clear fixed position - use mouse-based positioning
            nodePanelFixedPosition = null;
            // Get graph window element and check if mouse is inside it
            const graphWindow = document.querySelector('[data-window-id="graph"]') as HTMLElement;
            if (graphWindow) {
              const rect = graphWindow.getBoundingClientRect();
              // Check if current mouse position is inside graph window
              if (
                globalMousePosition.x >= rect.left &&
                globalMousePosition.x <= rect.right &&
                globalMousePosition.y >= rect.top &&
                globalMousePosition.y <= rect.bottom
              ) {
                // Mouse is inside graph window - use mouse position
                mousePosition = { ...globalMousePosition };
              } else {
                // Mouse is outside - use center of graph window
                mousePosition = {
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height / 2
                };
              }
            } else {
              // No graph window found - use center of screen
              mousePosition = {
                x: window.innerWidth / 2,
                y: window.innerHeight / 2
              };
            }
            // Open with first available library
            activeLibrary = 'core';
          }
        }
      }
      
      // Close node panel with Escape
      if (e.key === 'Escape' && (activeLibrary || activeCategory)) {
        activeLibrary = null;
        activeCategory = null;
        nodePanelFixedPosition = null;
      }
      
      // Additional keyboard shortcuts
      // ⌘B - Maximize/restore active panel
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        dockviewStore.toggleMaximizeActivePanel();
      }
      
      // ⌘/ - Toggle node panel (same as Tab)
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          if (activeLibrary || activeCategory) {
            activeLibrary = null;
            activeCategory = null;
            nodePanelFixedPosition = null;
          } else {
            nodePanelFixedPosition = null;
            mousePosition = {
              x: window.innerWidth / 2,
              y: window.innerHeight / 2
            };
            activeLibrary = 'core';
          }
        }
      }
      
      // ⌘; - Toggle inspector
      if ((e.metaKey || e.ctrlKey) && e.key === ';') {
        e.preventDefault();
        if (selectedNode) {
          selectedNode = null;
        } else if (selectedNode === null) {
          // Would need to get last selected node, but for now just close
          selectedNode = null;
        }
      }

      // ⌘E - Export project
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        loadExportDialog().then(() => exportDialogOpen = true);
      }

      // ⌘, - Settings
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        loadSettingsDialog().then(() => settingsDialogOpen = true);
      }

      // File shortcuts use Alt to avoid conflicting with browser shortcuts.
      const fileModifier = e.altKey;

      // Alt+N - New project
      if (fileModifier && e.key === 'n' && !e.shiftKey) {
        e.preventDefault();
        handleNewProject();
      }

      // Alt+O - Open project
      if (fileModifier && e.key === 'o' && !e.shiftKey) {
        e.preventDefault();
        handleOpenProject();
      }

      // Alt+S - Save project
      if (fileModifier && e.key === 's') {
        e.preventDefault();
        if (e.shiftKey) {
          handleSaveAs();
        } else {
          handleSave();
        }
      }

      // ⌘D - Duplicate (when not in input)
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          handleDuplicate();
        }
      }
      
      // Behavior Toggle Shortcuts (v1.2)
      const behaviorTarget = e.target as HTMLElement;
      if (behaviorTarget.tagName !== 'INPUT' && behaviorTarget.tagName !== 'TEXTAREA' && graph && selectedNode) {
        // B - Toggle bypass
        if (e.key === 'b' || e.key === 'B') {
          if (!e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            selectedNode.setBypass(!selectedNode.bypass);
          }
        }
        
        // K - Toggle cook (was C)
        if (e.key === 'k' || e.key === 'K') {
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            if (e.shiftKey) {
              // Shift+K - Multi-cook (cook this chain)
              selectedNode.setCook(true);
              // Cook all downstream nodes
              const cookDownstream = (node: Node) => {
                node.outputs.forEach((output) => {
                  output.connections.forEach((conn) => {
                    const downstreamNode = graph?.getNode(conn.to.nodeId);
                    if (downstreamNode) {
                      downstreamNode.setCook(true);
                      cookDownstream(downstreamNode);
                    }
                  });
                });
              };
              cookDownstream(selectedNode);
            } else {
              // Normal K: Always clear other cooking nodes first, then toggle this one
              if (selectedNode.cook) {
                selectedNode.setCook(false);
              } else {
                graph.clearCookingNodes();
                selectedNode.setCook(true);
              }
            }
          }
        }
        
        // Alt+B - Clear all bypasses
        if (e.altKey && (e.key === 'b' || e.key === 'B')) {
          e.preventDefault();
          graph.nodes.forEach(node => {
            if (node.bypass) {
              node.setBypass(false);
            }
          });
        }
        
        // Alt+K - Clear all cooking
        if (e.altKey && (e.key === 'k' || e.key === 'K')) {
          e.preventDefault();
          graph.clearCookingNodes();
        }
      }
      
      // Delete - Delete selected node
      if (e.key === 'Delete' && graph && selectedNode) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          recordHistory();
          graph.removeNode(selectedNode.id);
          selectedNode = null;
        }
      }
      
      // Alt+H - Home (reset view)
      if (e.altKey && (e.key === 'h' || e.key === 'H')) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          if (dockviewContainerRef && dockviewContainerRef.centerOnNodes) {
            dockviewContainerRef.centerOnNodes();
          }
        }
      }

      // Panel focus shortcuts (Ctrl+1-4)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        if (e.key === '1') {
          e.preventDefault();
          dockviewStore.focusPanel('graph-main');
        } else if (e.key === '2') {
          e.preventDefault();
          dockviewStore.focusPanel('viewer-main');
        } else if (e.key === '3') {
          e.preventDefault();
          dockviewStore.focusPanel('inspector-main');
        } else if (e.key === '4') {
          e.preventDefault();
          dockviewStore.focusPanel('log-main');
        }
      }

      // Ctrl+W - Close active panel (except graph-main)
      if ((e.ctrlKey || e.metaKey) && e.key === 'w' && !e.shiftKey) {
        const activePanel = dockviewStore.activePanel;
        if (activePanel && activePanel !== 'graph-main') {
          e.preventDefault();
          dockviewStore.removePanel(activePanel);
        }
      }

      // Ctrl+Shift+P - Reset layout
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        dockviewStore.resetLayout();
      }
    }
    
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousemove', handleMouseMove);
      unsubSettingsRequest();
      unsubNodeSources();
      unsubBuild();
    };
  });
</script>

<div class="app" class:presentation-mode={presentationMode}>
  {#if buildIsStale}
    <div class="build-stale" role="status">
      <span>Cascade updated. This tab is running the previous build.</span>
      <button on:click={() => location.reload()}>Reload</button>
    </div>
  {/if}
  {#if !presentationMode}
    <MenuBar
      documentName={displayName}
      canUndo={$canUndo}
      canRedo={$canRedo}
      on:action={(e) => handleMenuAction(e.detail)}
      on:openNodePanel={(e) => {
        activeLibrary = 'core';
        // Position panel directly below the Create button (dropdown mode)
        nodePanelFixedPosition = { x: e.detail.x, y: e.detail.y };
      }}
      on:nameChange={(e) => {
        documentName = e.detail;
        hasUnsavedChanges = true;
        updateWindowTitle();
      }}
    />
  {/if}
  <DockviewContainer
    bind:this={dockviewContainerRef}
    {graph}
    {selectedNode}
    {selectedAnnotation}
    {activeTool}
    {activeLibrary}
    documentName={displayName}
    {presentationMode}
    onRecordHistory={recordHistory}
    on:nodeSelect={(e) => handleNodeSelect(e.detail.node)}
    on:annotationSelect={(e) => handleAnnotationSelect(e)}
    on:libraryToggle={(e) => handleLibraryToggle(e.detail)}
    on:toolChange={(e) => handleToolChange(e.detail)}
    on:action={(e) => handleMenuAction(e.detail)}
    on:nameChange={(e) => {
      documentName = e.detail;
      hasUnsavedChanges = true;
      updateWindowTitle();
    }}
    on:openNodePanel={(e) => {
      // Get mouse position from event or use center of screen
      if (e.detail?.x && e.detail?.y) {
        mousePosition = { x: e.detail.x, y: e.detail.y };
      } else {
        mousePosition = {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2
        };
      }
      // Open with first available library
      activeLibrary = activeLibrary ? null : 'core';
      activeCategory = null;
    }}
  />

  <CookStatusStrip loading={isGraphLoading} status={cookStatus} />
  {#if missingProjectCredentials.length}
    <div class="credential-warning" role="alert">
      Missing project credentials: {missingProjectCredentials.join(', ')}.
      <button on:click={() => loadProjectSettingsDialog().then(() => projectSettingsOpen = true)}>Open Project Settings</button>
    </div>
  {/if}
  
  {#if activeLibrary || activeCategory}
    <NodePanel
      libraryId={activeLibrary}
      categoryId={activeCategory}
      centerPosition={mousePosition}
      fixedPosition={nodePanelFixedPosition}
      on:addNode={handleAddNode}
      on:selectCategory={handleCategorySelect}
      on:selectLibrary={handleLibrarySelect}
      on:close={() => {
        activeLibrary = null;
        activeCategory = null;
        nodePanelFixedPosition = null;
      }}
    />
  {/if}

  {#if graph && ExportDialog}
    <svelte:component
      this={ExportDialog}
      {graph}
      bind:open={exportDialogOpen}
      on:close={() => exportDialogOpen = false}
    />
  {/if}

  <ColorPalette
    open={colorPaletteOpen}
    selectionCount={selectedNodesOf(graph, $selectedNodeIds, selectedNode).length}
    on:choose={(e) => { applyNodeColor(e.detail); colorPaletteOpen = false; }}
    on:close={() => (colorPaletteOpen = false)}
  />

  {#if VersionHistoryDialog}
    <svelte:component
      this={VersionHistoryDialog}
      filename={projectGraphFile}
      bind:open={versionHistoryOpen}
      on:restore={handleRestoreVersion}
      on:close={() => versionHistoryOpen = false}
    />
  {/if}

  {#if SettingsDialog}
    <svelte:component
      this={SettingsDialog}
      bind:open={settingsDialogOpen}
      on:close={() => settingsDialogOpen = false}
    />
  {/if}

  {#if graph && ProjectSettings}
    <svelte:component
      this={ProjectSettings}
      {graph}
      bind:open={projectSettingsOpen}
      on:save={(event: CustomEvent<{ graphName: string; projectName: string; missingCredentials: string[] }>) => {
        documentName = event.detail.graphName || documentName;
        projectManifestName = event.detail.projectName;
        missingProjectCredentials = event.detail.missingCredentials;
        hasUnsavedChanges = true;
        updateWindowTitle();
      }}
      on:close={() => projectSettingsOpen = false}
    />
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow: hidden;
  }

  .app {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  /* In the layout flow rather than floating: it must not cover a tab bar or a
     menu, and it should be impossible to miss. */
  .build-stale {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 6px 12px;
    background: var(--banner-warn-bg);
    border-bottom: 1px solid var(--banner-warn-border);
    color: var(--banner-warn-text);
    font-size: 12px;
  }

  .build-stale button {
    background: var(--banner-warn-border);
    border: 1px solid var(--banner-warn-hover);
    border-radius: 4px;
    color: var(--banner-warn-text-bright);
    font-size: 12px;
    padding: 2px 10px;
    cursor: pointer;
  }

  .build-stale button:hover {
    background: var(--banner-warn-hover);
  }

  .credential-warning { background: var(--banner-alert-bg); color: var(--banner-alert-text); padding: 7px 12px; font-size: 12px; display: flex; gap: 8px; align-items: center; }
  .credential-warning button { margin-left: auto; background: transparent; color: inherit; border: 1px solid currentColor; border-radius: 4px; cursor: pointer; }

  .app :global(.dockview-container) {
    flex: 1;
    width: 100%;
  }

  .app.presentation-mode :global(.dockview-container) {
    height: 100vh;
  }

</style>
