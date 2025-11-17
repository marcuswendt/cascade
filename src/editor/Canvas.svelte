<script lang="ts">
  import { onMount, tick, createEventDispatcher } from 'svelte';
  import { Graph } from '@/core/Graph';
  import NodeUI from './NodeUI.svelte';
  import CodeEditor from './CodeEditor.svelte';
  import type { Node } from '@/core/Node';
  
  const dispatch = createEventDispatcher();
  
  export let activeTool = 'select';
  export let selectedNode: Node | null = null;
  export let graph = new Graph();
  let canvas: HTMLDivElement;
  let transform = { x: 0, y: 0, zoom: 1 };
  let isPanning = false;
  let selectedNodes: string[] = [];
  let spacePressed = false;
  let isSelecting = false;
  let selectionStart: { x: number; y: number } | null = null;
  
  // Connection state
  let connectingFrom: { nodeId: string; portId: string; portType: 'input' | 'output' } | null = null;
  let connectingPosition: { x: number; y: number } | null = null;
  let mousePosition: { x: number; y: number } = { x: 0, y: 0 };
  
  // Node dragging state
  let draggingNode: { nodeId: string; offset: { x: number; y: number } } | null = null;
  
  // Two-finger panning state
  let touchPanStart: { x: number; y: number; touches: TouchList } | null = null;
  let isWheelPanning = false;
  let pointerPanStart: { x: number; y: number; pointers: Map<number, { x: number; y: number }> } | null = null;
  
  // Code editor state
  let editingNode: Node | null = null;
  
  // Function to initialize default nodes
  export function initializeDefaultNodes() {
    // Clear existing nodes
    graph.nodes.forEach(node => {
      if (node.onDestroy) {
        node.onDestroy();
      }
    });
    graph.nodes = [];
    graph.connections = [];
    
    // Add default nodes
    const timer = graph.addNode('Timer', { x: 100, y: 100 });
    const viewer = graph.addNode('Viewer', { x: 400, y: 100 });
    
    // Initialize timer node
    tick().then(() => {
      timer.code = `
const tick = node.out('tick', 'trigger');
const time = node.out('time');

let frame = 0;
setInterval(() => {
  time.setValue(frame++);
  tick.trigger({ frame });
}, 1000 / 60);
      `;
      
      viewer.code = `
const input = node.in('input', null);
const output = node.out('output');
      `;
      
      try {
        const timerFunction = new Function('node', 'graph', timer.code);
        timer.setFunction(timerFunction);
        timer.execute();
        
        timer.inputs = [...timer.inputs];
        timer.outputs = [...timer.outputs];
      } catch (err) {
        console.error('Failed to initialize timer:', err);
      }
      
      graph.nodes = [...graph.nodes];
      
      // Center canvas on nodes after initialization
      tick().then(() => {
        centerOnNodes();
      });
    });
  }

  // Initialize nodes immediately on first load
  if (graph.nodes.length === 0) {
    initializeDefaultNodes();
  }
  
  // Reactive statement to ensure nodes array changes are detected
  $: nodes = graph.nodes;
  $: connections = graph.connections;
  
  // Force reactivity when node ports change
  $: nodePorts = nodes.map(n => ({ 
    id: n.id, 
    inputs: n.inputs.length, 
    outputs: n.outputs.length 
  }));
  
  function handleMouseDown(e: MouseEvent) {
    // Middle mouse button (button 1) for panning
    if (e.button === 1) {
      isPanning = true;
      e.preventDefault();
    } else if (e.button === 0 && (spacePressed || activeTool === 'hand')) {
      // Left mouse + Space or Hand tool for panning
      isPanning = true;
    } else if (e.button === 0 && activeTool === 'select') {
      // Start selection rectangle
      const rect = canvas.getBoundingClientRect();
      selectionStart = {
        x: (e.clientX - rect.left - transform.x) / transform.zoom,
        y: (e.clientY - rect.top - transform.y) / transform.zoom
      };
      isSelecting = true;
    }
  }
  
  function handleMouseMove(e: MouseEvent) {
    if (isPanning) {
      transform.x += e.movementX;
      transform.y += e.movementY;
      transform = transform;
    }
    
    // Handle node dragging
    if (draggingNode) {
      const node = graph.getNode(draggingNode.nodeId);
      if (node) {
        const rect = canvas.getBoundingClientRect();
        const newX = (e.clientX - rect.left - transform.x) / transform.zoom - draggingNode.offset.x;
        const newY = (e.clientY - rect.top - transform.y) / transform.zoom - draggingNode.offset.y;
        
        node.position = { x: newX, y: newY };
        // Force reactivity
        graph.nodes = [...graph.nodes];
      }
    }
    
    // Update mouse position for connection preview
    if (connectingFrom) {
      const rect = canvas.getBoundingClientRect();
      mousePosition = {
        x: (e.clientX - rect.left - transform.x) / transform.zoom,
        y: (e.clientY - rect.top - transform.y) / transform.zoom
      };
    }
  }
  
  function handleMouseUp(e: MouseEvent) {
    if (e.button === 1) {
      isPanning = false;
      e.preventDefault();
    } else {
      isPanning = false;
    }
    
    // Stop dragging
    draggingNode = null;
    
    // Finish selection
    if (isSelecting) {
      isSelecting = false;
      selectionStart = null;
    }
  }
  
  function handleNodeMouseDown(nodeId: string, e: MouseEvent) {
    // Don't start drag if clicking on a port or if middle mouse button
    if ((e.target as HTMLElement).closest('.port') || e.button === 1) {
      return;
    }
    
    const node = graph.getNode(nodeId);
    if (!node) return;
    
    const rect = canvas.getBoundingClientRect();
    
    // Calculate offset from mouse click position to node's top-left corner
    const mouseX = (e.clientX - rect.left - transform.x) / transform.zoom;
    const mouseY = (e.clientY - rect.top - transform.y) / transform.zoom;
    
    const offset = {
      x: mouseX - node.position.x,
      y: mouseY - node.position.y
    };
    
    draggingNode = { nodeId, offset };
    e.stopPropagation();
  }
  
  function handleNodeEdit(e: CustomEvent<{ node: Node }>) {
    editingNode = e.detail.node;
  }
  
  function handleEditorClose() {
    editingNode = null;
    // Force reactivity update to show any port changes
    graph.nodes = [...graph.nodes];
  }
  
  function handleNodeClick(nodeId: string, detail: { event: MouseEvent }) {
    const e = detail.event;
    if (activeTool === 'select') {
      e.stopPropagation();
      const node = graph.getNode(nodeId);
      if (node) {
        if (e.shiftKey) {
          // Multi-select
          if (selectedNodes.includes(nodeId)) {
            selectedNodes = selectedNodes.filter(id => id !== nodeId);
          } else {
            selectedNodes = [...selectedNodes, nodeId];
          }
        } else {
          // Single select
          selectedNodes = [nodeId];
        }
        selectedNode = node;
        dispatch('nodeSelect', { node });
      }
    }
  }
  
  function handleCanvasClick(e: MouseEvent) {
    if (activeTool === 'select' && !(e.target as HTMLElement).closest('.node')) {
      selectedNodes = [];
      selectedNode = null;
      dispatch('nodeSelect', { node: null });
    }
  }
  
  function handleCanvasDoubleClick(e: MouseEvent) {
    // Don't open panel if double-clicking on a node
    if (!(e.target as HTMLElement).closest('.node')) {
      e.preventDefault();
      // Get mouse position relative to viewport
      dispatch('openNodePanel', { x: e.clientX, y: e.clientY });
    }
  }
  
  export function handleAddNode(detail: { type: string; category: string | null }) {
    const nodeType = detail.type;
    const rect = canvas.getBoundingClientRect();
    
    // Calculate the center of the visible viewport in screen coordinates
    const viewportCenterX = rect.width / 2;
    const viewportCenterY = rect.height / 2;
    
    // Convert screen coordinates to canvas coordinates
    // Account for pan (transform.x, transform.y) and zoom (transform.zoom)
    let centerX = (viewportCenterX - transform.x) / transform.zoom;
    let centerY = (viewportCenterY - transform.y) / transform.zoom;
    
    // Check if there's a node at this position (with tolerance)
    const tolerance = 50; // pixels
    const nodeAtPosition = graph.nodes.find(node => {
      const dx = Math.abs(node.position.x - centerX);
      const dy = Math.abs(node.position.y - centerY);
      return dx < tolerance && dy < tolerance;
    });
    
    // If there's a node at this position, offset the new node to bottom right
    if (nodeAtPosition) {
      centerX += 50; // Offset to the right (1/3 of 150)
      centerY += 33; // Offset downward (1/3 of 100)
    }
    
    const newNode = graph.addNode(nodeType, { x: centerX, y: centerY });
    graph.nodes = [...graph.nodes];
    
    // Pan canvas to center on the new node
    // Convert node position to screen coordinates
    const nodeScreenX = centerX * transform.zoom + transform.x;
    const nodeScreenY = centerY * transform.zoom + transform.y;
    
    // Calculate how much to pan to center the node
    const panX = viewportCenterX - nodeScreenX;
    const panY = viewportCenterY - nodeScreenY;
    
    transform.x += panX;
    transform.y += panY;
    transform = transform; // Trigger reactivity
    
    // Select the new node
    selectedNodes = [newNode.id];
    selectedNode = newNode;
    dispatch('nodeSelect', { node: newNode });
  }
  
  // Update selectedNodes when selectedNode changes externally (but avoid cycles)
  $: if (selectedNode && selectedNode.id && !selectedNodes.includes(selectedNode.id)) {
    selectedNodes = [selectedNode.id];
  }

  // Function to center canvas on all nodes
  export function centerOnNodes() {
    if (!canvas || graph.nodes.length === 0) return;

    // Calculate bounding box of all nodes
    // Approximate node size: 120px width, 80px height (can be adjusted)
    const nodeWidth = 120;
    const nodeHeight = 80;
    
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    graph.nodes.forEach(node => {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + nodeWidth);
      maxY = Math.max(maxY, node.position.y + nodeHeight);
    });

    // Calculate center of bounding box
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // Get viewport dimensions
    const rect = canvas.getBoundingClientRect();
    const viewportWidth = rect.width;
    const viewportHeight = rect.height;

    // Calculate bounding box dimensions
    const bboxWidth = maxX - minX;
    const bboxHeight = maxY - minY;

    // Add padding (20% on each side)
    const padding = 0.2;
    const paddedWidth = bboxWidth * (1 + padding * 2);
    const paddedHeight = bboxHeight * (1 + padding * 2);

    // Calculate zoom to fit all nodes with padding
    const zoomX = viewportWidth / paddedWidth;
    const zoomY = viewportHeight / paddedHeight;
    const newZoom = Math.min(zoomX, zoomY, 1); // Don't zoom in more than 1x

    // Set zoom
    transform.zoom = newZoom;

    // Calculate pan to center the nodes
    // Center of viewport in canvas coordinates
    const viewportCenterX = viewportWidth / 2;
    const viewportCenterY = viewportHeight / 2;

    // Position of node center in screen coordinates at current zoom
    const nodeCenterScreenX = centerX * newZoom;
    const nodeCenterScreenY = centerY * newZoom;

    // Calculate pan to center
    transform.x = viewportCenterX - nodeCenterScreenX;
    transform.y = viewportCenterY - nodeCenterScreenY;

    // Trigger reactivity
    transform = transform;
  }
  
  function handleContextMenu(e: MouseEvent) {
    // Prevent context menu on middle mouse button
    if (e.button === 1) {
      e.preventDefault();
    }
  }
  
  function getPortElement(nodeId: string, portId: string): HTMLElement | null {
    return canvas.querySelector(`[data-node-id="${nodeId}"][data-port-id="${portId}"]`) as HTMLElement;
  }
  
  function getPortPosition(nodeId: string, portId: string, portType: 'input' | 'output'): { x: number; y: number } | null {
    const portElement = getPortElement(nodeId, portId);
    if (!portElement) {
      // Fallback to approximate position
      const node = graph.getNode(nodeId);
      if (!node) return null;
      
      const portIndex = portType === 'output'
        ? node.outputs.findIndex(p => p.id === portId)
        : node.inputs.findIndex(p => p.id === portId);
      
      if (portIndex === -1) return null;
      
      // Vertical layout: compact nodes (60x20px)
      // Input ports at top, output ports at bottom
      // Ports are arranged horizontally with 4px gap
      const portSpacing = 16; // 12px port + 4px gap
      const portOffset = portIndex * portSpacing;
      const portDotSize = 8;
      const nodeWidth = 60;
      const nodeHeight = 20;
      const portRowHeight = 12;
      
      // Node structure: port row (12px) -> body (20px) -> port row (12px) -> label
      // Input ports are in the top port row
      // Output ports are in the bottom port row
      const centerX = node.position.x + nodeWidth / 2;
      const inputY = node.position.y + portRowHeight / 2;
      const outputY = node.position.y + portRowHeight + nodeHeight + portRowHeight / 2;
      
      return {
        x: centerX - (portType === 'input' ? nodeWidth / 2 : -nodeWidth / 2) + portOffset - (portType === 'input' ? (node.inputs.length - 1) * portSpacing / 2 : (node.outputs.length - 1) * portSpacing / 2),
        y: portType === 'input' ? inputY : outputY
      };
    }
    
    const rect = portElement.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    
    // Get the center of the port dot
    // For vertical layout: input dots at top, output dots at bottom
    const dotElement = portElement.querySelector('.port-dot');
    
    if (dotElement) {
      const dotRect = dotElement.getBoundingClientRect();
      return {
        x: (dotRect.left + dotRect.width / 2 - canvasRect.left - transform.x) / transform.zoom,
        y: (dotRect.top + dotRect.height / 2 - canvasRect.top - transform.y) / transform.zoom
      };
    }
    
    // Fallback if dot element not found - use port element center
    return {
      x: (rect.left + rect.width / 2 - canvasRect.left - transform.x) / transform.zoom,
      y: (rect.top + rect.height / 2 - canvasRect.top - transform.y) / transform.zoom
    };
  }
  
  function handlePortClick(nodeId: string, portId: string, portType: 'input' | 'output', e: MouseEvent) {
    e.stopPropagation();
    
    const node = graph.getNode(nodeId);
    if (!node) return;
    
    const port = portType === 'output' 
      ? node.outputs.find(p => p.id === portId)
      : node.inputs.find(p => p.id === portId);
    
    if (!port) return;
    
    if (connectingFrom) {
      // Complete connection
      const from = connectingFrom;
      if (from.nodeId !== nodeId && from.portType !== portType) {
        const fromNode = graph.getNode(from.nodeId);
        const fromPort = from.portType === 'output'
          ? fromNode?.outputs.find(p => p.id === from.portId)
          : fromNode?.inputs.find(p => p.id === from.portId);
        
        if (fromPort && port) {
          // Only allow output -> input connections
          if (from.portType === 'output' && portType === 'input') {
            graph.connect(fromPort, port);
            graph.connections = [...graph.connections];
          }
        }
      }
      
      connectingFrom = null;
      connectingPosition = null;
    } else {
      // Start connection (only from output ports)
      if (portType === 'output') {
        const pos = getPortPosition(nodeId, portId, portType);
        if (pos) {
          connectingFrom = { nodeId, portId, portType };
          connectingPosition = pos;
          const rect = canvas.getBoundingClientRect();
          mousePosition = {
            x: (e.clientX - rect.left - transform.x) / transform.zoom,
            y: (e.clientY - rect.top - transform.y) / transform.zoom
          };
        }
      }
    }
  }
  
  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    
    // On macOS trackpads, two-finger panning comes as wheel events with deltaX/deltaY
    // If there's significant horizontal or vertical movement without modifier keys, it's panning
    const hasHorizontalPan = Math.abs(e.deltaX) > 1;
    const hasVerticalPan = Math.abs(e.deltaY) > 1;
    const isZoomGesture = e.ctrlKey || e.metaKey;
    
    if ((hasHorizontalPan || hasVerticalPan) && !isZoomGesture) {
      // Two-finger panning gesture
      isWheelPanning = true;
      transform.x -= e.deltaX;
      transform.y -= e.deltaY;
      transform = transform;
    } else if (isZoomGesture || (!hasHorizontalPan && !hasVerticalPan)) {
      // Zoom with wheel (pinch or scroll wheel)
      // Increased sensitivity: 5x faster (was -0.001, now -0.005)
      isWheelPanning = false;
      const delta = e.deltaY * -0.005;
      transform.zoom = Math.max(0.1, Math.min(2, transform.zoom + delta));
      transform = transform;
    }
  }
  
  function handleTouchStart(e: TouchEvent) {
    // Two-finger panning
    if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const centerX = (touch1.clientX + touch2.clientX) / 2;
      const centerY = (touch1.clientY + touch2.clientY) / 2;
      
      touchPanStart = {
        x: centerX,
        y: centerY,
        touches: e.touches
      };
      e.preventDefault();
    }
  }
  
  function handleTouchMove(e: TouchEvent) {
    if (e.touches.length === 2 && touchPanStart) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const centerX = (touch1.clientX + touch2.clientX) / 2;
      const centerY = (touch1.clientY + touch2.clientY) / 2;
      
      // Calculate pan delta
      const deltaX = centerX - touchPanStart.x;
      const deltaY = centerY - touchPanStart.y;
      
      transform.x += deltaX;
      transform.y += deltaY;
      transform = transform;
      
      // Update start position for next move
      touchPanStart.x = centerX;
      touchPanStart.y = centerY;
      
      e.preventDefault();
    }
  }
  
  function handleTouchEnd(e: TouchEvent) {
    if (e.touches.length < 2) {
      touchPanStart = null;
    }
  }
  
  function handlePointerDown(e: PointerEvent) {
    // Track multiple pointers for two-finger gestures
    if (!pointerPanStart) {
      pointerPanStart = {
        x: e.clientX,
        y: e.clientY,
        pointers: new Map()
      };
    }
    
    pointerPanStart.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    
    // If we have 2 pointers, start panning
    if (pointerPanStart.pointers.size === 2) {
      const pointers = Array.from(pointerPanStart.pointers.values());
      pointerPanStart.x = (pointers[0].x + pointers[1].x) / 2;
      pointerPanStart.y = (pointers[0].y + pointers[1].y) / 2;
      e.preventDefault();
    }
  }
  
  function handlePointerMove(e: PointerEvent) {
    if (pointerPanStart && pointerPanStart.pointers.has(e.pointerId)) {
      // Update pointer position
      pointerPanStart.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      
      // If we have 2 pointers, calculate pan
      if (pointerPanStart.pointers.size === 2) {
        const pointers = Array.from(pointerPanStart.pointers.values());
        const centerX = (pointers[0].x + pointers[1].x) / 2;
        const centerY = (pointers[0].y + pointers[1].y) / 2;
        
        const deltaX = centerX - pointerPanStart.x;
        const deltaY = centerY - pointerPanStart.y;
        
        transform.x += deltaX;
        transform.y += deltaY;
        transform = transform;
        
        pointerPanStart.x = centerX;
        pointerPanStart.y = centerY;
        e.preventDefault();
      }
    }
  }
  
  function handlePointerUp(e: PointerEvent) {
    if (pointerPanStart) {
      pointerPanStart.pointers.delete(e.pointerId);
      if (pointerPanStart.pointers.size === 0) {
        pointerPanStart = null;
      }
    }
  }
  
  function handleKeyDown(e: KeyboardEvent) {
    if (e.code === 'Space') {
      spacePressed = true;
      e.preventDefault();
    }
    
    // Canvas keyboard shortcuts
    // ⌘+ / ⌘- - Zoom in/out
    if ((e.metaKey || e.ctrlKey) && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      transform.zoom = Math.min(2, transform.zoom + 0.1);
      transform = transform;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '-') {
      e.preventDefault();
      transform.zoom = Math.max(0.1, transform.zoom - 0.1);
      transform = transform;
    }
    
    // ⌘0 - Reset zoom to 100%
    if ((e.metaKey || e.ctrlKey) && e.key === '0') {
      e.preventDefault();
      transform.zoom = 1;
      transform = transform;
    }
    
    // Delete / Backspace - Delete selected nodes
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodes.length > 0) {
      e.preventDefault();
      selectedNodes.forEach(nodeId => {
        graph.removeNode(nodeId);
      });
      selectedNodes = [];
      selectedNode = null;
      graph.nodes = [...graph.nodes];
      dispatch('nodeSelect', { node: null });
    }
    
    // ⌘D - Duplicate selected nodes
    if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
      e.preventDefault();
      if (selectedNodes.length > 0) {
        const nodesToDuplicate = selectedNodes.map(id => graph.getNode(id)).filter(Boolean) as Node[];
        const newNodes: Node[] = [];
        
        nodesToDuplicate.forEach(node => {
          const newNode = graph.addNode(node.type, {
            x: node.position.x + 50,
            y: node.position.y + 50
          });
          newNode.code = node.code;
          newNode.name = node.name;
          newNode.comment = node.comment;
          newNodes.push(newNode);
        });
        
        graph.nodes = [...graph.nodes];
        if (newNodes.length > 0) {
          selectedNodes = newNodes.map(n => n.id);
          selectedNode = newNodes[0];
          dispatch('nodeSelect', { node: newNodes[0] });
        }
      }
    }
  }
  
  function handleKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') {
      spacePressed = false;
    }
  }
  
  onMount(() => {
    // If nodes are already initialized, just ensure reactivity
    if (graph.nodes.length > 0) {
      graph.nodes = [...graph.nodes];
    }
    // Otherwise, initializeDefaultNodes() will be called automatically
    
    // Add keyboard listeners
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  });
</script>

