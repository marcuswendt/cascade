<script lang="ts">
  import { onMount, tick, createEventDispatcher } from 'svelte';
  import { Graph, type CanvasAnnotation } from '@/core/Graph';
  import NodeUI from './NodeUI.svelte';
  import type { Node } from '@/core/Node';
  import { marked } from 'marked';
  import { getLensNodeTemplate } from '@/nodes/lens';
  import { getPortColor } from '@/utils/portColors';
  
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
  export let transform: { x: number; y: number; zoom: number } | undefined = undefined;
  let canvas: HTMLDivElement;
  // Use transform prop if provided, otherwise use internal state
  let internalTransform = transform ? { ...transform } : { x: 0, y: 0, zoom: 1 };
  
  // Track last known prop value to detect external changes
  let lastPropTransform = transform ? { ...transform } : null;
  
  // Sync internal transform with prop when it's provided and changes externally
  // This reactive statement only runs when the transform PROP changes, not when internalTransform changes
  $: if (transform) {
    // Check if prop actually changed (external update)
    if (!lastPropTransform || 
        lastPropTransform.x !== transform.x || 
        lastPropTransform.y !== transform.y || 
        lastPropTransform.zoom !== transform.zoom) {
      // Prop changed externally, sync internal state
      internalTransform = { ...transform };
      lastPropTransform = { ...transform };
    }
  }
  
  // Dispatch transform changes back to parent when internal transform changes
  // This only runs when internalTransform changes, not when prop changes
  let lastDispatchedTransform = { ...internalTransform };
  $: if (transform !== undefined) {
    // Only dispatch if internal transform changed and it's different from the prop
    const hasChanged = lastDispatchedTransform.x !== internalTransform.x ||
        lastDispatchedTransform.y !== internalTransform.y ||
        lastDispatchedTransform.zoom !== internalTransform.zoom;
    
    if (hasChanged) {
      // Check if this change came from the prop (don't dispatch in that case)
      const isFromProp = lastPropTransform && 
        lastPropTransform.x === internalTransform.x &&
        lastPropTransform.y === internalTransform.y &&
        lastPropTransform.zoom === internalTransform.zoom;
      
      if (!isFromProp) {
        // Internal change, dispatch it
        lastDispatchedTransform = { ...internalTransform };
        dispatch('transformChange', { transform: { ...internalTransform } });
      } else {
        // Was from prop, just update tracking
        lastDispatchedTransform = { ...internalTransform };
      }
    }
  }
  let isPanning = false;
  let selectedNodes: string[] = [];
  let selectedAnnotations: string[] = [];
  let spacePressed = false;
  let isSelecting = false;
  let selectionStart: { x: number; y: number } | null = null;
  let selectionStartScreen: { x: number; y: number } | null = null;
  let selectionScreenPos: { x: number; y: number } | null = null;
  let justCompletedSelection = false;
  
  // Connection state
  let connectingFrom: { nodeId: string; portId: string; portType: 'input' | 'output' } | null = null;
  let connectingPosition: { x: number; y: number } | null = null;
  let mousePosition: { x: number; y: number } = { x: 0, y: 0 };
  
  // Node dragging state
  let draggingNode: { nodeId: string; offset: { x: number; y: number } } | null = null;
  let draggingMultiple: { 
    nodes: Array<{ nodeId: string; startPos: { x: number; y: number } }>;
    annotations: Array<{ annotationId: string; startPos: { x: number; y: number } }>;
    offset: { x: number; y: number };
  } | null = null;
  
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
    
    // Add default nodes - arranged similar to the image
    // Timer at top center, Color below and to the right, Checkers below and to the left, Composite at bottom center
    const timer = graph.addNode('Timer', { x: 0, y: 100 });
    const colorNode = graph.addNode('Color', { x: 200, y: 250 });
    const checkersNode = graph.addNode('Checkers', { x: -200, y: 400 });
    const compositeNode = graph.addNode('Composite', { x: 0, y: 550 });
    // Only set cook flag on Composite node
    compositeNode.setCooking(true);
    
    // Add default annotations
    const headlineAnnotation: any = {
      id: `ann_headline_${Date.now()}`,
      type: 'text',
      content: 'Hello World',
      position: { x: -200, y: -200 },
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
      position: { x: -200, y: -100 },
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
    
    graph.addAnnotation(headlineAnnotation);
    graph.addAnnotation(copyAnnotation);
    graph.annotations = [...graph.annotations];
    
    // Initialize timer node
    tick().then(async () => {
      timer.code = `
const tick = node.out('tick', 'trigger');
const time = node.out('time');

let frame = 0;
setInterval(() => {
  time.setValue(frame++);
  tick.trigger({ frame });
}, 1000 / 60);
      `;
      
      colorNode.code = `// Color node - creates a solid color canvas
node.defineProp('color', {
  value: '#ffffff',
  type: 'color',
  displayName: 'Color'
});

node.defineProp('resolution', {
  value: [512, 512],
  params: {
    min: [1, 1],
    max: [4096, 4096],
    integer: true
  },
  displayName: 'Resolution'
});

const output = node.out('image');

function render() {
  const [width, height] = node.props.resolution.value;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = node.props.color.value;
    ctx.fillRect(0, 0, width, height);
  }
  output.setValue(canvas);
  node.preview = canvas;
}

// Watch for prop changes
node.watchProp('color', render);
node.watchProp('resolution', render);

// Initial render
node.onReady = () => {
  render();
};
      `;
      
      try {
        const timerFunction = new Function('node', 'graph', timer.code);
        timer.setFunction(timerFunction);
        timer.execute();
        
        const colorFunction = new Function('node', 'graph', colorNode.code);
        colorNode.setFunction(colorFunction);
        colorNode.execute();
        
        // Get Checkers and Composite node templates
        const checkersCode = getDefaultNodeCode('Checkers');
        const compositeCode = getDefaultNodeCode('Composite');
        
        if (checkersCode) {
          checkersNode.code = checkersCode;
          const checkersFunction = new Function('node', 'graph', `return (async function(node, graph) {\n${checkersCode}\n})(node, graph);`);
          checkersNode.setFunction(checkersFunction);
          await checkersNode.execute();
        }
        
        if (compositeCode) {
          compositeNode.code = compositeCode;
          const compositeFunction = new Function('node', 'graph', `return (async function(node, graph) {\n${compositeCode}\n})(node, graph);`);
          compositeNode.setFunction(compositeFunction);
          await compositeNode.execute();
        }
        
        timer.inputs = [...timer.inputs];
        timer.outputs = [...timer.outputs];
        colorNode.inputs = [...colorNode.inputs];
        colorNode.outputs = [...colorNode.outputs];
        checkersNode.inputs = [...checkersNode.inputs];
        checkersNode.outputs = [...checkersNode.outputs];
        compositeNode.inputs = [...compositeNode.inputs];
        compositeNode.outputs = [...compositeNode.outputs];
        
        // Connect Checkers output to Composite image1 input
        const checkersImagePort = checkersNode.outputs.find(p => p.name === 'image');
        const compositeImage1Port = compositeNode.inputs.find(p => p.name === 'image1');
        
        if (checkersImagePort && compositeImage1Port) {
          graph.connect(checkersImagePort, compositeImage1Port);
        }
        
        // Connect Color output to Composite image2 input
        const colorImagePort = colorNode.outputs.find(p => p.name === 'image');
        const compositeImage2Port = compositeNode.inputs.find(p => p.name === 'image2');
        
        if (colorImagePort && compositeImage2Port) {
          graph.connect(colorImagePort, compositeImage2Port);
        }
        
        graph.connections = [...graph.connections];
      } catch (err) {
        console.error('Failed to initialize nodes:', err);
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
  // Filter out duplicate connections by ID to prevent Svelte key errors
  $: connections = graph.connections.filter((conn, index, self) => 
    self.findIndex(c => c.id === conn.id) === index
  );
  $: annotations = graph.annotations;
  
  // Force reactivity when node ports change
  $: nodePorts = nodes.map(n => ({ 
    id: n.id, 
    inputs: n.inputs.length, 
    outputs: n.outputs.length 
  }));
  
  // Track node positions to force connection re-renders when nodes move
  $: nodePositions = nodes.map(n => ({ 
    id: n.id, 
    x: n.position.x, 
    y: n.position.y 
  }));
  
  function handleMouseDown(e: MouseEvent) {
    if (!canvas) return;
    
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
          x: (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom,
          y: (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom
        };
        selectionStartScreen = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        };
        mousePosition = { ...selectionStart };
        selectionScreenPos = { ...selectionStartScreen };
        isSelecting = true;
        justCompletedSelection = false; // Reset flag when starting new selection
        // Clear current selection when starting new selection
        if (!e.shiftKey) {
          selectedNodes = [];
          selectedAnnotations = [];
          selectedNode = null;
          selectedAnnotation = null;
          dispatch('nodeSelect', { node: null });
          dispatch('annotationSelect', { annotationId: null });
        }
      }
    } else if (e.button === 0 && activeTool === 'line') {
      // Don't start line if clicking on existing annotation or node
      if ((e.target as HTMLElement).closest('.annotation, .node')) {
        return;
      }
      // Start drawing a line
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
      const y = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;
      
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
      const x = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
      const y = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;
      
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
      internalTransform.x += e.movementX;
      internalTransform.y += e.movementY;
      internalTransform = { ...internalTransform };
    }
    
    // Update selection rectangle
    if (isSelecting && selectionStart) {
      const rect = canvas.getBoundingClientRect();
      // Store both canvas coordinates (for selection logic) and screen coordinates (for rendering)
      const currentX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
      const currentY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;
      mousePosition = { x: currentX, y: currentY };
      // Also store screen coordinates for the selection rectangle rendering
      selectionScreenPos = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }
    
    // Handle node dragging (single or multiple)
    if (draggingNode) {
      const node = graph.getNode(draggingNode.nodeId);
      if (node) {
        const rect = canvas.getBoundingClientRect();
        const newX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom - draggingNode.offset.x;
        const newY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom - draggingNode.offset.y;
        
        // If multiple nodes or annotations are selected, move all of them
        if ((selectedNodes.length > 1 || selectedAnnotations.length > 0) && draggingMultiple && draggingNode) {
          const draggedNodeData = draggingMultiple.nodes.find(n => n.nodeId === draggingNode!.nodeId);
          if (!draggedNodeData) {
            // Fallback to single drag if node not found in draggingMultiple
            node.position = { x: newX, y: newY };
            graph.nodes = [...graph.nodes];
            return;
          }
          const deltaX = newX - draggedNodeData.startPos.x;
          const deltaY = newY - draggedNodeData.startPos.y;
          
          // Move all selected nodes
          draggingMultiple.nodes.forEach(({ nodeId, startPos }) => {
            const n = graph.getNode(nodeId);
            if (n) {
              n.position = { x: startPos.x + deltaX, y: startPos.y + deltaY };
            }
          });
          
          // Move all selected annotations
          draggingMultiple.annotations.forEach(({ annotationId, startPos }) => {
            const ann = graph.getAnnotation(annotationId);
            if (ann) {
              ann.position = { x: startPos.x + deltaX, y: startPos.y + deltaY };
            }
          });
        } else {
          // Single node drag
          node.position = { x: newX, y: newY };
        }
        
        // Force reactivity
        graph.nodes = [...graph.nodes];
        graph.annotations = [...graph.annotations];
      }
    }
    
    // Handle annotation dragging (single or multiple)
    if (draggingAnnotation && !resizingAnnotation) {
      const annotation = graph.getAnnotation(draggingAnnotation.annotationId);
      if (annotation) {
        const rect = canvas.getBoundingClientRect();
        const newX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom - draggingAnnotation.offset.x;
        const newY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom - draggingAnnotation.offset.y;
        
        // If multiple annotations or nodes are selected, move all of them
        if ((selectedAnnotations.length > 1 || selectedNodes.length > 0) && draggingMultiple && draggingAnnotation) {
          const draggedAnnotationData = draggingMultiple.annotations.find(a => a.annotationId === draggingAnnotation!.annotationId);
          if (!draggedAnnotationData) {
            // Fallback to single drag if annotation not found in draggingMultiple
            annotation.position = { x: newX, y: newY };
            graph.annotations = [...graph.annotations];
            return;
          }
          const deltaX = newX - draggedAnnotationData.startPos.x;
          const deltaY = newY - draggedAnnotationData.startPos.y;
          
          // Move all selected nodes
          draggingMultiple.nodes.forEach(({ nodeId, startPos }) => {
            const n = graph.getNode(nodeId);
            if (n) {
              n.position = { x: startPos.x + deltaX, y: startPos.y + deltaY };
            }
          });
          
          // Move all selected annotations
          draggingMultiple.annotations.forEach(({ annotationId, startPos }) => {
            const ann = graph.getAnnotation(annotationId);
            if (ann) {
              ann.position = { x: startPos.x + deltaX, y: startPos.y + deltaY };
            }
          });
        } else {
          // Single annotation drag
          annotation.position = { x: newX, y: newY };
        }
        
        graph.annotations = [...graph.annotations];
        graph.nodes = [...graph.nodes];
      }
    }
    
    // Handle annotation resizing
    if (resizingAnnotation) {
      const annotation = graph.getAnnotation(resizingAnnotation.annotationId);
      if (annotation) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
        const mouseY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;
        
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
        const mouseX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
        const mouseY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;
        
        annotation.endPosition = { x: mouseX, y: mouseY };
        graph.annotations = [...graph.annotations];
      }
    }
    
    // Handle polyline drawing
    if (drawingPolyline) {
      const annotation = graph.getAnnotation(drawingPolyline.annotationId);
      if (annotation) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
        const mouseY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;
        
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
        x: (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom,
        y: (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom
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
    
    // Cancel connection if not completed (clicked outside a port)
    if (connectingFrom && e.button === 0) {
      // Check if we're over a port element
      const target = e.target as HTMLElement;
      const portElement = target.closest('.port');
      if (!portElement) {
        // Not over a port, cancel connection
        connectingFrom = null;
        connectingPosition = null;
      }
    }
    
    // Stop dragging
    draggingNode = null;
    draggingAnnotation = null;
    draggingMultiple = null;
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
      const endX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
      const endY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;
      
      // Calculate selection rectangle bounds
      const minX = Math.min(selectionStart.x, endX);
      const maxX = Math.max(selectionStart.x, endX);
      const minY = Math.min(selectionStart.y, endY);
      const maxY = Math.max(selectionStart.y, endY);
      
      // Find all nodes that intersect with the selection rectangle
      const nodesInSelection: string[] = [];
      graph.nodes.forEach(node => {
        // Node bounds (approximate - nodes are about 120px wide, 80px tall)
        const nodeWidth = 120;
        const nodeHeight = 80;
        const nodeLeft = node.position.x;
        const nodeRight = node.position.x + nodeWidth;
        const nodeTop = node.position.y;
        const nodeBottom = node.position.y + nodeHeight;
        
        // Check if node intersects with selection rectangle
        if (nodeRight >= minX && nodeLeft <= maxX && nodeBottom >= minY && nodeTop <= maxY) {
          nodesInSelection.push(node.id);
        }
      });
      
      // Find all annotations that intersect with the selection rectangle
      const annotationsInSelection: string[] = [];
      graph.annotations.forEach(annotation => {
        let annotationLeft: number, annotationRight: number, annotationTop: number, annotationBottom: number;
        
        if (annotation.type === 'line') {
          // For lines, check if selection rectangle intersects with the line
          const lineStartX = annotation.position.x;
          const lineStartY = annotation.position.y;
          const lineEndX = annotation.endPosition?.x ?? annotation.position.x;
          const lineEndY = annotation.endPosition?.y ?? annotation.position.y;
          
          // Check if line intersects with selection rectangle
          // Simple bounding box check for line endpoints
          annotationLeft = Math.min(lineStartX, lineEndX);
          annotationRight = Math.max(lineStartX, lineEndX);
          annotationTop = Math.min(lineStartY, lineEndY);
          annotationBottom = Math.max(lineStartY, lineEndY);
          
          // Add some padding for line selection (stroke width)
          const padding = (annotation.style?.strokeWidth || 2) + 5;
          annotationLeft -= padding;
          annotationRight += padding;
          annotationTop -= padding;
          annotationBottom += padding;
        } else if (annotation.type === 'polyline') {
          // For polylines, check bounding box of all points
          if (annotation.points && annotation.points.length > 0) {
            const xs = annotation.points.map(p => p.x);
            const ys = annotation.points.map(p => p.y);
            annotationLeft = Math.min(...xs);
            annotationRight = Math.max(...xs);
            annotationTop = Math.min(...ys);
            annotationBottom = Math.max(...ys);
            
            // Add padding for stroke width
            const padding = (annotation.style?.strokeWidth || 2) + 5;
            annotationLeft -= padding;
            annotationRight += padding;
            annotationTop -= padding;
            annotationBottom += padding;
          } else {
            return; // Skip if no points
          }
        } else {
          // For text, image, and group annotations
          const width = annotation.size?.width || (annotation.type === 'text' ? 540 : annotation.type === 'image' ? 200 : 300);
          const height = annotation.size?.height || (annotation.type === 'text' ? 60 : annotation.type === 'image' ? 150 : 200);
          annotationLeft = annotation.position.x;
          annotationRight = annotation.position.x + width;
          annotationTop = annotation.position.y;
          annotationBottom = annotation.position.y + height;
        }
        
        // Check if annotation intersects with selection rectangle
        if (annotationRight >= minX && annotationLeft <= maxX && annotationBottom >= minY && annotationTop <= maxY) {
          annotationsInSelection.push(annotation.id);
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
        annotationsInSelection.forEach(annotationId => {
          if (!selectedAnnotations.includes(annotationId)) {
            selectedAnnotations.push(annotationId);
          }
        });
        // Update single selectedAnnotation for backward compatibility
        if (annotationsInSelection.length > 0) {
          selectedAnnotation = annotationsInSelection[0];
          dispatch('annotationSelect', { annotationId: selectedAnnotation });
        }
      } else {
        // Replace selection
        selectedNodes = nodesInSelection;
        selectedAnnotations = annotationsInSelection;
        if (annotationsInSelection.length > 0) {
          selectedAnnotation = annotationsInSelection[0];
          dispatch('annotationSelect', { annotationId: selectedAnnotation });
        } else {
          selectedAnnotation = null;
          dispatch('annotationSelect', { annotationId: null });
        }
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
      justCompletedSelection = true;
      selectionStart = null;
      selectionStartScreen = null;
      selectionScreenPos = null;
      
      // Reset the flag after a short delay to allow click handler to check it
      setTimeout(() => {
        justCompletedSelection = false;
      }, 100);
    }
  }
  
  function handleResizeHandleMouseDown(annotationId: string, handle: 'se' | 'sw' | 'ne' | 'nw' | 'e' | 'w' | 'n' | 's', e: MouseEvent) {
    e.stopPropagation();
    const annotation = graph.getAnnotation(annotationId);
    if (annotation) {
      const rect = canvas.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
      const mouseY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;
      
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
    const mouseX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
    const mouseY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;
    
    const offset = {
      x: mouseX - node.position.x,
      y: mouseY - node.position.y
    };
    
    draggingNode = { nodeId, offset };
    
    // If multiple items are selected, prepare to drag all of them
    if (selectedNodes.length > 1 || selectedAnnotations.length > 0) {
      draggingMultiple = {
        nodes: selectedNodes.map(id => {
          const n = graph.getNode(id);
          return { nodeId: id, startPos: n ? { ...n.position } : { x: 0, y: 0 } };
        }),
        annotations: selectedAnnotations.map(id => {
          const ann = graph.getAnnotation(id);
          return { annotationId: id, startPos: ann ? { ...ann.position } : { x: 0, y: 0 } };
        }),
        offset
      };
    }
    
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
      // Normal click: Always clear other cooking nodes first (unless shift+click)
      if (node.cooking) {
        // If already cooking, turn it off
        node.setCooking(false);
        graph.multiCookMode = false;
      } else {
        // Clear all other cooking nodes, then set this one to cooking
        graph.clearCookingNodes();
        node.setCooking(true);
        graph.multiCookMode = false;
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
  
  function handleCanvasKeyUp(e: KeyboardEvent) {
    // Handler for keyboard accessibility - required when using tabindex on non-interactive element
    // Canvas receives keyboard events for accessibility
  }
  
  function handleCanvasClick(e: MouseEvent) {
    // Don't create annotation if clicking on existing annotation
    if ((e.target as HTMLElement).closest('.annotation')) {
      return;
    }
    
    // Don't clear selection if we just finished a drag selection
    // (the click event fires after mouseup, so we need to check if we just completed a selection)
    if (activeTool === 'select' && !(e.target as HTMLElement).closest('.node') && !justCompletedSelection) {
      selectedNodes = [];
      selectedAnnotations = [];
      selectedNode = null;
      selectedAnnotation = null;
      editingAnnotation = null;
      dispatch('nodeSelect', { node: null });
    } else if (['text', 'image', 'group'].includes(activeTool)) {
      // Create annotation
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
      const y = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;
      
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
        if (!canvas) return;
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
        if (!canvas) return;
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
      if (e.shiftKey) {
        // Multi-select
        if (selectedAnnotations.includes(annotationId)) {
          selectedAnnotations = selectedAnnotations.filter(id => id !== annotationId);
        } else {
          selectedAnnotations = [...selectedAnnotations, annotationId];
        }
      } else {
        // Single select
        selectedAnnotations = [annotationId];
        selectedNodes = [];
        selectedNode = null;
      }
      selectedAnnotation = annotationId;
      dispatch('annotationSelect', { annotationId });
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
        // Update selection if not already selected
        if (!selectedAnnotations.includes(annotationId)) {
          if (e.shiftKey) {
            // Add to selection
            selectedAnnotations = [...selectedAnnotations, annotationId];
          } else {
            // Replace selection
            selectedAnnotations = [annotationId];
            selectedNodes = [];
            selectedNode = null;
          }
        }
        selectedAnnotation = annotationId;
        dispatch('annotationSelect', { annotationId });
        
        const rect = canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
        const mouseY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;
        
        const offset = {
          x: mouseX - annotation.position.x,
          y: mouseY - annotation.position.y
        };
        
        draggingAnnotation = { annotationId, offset };
        
        // If multiple items are selected, prepare to drag all of them
        if (selectedNodes.length > 0 || selectedAnnotations.length > 1) {
          draggingMultiple = {
            nodes: selectedNodes.map(id => {
              const n = graph.getNode(id);
              return { nodeId: id, startPos: n ? { ...n.position } : { x: 0, y: 0 } };
            }),
            annotations: selectedAnnotations.map(id => {
              const ann = graph.getAnnotation(id);
              return { annotationId: id, startPos: ann ? { ...ann.position } : { x: 0, y: 0 } };
            }),
            offset
          };
        }
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
    const localX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom - annotation.position.x;
    const localY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom - annotation.position.y;
    
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
    const mouseX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
    const mouseY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;
    
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
    selectedAnnotations = selectedAnnotations.filter(id => id !== annotationId);
    if (editingAnnotation === annotationId) {
      editingAnnotation = null;
    }
  }

  async function handleCut() {
    const target = document.activeElement as HTMLElement;
    // Don't cut if focus is in an input or textarea
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return;
    }

    const nodesToCut: Node[] = [];
    const annotationsToCut: CanvasAnnotation[] = [];
    
    // Collect selected nodes
    if (selectedNodes.length > 0) {
      selectedNodes.forEach(nodeId => {
        const node = graph.getNode(nodeId);
        if (node) {
          nodesToCut.push(node);
        }
      });
    }
    
    // Collect selected annotations
    if (selectedAnnotations.length > 0) {
      selectedAnnotations.forEach(annotationId => {
        const annotation = graph.getAnnotation(annotationId);
        if (annotation) {
          annotationsToCut.push(annotation);
        }
      });
    } else if (selectedAnnotation) {
      const annotation = graph.getAnnotation(selectedAnnotation);
      if (annotation) {
        annotationsToCut.push(annotation);
      }
    }
    
    // If nothing is selected, return
    if (nodesToCut.length === 0 && annotationsToCut.length === 0) {
      return;
    }
    
    // Serialize nodes with their properties
    const nodeData = nodesToCut.map(node => node.toJSON());
    
    // Get connections between selected nodes only
    const selectedNodeIds = new Set(nodesToCut.map(n => n.id));
    const connectionsToCut = graph.connections.filter(conn => {
      return selectedNodeIds.has(conn.from.nodeId) && selectedNodeIds.has(conn.to.nodeId);
    });
    
    // Create clipboard data
    const clipboardData = {
      type: 'cascade/cut',
      nodes: nodeData,
      connections: connectionsToCut,
      annotations: annotationsToCut
    };
    
    try {
      // Store in clipboard
      await navigator.clipboard.writeText(JSON.stringify(clipboardData));
      
      // Remove nodes from graph
      nodesToCut.forEach(node => {
        graph.removeNode(node.id);
      });
      
      // Remove annotations from graph
      annotationsToCut.forEach(annotation => {
        graph.removeAnnotation(annotation.id);
      });
      
      // Update graph reactivity
      graph.nodes = [...graph.nodes];
      graph.annotations = [...graph.annotations];
      
      // Clear selection
      selectedNodes = [];
      selectedAnnotations = [];
      selectedNode = null;
      selectedAnnotation = null;
      dispatch('nodeSelect', { node: null });
      dispatch('annotationSelect', { annotationId: null });
    } catch (err) {
      console.error('Failed to cut to clipboard:', err);
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
    const x = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
    const y = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;
    
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
  
  export async function handleAddNode(detail: { type: string; category: string | null }) {
    const nodeType = detail.type;
    const rect = canvas.getBoundingClientRect();
    
    // Calculate the center of the visible viewport in screen coordinates
    const viewportCenterX = rect.width / 2;
    const viewportCenterY = rect.height / 2;
    
    // Convert screen coordinates to canvas coordinates
    // Account for pan (internalTransform.x, internalTransform.y) and zoom (internalTransform.zoom)
    let centerX = (viewportCenterX - internalTransform.x) / internalTransform.zoom;
    let centerY = (viewportCenterY - internalTransform.y) / internalTransform.zoom;
    
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
    
    // Get default code template and initialize the node
    const defaultCode = getDefaultNodeCode(nodeType);
    if (defaultCode) {
      newNode.code = defaultCode;
      
      // Compile and execute the node code to initialize props and ports
      try {
        newNode.resetPortTracking();
        const wrappedCode = `return (async function(node, graph) {\n${defaultCode}\n})(node, graph);`;
        const nodeFunction = new Function('node', 'graph', wrappedCode) as (node: any, graph: any) => Promise<any>;
        newNode.setFunction(nodeFunction);
        
        // Ensure node can execute (not bypassed and temporarily cooking)
        // This is necessary because shouldExecute() checks if node is cooking when there are other cooking nodes
        const wasBypassed = newNode.bypassed;
        const wasCooking = newNode.cooking;
        if (wasBypassed) {
          newNode.setBypassed(false);
        }
        // Temporarily set cooking to ensure execution happens during initialization
        if (!wasCooking) {
          newNode.setCooking(true);
        }
        
        // Execute the node code to define props
        console.log(`Executing node ${nodeType}, props before:`, Object.keys(newNode.props).length);
        await newNode.execute();
        console.log(`Node ${nodeType} executed, props after:`, Object.keys(newNode.props).length, Object.keys(newNode.props));
        if (newNode.error) {
          console.error(`Node ${nodeType} execution error:`, newNode.error);
        }
        
        // Restore bypass and cooking state
        if (wasBypassed) {
          newNode.setBypassed(true);
        }
        if (!wasCooking) {
          newNode.setCooking(false);
        }
        
        newNode.cleanupUnusedPorts();
        
        // Force reactivity for inputs/outputs and props
        newNode.inputs = [...newNode.inputs];
        newNode.outputs = [...newNode.outputs];
        
        // Force reactivity on props by creating a new object reference
        // This must happen BEFORE selecting the node so inspector sees the props
        // Create a completely new props object to ensure Svelte detects the change
        const newProps = { ...newNode.props };
        newNode.props = newProps;
        newNode.markDirty();
        
        // Log for debugging
        console.log(`Node ${nodeType} initialized with ${Object.keys(newProps).length} props:`, Object.keys(newProps));
        if (Object.keys(newProps).length === 0) {
          console.warn(`Warning: Node ${nodeType} has no props after execution.`);
          console.warn('Code snippet:', defaultCode.substring(0, 300));
          if (newNode.error) {
            console.error('Node execution error:', newNode.error);
          }
        }
      } catch (err) {
        console.error('Failed to initialize node:', err);
        newNode.error = err as Error;
      }
    }
    
    graph.nodes = [...graph.nodes];
    
    // Pan canvas to center on the new node
    // Convert node position to screen coordinates
    const nodeScreenX = centerX * internalTransform.zoom + internalTransform.x;
    const nodeScreenY = centerY * internalTransform.zoom + internalTransform.y;
    
    // Calculate how much to pan to center the node
    const panX = viewportCenterX - nodeScreenX;
    const panY = viewportCenterY - nodeScreenY;
    
    internalTransform.x += panX;
    internalTransform.y += panY;
    internalTransform = { ...internalTransform }; // Trigger reactivity
    
    // Wait a tick to ensure props are fully initialized before selecting
    await tick();
    
    // Select the new node - do this AFTER tick to ensure props are visible
    selectedNodes = [newNode.id];
    selectedNode = newNode;
    dispatch('nodeSelect', { node: newNode });
  }
  
  // Helper function to get default node code template
  function getDefaultNodeCode(type: string): string {
    // Check Lens library templates first
    const lensTemplate = getLensNodeTemplate(type);
    if (lensTemplate) {
      return lensTemplate;
    }
    
    // Default template
    return `// ${type} node
const trigger = node.in('trigger', null, { type: 'trigger' });
const output = node.out('output');

// Handle triggers
if (trigger) {
  trigger.onTrigger = () => {
    // Your code here
    output.setValue('Hello World');
  };
}

// Lifecycle
node.onReady = () => {
  console.log('Node ready');
};
`;
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
    internalTransform.zoom = newZoom;

    // Calculate pan to center the content
    // Center of viewport in canvas coordinates
    const viewportCenterX = viewportWidth / 2;
    const viewportCenterY = viewportHeight / 2;

    // Position of content center in screen coordinates at current zoom
    const contentCenterScreenX = centerX * newZoom;
    const contentCenterScreenY = centerY * newZoom;

    // Calculate pan to center
    internalTransform.x = viewportCenterX - contentCenterScreenX;
    internalTransform.y = viewportCenterY - contentCenterScreenY;

    // Trigger reactivity
    internalTransform = { ...internalTransform };
  }
  
  function handleContextMenu(e: MouseEvent) {
    // Prevent default context menu
    e.preventDefault();
    
    // Don't open panel if right-clicking on a node or annotation
    if ((e.target as HTMLElement).closest('.node, .annotation')) {
      return;
    }
    
    // Open node panel at mouse position
    dispatch('openNodePanel', { x: e.clientX, y: e.clientY });
  }
  
  function getPortElement(nodeId: string, portId: string): HTMLElement | null {
    if (!canvas) return null;
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
      
      // Vertical layout: nodes with body 80x36px
      // Input ports at top, output ports at bottom
      // Ports are arranged horizontally with 4px gap
      const portSpacing = 16; // 12px port + 4px gap
      const portOffset = portIndex * portSpacing;
      const nodeWidth = 80; // Body width from NodeUI.svelte
      const nodeBodyHeight = 36; // Body height from NodeUI.svelte
      const portRowHeight = 12; // Port row height from NodeUI.svelte
      
      // Node structure: port row (12px) -> body (36px) -> port row (12px) -> label
      // Input ports are in the top port row
      // Output ports are in the bottom port row
      const centerX = node.position.x + nodeWidth / 2;
      const inputY = node.position.y + portRowHeight / 2;
      const outputY = node.position.y + portRowHeight + nodeBodyHeight + portRowHeight / 2;
      
      // Calculate port X position: center of node, then offset by port index
      const totalPortWidth = (portType === 'input' ? node.inputs.length : node.outputs.length) * portSpacing;
      const startX = centerX - totalPortWidth / 2 + portSpacing / 2;
      const portX = startX + portIndex * portSpacing;
      
      return {
        x: portX,
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
        x: (dotRect.left + dotRect.width / 2 - canvasRect.left - internalTransform.x) / internalTransform.zoom,
        y: (dotRect.top + dotRect.height / 2 - canvasRect.top - internalTransform.y) / internalTransform.zoom
      };
    }
    
    // Fallback if dot element not found - use port element center
    return {
      x: (rect.left + rect.width / 2 - canvasRect.left - internalTransform.x) / internalTransform.zoom,
      y: (rect.top + rect.height / 2 - canvasRect.top - internalTransform.y) / internalTransform.zoom
    };
  }
  
  function handlePortMouseDown(nodeId: string, portId: string, portType: 'input' | 'output', e: MouseEvent) {
    e.stopPropagation();
    
    const node = graph.getNode(nodeId);
    if (!node) return;
    
    const port = portType === 'output' 
      ? node.outputs.find(p => p.id === portId)
      : node.inputs.find(p => p.id === portId);
    
    if (!port) return;
    
    // Start connection (only from output ports on mousedown)
    if (portType === 'output' && !connectingFrom) {
      const pos = getPortPosition(nodeId, portId, portType);
      if (pos) {
        connectingFrom = { nodeId, portId, portType };
        connectingPosition = pos;
        const rect = canvas.getBoundingClientRect();
        mousePosition = {
          x: (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom,
          y: (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom
        };
      }
    }
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
      // Fallback: Start connection on click if mousedown didn't work
      if (portType === 'output') {
        const pos = getPortPosition(nodeId, portId, portType);
        if (pos) {
          connectingFrom = { nodeId, portId, portType };
          connectingPosition = pos;
          const rect = canvas.getBoundingClientRect();
          mousePosition = {
            x: (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom,
            y: (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom
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
    const oldZoom = internalTransform.zoom;
    const newZoom = Math.max(0.1, Math.min(2, oldZoom + delta));
    
    // Zoom from the center of all nodes
    const center = getNodesCenter();
    if (center) {
      // Calculate how much to adjust transform to keep the center point fixed
      // Formula: newTransform.x = oldTransform.x + centerX * (oldZoom - newZoom)
      internalTransform.x = internalTransform.x + center.x * (oldZoom - newZoom);
      internalTransform.y = internalTransform.y + center.y * (oldZoom - newZoom);
    }
    
    internalTransform.zoom = newZoom;
    internalTransform = { ...internalTransform };
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
      
      internalTransform.x += deltaX;
      internalTransform.y += deltaY;
      internalTransform = { ...internalTransform };
      
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
        
        internalTransform.x += deltaX;
        internalTransform.y += deltaY;
        internalTransform = { ...internalTransform };
        
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
      const oldZoom = internalTransform.zoom;
      const newZoom = Math.min(2, oldZoom + 0.1);
      
      // Zoom from the center of all nodes
      const center = getNodesCenter();
      if (center) {
        internalTransform.x = internalTransform.x + center.x * (oldZoom - newZoom);
        internalTransform.y = internalTransform.y + center.y * (oldZoom - newZoom);
      }
      
      internalTransform.zoom = newZoom;
      internalTransform = { ...internalTransform };
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '-') {
      e.preventDefault();
      const oldZoom = internalTransform.zoom;
      const newZoom = Math.max(0.1, oldZoom - 0.1);
      
      // Zoom from the center of all nodes
      const center = getNodesCenter();
      if (center) {
        internalTransform.x = internalTransform.x + center.x * (oldZoom - newZoom);
        internalTransform.y = internalTransform.y + center.y * (oldZoom - newZoom);
      }
      
      internalTransform.zoom = newZoom;
      internalTransform = { ...internalTransform };
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
        } else if (selectedAnnotation || selectedAnnotations.length > 0) {
          // Deselect annotation
          e.preventDefault();
          selectedAnnotation = null;
          selectedAnnotations = [];
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
        } else if (selectedAnnotations.length > 0) {
          e.preventDefault();
          selectedAnnotations.forEach(annotationId => {
            handleAnnotationDelete(annotationId);
          });
        } else if (selectedAnnotation) {
          e.preventDefault();
          handleAnnotationDelete(selectedAnnotation);
        }
      }
    }
    
    // ⌘X - Cut selected nodes or annotations
    if ((e.metaKey || e.ctrlKey) && e.key === 'x') {
      const target = e.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        handleCut();
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

<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
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
  on:keyup={handleCanvasKeyUp}
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
    style="transform: translate({internalTransform.x}px, {internalTransform.y}px) scale({internalTransform.zoom})"
  >
    <!-- Existing connections -->
    {#each connections as conn (conn.id)}
      {@const fromNodePos = nodePositions.find(np => np.id === conn.from.nodeId)}
      {@const toNodePos = nodePositions.find(np => np.id === conn.to.nodeId)}
      {@const fromPos = getPortPosition(conn.from.nodeId, conn.from.portId, 'output')}
      {@const toPos = getPortPosition(conn.to.nodeId, conn.to.portId, 'input')}
      {#if fromPos && toPos}
        {@const fromNode = graph.getNode(conn.from.nodeId)}
        {@const fromPort = fromNode?.outputs.find(p => p.id === conn.from.portId)}
        {@const connectionColor = fromPort ? getPortColor(fromPort) : '#888'}
        {@const midY = (fromPos.y + toPos.y) / 2}
        {@const curveOffset = Math.abs(toPos.y - fromPos.y) * 0.5}
        {@const isTrigger = conn.type === 'trigger'}
        <path
          d="M {fromPos.x} {fromPos.y} C {fromPos.x} {fromPos.y + curveOffset} {toPos.x} {toPos.y - curveOffset} {toPos.x} {toPos.y}"
          fill="none"
          stroke={connectionColor}
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
      {@const fromNode = graph.getNode(from.nodeId)}
      {@const fromPort = from.portType === 'output' ? fromNode?.outputs.find(p => p.id === from.portId) : fromNode?.inputs.find(p => p.id === from.portId)}
      {@const previewColor = fromPort ? getPortColor(fromPort) : '#888'}
      {@const curveOffset = Math.abs(mousePosition.y - connectingPosition.y) * 0.5}
      {@const isTrigger = from.portType === 'output' && (() => {
        if (!fromNode) return false;
        const port = fromNode.outputs.find(p => p.id === from.portId);
        return port?.portType === 'trigger';
      })()}
      <path
        d="M {connectingPosition.x} {connectingPosition.y} C {connectingPosition.x} {connectingPosition.y + curveOffset} {mousePosition.x} {mousePosition.y - curveOffset} {mousePosition.x} {mousePosition.y}"
        fill="none"
        stroke={previewColor}
        stroke-width="2"
        stroke-dasharray={isTrigger ? "3 3" : "4 4"}
        class="connection-preview"
      />
    {/if}
  </svg>
  
  <!-- Annotations Layer (v1.3) -->
  <div 
    class="annotations-container"
    style="transform: translate({internalTransform.x}px, {internalTransform.y}px) scale({internalTransform.zoom})"
  >
    {#each annotations as annotation (annotation.id)}
      {@const isEditing = editingAnnotation === annotation.id}
      {@const isSelected = selectedAnnotations.includes(annotation.id) || selectedAnnotation === annotation.id}
      
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
    style="transform: translate({internalTransform.x}px, {internalTransform.y}px) scale({internalTransform.zoom})"
  >
    {#each nodes as node (node.id)}
      <NodeUI 
        {node}
        selected={selectedNodes.includes(node.id)}
        on:portClick={(e) => handlePortClick(e.detail.nodeId, e.detail.portId, e.detail.portType, e.detail.event)}
        on:portMouseDown={(e) => handlePortMouseDown(e.detail.nodeId, e.detail.portId, e.detail.portType, e.detail.event)}
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
    z-index: 10;
    overflow: visible;
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
    z-index: 5;
  }
  
  .annotations-container {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
    pointer-events: none;
    z-index: 15;
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

