<script lang="ts">
  import { onMount, onDestroy, tick, createEventDispatcher } from 'svelte';
  import { Graph, type CanvasAnnotation } from '@/nodes/Graph';
  import { Annotation } from '@/nodes/annotations/Annotation';
  import { TextAnnotation } from '@/nodes/annotations/Text';
  import { annotationRegistry } from './annotations';
  import NodeUI from './NodeUI.svelte';
  import { StudioGraphController } from './StudioGraphController';
  import { graphStructure } from './stores/graphStructure';
  import type { Node } from '@/nodes/Node';
  import type { Connection } from '@/types/node.types';
  import { packagePathToType, getNodeClass } from '@/utils/nodeTypeUtils';
  import { loadEmbeddedModule } from '@/engine/nodeModuleLoader';
  import { getPortColor, getConnectionColor, DATA_TYPE_COLORS } from '@/utils/portColors';
  import { recordSnapshotImmediate } from './stores/historyStore';
  
  const dispatch = createEventDispatcher();
  
  export let activeTool = 'select';
  export let selectedNode: Node | null = null;
  export let graph = new Graph();
  export let selectedAnnotation: string | null = null;
  export let transform: { x: number; y: number; zoom: number } | undefined = undefined;
  export let onRecordHistory: (() => void) | undefined = undefined;

  const studioGraph = new StudioGraphController(() => graph);

  let subscribedScheduler: typeof graph.scheduler | undefined;
  let unsubscribeScheduler: (() => void) | undefined;
  let cookRevision = 0;

  // The scheduler owns cook state. This subscription only invalidates the
  // presentation when that state changes; it does not mirror or reinterpret it.
  $: {
    const scheduler = graph.scheduler;
    if (scheduler !== subscribedScheduler) {
      unsubscribeScheduler?.();
      subscribedScheduler = scheduler;
      unsubscribeScheduler = scheduler.subscribe(() => {
        cookRevision += 1;
      });
    }
  }

  onDestroy(() => unsubscribeScheduler?.());

  // Helper to record history using Canvas's graph reference directly
  // This ensures we capture the correct graph state
  function recordHistory() {
    recordSnapshotImmediate(graph, selectedNode?.id || null, selectedAnnotation);
  }
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

  // Network navigation state
  // currentNetwork is the subnet we're "inside" of (null = root level)
  let currentNetwork: Node | null = null;

  // Computed: breadcrumb segments for navigation
  $: breadcrumbs = getBreadcrumbs(currentNetwork);

  function getBreadcrumbs(network: Node | null): { id: string; label: string; node: Node | null }[] {
    const crumbs: { id: string; label: string; node: Node | null }[] = [
      { id: 'root', label: '/', node: null }
    ];

    if (!network) return crumbs;

    // Walk up the parent chain to build breadcrumbs
    const path: Node[] = [];
    let current: Node | null = network;
    while (current) {
      path.unshift(current);
      current = current.parent;
    }

    for (const node of path) {
      crumbs.push({ id: node.id, label: node.id, node });
    }

    return crumbs;
  }

  // Navigate into a subnet (dive in)
  function diveIntoSubnet(subnet: Node) {
    if (subnet.isNetwork()) {
      currentNetwork = subnet;
      // Clear selection when navigating
      selectedNodes = [];
      selectedNode = null;
      dispatch('nodeSelect', { node: null });
    }
  }

  // Navigate up one level (jump out)
  function jumpOut() {
    if (currentNetwork) {
      const exitedSubnet = currentNetwork;
      currentNetwork = currentNetwork.parent;
      // Keep the subnet we just exited selected
      selectedNodes = [exitedSubnet.id];
      selectedNode = exitedSubnet;
      dispatch('nodeSelect', { node: exitedSubnet });
    }
  }

  // Navigate to a specific breadcrumb
  function navigateToBreadcrumb(node: Node | null) {
    currentNetwork = node;
    selectedNodes = [];
    selectedNode = null;
    dispatch('nodeSelect', { node: null });
  }

  // Path input navigation
  let showPathInput = false;
  let pathInputValue = '';
  let pathInputElement: HTMLInputElement | null = null;

  function openPathInput() {
    // Initialize with current path
    pathInputValue = currentNetwork ? currentNetwork.path() : '/';
    showPathInput = true;
    // Focus input after it renders
    setTimeout(() => {
      pathInputElement?.focus();
      pathInputElement?.select();
    }, 10);
  }

  function closePathInput() {
    showPathInput = false;
    pathInputValue = '';
  }

  function navigateToPath(path: string) {
    if (!path || path === '/') {
      // Navigate to root
      currentNetwork = null;
    } else {
      // Try to find the node at this path
      // Use the graph's node resolution if available, otherwise walk manually
      let targetNode: Node | null = null;

      // Remove leading slash and split into segments
      const segments = path.replace(/^\//, '').split('/').filter(s => s);

      // Start from root and walk down
      let current: Node | null = null;
      for (const segment of segments) {
        // Find child with this ID at current level
        const searchIn: Node[] = current ? current.children() : graph.nodes.filter(n => !n.parent);
        const found: Node | undefined = searchIn.find(n => n.id === segment);
        if (found) {
          current = found;
        } else {
          // Path not found
          console.warn(`Path segment not found: ${segment}`);
          return;
        }
      }
      targetNode = current;

      // If found and it's a network, navigate into it
      if (targetNode && targetNode.isNetwork()) {
        currentNetwork = targetNode;
      } else if (targetNode) {
        // Navigate to its parent and select it
        currentNetwork = targetNode.parent;
        selectedNodes = [targetNode.id];
        selectedNode = targetNode;
        dispatch('nodeSelect', { node: targetNode });
        closePathInput();
        return;
      }
    }

    selectedNodes = [];
    selectedNode = null;
    dispatch('nodeSelect', { node: null });
    closePathInput();
  }

  function handlePathInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      navigateToPath(pathInputValue);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePathInput();
    }
  }

  // Get visible elements (only children of current network)
  // Works for both nodes and annotations since they're all Node instances
  function getVisibleElements<T extends Node>(allElements: T[], network: Node | null): T[] {
    if (!network) {
      // At root level, show elements without parent
      return allElements.filter(el => !el.parent);
    }
    // Inside a subnet, show elements that are children of this network
    return allElements.filter(el => el.parent === network);
  }

  $: visibleNodes = getVisibleElements(graph.nodes, currentNetwork);

  // Cached nodes center for zoom performance (avoid recalculating on every wheel event)
  let cachedNodesCenter: { x: number; y: number } | null = null;
  let nodesCenterCacheValid = false;

  // Invalidate cache when visible nodes or annotations change
  $: {
    visibleNodes;
    annotations;
    nodesCenterCacheValid = false;
  }

  // Get cached or compute nodes center
  function getCachedNodesCenter(): { x: number; y: number } | null {
    if (!nodesCenterCacheValid) {
      cachedNodesCenter = getNodesCenter();
      nodesCenterCacheValid = true;
    }
    return cachedNodesCenter;
  }

  /**
   * Add a child node to a parent network, using addChild() if available
   * This ensures SubnetNode.syncPorts() is called when Input/Output nodes are added
   */
  function addChildToNetwork(parent: Node, child: Node): void {
    graph.reparentElement(child, parent);
  }

  // Collapse selected nodes into a new subnet (Cmd+G)
  function collapseIntoSubnet() {
    if (selectedNodes.length === 0) return;

    recordHistory();

    // Get the nodes to collapse
    const nodesToCollapse = selectedNodes.map(id => graph.getNode(id)).filter(Boolean) as Node[];
    if (nodesToCollapse.length === 0) return;

    const nodeIdsToCollapse = new Set(nodesToCollapse.map(n => n.id));

    // Calculate bounding box to position the subnet
    const bounds = {
      minX: Math.min(...nodesToCollapse.map(n => n.position.x)),
      minY: Math.min(...nodesToCollapse.map(n => n.position.y)),
      maxX: Math.max(...nodesToCollapse.map(n => n.position.x)),
      maxY: Math.max(...nodesToCollapse.map(n => n.position.y))
    };

    // Find connections crossing the boundary
    const incomingConnections: { conn: any; targetNode: Node; targetPort: any }[] = [];
    const outgoingConnections: { conn: any; sourceNode: Node; sourcePort: any; targetNode: Node; targetPort: any }[] = [];

    graph.connections.forEach(conn => {
      const fromInside = nodeIdsToCollapse.has(conn.from.nodeId);
      const toInside = nodeIdsToCollapse.has(conn.to.nodeId);

      if (!fromInside && toInside) {
        // Incoming: external -> internal
        const targetNode = graph.getNode(conn.to.nodeId);
        const targetPort = targetNode?.inputs.find(p => p.id === conn.to.portId);
        if (targetNode && targetPort) {
          incomingConnections.push({ conn, targetNode, targetPort });
        }
      } else if (fromInside && !toInside) {
        // Outgoing: internal -> external
        const sourceNode = graph.getNode(conn.from.nodeId);
        const sourcePort = sourceNode?.outputs.find(p => p.id === conn.from.portId);
        const targetNode = graph.getNode(conn.to.nodeId);
        const targetPort = targetNode?.inputs.find(p => p.id === conn.to.portId);
        if (sourceNode && sourcePort && targetNode && targetPort) {
          outgoingConnections.push({ conn, sourceNode, sourcePort, targetNode, targetPort });
        }
      }
    });

    // Create a new subnet at the center of selected nodes
    const subnet = graph.addNode('Subnet', {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2
    });

    // Set parent to current network if we're inside one
    if (currentNetwork) {
      addChildToNetwork(currentNetwork, subnet);
    }

    // Move nodes into the subnet (set parent, adjust positions)
    nodesToCollapse.forEach(node => {
      // Adjust position relative to subnet center
      node.position = {
        x: node.position.x - subnet.position.x,
        y: node.position.y - subnet.position.y
      };
      addChildToNetwork(subnet, node);
    });

    // Handle incoming connections: create Input nodes
    const inputNodeMap = new Map<string, Node>(); // sourcePortId -> Input node
    incomingConnections.forEach((incoming, index) => {
      // Create an Input node inside the subnet
      const inputNode = graph.addNode('Input', {
        x: bounds.minX - subnet.position.x - 150,
        y: bounds.minY - subnet.position.y + (index * 80)
      });
      addChildToNetwork(subnet, inputNode);

      // Set input index
      if (inputNode.props.inputIndex) {
        inputNode.updateProp('inputIndex', index);
      }

      // Remove the old connection
      graph.disconnect(incoming.conn.id);

      // Connect Input node's output to the original target inside subnet
      const inputNodeOutput = inputNode.outputs[0];
      if (inputNodeOutput && incoming.targetPort) {
        graph.connect(inputNodeOutput, incoming.targetPort);
      }

      inputNodeMap.set(incoming.conn.from.portId, inputNode);
    });

    // Add input ports to subnet for each incoming connection
    // and wire external sources to subnet inputs
    if (incomingConnections.length > 0) {
      // For now, use the first incoming connection for the subnet's default input
      // More sophisticated handling would add multiple input ports
      const firstIncoming = incomingConnections[0];
      const externalSourceNode = graph.getNode(firstIncoming.conn.from.nodeId);
      const externalSourcePort = externalSourceNode?.outputs.find(p => p.id === firstIncoming.conn.from.portId);

      if (externalSourcePort && subnet.inputs[0]) {
        graph.connect(externalSourcePort, subnet.inputs[0]);
      }
    }

    // Handle outgoing connections: use the output node of the subnet
    // Find or set the cooking node
    let outputSourceNode: Node | null = null;
    if (outgoingConnections.length > 0) {
      // Use the source of the first outgoing connection as the output
      outputSourceNode = outgoingConnections[0].sourceNode;
      outputSourceNode.setCook(true);
    } else if (nodesToCollapse.length > 0) {
      // No outgoing - set the last node as cooking
      const lastNode = nodesToCollapse[nodesToCollapse.length - 1];
      lastNode.setCook(true);
      outputSourceNode = lastNode;
    }

    // Rewire outgoing connections: from subnet's output to external targets
    outgoingConnections.forEach(outgoing => {
      // Remove old connection
      graph.disconnect(outgoing.conn.id);

      // Connect subnet's output to external target
      const subnetOutput = subnet.outputs[0];
      if (subnetOutput && outgoing.targetPort) {
        graph.connect(subnetOutput, outgoing.targetPort);
      }
    });

    studioGraph.refresh({ nodes: true, connections: true });

    // Select the new subnet
    selectedNodes = [subnet.id];
    selectedNode = subnet;
    dispatch('nodeSelect', { node: subnet });
  }

  // Extract subnet contents and delete the subnet (inverse of collapseIntoSubnet)
  function extractAndDelete() {
    if (selectedNodes.length !== 1) return;

    const subnetNode = graph.getNode(selectedNodes[0]);
    if (!subnetNode || !subnetNode.isNetwork()) return;
    if (subnetNode.children().length === 0) return;

    recordHistory();

    const children = [...subnetNode.children()];
    const subnetParent = subnetNode.parent;

    // Find Input and Output nodes (we'll delete these, not extract them)
    const inputNodes = children.filter(n => n.type === 'Input');
    const outputNodes = children.filter(n => n.type === 'Output');
    const regularNodes = children.filter(n => n.type !== 'Input' && n.type !== 'Output');

    if (regularNodes.length === 0) return;

    // Find connections to the subnet from outside (these feed Input nodes)
    const subnetInputConnections: { conn: any; inputIndex: number }[] = [];
    graph.connections.forEach(conn => {
      if (conn.to.nodeId === subnetNode.id) {
        // Find which input port index
        const portIndex = subnetNode.inputs.findIndex(p => p.id === conn.to.portId);
        if (portIndex !== -1) {
          subnetInputConnections.push({ conn, inputIndex: portIndex });
        }
      }
    });

    // Find connections from the subnet to outside (these come from Output/cooking node)
    const subnetOutputConnections: { conn: any; outputIndex: number }[] = [];
    graph.connections.forEach(conn => {
      if (conn.from.nodeId === subnetNode.id) {
        const portIndex = subnetNode.outputs.findIndex(p => p.id === conn.from.portId);
        if (portIndex !== -1) {
          subnetOutputConnections.push({ conn, outputIndex: portIndex });
        }
      }
    });

    // Build mapping: inputIndex -> what Input nodes connect to inside
    const inputToInternalTarget = new Map<number, { node: Node; port: any }[]>();
    inputNodes.forEach(inputNode => {
      const inputIndex = inputNode.evalParm('inputIndex') ?? 0;
      // Find what the Input node's output connects to
      const targets: { node: Node; port: any }[] = [];
      graph.connections.forEach(conn => {
        if (conn.from.nodeId === inputNode.id) {
          const targetNode = graph.getNode(conn.to.nodeId);
          const targetPort = targetNode?.inputs.find(p => p.id === conn.to.portId);
          if (targetNode && targetPort) {
            targets.push({ node: targetNode, port: targetPort });
          }
        }
      });
      if (!inputToInternalTarget.has(inputIndex)) {
        inputToInternalTarget.set(inputIndex, []);
      }
      inputToInternalTarget.get(inputIndex)!.push(...targets);
    });

    // Find the output source node (cooking node or Output node's input)
    let outputSourceNode: Node | null = null;
    let outputSourcePort: any = null;

    const cookingNode = subnetNode.children().find(n => n.cook);
    const outputNode = outputNodes[0];

    if (outputNode) {
      // Output node - find what connects to its input
      graph.connections.forEach(conn => {
        if (conn.to.nodeId === outputNode.id) {
          const sourceNode = graph.getNode(conn.from.nodeId);
          const sourcePort = sourceNode?.outputs.find(p => p.id === conn.from.portId);
          if (sourceNode && sourcePort) {
            outputSourceNode = sourceNode;
            outputSourcePort = sourcePort;
          }
        }
      });
    } else if (cookingNode) {
      outputSourceNode = cookingNode;
      outputSourcePort = cookingNode.outputs[0];
    }

    // Move regular nodes out of the subnet to its parent
    regularNodes.forEach(node => {
      // Adjust position back to world coordinates
      node.position = {
        x: node.position.x + subnetNode.position.x,
        y: node.position.y + subnetNode.position.y
      };

      graph.reparentElement(node, subnetParent);
    });

    // Delete Input/Output nodes and their connections
    [...inputNodes, ...outputNodes].forEach(node => {
      // Remove connections involving this node
      const connectionsToRemove = graph.connections.filter(
        conn => conn.from.nodeId === node.id || conn.to.nodeId === node.id
      );
      connectionsToRemove.forEach(conn => graph.disconnect(conn.id));

      // Remove from graph
      graph.removeNode(node.id);
    });

    // Rewire external inputs to internal nodes
    subnetInputConnections.forEach(({ conn, inputIndex }) => {
      const targets = inputToInternalTarget.get(inputIndex) || [];
      const sourceNode = graph.getNode(conn.from.nodeId);
      const sourcePort = sourceNode?.outputs.find(p => p.id === conn.from.portId);

      // Remove old connection to subnet
      graph.disconnect(conn.id);

      // Connect to each internal target
      if (sourcePort) {
        targets.forEach(({ port }) => {
          graph.connect(sourcePort, port);
        });
      }
    });

    // Rewire subnet output to extracted nodes' output
    subnetOutputConnections.forEach(({ conn }) => {
      const targetNode = graph.getNode(conn.to.nodeId);
      const targetPort = targetNode?.inputs.find(p => p.id === conn.to.portId);

      // Remove old connection from subnet
      graph.disconnect(conn.id);

      // Connect from the output source node
      if (outputSourcePort && targetPort) {
        graph.connect(outputSourcePort, targetPort);
      }
    });

    // Remove any remaining connections to/from the subnet
    const remainingConns = graph.connections.filter(
      conn => conn.from.nodeId === subnetNode.id || conn.to.nodeId === subnetNode.id
    );
    remainingConns.forEach(conn => graph.disconnect(conn.id));

    // Delete the subnet
    graph.removeNode(subnetNode.id);

    studioGraph.refresh({ nodes: true, connections: true });

    // Select the extracted nodes
    selectedNodes = regularNodes.map(n => n.id);
    selectedNode = regularNodes[0] ?? null;
    dispatch('nodeSelect', { node: selectedNode });
  }
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
  let draggingFromConnectedPort: { nodeId: string; portId: string; portType: 'input' | 'output'; connectionIds: string[] } | null = null;
  
  // Connection hover state for scissors icon
  let hoveredConnection: { connectionId: string; position: { x: number; y: number } } | null = null;
  let ctrlPressed = false;
  let ctrlClickConnection: string | null = null;
  
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
  
  /*
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
    const blurNode = graph.addNode('Blur', { x: 200, y: 750 });
    const normalMapNode = graph.addNode('NormalMap', { x: 400, y: 950 });
    // Only set cook flag on Composite node
    compositeNode.setCook(true);
    
    // Add default annotations
    const headlineAnnotation: any = {
      id: `headline_${Date.now().toString(36)}`,
      type: 'Text',
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
      id: `copy_${Date.now().toString(36)}`,
      type: 'Text',
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
const intervalId = setInterval(() => {
  time.setValue(frame++);
  tick.trigger({ frame });
}, 1000 / 60);

// Cleanup interval when node is destroyed
node.onDestroy = () => clearInterval(intervalId);
      `;
      
      colorNode.code = `// Color node - creates a solid color canvas
node.defineProp('color', {
  value: '#87CEEB',
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
        blurNode.inputs = [...blurNode.inputs];
        blurNode.outputs = [...blurNode.outputs];
        normalMapNode.inputs = [...normalMapNode.inputs];
        normalMapNode.outputs = [...normalMapNode.outputs];
        
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
        
        // Connect Composite output to Blur input
        const compositeImagePort = compositeNode.outputs.find(p => p.name === 'image');
        const blurImagePort = blurNode.inputs.find(p => p.name === 'image');
        
        if (compositeImagePort && blurImagePort) {
          graph.connect(compositeImagePort, blurImagePort);
        }
        
        // Connect Blur output to NormalMap input
        const blurOutputPort = blurNode.outputs.find(p => p.name === 'image');
        const normalMapImagePort = normalMapNode.inputs.find(p => p.name === 'image');
        
        if (blurOutputPort && normalMapImagePort) {
          graph.connect(blurOutputPort, normalMapImagePort);
        }
        
        studioGraph.refresh({ connections: true });
        
        // Execute Composite node and its upstream dependencies to ensure outputs are ready
        await graph.execute(compositeNode);
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
*/


  // Graph will be loaded from default.cascade file in App.svelte onMount

  // Reactive statement to show only nodes in current network level
  // At root: show nodes without parent; Inside subnet: show subnet's children
  $: nodes = (() => {
    void cookRevision;
    return visibleNodes;
  })();
  
  // Force reactivity when node ports change
  // Guard against undefined nodes/ports during reactive updates
  $: nodePorts = nodes
    .filter(n => n && n.inputs && n.outputs)
    .map(n => ({
      id: n.id,
      inputs: n.inputs.length,
      outputs: n.outputs.length
    }));

  // Track node positions to force connection re-renders when nodes move
  /**
   * Node positions, which the connection paths are derived from.
   *
   * `$graphStructure` is referenced deliberately. `nodes` is an array of the
   * same objects whose `.position` is MUTATED in place — by a layout pass, or
   * by a node's own code — and Svelte cannot see a mutation. So after an
   * auto-layout the nodes moved and the wires kept their old geometry until a
   * pan happened to force a recompute, which is exactly the stale-wire symptom.
   */
  function positionsAfterStructureChange(version: number, currentNodes: typeof nodes) {
    void version;
    return currentNodes
    .filter(n => n && n.position)
    .map(n => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y
    }));
  }

  $: nodePositions = positionsAfterStructureChange($graphStructure, nodes);
  
  // Track annotation positions to force connection re-renders when annotations move or load
  // Create independent objects to prevent any reference sharing issues
  // $: annotationPositions = graph.annotations.map(ann => ({
  //   id: ann.id,
  //   // x: ann.position.x, // Read value, not reference
  //   // y: ann.position.y, // Read value, not reference
  //   // width: ann.size?.width || (ann.type === 'text' ? 540 : ann.type === 'image' ? 200 : 300),
  //   // height: ann.size?.height || (ann.type === 'text' ? 60 : ann.type === 'image' ? 150 : 200),
  //   hasOutputs: ann.outputs && ann.outputs.length > 0
  // }));
  
  // Declare connections variable
  let connections: Connection[] = [];

  /**
   * Wires sit at half brightness until they concern the selected node.
   *
   * Marcus's own reading of a full graph: the wires were brighter than the
   * nodes, so the picture read as a tangle of colour with the boxes behind it.
   * Halving them puts the nodes in front, and lifting only the selected node's
   * own wires back to full turns selection into the answer to "what goes in
   * and what comes out" — which is the question you actually select a node to
   * ask.
   *
   * A hovered wire lifts too, so the ctrl-to-cut affordance still finds you.
   */
  const DIMMED_WIRE_OPACITY = 0.5;

  function isConnectionHighlighted(
    conn: Connection,
    selection: string[],
    hoveredId: string | undefined
  ): boolean {
    if (conn.id === hoveredId) return true;
    if (selection.length === 0) return false;
    return selection.includes(conn.from.nodeId) || selection.includes(conn.to.nodeId);
  }

  function isConnectionProcessing(conn: Connection): boolean {
    const target = graph.getNode(conn.to.nodeId);
    return target?.cookState === 'queued' || target?.cookState === 'cooking';
  }

  // Dimmed first, highlighted last — see the each block below.
  $: orderedConnections = [
    ...connections.filter(c => !isConnectionHighlighted(c, selectedNodes, hoveredConnection?.connectionId)),
    ...connections.filter(c => isConnectionHighlighted(c, selectedNodes, hoveredConnection?.connectionId)),
  ];
  
  // Filter connections to only show those between visible nodes
  // Also filter out duplicates and depend on nodePositions/nodePorts for reactivity
  $: {
    cookRevision;
    // Reference nodePositions, nodePorts, annotations to make connections reactive to changes
    nodePositions;
    nodePorts;
    annotations;
    // Get IDs of visible nodes AND annotations for filtering connections
    const visibleNodeIds = new Set(nodes.map(n => n.id));
    const visibleAnnotationIds = new Set(annotations.map(a => a.id));
    const visibleElementIds = new Set([...visibleNodeIds, ...visibleAnnotationIds]);
    connections = graph.connections.filter((conn, index, self) =>
      // Remove duplicates
      self.findIndex(c => c.id === conn.id) === index &&
      // Only show connections between visible elements (nodes or annotations)
      visibleElementIds.has(conn.from.nodeId) && visibleElementIds.has(conn.to.nodeId)
    );
  }

  // Filter annotations to only show those in current network level (uses same logic as nodes)
  $: annotations = getVisibleElements(graph.annotations, currentNetwork);
  
  function handleMouseDown(e: MouseEvent) {
    if (!canvas) return;
    
    // Handle Ctrl+Click on connections early to prevent default behavior
    if (e.button === 0 && (e.ctrlKey || e.metaKey) && !(e.target as HTMLElement).closest('.node, .annotation')) {
      const rect = canvas.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
      const mouseY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;
      
      const hovered = findConnectionAtPoint(mouseX, mouseY);
      if (hovered) {
        e.preventDefault();
        e.stopPropagation();
        // Store the connection to disconnect on mouseup
        ctrlClickConnection = hovered.id;
        return;
      }
    }
    
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
      
      const id = `line_${Date.now().toString(36)}`;
      const annotation: any = {
        id,
        type: 'Line',
        position: { x, y },
        endPosition: { x, y },
        style: {
          strokeWidth: 2,
          strokeColor: '#ffffff'
        }
      };
      recordHistory();
      graph.addAnnotation(annotation);
      // Set parent after annotation is added
      if (currentNetwork) {
        const addedAnnotation = graph.getAnnotation(id);
        if (addedAnnotation) {
          addChildToNetwork(currentNetwork, addedAnnotation);
        }
      }
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
      
      const id = `polyline_${Date.now().toString(36)}`;
      const annotation: any = {
        id,
        type: 'Polyline',
        position: { x, y },
        points: [{ x, y }],
        style: {
          strokeWidth: 2,
          strokeColor: '#ffffff'
        }
      };
      recordHistory();
      graph.addAnnotation(annotation);
      // Set parent after annotation is added
      if (currentNetwork) {
        const addedAnnotation = graph.getAnnotation(id);
        if (addedAnnotation) {
          addChildToNetwork(currentNetwork, addedAnnotation);
        }
      }
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
          
          // Move all selected annotations - create new objects instead of mutating
          graph.annotations = graph.annotations.map(ann => {
            const draggedData = draggingMultiple?.annotations.find(a => a.annotationId === ann.id);
            if (!draggedData) {
              // Not being dragged, return unchanged
              return ann;
            }

            // Create new position object for this annotation
            const newX = draggedData.startPos.x + deltaX;
            const newY = draggedData.startPos.y + deltaY;

            return {
              ...ann,
              position: { x: newX, y: newY },
              style: ann.style ? { ...ann.style } : undefined,
              outputs: ann.outputs ? ann.outputs.map(port => ({ ...port })) : undefined
            } as CanvasAnnotation;
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
            // Don't mutate - create new object in map
            graph.annotations = graph.annotations.map((ann): CanvasAnnotation => {
              if (ann.id !== annotation.id) {
                return ann;
              }
              const oldX = ann.position.x;
              const oldY = ann.position.y;
              const deltaX = newX - oldX;
              const deltaY = newY - oldY;

              if (ann.type === 'Line') {
                return {
                  ...ann,
                  position: { x: newX, y: newY },
                  endPosition: ann.endPosition ? {
                    x: ann.endPosition.x + deltaX,
                    y: ann.endPosition.y + deltaY
                  } : undefined
                } as CanvasAnnotation;
              } else if (ann.type === 'Polyline') {
                return {
                  ...ann,
                  position: { x: newX, y: newY },
                  points: ann.points ? ann.points.map(p => ({
                    x: p.x + deltaX,
                    y: p.y + deltaY
                  })) : undefined
                } as CanvasAnnotation;
              } else {
                return {
                  ...ann,
                  position: { x: newX, y: newY }
                } as CanvasAnnotation;
              }
            });
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
          
          // Move all selected annotations - create new objects instead of mutating
          graph.annotations = graph.annotations.map((ann): CanvasAnnotation => {
            const draggedData = draggingMultiple?.annotations.find(a => a.annotationId === ann.id);
            if (!draggedData) {
              // Not being dragged, return unchanged
              return ann;
            }

            // Create new position object for this annotation
            const newX = draggedData.startPos.x + deltaX;
            const newY = draggedData.startPos.y + deltaY;
            const oldX = ann.position.x;
            const oldY = ann.position.y;
            const annotationDeltaX = newX - oldX;
            const annotationDeltaY = newY - oldY;

            // Handle line and polyline annotations specially
            if (ann.type === 'Line') {
              return {
                ...ann,
                position: { x: newX, y: newY },
                endPosition: ann.endPosition ? {
                  x: ann.endPosition.x + annotationDeltaX,
                  y: ann.endPosition.y + annotationDeltaY
                } : undefined
              } as CanvasAnnotation;
            } else if (ann.type === 'Polyline') {
              return {
                ...ann,
                position: { x: newX, y: newY },
                points: ann.points ? ann.points.map(p => ({
                  x: p.x + annotationDeltaX,
                  y: p.y + annotationDeltaY
                })) : undefined
              } as CanvasAnnotation;
            } else {
              return {
                ...ann,
                position: { x: newX, y: newY }
              } as CanvasAnnotation;
            }
          });
          
          // Force reactivity after multi-drag update
          graph.nodes = [...graph.nodes];
          return;
        } else {
          // Single annotation drag - don't mutate, create new object in map below
        }
        
        // Create new annotation object directly without mutating the original
        // This ensures other annotations are completely unaffected
        // Use the annotation from the array, not the one we retrieved (which might be stale)
        graph.annotations = graph.annotations.map((ann): CanvasAnnotation => {
          if (ann.id !== annotation.id) {
            // Return the exact same object reference for unchanged annotations
            return ann;
          }

          // Create new object for the annotation being dragged
          // Use ann (from array) not annotation (which might be stale)
          const oldX = ann.position.x;
          const oldY = ann.position.y;
          const deltaX = newX - oldX;
          const deltaY = newY - oldY;

          if (ann.type === 'Line') {
            return {
              ...ann,
              position: { x: newX, y: newY },
              endPosition: ann.endPosition ? {
                x: ann.endPosition.x + deltaX,
                y: ann.endPosition.y + deltaY
              } : undefined,
              style: ann.style ? { ...ann.style } : undefined,
              outputs: ann.outputs ? ann.outputs.map(port => ({ ...port })) : undefined
            } as CanvasAnnotation;
          } else if (ann.type === 'Polyline') {
            return {
              ...ann,
              position: { x: newX, y: newY },
              points: ann.points ? ann.points.map(p => ({
                x: p.x + deltaX,
                y: p.y + deltaY
              })) : undefined,
              style: ann.style ? { ...ann.style } : undefined,
              outputs: ann.outputs ? ann.outputs.map(port => ({ ...port })) : undefined
            } as CanvasAnnotation;
          } else {
            return {
              ...ann,
              position: { x: newX, y: newY },
              style: ann.style ? { ...ann.style } : undefined,
              outputs: ann.outputs ? ann.outputs.map(port => ({ ...port })) : undefined
            } as CanvasAnnotation;
          }
        });
        graph.nodes = [...graph.nodes];
      }
    }
    
    // Handle annotation resizing
    if (resizingAnnotation) {
      const resizing = resizingAnnotation; // Capture for type narrowing
      const annotation = graph.getAnnotation(resizing.annotationId);
      if (annotation) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
        const mouseY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;
        
        const deltaX = mouseX - resizing.startPos.x;
        const deltaY = mouseY - resizing.startPos.y;
        
        let newWidth = resizing.startSize.width;
        let newHeight = resizing.startSize.height;
        let newX = resizing.startPosition.x;
        let newY = resizing.startPosition.y;
        
        const handle = resizing.handle;
        
        // Handle horizontal resizing
        if (handle.includes('e')) {
          newWidth = Math.max(100, resizing.startSize.width + deltaX);
        } else if (handle.includes('w')) {
          newWidth = Math.max(100, resizing.startSize.width - deltaX);
          newX = resizing.startPosition.x + (resizing.startSize.width - newWidth);
        }
        
        // Handle vertical resizing
        if (handle.includes('s')) {
          newHeight = Math.max(40, resizing.startSize.height + deltaY);
        } else if (handle.includes('n')) {
          newHeight = Math.max(40, resizing.startSize.height - deltaY);
          newY = resizing.startPosition.y + (resizing.startSize.height - newHeight);
        }
        
        // Create new annotation object directly without mutating the original
        // This ensures other annotations are completely unaffected
        // Use the annotation from the array, not the one we retrieved (which might be stale)
        graph.annotations = graph.annotations.map(ann => {
          if (ann.id !== resizing.annotationId) {
            // Return the exact same object reference for unchanged annotations
            return ann;
          }
          // Create a completely new object for the resized annotation
          // Explicitly copy all properties to avoid any shared references
          return {
            ...ann,
            position: { x: newX, y: newY },
            size: { width: newWidth, height: newHeight },
            style: ann.style ? { ...ann.style } : undefined,
            outputs: ann.outputs ? ann.outputs.map(port => ({ ...port })) : ann.outputs,
            points: ann.points ? ann.points.map(p => ({ ...p })) : undefined,
            endPosition: ann.endPosition ? { ...ann.endPosition } : undefined
          } as CanvasAnnotation;
        });
      }
    }
    
    // Handle line drawing
    if (drawingLine) {
      const drawing = drawingLine; // Capture for type narrowing
      const annotation = graph.getAnnotation(drawing.annotationId);
      if (annotation) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
        const mouseY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;
        
        // Create new annotation object instead of mutating
        graph.annotations = graph.annotations.map((ann): CanvasAnnotation =>
          ann.id === drawing.annotationId
            ? { ...ann, endPosition: { x: mouseX, y: mouseY } } as CanvasAnnotation
            : ann
        );
      }
    }
    
    // Handle polyline drawing
    if (drawingPolyline) {
      const drawing = drawingPolyline; // Capture for type narrowing
      const annotation = graph.getAnnotation(drawing.annotationId);
      if (annotation) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
        const mouseY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;
        
        // Add point if mouse moved significantly (smoothing)
        const lastPoint = drawing.points[drawing.points.length - 1];
        const distance = Math.sqrt(
          Math.pow(mouseX - lastPoint.x, 2) + Math.pow(mouseY - lastPoint.y, 2)
        );
        
        if (distance > 3) { // Only add point if moved more than 3px
          drawing.points.push({ x: mouseX, y: mouseY });
          // Create new annotation object instead of mutating
          graph.annotations = graph.annotations.map((ann): CanvasAnnotation =>
            ann.id === drawing.annotationId
              ? { ...ann, points: [...drawing.points] } as CanvasAnnotation
              : ann
          );
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
    
    // Check for connection hover (for scissors icon)
    if (!connectingFrom && !draggingNode && !draggingAnnotation && !isSelecting) {
      const rect = canvas.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
      const mouseY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;
      
      // Check Ctrl key state from event (more reliable than tracking)
      const isCtrlPressed = e.ctrlKey || e.metaKey;
      
      // Check if mouse is over any connection
      const hovered = findConnectionAtPoint(mouseX, mouseY);
      if (hovered && isCtrlPressed) {
        hoveredConnection = {
          connectionId: hovered.id,
          position: { x: mouseX, y: mouseY }
        };
      } else {
        hoveredConnection = null;
      }
    } else {
      hoveredConnection = null;
    }
  }
  
  // Helper function to find connection at a point (hit testing)
  function findConnectionAtPoint(x: number, y: number): Connection | null {
    const hitThreshold = 8 / internalTransform.zoom; // 8 pixels tolerance, adjusted for zoom
    
    for (const conn of connections) {
      const fromPos = getPortPosition(conn.from.nodeId, conn.from.portId, 'output');
      const toPos = getPortPosition(conn.to.nodeId, conn.to.portId, 'input');
      
      if (!fromPos || !toPos) continue;
      
      // Check if point is near the bezier curve
      // The curve is: M fromPos C fromPos.x, fromPos.y + curveOffset, toPos.x, toPos.y - curveOffset, toPos.x, toPos.y
      const curveOffset = Math.abs(toPos.y - fromPos.y) * 0.5;
      
      // Sample points along the curve to check distance
      for (let t = 0; t <= 1; t += 0.05) {
        const p1x = fromPos.x;
        const p1y = fromPos.y;
        const p2x = fromPos.x;
        const p2y = fromPos.y + curveOffset;
        const p3x = toPos.x;
        const p3y = toPos.y - curveOffset;
        const p4x = toPos.x;
        const p4y = toPos.y;
        
        // Bezier curve point at t
        const mt = 1 - t;
        const pointX = mt * mt * mt * p1x + 3 * mt * mt * t * p2x + 3 * mt * t * t * p3x + t * t * t * p4x;
        const pointY = mt * mt * mt * p1y + 3 * mt * mt * t * p2y + 3 * mt * t * t * p3y + t * t * t * p4y;
        
        const distance = Math.sqrt(Math.pow(x - pointX, 2) + Math.pow(y - pointY, 2));
        if (distance < hitThreshold) {
          return conn;
        }
      }
    }
    
    return null;
  }
  
  function handleMouseUp(e: MouseEvent) {
    if (e.button === 1) {
      isPanning = false;
      e.preventDefault();
    } else {
      isPanning = false;
    }
    
    // Complete or cancel connection on mouseup
    if (connectingFrom && e.button === 0) {
      // Check if we're over a port element
      const target = e.target as HTMLElement;
      const portElement = target.closest('.port');
      
      if (portElement) {
        // Extract port information from data attributes
        const toNodeId = portElement.getAttribute('data-node-id');
        let toPortId = portElement.getAttribute('data-port-id');
        const toPortType = portElement.getAttribute('data-port-type') as 'input' | 'output' | null;
        const variadicBase = portElement.getAttribute('data-variadic-base');

        if (toNodeId && toPortId && toPortType) {
          const from = connectingFrom;

          // Only allow output -> input connections
          if (from.portType === 'output' && toPortType === 'input' && from.nodeId !== toNodeId) {
            // Unified connection handling - works for any element type
            const fromElement = graph.getElement(from.nodeId);
            const toElement = graph.getElement(toNodeId);

            if (fromElement && toElement) {
              // Find ports by ID
              const fromPort = fromElement.outputs.find(p => p.id === from.portId);

              // For variadic ports, find the first available (unconnected) port in the group
              let toPort;
              if (variadicBase) {
                // Find first unconnected variadic port, or create one if all are connected
                const variadicPorts = toElement.inputs.filter(
                  (p: any) => p.variadic && p.name.startsWith(`${variadicBase}_`) && !p.options?.hidden
                );
                toPort = variadicPorts.find((p: any) => p.connections.length === 0);

                // If all ports are connected, sync to create a new one
                if (!toPort && toElement.syncVariadicPorts) {
                  toElement.syncVariadicPorts();
                  const updatedPorts = toElement.inputs.filter(
                    (p: any) => p.variadic && p.name.startsWith(`${variadicBase}_`) && !p.options?.hidden
                  );
                  toPort = updatedPorts.find((p: any) => p.connections.length === 0);
                }

                // Fallback to the first port if somehow no empty port found
                if (!toPort) {
                  toPort = toElement.inputs.find((p: any) => p.id === toPortId);
                }
              } else {
                toPort = toElement.inputs.find((p: any) => p.id === toPortId);
              }

              if (fromPort && toPort) {
                try {
                  recordHistory();

                  // Check if connecting to a variadic port and there are multiple selected elements
                  const isVariadicTarget = toPort.variadic === true;
                  const otherSelectedElements: Array<{ element: any; output: any }> = [];

                  if (isVariadicTarget) {
                    // Get the target element's ID
                    const targetId = toElement.id;

                    // Collect other selected nodes (excluding the one being connected from AND the target)
                    selectedNodes.forEach(nodeId => {
                      if (nodeId !== from.nodeId && nodeId !== targetId) {
                        const node = graph.getNode(nodeId);
                        if (node && node.outputs.length > 0) {
                          otherSelectedElements.push({ element: node, output: node.outputs[0] });
                        }
                      }
                    });

                    // Collect selected annotations with outputs (excluding source and target)
                    selectedAnnotations.forEach(annId => {
                      if (annId !== from.nodeId && annId !== targetId) {
                        const ann = graph.getAnnotation(annId);
                        if (ann && ann.outputs && ann.outputs.length > 0) {
                          otherSelectedElements.push({ element: ann, output: ann.outputs[0] });
                        }
                      }
                    });
                  }

                  // Check if connecting INTO a subnet - auto-create Input node
                  if (toElement.isNetwork && toElement.isNetwork()) {
                    // Create an Input node inside the subnet
                    const inputNode = graph.addNode('Input', {
                      x: -200,
                      y: (toElement.children().length - toElement.children().filter((n: Node) => n.type === 'Input').length) * 80
                    });
                    inputNode.id = graph.generateUniqueNodeId('input');
                    addChildToNetwork(toElement, inputNode);

                    // Set the input index based on existing Input nodes
                    const existingInputNodes = toElement.children().filter((n: Node) => n.type === 'Input');
                    const inputIndex = existingInputNodes.length - 1; // -1 because we just added it
                    if (inputNode.props.inputIndex) {
                      inputNode.updateProp('inputIndex', inputIndex);
                    }

                    // Connect external source to subnet's input
                    graph.connect(fromPort, toPort);

                    // Update graph reactivity
                    graph.nodes = [...graph.nodes];
                  }
                  // Check if connecting FROM a subnet - use its output
                  else if (fromElement.isNetwork && fromElement.isNetwork()) {
                    // Just make the connection - subnet's output is handled by SubnetNode.update()
                    graph.connect(fromPort, toPort);
                  }
                  else {
                    // Make the primary connection
                    graph.connect(fromPort, toPort);
                  }

                  // If there are other selected elements and target is variadic, connect them too
                  if (isVariadicTarget && otherSelectedElements.length > 0) {
                    // Extract variadic base name from port name (e.g., "image_0" -> "image")
                    const portNameMatch = toPort.name.match(/^(.+)_(\d+)$/);
                    if (portNameMatch && toElement.syncVariadicPorts) {
                      const baseName = portNameMatch[1];
                      let currentIndex = parseInt(portNameMatch[2], 10) + 1;

                      for (const { output } of otherSelectedElements) {
                        // Sync variadic ports to ensure enough exist
                        toElement.syncVariadicPorts();

                        // Find or create the next variadic port
                        const nextPortName = `${baseName}_${currentIndex}`;
                        let nextPort = toElement.inputs.find((p: any) => p.name === nextPortName && !p.options?.hidden);

                        if (!nextPort) {
                          // Sync again and try to find it
                          toElement.syncVariadicPorts();
                          nextPort = toElement.inputs.find((p: any) => p.name === nextPortName && !p.options?.hidden);
                        }

                        if (nextPort) {
                          try {
                            graph.connect(output, nextPort);
                            currentIndex++;
                          } catch (err) {
                            console.warn('Failed to connect additional element:', err);
                          }
                        }
                      }
                    }
                  }

                  studioGraph.refresh({ connections: true });
                } catch (err) {
                  console.error('Failed to connect:', err);
                }
              }
            }
          }
        }
        
        // Reset connection state
        connectingFrom = null;
        connectingPosition = null;
        draggingFromConnectedPort = null;
      } else {
        // Not over a port - if dragging from connected port, disconnect it
        if (draggingFromConnectedPort) {
          recordHistory();
          studioGraph.disconnectMany(draggingFromConnectedPort.connectionIds);
          draggingFromConnectedPort = null;
        }
        // Cancel connection
        connectingFrom = null;
        connectingPosition = null;
      }
    }
    
    // Stop dragging
    draggingNode = null;
    draggingAnnotation = null;
    draggingMultiple = null;
    resizingAnnotation = null;
    
    // Don't clear ctrlClickConnection here - let the click handler process it
    // It will be cleared in handleCanvasClick after disconnection
    
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
        
        if (annotation.type === 'Line') {
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
        } else if (annotation.type === 'Polyline') {
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
          const width = annotation.size?.width || (annotation.type === 'Text' ? 540 : annotation.type === 'Image' ? 200 : 300);
          const height = annotation.size?.height || (annotation.type === 'Text' ? 60 : annotation.type === 'Image' ? 150 : 200);
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
      
      // Create independent copies of size and position to prevent any reference sharing
      const currentSize = annotation.size || { width: 200, height: 150 };
      const currentPosition = annotation.position;
      resizingAnnotation = {
        annotationId,
        handle,
        startPos: { x: mouseX, y: mouseY },
        startSize: { width: currentSize.width, height: currentSize.height },
        startPosition: { x: currentPosition.x, y: currentPosition.y }
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
  
  async function handleNodeMouseDown(nodeId: string, e: MouseEvent) {
    // Don't start drag if clicking on a port or if middle mouse button
    if ((e.target as HTMLElement).closest('.port') || e.button === 1) {
      return;
    }

    const node = graph.getNode(nodeId);
    if (!node) return;

    // Record history before starting drag
    recordHistory();

    const rect = canvas.getBoundingClientRect();

    // Calculate offset from mouse click position to node's top-left corner
    const mouseX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
    const mouseY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;

    // Alt-drag: duplicate selected nodes and drag the copies
    if (e.altKey) {
      // Ensure the clicked node is in selection
      let nodesToDuplicate = [...selectedNodes];
      let annotationsToDuplicate = [...selectedAnnotations];

      if (!nodesToDuplicate.includes(nodeId)) {
        nodesToDuplicate = [nodeId];
        annotationsToDuplicate = [];
      }

      // Duplicate nodes
      const nodeIdMap = new Map<string, string>();
      const newNodeIds: string[] = [];
      const newAnnotationIds: string[] = [];

      // Create duplicate nodes
      for (const oldNodeId of nodesToDuplicate) {
        const sourceNode = graph.getNode(oldNodeId);
        if (!sourceNode) continue;

        // Get the module path for proper node creation
        const modulePath = (sourceNode as any).modulePath || sourceNode.type;
        const newNode = graph.addNode(modulePath, { ...sourceNode.position });

        // Generate unique ID (exclude oldId from uniqueness check since addNode created a temp ID)
        const oldId = newNode.id;
        const newId = graph.generateUniqueNodeId(sourceNode.id, oldId);
        nodeIdMap.set(oldNodeId, newId);
        studioGraph.renameElement(oldId, newId);

        // Copy properties
        newNode.code = sourceNode.code || '';
        newNode.comment = sourceNode.comment || '';
        newNode.bypass = sourceNode.bypass || false;

        // Set parent to current network level
        if (currentNetwork) {
          graph.reparentElement(newNode, currentNetwork);
        }

        newNodeIds.push(newId);

        // Execute the node to initialize ports
        if (newNode.code) {
          try {
            await graph.execute(newNode);
          } catch (err) {
            console.warn('Failed to execute duplicated node:', err);
          }
        }
      }

      // Restore props after execution
      for (let i = 0; i < nodesToDuplicate.length; i++) {
        const oldNodeId = nodesToDuplicate[i];
        const newNodeId = newNodeIds[i];
        const sourceNode = graph.getNode(oldNodeId);
        const newNode = graph.getNode(newNodeId);

        if (sourceNode && newNode && Object.keys(sourceNode.props).length > 0) {
          Object.entries(sourceNode.props).forEach(([key, prop]) => {
            if (newNode.props[key]) {
              newNode.props[key].value = prop.value;
              if (prop.expression) {
                // Remap node ID references in expressions
                let expr = prop.expression;
                nodeIdMap.forEach((newId, oldId) => {
                  const pathPatterns = [
                    new RegExp(`(ch[sv]?\\s*\\(\\s*['"][^'"]*/)${oldId}(/[^'"]*['"]\\s*\\))`, 'g'),
                    new RegExp(`(ch[sv]?\\s*\\(\\s*['"]\\.\\./)${oldId}(['"]\\s*\\))`, 'g'),
                  ];
                  pathPatterns.forEach(pattern => {
                    expr = expr.replace(pattern, `$1${newId}$2`);
                  });
                });
                newNode.props[key].expression = expr;
              }
            }
          });
        }
      }

      // Recreate connections between duplicated nodes
      for (const oldNodeId of nodesToDuplicate) {
        const sourceNode = graph.getNode(oldNodeId);
        if (!sourceNode) continue;

        // Check each output connection
        for (const output of sourceNode.outputs) {
          for (const conn of output.connections) {
            // Get target node ID directly from connection
            const targetNodeId = conn.to.nodeId;
            const targetPortId = conn.to.portId;

            // Only recreate if both source and target were duplicated
            const newFromId = nodeIdMap.get(oldNodeId);
            const newToId = nodeIdMap.get(targetNodeId);

            if (newFromId && newToId) {
              const newFromNode = graph.getNode(newFromId);
              const newToNode = graph.getNode(newToId);
              const targetNode = graph.getNode(targetNodeId);

              if (newFromNode && newToNode && targetNode) {
                const fromPortIndex = sourceNode.outputs.indexOf(output);
                const targetInput = targetNode.getInputPortById(targetPortId);
                const toPortIndex = targetInput ? targetNode.inputs.indexOf(targetInput) : -1;

                if (fromPortIndex >= 0 && toPortIndex >= 0) {
                  const newFromPort = newFromNode.outputs[fromPortIndex];
                  const newToPort = newToNode.inputs[toPortIndex];

                  if (newFromPort && newToPort) {
                    try {
                      graph.connect(newFromPort, newToPort);
                    } catch (err) {
                      // Connection might fail due to type mismatch
                    }
                  }
                }
              }
            }
          }
        }
      }

      // Duplicate annotations
      for (const oldAnnotationId of annotationsToDuplicate) {
        const sourceAnnotation = graph.getAnnotation(oldAnnotationId);
        if (!sourceAnnotation) continue;

        const newId = `${sourceAnnotation.type}_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}`;
        const newAnnotation: any = {
          ...sourceAnnotation,
          id: newId,
          position: { ...sourceAnnotation.position }
        };

        if (currentNetwork) {
          graph.reparentElement(newAnnotation, currentNetwork);
        }

        graph.addAnnotation(newAnnotation);
        newAnnotationIds.push(newId);
      }

      // Update graph reactivity
      graph.nodes = [...graph.nodes];
      graph.annotations = [...graph.annotations];

      // Select the duplicated nodes
      selectedNodes = newNodeIds;
      selectedAnnotations = newAnnotationIds;

      // Find the duplicated version of the clicked node
      const newClickedNodeId = nodeIdMap.get(nodeId);
      if (newClickedNodeId) {
        const newClickedNode = graph.getNode(newClickedNodeId);
        if (newClickedNode) {
          selectedNode = newClickedNode;
          dispatch('nodeSelect', { node: newClickedNode });

          // Set up dragging on the new node
          const offset = {
            x: mouseX - newClickedNode.position.x,
            y: mouseY - newClickedNode.position.y
          };

          draggingNode = { nodeId: newClickedNodeId, offset };

          if (newNodeIds.length > 1 || newAnnotationIds.length > 0) {
            draggingMultiple = {
              nodes: newNodeIds.map(id => {
                const n = graph.getNode(id);
                return { nodeId: id, startPos: n ? { ...n.position } : { x: 0, y: 0 } };
              }),
              annotations: newAnnotationIds.map(id => {
                const ann = graph.getAnnotation(id);
                return { annotationId: id, startPos: ann ? { ...ann.position } : { x: 0, y: 0 } };
              }),
              offset
            };
          }
        }
      }

      e.stopPropagation();
      return;
    }

    // Normal drag (no alt key)
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
      node.setBypass(!node.bypass);
      graph.nodes = [...graph.nodes]; // Force reactivity
    }
  }
  
  function handleCookToggle(nodeId: string, e: MouseEvent) {
    const node = graph.getNode(nodeId);
    if (!node) return;

    if (e.shiftKey) {
      // Shift+click: Multi-cook mode - cook this node and all downstream nodes
      node.setCook(true);

      // Cook all downstream nodes
      const cookDownstream = (n: Node) => {
        n.outputs.forEach(output => {
          output.connections.forEach(conn => {
            const downstreamNode = graph.getNode(conn.to.nodeId);
            if (downstreamNode) {
              downstreamNode.setCook(true);
              cookDownstream(downstreamNode);
            }
          });
        });
      };
      cookDownstream(node);
    } else {
      // Normal click: Toggle cook state
      if (node.cook) {
        node.setCook(false);
      } else {
        graph.clearCookingNodes();
        node.setCook(true);
      }
    }

    graph.nodes = [...graph.nodes]; // Force reactivity
  }

  function handleVariadicDisconnect(connectionId: string) {
    recordHistory();
    studioGraph.disconnect(connectionId);
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
      // Don't simulate click for keyboard accessibility - just return early
      // The canvas click handler expects a real mouse event with a target
      return;
    }
  }
  
  function handleCanvasKeyUp(e: KeyboardEvent) {
    // Handler for keyboard accessibility - required when using tabindex on non-interactive element
    // Canvas receives keyboard events for accessibility
  }
  
  function handleCanvasClick(e: MouseEvent) {
    // Handle Ctrl+Click on connections to disconnect
    if (ctrlClickConnection) {
      e.preventDefault();
      e.stopPropagation();
      recordHistory();
      studioGraph.disconnect(ctrlClickConnection);
      hoveredConnection = null;
      ctrlClickConnection = null;
      return;
    }

    // Fallback: Handle Ctrl+Click on connections to disconnect (if not caught in mousedown)
    if ((e.ctrlKey || e.metaKey) && e.target && !(e.target as HTMLElement).closest('.node, .annotation')) {
      const rect = canvas.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
      const mouseY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;

      const hovered = findConnectionAtPoint(mouseX, mouseY);
      if (hovered) {
        e.preventDefault();
        e.stopPropagation();
        recordHistory();
        studioGraph.disconnect(hovered.id);
        hoveredConnection = null;
        return;
      }
    }
    
    // Don't create annotation if clicking on existing annotation
    if (e.target && (e.target as HTMLElement).closest('.annotation')) {
      return;
    }
    
    // Don't clear selection if we just finished a drag selection
    // (the click event fires after mouseup, so we need to check if we just completed a selection)
    if (activeTool === 'select' && e.target && !(e.target as HTMLElement).closest('.node') && !justCompletedSelection) {
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
    const id = `${type}_${Date.now().toString(36)}`;

    // Record history before creating annotation
    recordHistory();

    // Helper to set parent after annotation is added (addAnnotation creates new instance)
    const setAnnotationParentAfterAdd = (annotationId: string) => {
      if (currentNetwork) {
        const addedAnnotation = graph.getAnnotation(annotationId);
        if (addedAnnotation) {
          addChildToNetwork(currentNetwork, addedAnnotation);
        }
      }
    };

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
              type: 'Image',
              src: dataUrl,
              position: { x, y },
              size: { width: 200, height: 150 }
            };
            graph.addAnnotation(annotation);
            setAnnotationParentAfterAdd(id);
            graph.annotations = [...graph.annotations];
          };
          reader.readAsDataURL(file);
        }
      };
      input.click();
    } else if (type === 'group') {
      const annotation: any = {
        id,
        type: 'Group',
        content: 'Group',
        position: { x, y },
        containedElements: []
      };
      graph.addAnnotation(annotation);
      setAnnotationParentAfterAdd(id);
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
        type: 'Text',
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
      setAnnotationParentAfterAdd(id);
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

      // Record history before starting drag
      recordHistory();

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

      // Record history before resize
      recordHistory();

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
  
  function handleAnnotationDelete(annotationId: string, skipHistoryRecord = false) {
    if (!skipHistoryRecord) {
      recordHistory();
    }
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

    // Record history before cut operation
    recordHistory();
    
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

  async function handleCopy() {
    const target = document.activeElement as HTMLElement;
    // Don't copy if focus is in an input or textarea
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return;
    }

    const nodesToCopy: Node[] = [];
    const annotationsToCopy: CanvasAnnotation[] = [];

    // Collect selected nodes
    if (selectedNodes.length > 0) {
      selectedNodes.forEach(nodeId => {
        const node = graph.getNode(nodeId);
        if (node) {
          nodesToCopy.push(node);
        }
      });
    }

    // Collect selected annotations
    if (selectedAnnotations.length > 0) {
      selectedAnnotations.forEach(annotationId => {
        const annotation = graph.getAnnotation(annotationId);
        if (annotation) {
          annotationsToCopy.push(annotation);
        }
      });
    } else if (selectedAnnotation) {
      const annotation = graph.getAnnotation(selectedAnnotation);
      if (annotation) {
        annotationsToCopy.push(annotation);
      }
    }

    // If nothing is selected, return
    if (nodesToCopy.length === 0 && annotationsToCopy.length === 0) {
      return;
    }

    // Serialize nodes with their properties
    const nodeData = nodesToCopy.map(node => node.toJSON());

    // Get connections between selected nodes only
    const selectedNodeIds = new Set(nodesToCopy.map(n => n.id));
    const connectionsToCopy = graph.connections.filter(conn => {
      return selectedNodeIds.has(conn.from.nodeId) && selectedNodeIds.has(conn.to.nodeId);
    });

    // Create clipboard data
    const clipboardData = {
      type: 'cascade/copy',
      nodes: nodeData,
      connections: connectionsToCopy,
      annotations: annotationsToCopy
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(clipboardData));
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  }

  async function handlePaste() {
    const target = document.activeElement as HTMLElement;
    // Don't paste if focus is in an input or textarea
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      const clipboardData = JSON.parse(text);

      // Check if it's our data format
      if (!clipboardData.type || (!clipboardData.type.startsWith('cascade/'))) {
        return;
      }

      recordHistory();

      const nodeIdMap = new Map<string, string>();
      const newNodes: Node[] = [];
      const pasteOffset = 50;

      // Paste nodes
      if (clipboardData.nodes && clipboardData.nodes.length > 0) {
        for (const nodeData of clipboardData.nodes) {
          // Position is serialized as [x, y] array in toJSON()
          const posX = Array.isArray(nodeData.position) ? nodeData.position[0] : nodeData.position.x;
          const posY = Array.isArray(nodeData.position) ? nodeData.position[1] : nodeData.position.y;
          const newNode = graph.addNode(nodeData.type, {
            x: posX + pasteOffset,
            y: posY + pasteOffset
          });

          // Generate unique ID and update the graph's element map
          // Pass oldId to exclude it from uniqueness check (addNode already created a temp ID)
          const oldId = newNode.id;
          const newId = graph.generateUniqueNodeId(nodeData.id, oldId);
          nodeIdMap.set(nodeData.id, newId);
          studioGraph.renameElement(oldId, newId);

          // Copy properties
          newNode.code = nodeData.code || '';
          newNode.comment = nodeData.comment || '';
          newNode.bypass = nodeData.bypass || false;

          // Set parent to current network level
          if (currentNetwork) {
            graph.reparentElement(newNode, currentNetwork);
          }

          newNodes.push(newNode);

          // Execute the node to initialize ports
          if (newNode.code) {
            try {
              await graph.execute(newNode);
            } catch (e) {
              console.warn('Failed to execute pasted node:', e);
            }
          }
        }

        // Restore props after all nodes are created (so we can remap paths)
        for (let i = 0; i < clipboardData.nodes.length; i++) {
          const nodeData = clipboardData.nodes[i];
          const newNode = newNodes[i];

          if (nodeData.props) {
            Object.entries(nodeData.props).forEach(([key, propData]: [string, any]) => {
              if (newNode.props[key]) {
                // Handle expression data format: { value, expression }
                if (propData && typeof propData === 'object' && 'expression' in propData) {
                  // Remap node IDs in expression paths
                  let expr = propData.expression as string;
                  nodeIdMap.forEach((newId, oldId) => {
                    // Replace node ID references in ch(), chs(), chv() paths
                    const pathPatterns = [
                      new RegExp(`(ch[sv]?\\s*\\(\\s*['"][^'"]*/)${oldId}(/[^'"]*['"]\\s*\\))`, 'g'),
                      new RegExp(`(ch[sv]?\\s*\\(\\s*['"]\\.\\./)${oldId}(['"]\\s*\\))`, 'g'),
                    ];
                    pathPatterns.forEach(pattern => {
                      expr = expr.replace(pattern, `$1${newId}$2`);
                    });
                  });

                  newNode.props[key] = {
                    ...newNode.props[key],
                    value: propData.value,
                    expression: expr
                  };
                } else {
                  // Simple value
                  newNode.updateProp(key, propData);
                }
              }
            });
          }
        }
      }

      // Recreate connections with new IDs
      if (clipboardData.connections && clipboardData.connections.length > 0) {
        for (const conn of clipboardData.connections) {
          const fromId = nodeIdMap.get(conn.from.nodeId);
          const toId = nodeIdMap.get(conn.to.nodeId);

          if (fromId && toId) {
            const fromNode = graph.getNode(fromId);
            const toNode = graph.getNode(toId);

            if (fromNode && toNode) {
              const fromPort = fromNode.outputs.find(p => p.id === conn.from.portId);
              const toPort = toNode.inputs.find(p => p.id === conn.to.portId);

              if (fromPort && toPort) {
                graph.connect(fromPort, toPort);
              }
            }
          }
        }
      }

      // Paste annotations
      if (clipboardData.annotations && clipboardData.annotations.length > 0) {
        for (const annotationData of clipboardData.annotations) {
          const newId = `${annotationData.type}_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}`;
          const newAnnotation: any = {
            ...annotationData,
            id: newId,
            position: {
              x: annotationData.position.x + pasteOffset,
              y: annotationData.position.y + pasteOffset
            }
          };

          // Set parent to current network level
          if (currentNetwork) {
            graph.reparentElement(newAnnotation, currentNetwork);
          }

          graph.addAnnotation(newAnnotation);
        }
      }

      // Update graph reactivity
      graph.nodes = [...graph.nodes];
      graph.annotations = [...graph.annotations];

      // Select pasted nodes
      if (newNodes.length > 0) {
        selectedNodes = newNodes.map(n => n.id);
        selectedNode = newNodes[0];
        dispatch('nodeSelect', { node: newNodes[0] });
      }

    } catch (err) {
      // Not our clipboard data or invalid JSON - ignore
      console.debug('Paste failed or not Cascade data:', err);
    }
  }

  function handleAnnotationContentChange(annotationId: string, content: string) {
    const annotation = graph.getAnnotation(annotationId) as CanvasAnnotation | null;
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
    const baseX = (e.clientX - rect.left - internalTransform.x) / internalTransform.zoom;
    const baseY = (e.clientY - rect.top - internalTransform.y) / internalTransform.zoom;

    // Cascade offset for multiple files
    const cascadeOffset = 30;

    files.forEach(async (file, index) => {
      const x = baseX + (index * cascadeOffset);
      const y = baseY + (index * cascadeOffset);
      // Check if it's an image
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          // Use filename (without extension) as base for ID
          const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
          const id = `${baseName}_${Date.now().toString(36)}`;
          const annotation: any = {
            id,
            type: 'Image',
            src: dataUrl,
            position: { x, y },
            size: { width: 200, height: 150 },
            caption: file.name
          };
          graph.addAnnotation(annotation);

          // Set parent after annotation is added (addAnnotation creates a new instance)
          if (currentNetwork) {
            const addedAnnotation = graph.getAnnotation(id);
            if (addedAnnotation) {
              addChildToNetwork(currentNetwork, addedAnnotation);
            }
          }
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

  /**
   * Auto-connect selected nodes/annotations to a newly created node.
   * For variadic inputs: connects all selected sources
   * For regular inputs: connects sources in order to available inputs
   */
  function autoConnectSelectedNodes(sourceNodes: Node[], targetNode: Node): void {
    if (!graph) return;

    // Get outputs from source nodes (prefer 'output' named port, otherwise first output)
    const sourceOutputs = sourceNodes
      .map(node => node.outputs.find(p => p.name === 'output') || node.outputs[0])
      .filter(Boolean);

    if (sourceOutputs.length === 0) return;

    if (targetNode.variadic) {
      // Connect all sources to variadic inputs
      sourceOutputs.forEach((output, index) => {
        targetNode.syncVariadicPorts();
        const inputs = targetNode.getVariadicInputs();
        const input = inputs[index];
        if (input && output) {
          try {
            graph.connect(output, input);
          } catch (e) {
            // Skip failed connections (type mismatch, etc.)
          }
        }
      });
    } else {
      // Connect to regular inputs (non-hidden, unconnected)
      const availableInputs = targetNode.inputs.filter(p =>
        p.connections.length === 0 && !p.options?.hidden
      );

      sourceOutputs.forEach((output, index) => {
        const input = availableInputs[index];
        if (input && output) {
          try {
            graph.connect(output, input);
          } catch (e) {
            // Skip failed connections (type mismatch, etc.)
          }
        }
      });
    }
  }

  export async function addNode(detail: {
    type: string;
    category: string | null;
    customConfig?: {
      name: string;
      modulePath: string;
      baseClass: string;
      code: string;
    };
  }) {
    // Record history before adding node
    recordHistory();

    // Capture currently selected nodes AND annotations before creating the new node
    const previouslySelectedNodeIds = [...selectedNodes];
    const previouslySelectedAnnotationIds = [...selectedAnnotations];

    const nodeType = detail.type;
    const customConfig = detail.customConfig;
    const rect = canvas.getBoundingClientRect();

    // Calculate the center of the visible viewport in screen coordinates
    const viewportCenterX = rect.width / 2;
    const viewportCenterY = rect.height / 2;

    // Convert screen coordinates to canvas coordinates
    // Account for pan (internalTransform.x, internalTransform.y) and zoom (internalTransform.zoom)
    let centerX = (viewportCenterX - internalTransform.x) / internalTransform.zoom;
    let centerY = (viewportCenterY - internalTransform.y) / internalTransform.zoom;

    // Check if this is an annotation type (e.g., "annotation:text", "annotation:image")
    if (nodeType.startsWith('annotation:')) {
      const annotationType = nodeType.replace('annotation:', '');
      // Line and polyline require click-and-drag interaction, so set the tool mode
      if (annotationType === 'line' || annotationType === 'polyline') {
        activeTool = annotationType;
        dispatch('toolChange', annotationType);
        return;
      }
      // Other annotations can be created immediately at center
      createAnnotation(annotationType, centerX, centerY);
      return;
    }

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

    // Set parent if we're inside a subnet
    if (currentNetwork && currentNetwork.isNetwork()) {
      addChildToNetwork(currentNetwork, newNode);
    }

    // Class-based nodes (stdlib) are already initialized by their constructor
    // Custom nodes need code and compilation
    const isClassBased = getNodeClass(nodeType) !== null;

    if (!isClassBased) {
      // Custom node: set default code template and compile
      // Use custom config code if provided, otherwise use default template
      const defaultCode = customConfig?.code || getDefaultNodeCode(nodeType);
      newNode.code = defaultCode;

      // Register custom node with module resolver for proper serialization
      if (nodeType.startsWith('local.')) {
        graph.moduleResolver.createEmbeddedModule(nodeType, defaultCode, 'user');
      }

      // Compile and execute the node code to initialize props and ports
      try {
        newNode.resetPortTracking();
        const compiled = await loadEmbeddedModule(defaultCode);
        newNode.setFunction(compiled.execute);

        // Ensure node can execute (not bypassed and temporarily cooking)
        // This is necessary because shouldExecute() checks if node is cooking when there are other cooking nodes
        const wasBypassed = newNode.bypass;
        const wasCooking = newNode.cook;
        if (wasBypassed) {
          newNode.setBypass(false);
        }
        // Temporarily set cooking to ensure execution happens during initialization
        if (!wasCooking) {
          newNode.setCook(true);
        }
        
        // Execute the node code to define props
        console.log(`Executing node ${nodeType}, props before:`, Object.keys(newNode.props).length);
        await graph.execute(newNode);
        console.log(`Node ${nodeType} executed, props after:`, Object.keys(newNode.props).length, Object.keys(newNode.props));
        if (newNode.error) {
          console.error(`Node ${nodeType} execution error:`, newNode.error);
        }
        
        // Restore bypass and cooking state
        if (wasBypassed) {
          newNode.setBypass(true);
        }
        if (!wasCooking) {
          newNode.setCook(false);
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

    // Auto-connect previously selected nodes and annotations to the new node
    const previouslySelectedNodes = previouslySelectedNodeIds
      .map(id => graph.getNode(id))
      .filter((n): n is Node => n !== null);

    const previouslySelectedAnnotations = previouslySelectedAnnotationIds
      .map(id => graph.getAnnotation(id))
      .filter((a): a is Annotation => a !== null);

    // Combine nodes and annotations (Annotation extends Node)
    const allSelectedSources: Node[] = [...previouslySelectedNodes, ...previouslySelectedAnnotations];

    if (allSelectedSources.length > 0) {
      autoConnectSelectedNodes(allSelectedSources, newNode);
    }

    studioGraph.refresh({ nodes: true, connections: true });
    
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
  
  // Helper function to get default code template for custom nodes
  function getDefaultNodeCode(type: string): string {
    const shortType = packagePathToType(type);
    return `// ${shortType} - Custom Node
//
// Define inputs
const input = node.in('input', null);

// Define properties (shown in inspector)
node.defineProp('value', {
  value: 1.0,
  params: { min: 0, max: 10, step: 0.1 },
  displayName: 'Value'
});

// Define outputs
const output = node.out('output');

// React to input changes
input.onChange = (value) => {
  output.setValue(value);
};

// React to property changes
node.watchProp('value', (newValue) => {
  output.setValue(newValue);
});

// Called once when node is ready
node.onReady = () => {
  output.setValue(node.props.value.value);
};
`;
  }
  
  // Update selectedNodes when selectedNode changes externally (but avoid cycles)
  $: if (selectedNode && selectedNode.id && !selectedNodes.includes(selectedNode.id)) {
    selectedNodes = [selectedNode.id];
  }

  // Helper function to calculate the center of visible nodes in current network
  function getNodesCenter(): { x: number; y: number } | null {

    // Calculate bounding box of visible nodes and annotations
    // Approximate node size: 120px width, 80px height (can be adjusted)
    const nodeWidth = 120;
    const nodeHeight = 80;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    // Include visible nodes in bounding box
    visibleNodes.forEach(node => {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + nodeWidth);
      maxY = Math.max(maxY, node.position.y + nodeHeight);
    });

    // Include visible annotations in bounding box
    annotations.forEach(annotation => {
      if (annotation.type === 'Line') {
        // Line: use position and endPosition
        const startX = annotation.position.x;
        const startY = annotation.position.y;
        const endX = annotation.endPosition?.x ?? annotation.position.x;
        const endY = annotation.endPosition?.y ?? annotation.position.y;
        minX = Math.min(minX, startX, endX);
        minY = Math.min(minY, startY, endY);
        maxX = Math.max(maxX, startX, endX);
        maxY = Math.max(maxY, startY, endY);

      } else if (annotation.type === 'Polyline') {
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
        const width = annotation.size?.width || (annotation.type === 'Text' ? 540 : annotation.type === 'Image' ? 200 : 300);
        const height = annotation.size?.height || (annotation.type === 'Text' ? 60 : annotation.type === 'Image' ? 150 : 200);

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

  // Function to center canvas on visible nodes in current network
  export function centerOnNodes() {
    if (!canvas) return;

    const center = getNodesCenter();
    if (!center) return;

    const centerX = center.x;
    const centerY = center.y;

    // Get viewport dimensions
    const rect = canvas.getBoundingClientRect();
    const viewportWidth = rect.width;
    const viewportHeight = rect.height;

    // Calculate bounding box of visible nodes and annotations
    const nodeWidth = 120;
    const nodeHeight = 80;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    // Include visible nodes in bounding box
    visibleNodes.forEach(node => {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + nodeWidth);
      maxY = Math.max(maxY, node.position.y + nodeHeight);
    });

    // Include visible annotations in bounding box
    annotations.forEach(annotation => {
      if (annotation.type === 'Line') {
        const startX = annotation.position.x;
        const startY = annotation.position.y;
        const endX = annotation.endPosition?.x ?? annotation.position.x;
        const endY = annotation.endPosition?.y ?? annotation.position.y;
        minX = Math.min(minX, startX, endX);
        minY = Math.min(minY, startY, endY);
        maxX = Math.max(maxX, startX, endX);
        maxY = Math.max(maxY, startY, endY);
      } else if (annotation.type === 'Polyline') {
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
        const width = annotation.size?.width || (annotation.type === 'Text' ? 540 : annotation.type === 'Image' ? 200 : 300);
        const height = annotation.size?.height || (annotation.type === 'Text' ? 60 : annotation.type === 'Image' ? 150 : 200);
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

  // Select all nodes and annotations (toggle: if all selected, deselect all)
  export function selectAll() {
    const allNodesSelected = graph.nodes.length > 0 &&
      graph.nodes.every(n => selectedNodes.includes(n.id));
    const allAnnotationsSelected = graph.annotations.length === 0 ||
      graph.annotations.every(a => selectedAnnotations.includes(a.id));

    if (allNodesSelected && allAnnotationsSelected && selectedNodes.length > 0) {
      // Everything already selected - deselect all
      deselectAll();
    } else {
      // Select all
      selectedNodes = graph.nodes.map(n => n.id);
      selectedAnnotations = graph.annotations.map(a => a.id);
      if (graph.nodes.length > 0) {
        selectedNode = graph.nodes[0];
        dispatch('nodeSelect', { node: graph.nodes[0] });
      }
    }
  }

  // Deselect all nodes and annotations
  export function deselectAll() {
    selectedNodes = [];
    selectedAnnotations = [];
    selectedNode = null;
    dispatch('nodeSelect', { node: null });
    dispatch('annotationSelect', { annotationId: null });
  }

  // Delete all selected nodes and annotations
  export function deleteSelected() {
    const hasNodes = selectedNodes.length > 0;
    const hasAnnotations = selectedAnnotations.length > 0 || selectedAnnotation;

    if (!hasNodes && !hasAnnotations) return;

    recordHistory();

    // Delete selected nodes
    if (hasNodes) {
      selectedNodes.forEach(nodeId => {
        graph.removeNode(nodeId);
      });
      selectedNodes = [];
      selectedNode = null;
      graph.nodes = [...graph.nodes];
      dispatch('nodeSelect', { node: null });
    }

    // Delete selected annotations
    if (selectedAnnotations.length > 0) {
      selectedAnnotations.forEach(annotationId => {
        handleAnnotationDelete(annotationId, true);
      });
      dispatch('annotationSelect', { annotationId: null });
    } else if (selectedAnnotation) {
      handleAnnotationDelete(selectedAnnotation);
      dispatch('annotationSelect', { annotationId: null });
    }
  }

  function handleContextMenu(e: MouseEvent) {
    // Prevent default context menu
    e.preventDefault();
    
    // Don't open panel if Ctrl/Cmd is pressed (might be Ctrl+Click)
    if (e.ctrlKey || e.metaKey) {
      return;
    }
    
    // Don't open panel if right-clicking on a node or annotation
    if ((e.target as HTMLElement).closest('.node, .annotation')) {
      return;
    }
    
    // Open node panel at mouse position
    dispatch('openNodePanel', { x: e.clientX, y: e.clientY });
  }
  
  function getPortElement(nodeId: string, portId: string): HTMLElement | null {
    if (!canvas) return null;

    // First try to find the element directly
    let element = canvas.querySelector(`[data-node-id="${nodeId}"][data-port-id="${portId}"]`) as HTMLElement;
    if (element) return element;

    // If not found, check if this is a variadic port - look for a variadic group that contains this port
    // The portId would be in the data-variadic-ports attribute
    const variadicElements = canvas.querySelectorAll(`[data-node-id="${nodeId}"][data-variadic-ports]`);
    for (const el of variadicElements) {
      const variadicPorts = el.getAttribute('data-variadic-ports');
      if (variadicPorts && variadicPorts.split(',').includes(portId)) {
        return el as HTMLElement;
      }
    }

    return null;
  }
  
  function getPortPosition(nodeId: string, portId: string, portType: 'input' | 'output'): { x: number; y: number } | null {
    // Check if this is an annotation by looking up the element
    const element = graph.getElement(nodeId);
    const isAnnotationElement = (element as any)?.isAnnotation === true;

    // Handle annotation ports - try to get actual DOM element position first
    if (isAnnotationElement) {
      const portElement = getPortElement(nodeId, portId);
      if (portElement && canvas) {
        // Get actual DOM position of the port element
        const rect = portElement.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();

        // Get the center of the port dot or pill
        const dotElement = portElement.querySelector('.port-dot, .port-pill');
        if (dotElement) {
          const dotRect = dotElement.getBoundingClientRect();
          return {
            x: (dotRect.left + dotRect.width / 2 - canvasRect.left - internalTransform.x) / internalTransform.zoom,
            y: (dotRect.top + dotRect.height / 2 - canvasRect.top - internalTransform.y) / internalTransform.zoom
          };
        }

        // Fallback to port element center
        return {
          x: (rect.left + rect.width / 2 - canvasRect.left - internalTransform.x) / internalTransform.zoom,
          y: (rect.top + rect.height / 2 - canvasRect.top - internalTransform.y) / internalTransform.zoom
        };
      }

      // Fallback to calculated position if element not found
      const annotation = element as Annotation | null;
      if (!annotation || !annotation.outputs) return null;

      const port = annotation.outputs.find(p => p.id === portId);
      if (!port) return null;

      // For all annotations, output ports are at the bottom center
      const annotationWidth = annotation.size?.width ?? (annotation.type === 'Text' ? 540 : annotation.type === 'Image' ? 200 : 300);
      const annotationHeight = annotation.size?.height ?? (annotation.type === 'Text' ? 60 : annotation.type === 'Image' ? 150 : 200);

      // Bottom center for all annotation types
      return {
        x: annotation.position.x + annotationWidth / 2,
        y: annotation.position.y + annotationHeight
      };
    }
    
    
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

    // Get the center of the port dot or pill
    // For vertical layout: input dots at top, output dots at bottom
    const dotElement = portElement.querySelector('.port-dot, .port-pill');

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

    // Check if this is an annotation
    const element = graph.getElement(nodeId);
    const isAnnotationElement = (element as any)?.isAnnotation === true;

    // Handle annotation ports
    if (isAnnotationElement) {
      const annotation = element;
      if (!annotation || !annotation.outputs) return;
      
      const port = annotation.outputs.find(p => p.id === portId);
      if (!port) return;
      
      // Track if port is already connected (for disconnection on drag off canvas)
      if (port.connections.length > 0) {
        draggingFromConnectedPort = {
          nodeId,
          portId,
          portType,
          connectionIds: port.connections.map(c => c.id)
        };
      }
      
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
      return;
    }
    
    const node = graph.getNode(nodeId);
    if (!node) return;
    
    const port = portType === 'output' 
      ? node.outputs.find(p => p.id === portId)
      : node.inputs.find(p => p.id === portId);
    
    if (!port) return;
    
    // Track if port is already connected (for disconnection on drag off canvas)
    if (port.connections.length > 0) {
      draggingFromConnectedPort = {
        nodeId,
        portId,
        portType,
        connectionIds: port.connections.map(c => c.id)
      };
    }
    
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
    
    // Also allow disconnecting from input ports by dragging
    if (portType === 'input' && port.connections.length > 0 && !connectingFrom) {
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
        const fromElement = graph.getElement(from.nodeId);
        const fromPort = from.portType === 'output'
          ? fromElement?.outputs.find((p: any) => p.id === from.portId)
          : fromElement?.inputs.find((p: any) => p.id === from.portId);

        if (fromPort && port) {
          // Only allow output -> input connections
          if (from.portType === 'output' && portType === 'input') {
            recordHistory();

            // Check if connecting to a variadic port and there are multiple selected elements
            const isVariadicTarget = 'variadic' in port && port.variadic === true;
            const otherSelectedElements: Array<{ element: any; output: any }> = [];

            if (isVariadicTarget) {
              // Get the target node's ID
              const targetId = nodeId;

              // Collect other selected nodes (excluding the one being connected from AND the target)
              selectedNodes.forEach(selectedNodeId => {
                if (selectedNodeId !== from.nodeId && selectedNodeId !== targetId) {
                  const selectedNode = graph.getNode(selectedNodeId);
                  if (selectedNode && selectedNode.outputs.length > 0) {
                    otherSelectedElements.push({ element: selectedNode, output: selectedNode.outputs[0] });
                  }
                }
              });

              // Collect selected annotations with outputs (excluding source and target)
              selectedAnnotations.forEach(annId => {
                if (annId !== from.nodeId && annId !== targetId) {
                  const ann = graph.getAnnotation(annId);
                  if (ann && ann.outputs && ann.outputs.length > 0) {
                    otherSelectedElements.push({ element: ann, output: ann.outputs[0] });
                  }
                }
              });
            }

            // Make the primary connection
            graph.connect(fromPort, port);

            // If there are other selected elements and target is variadic, connect them too
            if (isVariadicTarget && otherSelectedElements.length > 0) {
              // Extract variadic base name from port name (e.g., "image_0" -> "image")
              const portNameMatch = port.name.match(/^(.+)_(\d+)$/);
              if (portNameMatch && node.syncVariadicPorts) {
                const baseName = portNameMatch[1];
                let currentIndex = parseInt(portNameMatch[2], 10) + 1;

                for (const { output } of otherSelectedElements) {
                  // Sync variadic ports to ensure enough exist
                  node.syncVariadicPorts();

                  // Find or create the next variadic port
                  const nextPortName = `${baseName}_${currentIndex}`;
                  let nextPort = node.inputs.find((p: any) => p.name === nextPortName && !p.options?.hidden);

                  if (!nextPort) {
                    // Sync again and try to find it
                    node.syncVariadicPorts();
                    nextPort = node.inputs.find((p: any) => p.name === nextPortName && !p.options?.hidden);
                  }

                  if (nextPort) {
                    try {
                      graph.connect(output, nextPort);
                      currentIndex++;
                    } catch (err) {
                      console.warn('Failed to connect additional element:', err);
                    }
                  }
                }
              }
            }

            studioGraph.refresh({ connections: true });
          }
        }
      }

      connectingFrom = null;
      connectingPosition = null;
      draggingFromConnectedPort = null; // Reset when connection is completed
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
    
    // Zoom from the center of all nodes (use cached value for performance)
    const center = getCachedNodesCenter();
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
    // Don't intercept space when typing in an input field
    const activeEl = document.activeElement;
    const isTyping = activeEl instanceof HTMLInputElement ||
                     activeEl instanceof HTMLTextAreaElement ||
                     activeEl?.getAttribute('contenteditable') === 'true';

    if (e.code === 'Space' && !isTyping) {
      spacePressed = true;
      e.preventDefault();
    }
    
    // Track Ctrl key for scissors icon (check both key and modifier)
    if (e.key === 'Control' || e.key === 'Meta' || e.ctrlKey || e.metaKey) {
      ctrlPressed = true;
    }
    
    // Canvas keyboard shortcuts
    // ⌘+ / ⌘- - Zoom in/out
    if ((e.metaKey || e.ctrlKey) && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      const oldZoom = internalTransform.zoom;
      const newZoom = Math.min(2, oldZoom + 0.1);

      // Zoom from the center of all nodes (use cached value for performance)
      const center = getCachedNodesCenter();
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

      // Zoom from the center of all nodes (use cached value for performance)
      const center = getCachedNodesCenter();
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

    // H - Home/center on visible nodes (same as ⌘0)
    if (e.key === 'h' || e.key === 'H') {
      const target = e.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        centerOnNodes();
      }
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
        if (selectedNodes.length > 0 || selectedAnnotations.length > 0 || selectedAnnotation) {
          e.preventDefault();
          deleteSelected();
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

    // ⌘C - Copy selected nodes or annotations
    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      const target = e.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        handleCopy();
      }
    }

    // ⌘V - Paste nodes or annotations
    if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
      const target = e.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        handlePaste();
      }
    }

    // ⌘A - Select all nodes and annotations
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      const target = e.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        selectAll();
      }
    }

    // ⌘D - Duplicate selected nodes
    if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
      e.preventDefault();
      if (selectedNodes.length > 0) {
        recordHistory();
        const nodesToDuplicate = selectedNodes.map(id => graph.getNode(id)).filter(Boolean) as Node[];
        const newNodes: Node[] = [];

        nodesToDuplicate.forEach(node => {
          const newNode = graph.addNode(node.type, {
            x: node.position.x + 50,
            y: node.position.y + 50
          });
          newNode.code = node.code;
          // Generate unique ID based on the original node's ID
          newNode.id = graph.generateUniqueNodeId(node.id);
          newNode.comment = node.comment;
          newNode.bypass = node.bypass;
          // Set parent to current network level
          if (currentNetwork) {
            graph.reparentElement(newNode, currentNetwork);
          }
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

    // Subnet Navigation Shortcuts
    const navTarget = e.target as HTMLElement;
    if (navTarget.tagName !== 'INPUT' && navTarget.tagName !== 'TEXTAREA') {
      // Enter or i - Dive into selected subnet
      if ((e.key === 'Enter' || e.key === 'i') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (selectedNode && selectedNode.isNetwork()) {
          e.preventDefault();
          diveIntoSubnet(selectedNode);
        }
      }

      // o or u - Jump out of current subnet
      if ((e.key === 'o' || e.key === 'u') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (currentNetwork) {
          e.preventDefault();
          jumpOut();
        }
      }

      // ⌘G - Collapse selected nodes into subnet
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'g') {
        if (selectedNodes.length > 0) {
          e.preventDefault();
          collapseIntoSubnet();
        }
      }

      // ⌘⇧G - Extract subnet contents (inverse of collapse)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'G') {
        if (selectedNodes.length === 1) {
          const node = graph.getNode(selectedNodes[0]);
          if (node?.isNetwork()) {
            e.preventDefault();
            extractAndDelete();
          }
        }
      }

      // / - Open path input for direct navigation
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        openPathInput();
      }

      // C - Toggle cooking on selected node (subnet output designation)
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (selectedNode) {
          e.preventDefault();
          selectedNode.setCook(!selectedNode.cook);
          graph.nodes = [...graph.nodes];
        }
      }

      // B - Toggle bypass on selected node
      if (e.key === 'b' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (selectedNode) {
          e.preventDefault();
          selectedNode.setBypass(!selectedNode.bypass);
          graph.nodes = [...graph.nodes];
        }
      }
    }
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') {
      spacePressed = false;
    }

    // Track Ctrl key release for scissors icon (check both key and modifier)
    if (e.key === 'Control' || e.key === 'Meta' || (!e.ctrlKey && !e.metaKey)) {
      ctrlPressed = false;
      hoveredConnection = null;
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
  <!-- Network Path Navigation Bar -->
  <div class="network-path-bar">
    {#if showPathInput}
      <input
        type="text"
        class="path-input"
        bind:this={pathInputElement}
        bind:value={pathInputValue}
        on:keydown={handlePathInputKeydown}
        on:blur={closePathInput}
        placeholder="Enter path (e.g., /subnet1/node1)"
      />
    {:else}
      {#each breadcrumbs as crumb, i}
        {#if i > 0}
          <span class="path-separator">›</span>
        {/if}
        <button
          class="path-segment"
          class:current={i === breadcrumbs.length - 1}
          on:click={() => navigateToBreadcrumb(crumb.node)}
        >
          {crumb.label}
        </button>
      {/each}
      <button class="path-edit-btn" on:click={openPathInput} title="Press / to navigate by path">
        /
      </button>
    {/if}
  </div>

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
    <!-- Existing connections.
         Ordered so highlighted wires paint LAST. SVG has no z-index — a wire
         at full brightness drawn first still ends up under every dimmed one
         crossing it, which is the opposite of the point. -->
    {#each orderedConnections as conn (conn.id)}
      {@const fromNodePos = nodePositions.find(np => np.id === conn.from.nodeId)}
      {@const toNodePos = nodePositions.find(np => np.id === conn.to.nodeId)}
      <!-- {@const fromAnnPos = annotationPositions.find(ap => `ann_${ap.id}` === conn.from.nodeId)}
      {@const toAnnPos = annotationPositions.find(ap => `ann_${ap.id}` === conn.to.nodeId)} -->
      {@const fromPos = getPortPosition(conn.from.nodeId, conn.from.portId, 'output')}
      {@const toPos = getPortPosition(conn.to.nodeId, conn.to.portId, 'input')}
      {#if fromPos && toPos}
        {@const fromElement = graph.getElement(conn.from.nodeId)}
        {@const toElement = graph.getElement(conn.to.nodeId)}
        {@const fromNode = fromElement && !(fromElement as any)?.isAnnotation ? fromElement : null}
        {@const toNode = toElement && !(toElement as any)?.isAnnotation ? toElement : null}
        {@const fromAnnotation = (fromElement as any)?.isAnnotation ? fromElement : null}
        {@const fromPort = fromNode?.outputs.find(p => p.id === conn.from.portId) || fromAnnotation?.outputs?.find(p => p.id === conn.from.portId)}
        {@const isActive = !(toNode as any)?.isInputActive || (toNode as any).isInputActive(conn.to.portId)}
        {@const connectionColor = isActive ? (fromPort ? getPortColor(fromPort) : '#888') : DATA_TYPE_COLORS.inactive}
        {@const isHighlighted = isConnectionHighlighted(conn, selectedNodes, hoveredConnection?.connectionId)}
        {@const midY = (fromPos.y + toPos.y) / 2}
        {@const curveOffset = Math.abs(toPos.y - fromPos.y) * 0.5}
        {@const isTrigger = conn.type === 'trigger'}
        {@const isProcessing = isConnectionProcessing(conn)}
        <!-- Invisible wider path for better hit testing -->
        <path
          d="M {fromPos.x} {fromPos.y} C {fromPos.x} {fromPos.y + curveOffset} {toPos.x} {toPos.y - curveOffset} {toPos.x} {toPos.y}"
          fill="none"
          stroke="transparent"
          stroke-width="12"
          class="connection-hit-area"
          style="cursor: {(hoveredConnection?.connectionId === conn.id && ctrlPressed) ? 'pointer' : 'default'};"
        />
        <!-- Visible connection path -->
        <path
          d="M {fromPos.x} {fromPos.y} C {fromPos.x} {fromPos.y + curveOffset} {toPos.x} {toPos.y - curveOffset} {toPos.x} {toPos.y}"
          fill="none"
          stroke={connectionColor}
          stroke-width="2"
          stroke-opacity={isHighlighted ? 1 : DIMMED_WIRE_OPACITY}
          stroke-dasharray={isProcessing ? "8 6" : (isTrigger ? "3 3" : "none")}
          class="connection"
          class:trigger-connection={isTrigger}
          class:processing-connection={isProcessing}
          class:inactive={!isActive}
        />
      {/if}
    {/each}
    
    <!-- Scissors icon when hovering over connection with Ctrl -->
    {#if hoveredConnection}
      {@const pos = hoveredConnection.position}
      <g transform="translate({pos.x}, {pos.y})">
        <circle cx="0" cy="0" r="12" fill="#1a1a1a" stroke="#888" stroke-width="1" opacity="0.9" />
        <!-- Scissors icon (simplified SVG path) -->
        <path
          d="M -6,-4 L -6,4 M 6,-4 L 6,4 M -4,-6 L 4,6 M -4,6 L 4,-6"
          stroke="#fff"
          stroke-width="1.5"
          stroke-linecap="round"
          fill="none"
        />
      </g>
    {/if}
    
    <!-- Connection preview (while dragging) -->
    {#if connectingFrom && connectingPosition}
      {@const from = connectingFrom}
      {@const fromElement = graph.getElement(from.nodeId)}
      {@const fromNode = fromElement && !(fromElement as any)?.isAnnotation ? fromElement : null}
      {@const fromAnnotation = (fromElement as any)?.isAnnotation ? fromElement : null}
      {@const fromPort = from.portType === 'output' 
        ? (fromNode?.outputs.find(p => p.id === from.portId) || fromAnnotation?.outputs?.find(p => p.id === from.portId))
        : fromNode?.inputs.find(p => p.id === from.portId)}
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
      {@const isDragging = draggingAnnotation?.annotationId === annotation.id}
      {@const Component = annotationRegistry.get(annotation.type)}

      {#if Component}
        <svelte:component
          this={Component}
          {annotation}
          {isSelected}
          {isEditing}
          {isDragging}
          on:click={(e: CustomEvent<{id: string; event: MouseEvent}>) => handleAnnotationClick(e.detail.id, e.detail.event)}
          on:dblclick={(e: CustomEvent<{id: string; event: MouseEvent}>) => handleAnnotationDoubleClick(e.detail.id, e.detail.event)}
          on:mousedown={(e: CustomEvent<{id: string; event: MouseEvent; width?: number; height?: number}>) => {
            const { id, event, width, height } = e.detail;
            if (annotation instanceof TextAnnotation) {
              handleAnnotationMouseDownForText(id, event, width || 540, height || 60);
            } else {
              handleAnnotationMouseDown(id, event);
            }
          }}
          on:mousemove={(e: CustomEvent<{id: string; event: MouseEvent; width?: number; height?: number}>) => {
            const { id, event, width, height } = e.detail;
            handleAnnotationMouseMove(id, event, width || 540, height || 60);
          }}
          on:keydown={(e: CustomEvent<{id: string; event: KeyboardEvent}>) => handleAnnotationKeyDown(e.detail.id, e.detail.event)}
          on:finishEdit={finishEditingAnnotation}
          on:delete={(e: CustomEvent<{id: string}>) => handleAnnotationDelete(e.detail.id)}
          on:input={(e: CustomEvent<{id: string; event: Event}>) => {
            const { id, event } = e.detail;
            if (annotation instanceof TextAnnotation) {
              handleTextareaInput(id, event);
            } else {
              handleInputInput(id, event);
            }
          }}
          on:portMouseDown={(e: CustomEvent<{nodeId: string; portId: string; portType: 'input' | 'output'; event: MouseEvent}>) => handlePortMouseDown(e.detail.nodeId, e.detail.portId, e.detail.portType, e.detail.event)}
          on:resizeStart={(e: CustomEvent<{id: string; handle: 'se' | 'sw' | 'ne' | 'nw' | 'e' | 'w' | 'n' | 's'; event: MouseEvent}>) => handleResizeHandleMouseDown(e.detail.id, e.detail.handle, e.detail.event)}
        />
      {:else}
        <!-- Debug fallback for unmapped annotation type -->
        <div
          class="annotation-debug"
          style="position: absolute; left: {annotation.position.x}px; top: {annotation.position.y}px; background: #ff4444; color: white; padding: 8px; border-radius: 4px; font-size: 12px;"
        >
          Unknown type: {annotation.type}
        </div>
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
        canvasTransform={internalTransform}
        on:portClick={(e) => handlePortClick(e.detail.nodeId, e.detail.portId, e.detail.portType, e.detail.event)}
        on:portMouseDown={(e) => handlePortMouseDown(e.detail.nodeId, e.detail.portId, e.detail.portType, e.detail.event)}
        on:nodeMouseDown={(e) => handleNodeMouseDown(e.detail.nodeId, e.detail.event)}
        on:click={(e) => handleNodeClick(node.id, e.detail)}
        on:edit={handleNodeEdit}
        on:diveInto={(e) => diveIntoSubnet(e.detail.node)}
        on:bypassToggle={(e) => handleBypassToggle(e.detail.nodeId, e.detail.event)}
        on:cookToggle={(e) => handleCookToggle(e.detail.nodeId, e.detail.event)}
        on:disconnect={(e) => handleVariadicDisconnect(e.detail.connectionId)}
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

  .connection.processing-connection {
    animation: cascade-connection-flow 0.7s linear infinite;
  }

  @keyframes cascade-connection-flow {
    to {
      stroke-dashoffset: -14;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .connection.processing-connection {
      animation: none;
    }
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

  /* Network Path Navigation Bar */
  .network-path-bar {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 100;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: rgba(30, 30, 30, 0.9);
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(8px);
    font-size: 12px;
  }

  .path-segment {
    background: none;
    border: none;
    color: #888;
    padding: 2px 6px;
    border-radius: 3px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    transition: all 0.15s ease;
  }

  .path-segment:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .path-segment.current {
    color: #fff;
    font-weight: 500;
  }

  .path-separator {
    color: #555;
    font-size: 11px;
  }

  .path-input {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(100, 160, 255, 0.5);
    color: #fff;
    padding: 4px 8px;
    border-radius: 4px;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 12px;
    width: 250px;
    outline: none;
  }

  .path-input:focus {
    border-color: rgba(100, 160, 255, 0.8);
    box-shadow: 0 0 0 2px rgba(100, 160, 255, 0.2);
  }

  .path-edit-btn {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #666;
    padding: 2px 6px;
    border-radius: 3px;
    cursor: pointer;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 11px;
    margin-left: 4px;
    transition: all 0.15s ease;
  }

  .path-edit-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #aaa;
    border-color: rgba(255, 255, 255, 0.25);
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

  .connection.inactive {
    opacity: 0.5;
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
  
  .selection-rectangle {
    position: absolute;
    border: 1px dashed #4a9eff;
    background: rgba(74, 158, 255, 0.1);
    pointer-events: none;
    z-index: 100;
    transform-origin: top left;
  }
</style>
