<script lang="ts">
  import { onMount, tick } from 'svelte';
  import DockviewContainer from './editor/dockview/DockviewContainer.svelte';
  import MenuBar from './editor/MenuBar.svelte';
  import NodePanel from './editor/NodePanel.svelte';
  import { dockviewStore } from './editor/dockview/dockview-store.svelte';
  import ExportDialog from './editor/ExportDialog.svelte';
  import SettingsDialog from './editor/SettingsDialog.svelte';
  import { saveGraph, loadGraphFromFile, triggerFileInput, removeExtension } from '@/utils/fileSystem';
  import { Graph } from '@/nodes/Graph';
  import { Node } from '@/nodes/Node';
  import { GraphEditorAdapter } from './editor/GraphEditorAdapter';
  import { incrementPropUpdateCounter } from './editor/stores/propUpdateStore';
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
  let nodePanelPosition = { x: 0, y: 0 };
  let nodePanelFixedPosition: { x: number; y: number } | null = null; // For dropdown menu positioning
  let activeTool = 'select';
  let mousePosition = { x: 0, y: 0 };
  let globalMousePosition = { x: 0, y: 0 }; // Track mouse position globally
  let exportDialogOpen = false;
  let settingsDialogOpen = false;
  let graph: Graph | undefined = undefined;
  let documentName = 'Untitled';
  let currentFilePath: string | null = null;
  
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
    if (libraryId) {
      nodePanelPosition = { x: 0, y: 64 };
    }
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

  function handleAddNode(e: CustomEvent<{ type: string; libraryId: string | null; categoryId: string | null }>) {
    if (dockviewContainerRef && dockviewContainerRef.addNode) {
      dockviewContainerRef.addNode({ type: e.detail.type, category: e.detail.categoryId });
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
      case 'saveAs':
        handleSaveAs();
        break;
      case 'duplicate':
        handleDuplicate();
        break;
      case 'export':
        exportDialogOpen = true;
        break;
      case 'settings':
        settingsDialogOpen = true;
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

  async function handleNewProject() {
    if (graph && confirm('Create a new project? Unsaved changes will be lost.')) {
      // User confirmed, proceed with new project
    } else if (!graph) {
      // No existing graph, just create new one
    } else {
      // User cancelled
      return;
    }

    // Clear history when creating new project
    clearHistory();

    // Load default graph from file
    try {
      const response = await fetch('/graphs/default.cascade');
      if (!response.ok) {
        throw new Error('Failed to load default graph');
      }
      const json = await response.json();
      
      // Clear existing graph if it exists
      if (graph) {
        graph.nodes.forEach(node => {
          if (node.onDestroy) {
            node.onDestroy();
          }
        });
      }
      
      // Load new graph
      const adapter = GraphEditorAdapter.fromJSON(json);
      graph = adapter.getGraph();
      documentName = 'Untitled';
      currentFilePath = null;
      updateWindowTitle();
      
      // Wait for annotation ports to be initialized (especially image annotations)
      await graph.waitForAnnotationPorts();

      // Execute all nodes to initialize them
      for (const node of graph.nodes) {
        if (node.code) {
          try {
            // Wrap code in async function to support top-level await (same as CodeEditor)
            const wrappedCode = `return (async function(node, graph) {\n${node.code}\n})(node, graph);`;
            const nodeFunction = new Function('node', 'graph', wrappedCode) as (node: any, graph: any) => Promise<any>;
            node.setFunction(nodeFunction);
            await node.execute();
          } catch (err) {
            console.warn('Failed to execute node ' + node.id + ':', err);
          }
        }
      }

      // Restore connections now that ports exist
      graph.restoreConnections();
      // Wait for DOM to update before forcing reactivity
      await tick();
      // Force connections array reference update to trigger reactivity
      graph.connections = [...graph.connections];
      // Force elements array reference to trigger reactivity
      graph.elements = [...graph.elements];
      
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
      updateWindowTitle();
    }
  }

  async function handleOpenProject() {
    try {
      const file = await triggerFileInput('.cascade');
      if (!file) return;

      // Clear history when opening new project
      clearHistory();

      const json = await loadGraphFromFile(file);

      // Clear existing graph if it exists
      if (graph) {
        graph.nodes.forEach(node => {
          if (node.onDestroy) {
            node.onDestroy();
          }
        });
      }
        
        // Load new graph
      const adapter = GraphEditorAdapter.fromJSON(json);
      graph = adapter.getGraph();
        documentName = removeExtension(file.name);
        currentFilePath = file.name;
        updateWindowTitle();
        
        // Wait for annotation ports to be initialized (especially image annotations)
        await graph.waitForAnnotationPorts();
        
        // Execute all nodes to initialize them
        for (const node of graph.nodes) {
          if (node.code) {
            try {
              // Wrap code in async function to support top-level await (same as CodeEditor)
              const wrappedCode = `return (async function(node, graph) {\n${node.code}\n})(node, graph);`;
              const nodeFunction = new Function('node', 'graph', wrappedCode) as (node: any, graph: any) => Promise<any>;
              node.setFunction(nodeFunction);
              await node.execute();
            } catch (err) {
              console.warn('Failed to execute node ' + node.id + ':', err);
            }
          }
        }
        
        // Restore connections now that ports exist
        graph.restoreConnections();
        // Wait for DOM to update before forcing reactivity
        await tick();
        // Force connections array reference update to trigger reactivity
        graph.connections = [...graph.connections];
        // Force elements array reference to trigger reactivity
        graph.elements = [...graph.elements];

        // Center canvas on nodes after loading
        setTimeout(() => {
          if (dockviewContainerRef && dockviewContainerRef.centerOnNodes) {
            dockviewContainerRef.centerOnNodes();
          }
        }, 100);
      } catch (error) {
      alert('Failed to open project: ' + (error as Error).message);
    }
  }

  function handleSave() {
    if (!graph) return;
    
    if (currentFilePath) {
      saveGraph(graph, currentFilePath);
    } else {
      handleSaveAs();
    }
  }

  function handleSaveAs() {
    if (!graph) return;
    
    const filename = documentName + '.cascade';
    saveGraph(graph, filename);
    currentFilePath = filename;
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
    updateWindowTitle();
    
    // Execute all nodes to initialize them
    newGraph.nodes.forEach(node => {
      if (node.code) {
        try {
          const nodeFunction = new Function('node', 'graph', node.code);
          node.setFunction(nodeFunction);
          node.execute();
        } catch (err) {
          console.warn('Failed to execute node ' + node.id + ':', err);
        }
      }
    });
    
    // Center canvas on nodes after duplicating
    setTimeout(() => {
      if (dockviewContainerRef && dockviewContainerRef.centerOnNodes) {
        dockviewContainerRef.centerOnNodes();
      }
    }, 100);
  }

  function updateWindowTitle() {
    if (typeof document !== 'undefined') {
      if (documentName && documentName !== 'Untitled') {
        document.title = `Cascade - ${documentName}`;
      } else {
        document.title = 'Cascade';
      }
    }
  }

  /**
   * Restore graph from a history snapshot (for undo/redo)
   */
  async function restoreFromSnapshot(snapshot: GraphSnapshot) {
    if (!graph) return;

    // Clean up existing nodes
    graph.nodes.forEach(node => {
      if (node.onDestroy) {
        node.onDestroy();
      }
    });

    // Load graph from snapshot JSON
    const adapter = GraphEditorAdapter.fromJSON(snapshot.json);
    graph = adapter.getGraph();

    // Wait for annotation ports to be initialized
    await graph.waitForAnnotationPorts();

    // Execute all nodes to initialize them
    for (const node of graph.nodes) {
      if (node.code) {
        try {
          const wrappedCode = `return (async function(node, graph) {\n${node.code}\n})(node, graph);`;
          const nodeFunction = new Function('node', 'graph', wrappedCode) as (node: any, graph: any) => Promise<any>;
          node.setFunction(nodeFunction);
          await node.execute();
        } catch (err) {
          console.warn('Failed to execute node ' + node.id + ':', err);
        }
      }
    }

    // Restore connections now that ports exist
    graph.restoreConnections();

    // Wait for DOM to update before forcing reactivity
    await tick();

    // Force reactivity
    graph.connections = [...graph.connections];
    graph.elements = [...graph.elements];

    // Restore selection
    selectedNode = snapshot.selectedNodeId ? graph.getNode(snapshot.selectedNodeId) : null;
    selectedAnnotation = snapshot.selectedAnnotationId;
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
  }

  // Update window title when document name changes
  $: if (documentName) {
    updateWindowTitle();
  }

  // Set initial window title
  onMount(async () => {
    // Wire up Node's prop params change callback to editor's store
    Node.onPropParamsChanged = incrementPropUpdateCounter;

    updateWindowTitle();

    // Load default graph on startup
    if (!graph) {
      try {
        const response = await fetch('/graphs/default.cascade');
        if (!response.ok) {
          throw new Error('Failed to load default graph');
        }
        const json = await response.json();
        
        // Load graph from JSON
        const adapter = GraphEditorAdapter.fromJSON(json);
        graph = adapter.getGraph();
        documentName = 'Default Cascade Graph';
        currentFilePath = null;
        updateWindowTitle();
        
        // Wait for annotation ports to be initialized (especially image annotations)
        await graph.waitForAnnotationPorts();
        
        // Execute all nodes to initialize them
        for (const node of graph.nodes) {
          if (node.code) {
            try {
              // Wrap code in async function to support top-level await (same as CodeEditor)
              const wrappedCode = `return (async function(node, graph) {\n${node.code}\n})(node, graph);`;
              const nodeFunction = new Function('node', 'graph', wrappedCode) as (node: any, graph: any) => Promise<any>;
              node.setFunction(nodeFunction);
              await node.execute();
            } catch (err) {
              console.warn('Failed to execute node ' + node.id + ':', err);
            }
          }
        }
        
        // Restore connections now that ports exist
        graph.restoreConnections();
        // Wait for DOM to update before forcing reactivity
        await tick();
        // Force connections array reference update to trigger reactivity
        graph.connections = [...graph.connections];
        // Force elements array reference to trigger reactivity
        graph.elements = [...graph.elements];

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
        updateWindowTitle();
      }
    }

    // Track global mouse position
    function handleMouseMove(e: MouseEvent) {
      globalMousePosition = { x: e.clientX, y: e.clientY };
    }
    window.addEventListener('mousemove', handleMouseMove);
    
    // Keyboard shortcuts
    function handleKeyDown(e: KeyboardEvent) {
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
        exportDialogOpen = true;
      }

      // ⌘, - Settings
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        settingsDialogOpen = true;
      }

      // ⌘N - New project
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        handleNewProject();
      }

      // ⌘O - Open project
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        handleOpenProject();
      }

      // ⌘S - Save project
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
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
        
        // C - Toggle cook
        if (e.key === 'c' || e.key === 'C') {
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            if (e.shiftKey) {
              // Shift+C - Multi-cook (cook this chain)
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
              // Normal C: Always clear other cooking nodes first, then toggle this one
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
        
        // Alt+C - Clear all cooking
        if (e.altKey && (e.key === 'c' || e.key === 'C')) {
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
    };
  });
</script>

<div class="app" class:presentation-mode={presentationMode}>
  {#if !presentationMode}
    <MenuBar
      {documentName}
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
    {documentName}
    {presentationMode}
    onRecordHistory={recordHistory}
    on:nodeSelect={(e) => handleNodeSelect(e.detail.node)}
    on:annotationSelect={(e) => handleAnnotationSelect(e)}
    on:libraryToggle={(e) => handleLibraryToggle(e.detail)}
    on:toolChange={(e) => handleToolChange(e.detail)}
    on:action={(e) => handleMenuAction(e.detail)}
    on:nameChange={(e) => {
      documentName = e.detail;
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
  
  {#if activeLibrary || activeCategory}
    <NodePanel
      libraryId={activeLibrary}
      categoryId={activeCategory}
      position={nodePanelPosition}
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

  {#if graph}
    <ExportDialog
      {graph}
      bind:open={exportDialogOpen}
      on:close={() => exportDialogOpen = false}
    />
  {/if}

  <SettingsDialog
    bind:open={settingsDialogOpen}
    on:close={() => settingsDialogOpen = false}
  />
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

  .app :global(.dockview-container) {
    flex: 1;
    width: 100%;
  }

  .app.presentation-mode :global(.dockview-container) {
    height: 100vh;
  }
</style>

