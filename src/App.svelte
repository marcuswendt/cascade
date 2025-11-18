<script lang="ts">
  import { onMount } from 'svelte';
  import WindowManager from './editor/WindowManager.svelte';
  import NodePanel from './editor/NodePanel.svelte';
  import ExportDialog from './editor/ExportDialog.svelte';
  import DocumentPanel from './editor/DocumentPanel.svelte';
  import { saveGraph, loadGraphFromFile, triggerFileInput, removeExtension } from '@/utils/fileSystem';
  import { Graph } from '@/core/engine/Graph';
  import type { Node } from '@/core/engine/Node';
  import { GraphEditorAdapter } from './editor/GraphEditorAdapter';
  
  let presentationMode = false;
  let showDocumentPanel = true;
  let activeLibrary: string | null = null;
  let activeCategory: string | null = null;
  let selectedNode: Node | null = null;
  let selectedAnnotation: string | null = null;
  let inspectorWasVisible = false;
  
  $: inspectorIsVisible = selectedNode !== null || selectedAnnotation !== null;
  $: shouldSkipAnimation = inspectorWasVisible && inspectorIsVisible;
  $: inspectorWasVisible = inspectorIsVisible;
  let nodePanelPosition = { x: 0, y: 0 };
  let activeTool = 'select';
  let mousePosition = { x: 0, y: 0 };
  let globalMousePosition = { x: 0, y: 0 }; // Track mouse position globally
  let exportDialogOpen = false;
  let graph: Graph | undefined = undefined;
  let documentName = 'Untitled';
  let currentFilePath: string | null = null;
  
  function togglePresentationMode() {
    presentationMode = !presentationMode;
    showDocumentPanel = !presentationMode; // Hide document panel in presentation mode
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
  let windowManagerRef: any = null;
  
  function handleAddNode(e: CustomEvent<{ type: string; libraryId: string | null; categoryId: string | null }>) {
    if (windowManagerRef && windowManagerRef.addNode) {
      windowManagerRef.addNode({ type: e.detail.type, category: e.detail.categoryId });
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

  function handleDocumentAction(action: string) {
    switch (action) {
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
      case 'about':
        // TODO: Show about dialog
        alert('Cascade - Visual Programming Framework\nVersion 1.0.0');
        break;
    }
  }

  function handleNewProject() {
    if (graph && confirm('Create a new project? Unsaved changes will be lost.')) {
      // User confirmed, proceed with new project
    } else if (!graph) {
      // No existing graph, just create new one
    } else {
      // User cancelled
      return;
    }
    
    const adapter = GraphEditorAdapter.create();
    graph = adapter.getGraph();
        documentName = 'Untitled';
        currentFilePath = null;
        updateWindowTitle();
        // Re-initialize with default nodes
        if (windowManagerRef && windowManagerRef.initializeDefaultNodes) {
          windowManagerRef.initializeDefaultNodes();
          // Center canvas on nodes after a short delay to ensure nodes are rendered
          setTimeout(() => {
            if (windowManagerRef && windowManagerRef.centerOnNodes) {
              windowManagerRef.centerOnNodes();
            }
          }, 100);
    }
  }

  async function handleOpenProject() {
    try {
      const file = await triggerFileInput('.cascade');
      if (!file) return;

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
        
        // Center canvas on nodes after loading
        setTimeout(() => {
          if (windowManagerRef && windowManagerRef.centerOnNodes) {
            windowManagerRef.centerOnNodes();
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
      if (windowManagerRef && windowManagerRef.centerOnNodes) {
        windowManagerRef.centerOnNodes();
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

  // Update window title when document name changes
  $: if (documentName) {
    updateWindowTitle();
  }

  // Set initial window title
  onMount(() => {
    updateWindowTitle();
    
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
          if (windowManagerRef && windowManagerRef.centerOnNodes) {
            windowManagerRef.centerOnNodes();
          }
        }
        
        // Annotation shortcuts
        if (e.key === 't' || e.key === 'T') {
          if (!e.metaKey && !e.ctrlKey) {
            activeTool = 'text';
          }
        }
        if (e.key === 'i' || e.key === 'I') {
          if (!e.metaKey && !e.ctrlKey) {
            activeTool = 'image';
          }
        }
        if (e.key === 'g' || e.key === 'G') {
          if (!e.metaKey && !e.ctrlKey) {
            activeTool = 'group';
          }
        }
        if (e.key === 'l' || e.key === 'L') {
          if (!e.metaKey && !e.ctrlKey) {
            activeTool = 'line';
          }
        }
        if (e.key === 'p' || e.key === 'P') {
          if (!e.metaKey && !e.ctrlKey) {
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
          } else {
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
      }
      
      // Additional keyboard shortcuts
      // ⌘B - Toggle bottom toolbar visibility (via presentation mode)
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        // Toggle presentation mode which hides toolbar
        togglePresentationMode();
      }
      
      // ⌘/ - Toggle node panel (same as Tab)
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          if (activeLibrary || activeCategory) {
            activeLibrary = null;
            activeCategory = null;
          } else {
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
            selectedNode.setBypassed(!selectedNode.bypassed);
          }
        }
        
        // C - Toggle cook
        if (e.key === 'c' || e.key === 'C') {
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            if (e.shiftKey) {
              // Shift+C - Multi-cook (cook this chain)
              graph.multiCookMode = true;
              selectedNode.setCooking(true);
              // Cook all downstream nodes
              const cookDownstream = (node: Node) => {
                node.outputs.forEach(output => {
                  output.connections.forEach(conn => {
                    const downstreamNode = graph?.getNode(conn.to.nodeId);
                    if (downstreamNode) {
                      downstreamNode.setCooking(true);
                      cookDownstream(downstreamNode);
                    }
                  });
                });
              };
              cookDownstream(selectedNode);
            } else {
              // Normal C: Always clear other cooking nodes first, then toggle this one
              if (selectedNode.cooking) {
                // If already cooking, turn it off
                selectedNode.setCooking(false);
                graph.multiCookMode = false;
              } else {
                // Clear all other cooking nodes, then set this one to cooking
                graph.clearCookingNodes();
                selectedNode.setCooking(true);
                graph.multiCookMode = false;
              }
            }
          }
        }
        
        // Alt+B - Clear all bypasses
        if (e.altKey && (e.key === 'b' || e.key === 'B')) {
          e.preventDefault();
          graph.nodes.forEach(node => {
            if (node.bypassed) {
              node.setBypassed(false);
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
          graph.removeNode(selectedNode.id);
          selectedNode = null;
        }
      }
      
      // Alt+H - Home (reset view)
      if (e.altKey && (e.key === 'h' || e.key === 'H')) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          if (windowManagerRef && windowManagerRef.centerOnNodes) {
            windowManagerRef.centerOnNodes();
          }
        }
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
  {#if showDocumentPanel}
    <DocumentPanel
      {graph}
      bind:documentName={documentName}
      on:action={(e) => handleDocumentAction(e.detail)}
      on:nameChange={(e) => {
        documentName = e.detail;
        updateWindowTitle();
      }}
    />
  {/if}

  <WindowManager
    bind:this={windowManagerRef}
    {graph}
    {selectedNode}
    {selectedAnnotation}
    {activeTool}
    bind:activeLibrary={activeLibrary}
    {presentationMode}
    on:nodeSelect={(e) => handleNodeSelect(e.detail.node)}
    on:annotationSelect={(e) => handleAnnotationSelect(e)}
    on:libraryToggle={(e) => handleLibraryToggle(e.detail)}
    on:toolChange={(e) => handleToolChange(e.detail)}
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
      on:addNode={handleAddNode}
      on:selectCategory={handleCategorySelect}
      on:selectLibrary={handleLibrarySelect}
      on:close={() => {
        activeLibrary = null;
        activeCategory = null;
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
  
  
  .app.presentation-mode :global(.window-manager) {
    width: 100%;
    height: 100vh;
  }
</style>

