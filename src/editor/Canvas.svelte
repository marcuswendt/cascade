<script lang="ts">
  import { onMount, tick, createEventDispatcher } from 'svelte';
  import { Graph } from '@/core/Graph';
  import NodeUI from './NodeUI.svelte';
  import type { Node } from '@/core/Node';
  import { marked } from 'marked';
  
  // Configure marked for safe rendering
  marked.setOptions({
    breaks: true,
    gfm: true
  });
  
  const dispatch = createEventDispatcher();
  
  export let activeTool = 'select';
  export let selectedNode: Node | null = null;
  export let graph = new Graph();
  export let selectedAnnotation: string | null = null;
  let canvas: HTMLDivElement;
  let transform = { x: 0, y: 0, zoom: 1 };
  let isPanning = false;
  let selectedNodes: string[] = [];
  let spacePressed = false;
  let isSelecting = false;
  let selectionStart: { x: number; y: number } | null = null;
  let selectionStartScreen: { x: number; y: number } | null = null;
  let selectionScreenPos: { x: number; y: number } | null = null;
  
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
  
  // Code editor state - removed, now handled by WindowManager tabs
  
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
    graph.annotations = [];
    
    // Add default nodes
    const timer = graph.addNode('Timer', { x: 100, y: 100 });
    const viewer = graph.addNode('Viewer', { x: 400, y: 100 });
    viewer.setCooking(true); // Enable cooking on Viewer node
    
    // Add default annotations
    const headlineAnnotation: any = {
      id: `ann_headline_${Date.now()}`,
      type: 'text',
      content: 'Hello World',
      position: { x: 50, y: 50 },
      size: { width: 540, height: 60 },
      style: {
        fontSize: 32,
        fontWeight: '700',
        fontStyle: 'normal',
        textAlign: 'left',
        color: '#ffffff',
        padding: 0,
        borderRadius: 0
      }
    };
    
    const copyAnnotation: any = {
      id: `ann_copy_${Date.now()}`,
      type: 'text',
      content: 'Cascade is a visual programming framework designed for creative coders who want to build interactive experiences without sacrificing the power of code. Every node is just a TypeScript function, fully inspectable and editable. The visual graph and code are equal partners, not abstractions of each other. This allows you to work visually when it makes sense, and dive into code when you need precision and control.',
      position: { x: 50, y: 150 },
      size: { width: 540, height: 200 },
      style: {
        fontSize: 14,
        fontWeight: 'normal',
        fontStyle: 'normal',
        textAlign: 'left',
        color: '#ffffff',
        padding: 0,
        borderRadius: 0
      }
    };
    
    // Create a simple placeholder image using a data URL (1x1 transparent PNG, then we'll make it visible)
    // For a real default, we could use a canvas-generated image or a simple SVG
    const placeholderImage = 'data:image/svg+xml;base64,' + btoa(`
      <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
        <rect width="400" height="300" fill="#1a1a1a" stroke="#4a9eff" stroke-width="2"/>
        <text x="200" y="150" font-family="Arial" font-size="24" fill="#4a9eff" text-anchor="middle">Placeholder Image</text>
        <text x="200" y="180" font-family="Arial" font-size="14" fill="#888" text-anchor="middle">Drag an image here</text>
      </svg>
    `);
    
    const imageAnnotation: any = {
      id: `ann_image_${Date.now()}`,
      type: 'image',
      src: placeholderImage,
      position: { x: 650, y: 50 },
      size: { width: 400, height: 300 },
      caption: 'Default Image'
    };
    
    graph.addAnnotation(headlineAnnotation);
    graph.addAnnotation(copyAnnotation);
    graph.addAnnotation(imageAnnotation);
    graph.annotations = [...graph.annotations];
    
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
  $: annotations = graph.annotations;
  
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
    } else if (e.button === 0 && activeTool === 'select' && !draggingNode) {
      // Only start selection if clicking on empty canvas (not on nodes or annotations)
      if (!(e.target as HTMLElement).closest('.node, .annotation')) {
        const rect = canvas.getBoundingClientRect();
        selectionStart = {
          x: (e.clientX - rect.left - transform.x) / transform.zoom,
          y: (e.clientY - rect.top - transform.y) / transform.zoom
        };
        selectionStartScreen = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        };
        mousePosition = { ...selectionStart };
        selectionScreenPos = { ...selectionStartScreen };
        isSelecting = true;
        // Clear current selection when starting new selection
        if (!e.shiftKey) {
          selectedNodes = [];
          selectedNode = null;
          dispatch('nodeSelect', { node: null });
        }
      }
    } else if (e.button === 0 && activeTool === 'line') {
      // Don't start line if clicking on existing annotation or node
      if ((e.target as HTMLElement).closest('.annotation, .node')) {
        return;
      }
      // Start drawing a line
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - transform.x) / transform.zoom;
      const y = (e.clientY - rect.top - transform.y) / transform.zoom;
      
      const id = `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const annotation: any = {
        id,
        type: 'line',
        position: { x, y },
        endPosition: { x, y },
        style: {
          strokeWidth: 2,
          strokeColor: '#ffffff'
        }
      };
      graph.addAnnotation(annotation);
      graph.annotations = [...graph.annotations];
      drawingLine = { annotationId: id, startPos: { x, y } };
      e.stopPropagation();
    } else if (e.button === 0 && activeTool === 'polyline') {
      // Don't start polyline if clicking on existing annotation or node
      if ((e.target as HTMLElement).closest('.annotation, .node')) {
        return;
      }
      // Start drawing a polyline
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - transform.x) / transform.zoom;
      const y = (e.clientY - rect.top - transform.y) / transform.zoom;
      
      const id = `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const annotation: any = {
        id,
        type: 'polyline',
        position: { x, y },
        points: [{ x, y }],
        style: {
          strokeWidth: 2,
          strokeColor: '#ffffff'
        }
      };
      graph.addAnnotation(annotation);
      graph.annotations = [...graph.annotations];
      drawingPolyline = { annotationId: id, points: [{ x, y }] };
      e.stopPropagation();
    }
  }
  
  function handleMouseMove(e: MouseEvent) {
    if (isPanning) {
      transform.x += e.movementX;
      transform.y += e.movementY;
      transform = transform;
    }
    
    // Update selection rectangle
    if (isSelecting && selectionStart) {
      const rect = canvas.getBoundingClientRect();
      // Store both canvas coordinates (for selection logic) and screen coordinates (for rendering)
      const currentX = (e.clientX - rect.left - transform.x) / transform.zoom;
      const currentY = (e.clientY - rect.top - transform.y) / transform.zoom;
      mousePosition = { x: currentX, y: currentY };
      // Also store screen coordinates for the selection rectangle rendering
      selectionScreenPos = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
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
    
    // Handle annotation dragging
    if (draggingAnnotation && !resizingAnnotation) {
      const annotation = graph.getAnnotation(draggingAnnotation.annotationId);
      if (annotation) {
        const rect = canvas.getBoundingClientRect();
        const newX = (e.clientX - rect.left - transform.x) / transform.zoom - draggingAnnotation.offset.x;
        const newY = (e.clientY - rect.top - transform.y) / transform.zoom - draggingAnnotation.offset.y;
        
        annotation.position = { x: newX, y: newY };
        graph.annotations = [...graph.annotations];
      }
    }
    
    // Handle annotation resizing
    if (resizingAnnotation) {
      const annotation = graph.getAnnotation(resizingAnnotation.annotationId);
      if (annotation) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - transform.x) / transform.zoom;
        const mouseY = (e.clientY - rect.top - transform.y) / transform.zoom;
        
        const deltaX = mouseX - resizingAnnotation.startPos.x;
        const deltaY = mouseY - resizingAnnotation.startPos.y;
        
        let newWidth = resizingAnnotation.startSize.width;
        let newHeight = resizingAnnotation.startSize.height;
        let newX = resizingAnnotation.startPosition.x;
        let newY = resizingAnnotation.startPosition.y;
        
        const handle = resizingAnnotation.handle;
        
        // Handle horizontal resizing
        if (handle.includes('e')) {
          newWidth = Math.max(100, resizingAnnotation.startSize.width + deltaX);
        } else if (handle.includes('w')) {
          newWidth = Math.max(100, resizingAnnotation.startSize.width - deltaX);
          newX = resizingAnnotation.startPosition.x + (resizingAnnotation.startSize.width - newWidth);
        }
        
        // Handle vertical resizing
        if (handle.includes('s')) {
          newHeight = Math.max(40, resizingAnnotation.startSize.height + deltaY);
        } else if (handle.includes('n')) {
          newHeight = Math.max(40, resizingAnnotation.startSize.height - deltaY);
          newY = resizingAnnotation.startPosition.y + (resizingAnnotation.startSize.height - newHeight);
        }
        
        annotation.size = { width: newWidth, height: newHeight };
        annotation.position = { x: newX, y: newY };
        
        graph.annotations = [...graph.annotations];
      }
    }
    
    // Handle line drawing
    if (drawingLine) {
      const annotation = graph.getAnnotation(drawingLine.annotationId);
      if (annotation) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - transform.x) / transform.zoom;
        const mouseY = (e.clientY - rect.top - transform.y) / transform.zoom;
        
        annotation.endPosition = { x: mouseX, y: mouseY };
        graph.annotations = [...graph.annotations];
      }
    }
    
    // Handle polyline drawing
    if (drawingPolyline) {
      const annotation = graph.getAnnotation(drawingPolyline.annotationId);
      if (annotation) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - transform.x) / transform.zoom;
        const mouseY = (e.clientY - rect.top - transform.y) / transform.zoom;
        
        // Add point if mouse moved significantly (smoothing)
        const lastPoint = drawingPolyline.points[drawingPolyline.points.length - 1];
        const distance = Math.sqrt(
          Math.pow(mouseX - lastPoint.x, 2) + Math.pow(mouseY - lastPoint.y, 2)
        );
        
        if (distance > 3) { // Only add point if moved more than 3px
          drawingPolyline.points.push({ x: mouseX, y: mouseY });
          annotation.points = [...drawingPolyline.points];
          graph.annotations = [...graph.annotations];
        }
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
    draggingAnnotation = null;
    resizingAnnotation = null;
    
    // Finish line drawing
    if (drawingLine) {
      drawingLine = null;
      // Reset to select tool after finishing line
      activeTool = 'select';
      dispatch('toolChange', 'select');
    }
    
    // Finish polyline drawing
    if (drawingPolyline) {
      drawingPolyline = null;
      // Reset to select tool after finishing polyline
      activeTool = 'select';
      dispatch('toolChange', 'select');
    }
    
    // Finish selection
    if (isSelecting && selectionStart) {
      const rect = canvas.getBoundingClientRect();
      const endX = (e.clientX - rect.left - transform.x) / transform.zoom;
      const endY = (e.clientY - rect.top - transform.y) / transform.zoom;
      
      // Calculate selection rectangle bounds
      const minX = Math.min(selectionStart.x, endX);
      const maxX = Math.max(selectionStart.x, endX);
      const minY = Math.min(selectionStart.y, endY);
      const maxY = Math.max(selectionStart.y, endY);
      
      // Find all nodes that intersect with the selection rectangle
      const nodesInSelection: string[] = [];
      graph.nodes.forEach(node => {
        // Node bounds (approximate - nodes are about 80px wide, 60px tall including label)
        const nodeLeft = node.position.x;
        const nodeRight = node.position.x + 80;
        const nodeTop = node.position.y;
        const nodeBottom = node.position.y + 60;
        
        // Check if node intersects with selection rectangle
        if (nodeRight >= minX && nodeLeft <= maxX && nodeBottom >= minY && nodeTop <= maxY) {
          nodesInSelection.push(node.id);
        }
      });
      
      // Update selection
      if (e.shiftKey) {
        // Add to existing selection
        nodesInSelection.forEach(nodeId => {
          if (!selectedNodes.includes(nodeId)) {
            selectedNodes.push(nodeId);
          }
        });
      } else {
        // Replace selection
        selectedNodes = nodesInSelection;
      }
      
      // Update selectedNode to the first selected node (or null)
      if (selectedNodes.length > 0) {
        selectedNode = graph.getNode(selectedNodes[0]);
        if (selectedNode) {
          dispatch('nodeSelect', { node: selectedNode });
        }
      } else {
        selectedNode = null;
        dispatch('nodeSelect', { node: null });
      }
      
      isSelecting = false;
      selectionStart = null;
      selectionStartScreen = null;
      selectionScreenPos = null;
    }
  }
  
  function handleResizeHandleMouseDown(annotationId: string, handle: 'se' | 'sw' | 'ne' | 'nw' | 'e' | 'w' | 'n' | 's', e: MouseEvent) {
    e.stopPropagation();
    const annotation = graph.getAnnotation(annotationId);
    if (annotation) {
      const rect = canvas.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - transform.x) / transform.zoom;
      const mouseY = (e.clientY - rect.top - transform.y) / transform.zoom;
      
      resizingAnnotation = {
        annotationId,
        handle,
        startPos: { x: mouseX, y: mouseY },
        startSize: annotation.size || { width: 200, height: 150 },
        startPosition: { ...annotation.position }
      };
    }
  }
  
  function handleResizeHandleKeyDown(annotationId: string, handle: 'se' | 'sw' | 'ne' | 'nw' | 'e' | 'w' | 'n' | 's', e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const fakeEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
      handleResizeHandleMouseDown(annotationId, handle, fakeEvent);
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
    // Dispatch event to parent (WindowManager) to open tab
    dispatch('nodeEdit', { node: e.detail.node });
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
  
  function handleBypassToggle(nodeId: string, e: MouseEvent) {
    const node = graph.getNode(nodeId);
    if (node) {
      node.setBypassed(!node.bypassed);
      graph.nodes = [...graph.nodes]; // Force reactivity
    }
  }
  
  function handleCookToggle(nodeId: string, e: MouseEvent) {
    const node = graph.getNode(nodeId);
    if (!node) return;
    
    if (e.shiftKey) {
      // Shift+click: Multi-cook mode - cook this node and all downstream nodes
      graph.multiCookMode = true;
      node.setCooking(true);
      
      // Cook all downstream nodes
      const cookDownstream = (n: Node) => {
        n.outputs.forEach(output => {
          output.connections.forEach(conn => {
            const downstreamNode = graph.getNode(conn.to.nodeId);
            if (downstreamNode) {
              downstreamNode.setCooking(true);
              cookDownstream(downstreamNode);
            }
          });
        });
      };
      cookDownstream(node);
    } else {
      // Normal click: Toggle cook, but clear other cooking nodes first
      if (node.cooking) {
        // If already cooking, turn it off
        node.setCooking(false);
        graph.multiCookMode = false;
      } else {
        // Clear other cooking nodes (unless in multi-cook mode)
        if (!graph.multiCookMode) {
          graph.clearCookingNodes();
        }
        node.setCooking(true);
      }
    }
    
    graph.nodes = [...graph.nodes]; // Force reactivity
  }
  
  // Annotation state
  let editingAnnotation: string | null = null;
  let annotationInput: HTMLInputElement | HTMLTextAreaElement | null = null;
  let draggingAnnotation: { annotationId: string; offset: { x: number; y: number } } | null = null;
  let resizingAnnotation: { annotationId: string; handle: 'se' | 'sw' | 'ne' | 'nw' | 'e' | 'w' | 'n' | 's'; startPos: { x: number; y: number }; startSize: { width: number; height: number }; startPosition: { x: number; y: number } } | null = null;
  let drawingLine: { annotationId: string; startPos: { x: number; y: number } } | null = null;
  let drawingPolyline: { annotationId: string; points: { x: number; y: number }[] } | null = null;
  
  function handleCanvasKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      // Simulate click for keyboard accessibility
      const fakeEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      handleCanvasClick(fakeEvent);
    }
  }
  
  function handleCanvasClick(e: MouseEvent) {
    // Don't create annotation if clicking on existing annotation
    if ((e.target as HTMLElement).closest('.annotation')) {
      return;
    }
    
    if (activeTool === 'select' && !(e.target as HTMLElement).closest('.node')) {
      selectedNodes = [];
      selectedNode = null;
      selectedAnnotation = null;
      editingAnnotation = null;
      dispatch('nodeSelect', { node: null });
    } else if (['text', 'image', 'group'].includes(activeTool)) {
      // Create annotation
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - transform.x) / transform.zoom;
      const y = (e.clientY - rect.top - transform.y) / transform.zoom;
      
      createAnnotation(activeTool, x, y);
      // Reset to select tool after creating
      activeTool = 'select';
      dispatch('toolChange', 'select');
    }
  }
  
  function createAnnotation(type: string, x: number, y: number) {
    const id = `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    if (type === 'image') {
      // Create file input for image
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const dataUrl = event.target?.result as string;
            const annotation: any = {
              id,
              type: 'image',
              src: dataUrl,
              position: { x, y },
              size: { width: 200, height: 150 }
            };
            graph.addAnnotation(annotation);
            graph.annotations = [...graph.annotations];
          };
          reader.readAsDataURL(file);
        }
      };
      input.click();
    } else if (type === 'group') {
      const annotation: any = {
        id,
        type: 'group',
        content: 'Group',
        position: { x, y },
        containedElements: []
      };
      graph.addAnnotation(annotation);
      graph.annotations = [...graph.annotations];
      // Start editing immediately
      editingAnnotation = id;
      setTimeout(() => {
        const el = canvas.querySelector(`[data-annotation-id="${id}"]`) as HTMLElement;
        if (el) {
          const input = el.querySelector('input, textarea') as HTMLInputElement;
          if (input) {
            input.focus();
            input.select();
          }
        }
      }, 10);
    } else if (type === 'text') {
      // Text annotation with default style
      // Default width: ~90 characters at 14px font (average char width ~6px) = ~540px
      const defaultWidth = 540;
      const annotation: any = {
        id,
        type: 'text',
        content: '',
        position: { x, y },
        size: { width: defaultWidth, height: 60 }, // Height will auto-grow with content
        style: {
          fontSize: 14,
          fontWeight: 'normal',
          fontStyle: 'normal',
          textAlign: 'left',
          color: '#ffffff',
          padding: 0,
          borderRadius: 0
        }
      };
      graph.addAnnotation(annotation);
      graph.annotations = [...graph.annotations];
      // Start editing immediately
      editingAnnotation = id;
      setTimeout(() => {
        const el = canvas.querySelector(`[data-annotation-id="${id}"]`) as HTMLElement;
        if (el) {
          const input = el.querySelector('input, textarea') as HTMLInputElement;
          if (input) {
            input.focus();
          }
        }
      }, 10);
    }
  }
  
  function handleAnnotationClick(annotationId: string, e: MouseEvent) {
    e.stopPropagation();
    if (activeTool === 'select' && !editingAnnotation) {
      selectedAnnotation = annotationId;
      dispatch('annotationSelect', { annotationId });
      selectedNode = null;
      selectedNodes = [];
    }
  }
  
  function handleAnnotationMouseDown(annotationId: string, e: MouseEvent) {
    e.stopPropagation();
    if (activeTool === 'select' && !editingAnnotation && e.button === 0) {
      // Don't start drag if clicking on input/button/resize handle
      if ((e.target as HTMLElement).closest('input, textarea, button, .resize-handle')) {
        return;
      }
      
      const annotation = graph.getAnnotation(annotationId);
      if (annotation) {
        selectedAnnotation = annotationId;
        dispatch('annotationSelect', { annotationId });
        selectedNode = null;
        selectedNodes = [];
        
        const rect = canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - transform.x) / transform.zoom;
        const mouseY = (e.clientY - rect.top - transform.y) / transform.zoom;
        
        const offset = {
          x: mouseX - annotation.position.x,
          y: mouseY - annotation.position.y
        };
        
        draggingAnnotation = { annotationId, offset };
      }
    }
  }
  
  function handleAnnotationMouseDownForText(annotationId: string, e: MouseEvent, width: number, height: number) {
    if (!(e.target as HTMLElement).closest('input, textarea, button')) {
      handleAnnotationMouseDown(annotationId, e);
    }
    if (!resizingAnnotation) {
      handleAnnotationMouseDownForResize(annotationId, e, width, height);
    }
  }
  
  function handleAnnotationKeyDown(annotationId: string, e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      const fakeEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      handleAnnotationClick(annotationId, fakeEvent);
    }
  }
  
  function handleAnnotationMouseMove(annotationId: string, e: MouseEvent, width: number, height: number) {
    if (!selectedAnnotation || selectedAnnotation !== annotationId || editingAnnotation === annotationId) {
      return;
    }
    
    const annotation = graph.getAnnotation(annotationId);
    if (!annotation) return;
    
    const rect = canvas.getBoundingClientRect();
    const localX = (e.clientX - rect.left - transform.x) / transform.zoom - annotation.position.x;
    const localY = (e.clientY - rect.top - transform.y) / transform.zoom - annotation.position.y;
    
    const edgeThreshold = 8;
    const isNearLeft = localX < edgeThreshold;
    const isNearRight = localX > width - edgeThreshold;
    const isNearTop = localY < edgeThreshold;
    const isNearBottom = localY > height - edgeThreshold;
    
    let cursor = 'default';
    if ((isNearLeft && isNearTop) || (isNearRight && isNearBottom)) {
      cursor = 'nwse-resize';
    } else if ((isNearLeft && isNearBottom) || (isNearRight && isNearTop)) {
      cursor = 'nesw-resize';
    } else if (isNearLeft || isNearRight) {
      cursor = 'ew-resize';
    } else if (isNearTop || isNearBottom) {
      cursor = 'ns-resize';
    }
    
    (e.currentTarget as HTMLElement).style.cursor = cursor;
  }
  
  function handleAnnotationMouseDownForResize(annotationId: string, e: MouseEvent, width: number, height: number) {
    if (!selectedAnnotation || selectedAnnotation !== annotationId || editingAnnotation === annotationId) {
      return;
    }
    
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left - transform.x) / transform.zoom;
    const mouseY = (e.clientY - rect.top - transform.y) / transform.zoom;
    
    const annotation = graph.getAnnotation(annotationId);
    if (!annotation) return;
    
    const localX = mouseX - annotation.position.x;
    const localY = mouseY - annotation.position.y;
    
    const edgeThreshold = 8;
    const isNearLeft = localX < edgeThreshold;
    const isNearRight = localX > width - edgeThreshold;
    const isNearTop = localY < edgeThreshold;
    const isNearBottom = localY > height - edgeThreshold;
    
    if (isNearLeft || isNearRight || isNearTop || isNearBottom) {
      e.stopPropagation();
      
      let handle: 'se' | 'sw' | 'ne' | 'nw' | 'e' | 'w' | 'n' | 's' = 'se';
      if (isNearLeft && isNearTop) handle = 'nw';
      else if (isNearLeft && isNearBottom) handle = 'sw';
      else if (isNearRight && isNearTop) handle = 'ne';
      else if (isNearRight && isNearBottom) handle = 'se';
      else if (isNearLeft) handle = 'w';
      else if (isNearRight) handle = 'e';
      else if (isNearTop) handle = 'n';
      else if (isNearBottom) handle = 's';
      
      resizingAnnotation = {
        annotationId,
        handle,
        startPos: { x: mouseX, y: mouseY },
        startSize: annotation.size || { width, height },
        startPosition: { ...annotation.position }
      };
    }
  }
  
  function handleAnnotationDoubleClick(annotationId: string, e: MouseEvent) {
    e.stopPropagation();
    editingAnnotation = annotationId;
  }
  
  function handleAnnotationDelete(annotationId: string) {
    graph.removeAnnotation(annotationId);
    graph.annotations = [...graph.annotations];
    if (selectedAnnotation === annotationId) {
      selectedAnnotation = null;
    }
    if (editingAnnotation === annotationId) {
      editingAnnotation = null;
    }
  }
  
  function handleAnnotationContentChange(annotationId: string, content: string) {
    const annotation = graph.getAnnotation(annotationId);
    if (annotation) {
      annotation.content = content;
      graph.annotations = [...graph.annotations];
    }
  }
  
  function handleTextareaInput(annotationId: string, e: Event) {
    const target = e.target as HTMLTextAreaElement;
    handleAnnotationContentChange(annotationId, target.value);
  }
  
  function handleInputInput(annotationId: string, e: Event) {
    const target = e.target as HTMLInputElement;
    handleAnnotationContentChange(annotationId, target.value);
  }
  
  function finishEditingAnnotation() {
    editingAnnotation = null;
  }
  
  // Asset drag-drop
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    
    // Don't handle drop if we're dragging an annotation (only handle file drops)
    if (draggingAnnotation) {
      return;
    }
    
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length === 0) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - transform.x) / transform.zoom;
    const y = (e.clientY - rect.top - transform.y) / transform.zoom;
    
    files.forEach(async (file) => {
      // Check if it's an image
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          const id = `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const annotation: any = {
            id,
            type: 'image',
            src: dataUrl,
            position: { x, y },
            size: { width: 200, height: 150 },
            caption: file.name
          };
          graph.addAnnotation(annotation);
          graph.annotations = [...graph.annotations];
          
          // Also add to asset manager
          graph.assetManager.cache.set(file.name, {
            id: file.name,
            path: dataUrl,
            type: 'image',
            data: dataUrl,
            size: file.size,
            metadata: { name: file.name }
          });
        };
        reader.readAsDataURL(file);
      } else {
        // For other file types, try to add as asset
        try {
          const text = await file.text();
          graph.assetManager.cache.set(file.name, {
            id: file.name,
            path: file.name,
            type: file.type.includes('json') ? 'json' : 'text',
            data: file.type.includes('json') ? JSON.parse(text) : text,
            size: file.size,
            metadata: { name: file.name }
          });
        } catch (err) {
          console.warn('Failed to load file as asset:', err);
        }
      }
    });
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

  // Helper function to calculate the center of all nodes and annotations
  function getNodesCenter(): { x: number; y: number } | null {
    if (graph.nodes.length === 0 && graph.annotations.length === 0) return null;

    // Calculate bounding box of all nodes and annotations
    // Approximate node size: 120px width, 80px height (can be adjusted)
    const nodeWidth = 120;
    const nodeHeight = 80;
    
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    // Include nodes in bounding box
    graph.nodes.forEach(node => {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + nodeWidth);
      maxY = Math.max(maxY, node.position.y + nodeHeight);
    });

    // Include annotations in bounding box
    graph.annotations.forEach(annotation => {
      if (annotation.type === 'line') {
        // Line: use position and endPosition
        const startX = annotation.position.x;
        const startY = annotation.position.y;
        const endX = annotation.endPosition?.x ?? annotation.position.x;
        const endY = annotation.endPosition?.y ?? annotation.position.y;
        minX = Math.min(minX, startX, endX);
        minY = Math.min(minY, startY, endY);
        maxX = Math.max(maxX, startX, endX);
        maxY = Math.max(maxY, startY, endY);
      } else if (annotation.type === 'polyline') {
        // Polyline: use all points
        if (annotation.points && annotation.points.length > 0) {
          annotation.points.forEach(point => {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
          });
        } else {
          // Fallback to position if no points
          minX = Math.min(minX, annotation.position.x);
          minY = Math.min(minY, annotation.position.y);
          maxX = Math.max(maxX, annotation.position.x);
          maxY = Math.max(maxY, annotation.position.y);
        }
      } else {
        // text, image, group: use position and size
        const width = annotation.size?.width || (annotation.type === 'text' ? 540 : annotation.type === 'image' ? 200 : 300);
        const height = annotation.size?.height || (annotation.type === 'text' ? 60 : annotation.type === 'image' ? 150 : 200);
        minX = Math.min(minX, annotation.position.x);
        minY = Math.min(minY, annotation.position.y);
        maxX = Math.max(maxX, annotation.position.x + width);
        maxY = Math.max(maxY, annotation.position.y + height);
      }
    });

    // If no content found, return null
    if (minX === Infinity) return null;

    // Calculate center of bounding box
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    return { x: centerX, y: centerY };
  }

  // Function to center canvas on all nodes and annotations
  export function centerOnNodes() {
    if (!canvas || (graph.nodes.length === 0 && graph.annotations.length === 0)) return;

    const center = getNodesCenter();
    if (!center) return;
    
    const centerX = center.x;
    const centerY = center.y;

    // Get viewport dimensions
    const rect = canvas.getBoundingClientRect();
    const viewportWidth = rect.width;
    const viewportHeight = rect.height;

    // Calculate bounding box of all nodes and annotations
    const nodeWidth = 120;
    const nodeHeight = 80;
    
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    // Include nodes in bounding box
    graph.nodes.forEach(node => {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + nodeWidth);
      maxY = Math.max(maxY, node.position.y + nodeHeight);
    });

    // Include annotations in bounding box
    graph.annotations.forEach(annotation => {
      if (annotation.type === 'line') {
        const startX = annotation.position.x;
        const startY = annotation.position.y;
        const endX = annotation.endPosition?.x ?? annotation.position.x;
        const endY = annotation.endPosition?.y ?? annotation.position.y;
        minX = Math.min(minX, startX, endX);
        minY = Math.min(minY, startY, endY);
        maxX = Math.max(maxX, startX, endX);
        maxY = Math.max(maxY, startY, endY);
      } else if (annotation.type === 'polyline') {
        if (annotation.points && annotation.points.length > 0) {
          annotation.points.forEach(point => {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
          });
        } else {
          minX = Math.min(minX, annotation.position.x);
          minY = Math.min(minY, annotation.position.y);
          maxX = Math.max(maxX, annotation.position.x);
          maxY = Math.max(maxY, annotation.position.y);
        }
      } else {
        const width = annotation.size?.width || (annotation.type === 'text' ? 540 : annotation.type === 'image' ? 200 : 300);
        const height = annotation.size?.height || (annotation.type === 'text' ? 60 : annotation.type === 'image' ? 150 : 200);
        minX = Math.min(minX, annotation.position.x);
        minY = Math.min(minY, annotation.position.y);
        maxX = Math.max(maxX, annotation.position.x + width);
        maxY = Math.max(maxY, annotation.position.y + height);
      }
    });

    // Calculate bounding box dimensions
    const bboxWidth = maxX - minX;
    const bboxHeight = maxY - minY;

    // Add padding (20% on each side)
    const padding = 0.2;
    const paddedWidth = bboxWidth * (1 + padding * 2);
    const paddedHeight = bboxHeight * (1 + padding * 2);

    // Calculate zoom to fit all content with padding
    const zoomX = viewportWidth / paddedWidth;
    const zoomY = viewportHeight / paddedHeight;
    const newZoom = Math.min(zoomX, zoomY, 1); // Don't zoom in more than 1x

    // Set zoom
    transform.zoom = newZoom;

    // Calculate pan to center the content
    // Center of viewport in canvas coordinates
    const viewportCenterX = viewportWidth / 2;
    const viewportCenterY = viewportHeight / 2;

    // Position of content center in screen coordinates at current zoom
    const contentCenterScreenX = centerX * newZoom;
    const contentCenterScreenY = centerY * newZoom;

    // Calculate pan to center
    transform.x = viewportCenterX - contentCenterScreenX;
    transform.y = viewportCenterY - contentCenterScreenY;

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
    
    // Always zoom on mouse wheel
    // Use deltaY for vertical scrolling (primary zoom direction)
    // Also support horizontal scrolling (deltaX) for zoom on some trackpads
    isWheelPanning = false;
    
    // Calculate zoom delta from vertical scroll, with horizontal scroll as fallback
    const zoomDelta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
    const delta = zoomDelta * -0.005;
    const oldZoom = transform.zoom;
    const newZoom = Math.max(0.1, Math.min(2, oldZoom + delta));
    
    // Zoom from the center of all nodes
    const center = getNodesCenter();
    if (center) {
      // Calculate how much to adjust transform to keep the center point fixed
      // Formula: newTransform.x = oldTransform.x + centerX * (oldZoom - newZoom)
      transform.x = transform.x + center.x * (oldZoom - newZoom);
      transform.y = transform.y + center.y * (oldZoom - newZoom);
    }
    
    transform.zoom = newZoom;
    transform = transform;
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
      const oldZoom = transform.zoom;
      const newZoom = Math.min(2, oldZoom + 0.1);
      
      // Zoom from the center of all nodes
      const center = getNodesCenter();
      if (center) {
        transform.x = transform.x + center.x * (oldZoom - newZoom);
        transform.y = transform.y + center.y * (oldZoom - newZoom);
      }
      
      transform.zoom = newZoom;
      transform = transform;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '-') {
      e.preventDefault();
      const oldZoom = transform.zoom;
      const newZoom = Math.max(0.1, oldZoom - 0.1);
      
      // Zoom from the center of all nodes
      const center = getNodesCenter();
      if (center) {
        transform.x = transform.x + center.x * (oldZoom - newZoom);
        transform.y = transform.y + center.y * (oldZoom - newZoom);
      }
      
      transform.zoom = newZoom;
      transform = transform;
    }
    
    // ⌘0 - Zoom out to fit all nodes and annotations
    if ((e.metaKey || e.ctrlKey) && e.key === '0') {
      e.preventDefault();
      centerOnNodes();
    }
    
    // Escape - Deselect annotations or exit editing mode
    if (e.key === 'Escape') {
      const target = e.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
        if (editingAnnotation) {
          // Exit editing mode
          editingAnnotation = null;
        } else if (selectedAnnotation) {
          // Deselect annotation
          e.preventDefault();
          selectedAnnotation = null;
          dispatch('annotationSelect', { annotationId: null });
        }
      }
    }
    
    // Delete / Backspace - Delete selected nodes or annotations
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const target = e.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
        if (selectedNodes.length > 0) {
          e.preventDefault();
          selectedNodes.forEach(nodeId => {
            graph.removeNode(nodeId);
          });
          selectedNodes = [];
          selectedNode = null;
          graph.nodes = [...graph.nodes];
          dispatch('nodeSelect', { node: null });
        } else if (selectedAnnotation) {
          e.preventDefault();
          handleAnnotationDelete(selectedAnnotation);
        }
      }
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
  on:dragover={handleDragOver}
  on:drop={handleDrop}
  on:keydown={handleCanvasKeyDown}