<div 
  class="canvas"
  role="application"
  aria-label="Graph canvas"
  tabindex="0"
  class:select-tool={activeTool === 'select'}
  class:hand-tool={activeTool === 'hand'}
  bind:this={canvas}
  on:mousedown={handleMouseDown}
  on:mousemove={handleMouseMove}
  on:mouseup={handleMouseUp}
  on:click={handleCanvasClick}
  on:dblclick={handleCanvasDoubleClick}
  on:wheel={handleWheel}
  on:contextmenu={handleContextMenu}
  on:touchstart={handleTouchStart}
  on:touchmove={handleTouchMove}
  on:touchend={handleTouchEnd}
  on:touchcancel={handleTouchEnd}
  on:pointerdown={handlePointerDown}
  on:pointermove={handlePointerMove}
  on:pointerup={handlePointerUp}
  on:pointercancel={handlePointerUp}
>
  <!-- Background grid -->
  <svg class="grid">
    <defs>
      <pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse">
        <circle cx="10" cy="10" r="0.5" fill="#2a2a2a" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="#0a0a0a" />
    <rect width="100%" height="100%" fill="url(#dots)" />
  </svg>
  
  <!-- Connections layer -->
  <svg 
    class="connections-layer"
    style="transform: translate({transform.x}px, {transform.y}px) scale({transform.zoom})"
  >
    <!-- Existing connections -->
    {#each connections as conn (conn.id)}
      {@const fromPos = getPortPosition(conn.from.nodeId, conn.from.portId, 'output')}
      {@const toPos = getPortPosition(conn.to.nodeId, conn.to.portId, 'input')}
      {#if fromPos && toPos}
        {@const midY = (fromPos.y + toPos.y) / 2}
        {@const curveOffset = Math.abs(toPos.y - fromPos.y) * 0.5}
        {@const isTrigger = conn.type === 'trigger'}
        <path
          d="M {fromPos.x} {fromPos.y} C {fromPos.x} {fromPos.y + curveOffset} {toPos.x} {toPos.y - curveOffset} {toPos.x} {toPos.y}"
          fill="none"
          stroke="#888"
          stroke-width="2"
          stroke-dasharray={isTrigger ? "3 3" : "none"}
          class="connection"
          class:trigger-connection={isTrigger}
        />
      {/if}
    {/each}
    
    <!-- Connection preview (while dragging) -->
    {#if connectingFrom && connectingPosition}
      {@const curveOffset = Math.abs(mousePosition.y - connectingPosition.y) * 0.5}
      {@const isTrigger = connectingFrom.portType === 'output' && (() => {
        const fromNode = graph.getNode(connectingFrom.nodeId);
        if (!fromNode) return false;
        const port = fromNode.outputs.find(p => p.id === connectingFrom.portId);
        return port?.portType === 'trigger';
      })()}
      <path
        d="M {connectingPosition.x} {connectingPosition.y} C {connectingPosition.x} {connectingPosition.y + curveOffset} {mousePosition.x} {mousePosition.y - curveOffset} {mousePosition.x} {mousePosition.y}"
        fill="none"
        stroke="#888"
        stroke-width="2"
        stroke-dasharray={isTrigger ? "3 3" : "4 4"}
        class="connection-preview"
      />
    {/if}
  </svg>
  
  <!-- Nodes -->
  <div 
    class="nodes-container"
    style="transform: translate({transform.x}px, {transform.y}px) scale({transform.zoom})"
  >
    {#each nodes as node (node.id)}
      <NodeUI 
        {node}
        selected={selectedNodes.includes(node.id)}
        on:portClick={(e) => handlePortClick(e.detail.nodeId, e.detail.portId, e.detail.portType, e.detail.event)}
        on:nodeMouseDown={(e) => handleNodeMouseDown(e.detail.nodeId, e.detail.event)}
        on:click={(e) => handleNodeClick(node.id, e.detail)}
        on:edit={handleNodeEdit}
      />
    {/each}
  </div>
  
  <!-- Code Editor Modal -->
  {#if editingNode}
    <CodeEditor 
      node={editingNode}
      packageManager={graph.packageManager}
      onClose={handleEditorClose}
    />
  {/if}
</div>

<style>
  .canvas {
    position: relative;
    width: 100%;
    height: 100vh;
    overflow: hidden;
    background: #0a0a0a;
    cursor: default;
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
  }
  
  .canvas.select-tool {
    cursor: default;
  }
  
  .canvas.hand-tool {
    cursor: grab;
  }
  
  .canvas.hand-tool:active {
    cursor: grabbing;
  }
  
  .grid {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  
  .connections-layer {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    transform-origin: top left;
  }
  
  .connection {
    pointer-events: stroke;
    cursor: pointer;
  }
  
  .connection.trigger-connection {
    stroke-dasharray: 3 3;
  }
  
  .connection-preview {
    pointer-events: none;
    opacity: 0.7;
  }
  
  .nodes-container {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
  }
</style>