>
  <!-- Selection rectangle -->
  {#if isSelecting && selectionStart && selectionStartScreen && selectionScreenPos}
    {@const screenRect = {
      x: Math.min(selectionStartScreen.x, selectionScreenPos.x),
      y: Math.min(selectionStartScreen.y, selectionScreenPos.y),
      width: Math.abs(selectionScreenPos.x - selectionStartScreen.x),
      height: Math.abs(selectionScreenPos.y - selectionStartScreen.y)
    }}
    <div
      class="selection-rectangle"
      style="left: {screenRect.x}px; top: {screenRect.y}px; width: {screenRect.width}px; height: {screenRect.height}px;"
    ></div>
  {/if}
  
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
      {@const from = connectingFrom}
      {@const curveOffset = Math.abs(mousePosition.y - connectingPosition.y) * 0.5}
      {@const isTrigger = from.portType === 'output' && (() => {
        const fromNode = graph.getNode(from.nodeId);
        if (!fromNode) return false;
        const port = fromNode.outputs.find(p => p.id === from.portId);
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
  
  <!-- Annotations Layer (v1.3) -->
  <div 
    class="annotations-container"
    style="transform: translate({transform.x}px, {transform.y}px) scale({transform.zoom})"
  >
    {#each annotations as annotation (annotation.id)}
      {@const isEditing = editingAnnotation === annotation.id}
      {@const isSelected = selectedAnnotation === annotation.id}
      
      {#if annotation.type === 'text'}
        {@const style = annotation.style || {}}
        {@const width = annotation.size?.width || 540}
        {@const height = annotation.size?.height || 'auto'}
        {@const styleStr = [
          `font-size: ${style.fontSize || 14}px`,
          `font-weight: ${style.fontWeight || 'normal'}`,
          `font-style: ${style.fontStyle || 'normal'}`,
          `text-align: ${style.textAlign || 'left'}`,
          `color: ${style.color || '#ffffff'}`,
          style.backgroundColor ? `background-color: ${style.backgroundColor}` : '',
          `padding: ${style.padding || 0}px`,
          `border-radius: ${style.borderRadius || 0}px`,
          style.borderLeft ? `border-left: ${style.borderLeft}` : '',
          `width: ${width}px`,
          typeof height === 'number' ? `min-height: ${height}px` : ''
        ].filter(Boolean).join('; ')}
        <div
          class="annotation annotation-text"
          class:selected={isSelected}
          class:editing={isEditing}
          class:dragging={draggingAnnotation?.annotationId === annotation.id}
          data-annotation-id={annotation.id}
          role="textbox"
          aria-label="Text annotation"
          tabindex="0"
          style="left: {annotation.position.x}px; top: {annotation.position.y}px; {styleStr}"
          on:click={(e) => handleAnnotationClick(annotation.id, e)}
          on:dblclick={(e) => handleAnnotationDoubleClick(annotation.id, e)}
          on:mousedown={(e) => handleAnnotationMouseDownForText(annotation.id, e, width, typeof height === 'number' ? height : 60)}
          on:mousemove={(e) => handleAnnotationMouseMove(annotation.id, e, width, typeof height === 'number' ? height : 60)}
          on:keydown={(e) => handleAnnotationKeyDown(annotation.id, e)}
        >
          {#if isEditing}
            <textarea
              class="annotation-input"
              bind:this={annotationInput}
              value={annotation.content || ''}
              style="width: {width - (style.padding || 8) * 2}px; min-height: {typeof height === 'number' ? height - (style.padding || 8) * 2 : 60}px"
              on:blur={finishEditingAnnotation}
              on:keydown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  finishEditingAnnotation();
                } else if (e.key === 'Escape') {
                  finishEditingAnnotation();
                } else if (e.key === 'Delete' && (e.metaKey || e.ctrlKey)) {
                  handleAnnotationDelete(annotation.id);
                }
              }}
              on:input={(e) => handleTextareaInput(annotation.id, e)}
              placeholder="Enter text..."
            ></textarea>
          {:else}
            <div class="annotation-content">{@html marked.parse(annotation.content || '')}</div>
          {/if}
        </div>
      {:else if annotation.type === 'image'}
        <div
          class="annotation annotation-image"
          class:selected={isSelected}
          class:dragging={draggingAnnotation?.annotationId === annotation.id}
          data-annotation-id={annotation.id}
          role="button"
          aria-label="Image annotation"
          tabindex="0"
          style="left: {annotation.position.x}px; top: {annotation.position.y}px; width: {annotation.size?.width || 200}px; height: {annotation.size?.height || 150}px"
          on:click={(e) => handleAnnotationClick(annotation.id, e)}
          on:dblclick={(e) => handleAnnotationDoubleClick(annotation.id, e)}
          on:mousedown={(e) => {
            if (e.button === 0) {
              e.preventDefault();
              handleAnnotationMouseDown(annotation.id, e);
            }
          }}
          on:dragstart={(e) => e.preventDefault()}
          on:keydown={(e) => handleAnnotationKeyDown(annotation.id, e)}
        >
          <img src={annotation.src} alt={annotation.caption || ''} draggable="false" on:dragstart={(e) => e.preventDefault()} />
          {#if annotation.caption}
            <div class="annotation-caption">{annotation.caption}</div>
          {/if}
          {#if isSelected}
            <div
              class="resize-handle resize-se"
              role="button"
              aria-label="Resize southeast"
              tabindex="0"
              on:mousedown={(e) => handleResizeHandleMouseDown(annotation.id, 'se', e)}
              on:keydown={(e) => handleResizeHandleKeyDown(annotation.id, 'se', e)}
            ></div>
            <div
              class="resize-handle resize-sw"
              role="button"
              aria-label="Resize southwest"
              tabindex="0"
              on:mousedown={(e) => handleResizeHandleMouseDown(annotation.id, 'sw', e)}
              on:keydown={(e) => handleResizeHandleKeyDown(annotation.id, 'sw', e)}
            ></div>
            <div
              class="resize-handle resize-ne"
              role="button"
              aria-label="Resize northeast"
              tabindex="0"
              on:mousedown={(e) => handleResizeHandleMouseDown(annotation.id, 'ne', e)}
              on:keydown={(e) => handleResizeHandleKeyDown(annotation.id, 'ne', e)}
            ></div>
            <div
              class="resize-handle resize-nw"
              role="button"
              aria-label="Resize northwest"
              tabindex="0"
              on:mousedown={(e) => handleResizeHandleMouseDown(annotation.id, 'nw', e)}
              on:keydown={(e) => handleResizeHandleKeyDown(annotation.id, 'nw', e)}
            ></div>
          {/if}
        </div>
      {:else if annotation.type === 'group'}
        <div
          class="annotation annotation-group"
          class:selected={isSelected}
          class:editing={isEditing}
          class:dragging={draggingAnnotation?.annotationId === annotation.id}
          data-annotation-id={annotation.id}
          role="button"
          aria-label="Group annotation"
          tabindex="0"
          style="left: {annotation.position.x}px; top: {annotation.position.y}px; width: {annotation.size?.width || 300}px; height: {annotation.size?.height || 200}px"
          on:click={(e) => handleAnnotationClick(annotation.id, e)}
          on:dblclick={(e) => handleAnnotationDoubleClick(annotation.id, e)}
          on:mousedown={(e) => {
            if (e.button === 0) {
              handleAnnotationMouseDown(annotation.id, e);
            }
          }}
          on:keydown={(e) => handleAnnotationKeyDown(annotation.id, e)}
        >
          {#if isEditing}
            <input
              type="text"
              class="annotation-input"
              bind:this={annotationInput}
              value={annotation.content || 'Group'}
              on:blur={finishEditingAnnotation}
              on:keydown={(e) => {
                if (e.key === 'Enter') {
                  finishEditingAnnotation();
                } else if (e.key === 'Escape') {
                  finishEditingAnnotation();
                } else if (e.key === 'Delete' && (e.metaKey || e.ctrlKey)) {
                  handleAnnotationDelete(annotation.id);
                }
              }}
              on:input={(e) => handleInputInput(annotation.id, e)}
              placeholder="Group name..."
            />
          {:else}
            <div class="group-header">{annotation.content || 'Group'}</div>
          {/if}
          {#if isSelected && !isEditing}
            <div
              class="resize-handle resize-se"
              role="button"
              aria-label="Resize southeast"
              tabindex="0"
              on:mousedown={(e) => handleResizeHandleMouseDown(annotation.id, 'se', e)}
              on:keydown={(e) => handleResizeHandleKeyDown(annotation.id, 'se', e)}
            ></div>
            <div
              class="resize-handle resize-sw"
              role="button"
              aria-label="Resize southwest"
              tabindex="0"
              on:mousedown={(e) => handleResizeHandleMouseDown(annotation.id, 'sw', e)}
              on:keydown={(e) => handleResizeHandleKeyDown(annotation.id, 'sw', e)}
            ></div>
            <div
              class="resize-handle resize-ne"
              role="button"
              aria-label="Resize northeast"
              tabindex="0"
              on:mousedown={(e) => handleResizeHandleMouseDown(annotation.id, 'ne', e)}
              on:keydown={(e) => handleResizeHandleKeyDown(annotation.id, 'ne', e)}
            ></div>
            <div
              class="resize-handle resize-nw"
              role="button"
              aria-label="Resize northwest"
              tabindex="0"
              on:mousedown={(e) => handleResizeHandleMouseDown(annotation.id, 'nw', e)}
              on:keydown={(e) => handleResizeHandleKeyDown(annotation.id, 'nw', e)}
            ></div>
          {/if}
        </div>
      {:else if annotation.type === 'line'}
        {@const style = annotation.style || {}}
        {@const startX = annotation.position.x}
        {@const startY = annotation.position.y}
        {@const endX = annotation.endPosition?.x || annotation.position.x}
        {@const endY = annotation.endPosition?.y || annotation.position.y}
        {@const strokeWidth = style.strokeWidth || 2}
        {@const strokeColor = style.strokeColor || '#ffffff'}
        <svg
          class="annotation annotation-line"
          class:selected={isSelected}
          data-annotation-id={annotation.id}
          role="button"
          aria-label="Line annotation"
          tabindex="0"
          style="position: absolute; left: 0; top: 0; pointer-events: none;"
          on:click={(e) => handleAnnotationClick(annotation.id, e)}
          on:keydown={(e) => handleAnnotationKeyDown(annotation.id, e)}
        >
          <line
            x1={startX}
            y1={startY}
            x2={endX}
            y2={endY}
            stroke={strokeColor}
            stroke-width={strokeWidth}
            pointer-events="stroke"
            style="cursor: pointer;"
          />
        </svg>
      {:else if annotation.type === 'polyline'}
        {@const style = annotation.style || {}}
        {@const points = annotation.points || []}
        {@const strokeWidth = style.strokeWidth || 2}
        {@const strokeColor = style.strokeColor || '#ffffff'}
        {#if points.length > 0}
          {@const pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
          <svg
            class="annotation annotation-polyline"
            class:selected={isSelected}
            data-annotation-id={annotation.id}
            role="button"
            aria-label="Polyline annotation"
            tabindex="0"
            style="position: absolute; left: 0; top: 0; pointer-events: none;"
            on:click={(e) => handleAnnotationClick(annotation.id, e)}
            on:keydown={(e) => handleAnnotationKeyDown(annotation.id, e)}
          >
            <path
              d={pathData}
              fill="none"
              stroke={strokeColor}
              stroke-width={strokeWidth}
              pointer-events="stroke"
              style="cursor: pointer;"
            />
          </svg>
          {/if}
      {/if}
    {/each}
  </div>
  
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
        on:bypassToggle={(e) => handleBypassToggle(e.detail.nodeId, e.detail.event)}
        on:cookToggle={(e) => handleCookToggle(e.detail.nodeId, e.detail.event)}
      />
    {/each}
  </div>
  
  <!-- Code Editor is now handled by WindowManager tabs -->
</div>

<style>
  .canvas {
    position: relative;
    width: 100%;
    height: 100%;
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
  
  .annotations-container {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
    pointer-events: none;
  }
  
  .annotation {
    position: absolute;
    pointer-events: auto;
  }
  
  .annotation-text {
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  
  .annotation-image {
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }
  
  .annotation-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  .annotation-caption {
    padding: 4px 8px;
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
    font-size: 12px;
    text-align: center;
  }
  
  .annotation-group {
    padding: 8px 12px;
    background: rgba(74, 158, 255, 0.1);
    border: 2px dashed #4a9eff;
    border-radius: 4px;
  }
  
  .group-header {
    font-weight: 600;
    color: #4a9eff;
  }
  
  .annotation.selected {
    outline: 2px solid #4a9eff;
    outline-offset: 2px;
  }
  
  .annotation.editing {
    z-index: 1000;
  }
  
  .annotation-input {
    width: 100%;
    background: rgba(0, 0, 0, 0.8);
    border: 1px dashed #ffffff;
    border-radius: 4px;
    color: #fff;
    font-family: inherit;
    font-size: inherit;
    padding: 8px;
    outline: none;
    resize: none;
  }
  
  .annotation-input:focus {
    border: 1px dashed #ffffff;
  }
  
  .resize-handle {
    position: absolute;
    width: 12px;
    height: 12px;
    background: #4a9eff;
    border: 2px solid #fff;
    border-radius: 50%;
    cursor: nwse-resize;
    z-index: 20;
    pointer-events: auto;
  }
  
  .resize-handle:hover {
    background: #6bb6ff;
    transform: scale(1.2);
  }
  
  .resize-se {
    bottom: -6px;
    right: -6px;
    cursor: nwse-resize;
  }
  
  .resize-sw {
    bottom: -6px;
    left: -6px;
    cursor: nesw-resize;
  }
  
  .resize-ne {
    top: -6px;
    right: -6px;
    cursor: nesw-resize;
  }
  
  .resize-nw {
    top: -6px;
    left: -6px;
    cursor: nwse-resize;
  }
  
  .selection-rectangle {
    position: absolute;
    border: 1px dashed #4a9eff;
    background: rgba(74, 158, 255, 0.1);
    pointer-events: none;
    z-index: 100;
    transform-origin: top left;
  }
  
  .annotation.dragging {
    opacity: 0.8;
  }
  
  .annotation-content {
    word-wrap: break-word;
    overflow-wrap: break-word;
    line-height: 1.6;
  }
  
  .annotation-content :global(h1) {
    font-size: 1.8em;
    font-weight: bold;
    margin: 0.5em 0;
  }
  
  .annotation-content :global(h2) {
    font-size: 1.5em;
    font-weight: bold;
    margin: 0.4em 0;
  }
  
  .annotation-content :global(h3) {
    font-size: 1.2em;
    font-weight: bold;
    margin: 0.3em 0;
  }
  
  .annotation-content :global(p) {
    margin: 0.5em 0;
  }
  
  .annotation-content :global(ul),
  .annotation-content :global(ol) {
    margin: 0.5em 0;
    padding-left: 1.5em;
  }
  
  .annotation-content :global(li) {
    margin: 0.2em 0;
  }
  
  .annotation-content :global(code) {
    background: rgba(255, 255, 255, 0.1);
    padding: 2px 4px;
    border-radius: 3px;
    font-family: 'Monaco', 'Courier New', monospace;
    font-size: 0.9em;
  }
  
  .annotation-content :global(pre) {
    background: rgba(0, 0, 0, 0.3);
    padding: 8px;
    border-radius: 4px;
    overflow-x: auto;
    margin: 0.5em 0;
  }
  
  .annotation-content :global(pre code) {
    background: none;
    padding: 0;
  }
  
  .annotation-content :global(strong) {
    font-weight: bold;
  }
  
  .annotation-content :global(em) {
    font-style: italic;
  }
  
  .annotation-content :global(a) {
    color: #4a9eff;
    text-decoration: underline;
  }
  
  .annotation-content :global(blockquote) {
    border-left: 3px solid #4a9eff;
    padding-left: 1em;
    margin: 0.5em 0;
    opacity: 0.8;
  }
  
  .annotation-line,
  .annotation-polyline {
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  
  .annotation-line.selected line,
  .annotation-polyline.selected path {
    stroke: #4a9eff;
    stroke-width: 3;
  }
</style>

