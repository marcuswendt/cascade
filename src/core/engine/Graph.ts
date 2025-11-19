import { Node } from './Node.js';
import { AssetManager } from './AssetManager.js';
import { PackageManager } from './PackageManager.js';
import { GraphValidator, type ValidationResult } from './GraphValidator.js';
import type { Connection } from '../../types/node.types.js';
import { packagePathToType, getNodeTemplateCode } from '../../utils/nodeTypeUtils.js';
import { normalizeColor, isColorValue } from '../../utils/colorUtils.js';

export interface CanvasAnnotation {
  id: string;
  type: 'text' | 'image' | 'group' | 'line' | 'polyline';
  content?: string;
  src?: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  points?: { x: number; y: number }[]; // For polyline
  endPosition?: { x: number; y: number }; // For line
  style?: {
    fontSize?: number;
    fontWeight?: 'normal' | 'bold' | '600' | '700';
    fontStyle?: 'normal' | 'italic';
    textAlign?: 'left' | 'center' | 'right';
    color?: string;
    backgroundColor?: string;
    padding?: number;
    borderRadius?: number;
    borderLeft?: string;
    strokeWidth?: number;
    strokeColor?: string;
  };
  caption?: string;
  containedElements?: string[];
}

export type ExecutionState = 'idle' | 'running' | 'paused' | 'stopped';

export class Graph {
  nodes: Node[] = [];
  connections: Connection[] = [];
  private connectionIdCounter: number = 0;
  annotations: CanvasAnnotation[] = [];
  packageManager: PackageManager;
  assetManager: AssetManager;
  
  // Execution Control (v1.2)
  cookingNodes: Set<Node> = new Set();
  multiCookMode: boolean = false;
  
  // Execution state
  executionState: ExecutionState = 'idle';
  private executionQueue: Node[] = [];
  
  // Cached topological order (invalidated when graph structure changes)
  private cachedTopologicalOrder: string[] | null = null;
  
  constructor(assetManager?: AssetManager, packageManager?: PackageManager) {
    this.assetManager = assetManager || new AssetManager();
    this.packageManager = packageManager || new PackageManager();
  }
  
  /**
   * Generates a unique node ID based on a base ID.
   * Always appends a number starting from 1 (e.g., "Checkers1", "Checkers2").
   * Ensures the ID has no spaces.
   * @param baseId The base ID to use (typically the node type)
   * @param excludeNodeId Optional node ID to exclude from uniqueness check (useful when renaming)
   * @returns A unique node ID with no spaces
   */
  generateUniqueNodeId(baseId: string, excludeNodeId?: string): string {
    // Remove spaces from base ID
    const sanitizedBaseId = baseId.replace(/\s+/g, '');
    
    // Always use numbered versions starting from 1
    let counter = 1;
    let candidateId = `${sanitizedBaseId}${counter}`;
    
    // Find the first available numbered ID
    while (this.nodes.some(
      node => node.id === candidateId && (!excludeNodeId || node.id !== excludeNodeId)
    )) {
      counter++;
      candidateId = `${sanitizedBaseId}${counter}`;
    }
    
    return candidateId;
  }
  
  addNode(type: string, position: { x: number; y: number }): Node {
    // Type should be a package path, but we'll convert to short type for internal use
    const shortType = packagePathToType(type);
    
    // Generate unique ID automatically based on short type
    const id = this.generateUniqueNodeId(shortType);
    const node = new Node(id, shortType, this);
    node.position = position;
    this.nodes.push(node);
    
    // Invalidate cached topological order when graph structure changes
    this.invalidateTopologicalOrder();
    
    return node;
  }
  
  removeNode(nodeId: string) {
    const index = this.nodes.findIndex(n => n.id === nodeId);
    if (index >= 0) {
      const node = this.nodes[index];
      
      // Call onDestroy if exists
      if (node.onDestroy) {
        node.onDestroy();
      }
      
      // Remove connections
      this.connections = this.connections.filter(
        c => c.from.nodeId !== nodeId && c.to.nodeId !== nodeId
      );
      
      // Remove node
      this.nodes.splice(index, 1);
      
      // Invalidate cached topological order when graph structure changes
      this.invalidateTopologicalOrder();
    }
  }
  
  getNode(nodeId: string): Node | null {
    return this.nodes.find(n => n.id === nodeId) || null;
  }
  
  /**
   * Validate a connection before creating it
   */
  validateConnection(fromPort: any, toPort: any): { valid: boolean; error?: string } {
    const fromNodeId = fromPort.id.split('_out_')[0];
    const toNodeId = toPort.id.split('_in_')[0];
    
    const error = GraphValidator.validateConnection(
      this,
      fromNodeId,
      toNodeId,
      fromPort.id,
      toPort.id
    );
    
    if (error) {
      return { valid: false, error: error.message };
    }
    
    return { valid: true };
  }
  
  connect(fromPort: any, toPort: any): Connection {
    // Validate connection first
    const validation = this.validateConnection(fromPort, toPort);
    if (!validation.valid) {
      throw new Error(`Invalid connection: ${validation.error}`);
    }
    
    // Use a counter to ensure unique IDs even if connections are created in the same millisecond
    const connection: Connection = {
      id: `conn_${Date.now()}_${++this.connectionIdCounter}`,
      from: { 
        nodeId: fromPort.id.split('_out_')[0], 
        portId: fromPort.id 
      },
      to: { 
        nodeId: toPort.id.split('_in_')[0], 
        portId: toPort.id 
      },
      type: fromPort.portType
    };
    
    // Check for duplicates before adding
    const existing = this.connections.find(c => 
      c.from.nodeId === connection.from.nodeId &&
      c.from.portId === connection.from.portId &&
      c.to.nodeId === connection.to.nodeId &&
      c.to.portId === connection.to.portId
    );
    
    if (existing) {
      // Return existing connection instead of creating duplicate
      return existing;
    }
    
    this.connections.push(connection);
    fromPort.connections.push(connection);
    toPort.connections.push(connection);
    
    // Invalidate cached topological order when graph structure changes
    this.invalidateTopologicalOrder();
    
    // Propagate existing value from output port to input port when connection is made
    if (fromPort.value !== undefined && fromPort.value !== null) {
      toPort.value = fromPort.value;
      // Trigger onChange callback if it exists
      if (toPort.onChange) {
        try {
          toPort.onChange(fromPort.value);
        } catch (err) {
          console.error(`Error in onChange callback for port ${toPort.name}:`, err);
        }
      }
    }
    
    return connection;
  }
  
  disconnect(connectionId: string) {
    const index = this.connections.findIndex(c => c.id === connectionId);
    if (index >= 0) {
      const conn = this.connections[index];
      
      // Remove from port connections
      this.nodes.forEach(node => {
        node.inputs.forEach(p => {
          p.connections = p.connections.filter(c => c.id !== connectionId);
        });
        node.outputs.forEach(p => {
          p.connections = p.connections.filter(c => c.id !== connectionId);
        });
      });
      
      this.connections.splice(index, 1);
      
      // Invalidate cached topological order when graph structure changes
      this.invalidateTopologicalOrder();
    }
  }
  
  /**
   * Validate the entire graph
   */
  validate(): ValidationResult {
    return GraphValidator.validateGraph(this);
  }
  
  /**
   * Execute graph using topological sort for proper ordering
   */
  async execute(entryNode?: Node) {
    if (this.executionState === 'running') {
      console.warn('Graph execution already in progress');
      return;
    }

    this.executionState = 'running';
    
    try {
      if (entryNode) {
        // Execute from specific entry point
        await this.executeFromEntry(entryNode);
      } else {
        // Execute all entry points (nodes with no input connections)
        const entryPoints = this.nodes.filter(
          node => node.inputs.every(p => p.connections.length === 0)
        );
        
        if (entryPoints.length === 0) {
          console.warn('No entry points found in graph');
          return;
        }
        
        // Execute all entry points in parallel
        await Promise.all(entryPoints.map(node => this.executeFromEntry(node)));
      }
    } finally {
      this.executionState = 'idle';
    }
  }
  
  /**
   * Get or compute topological order for the entire graph
   * Caches the result until graph structure changes
   */
  private getTopologicalOrder(): string[] {
    if (this.cachedTopologicalOrder) {
      return this.cachedTopologicalOrder;
    }
    
    this.cachedTopologicalOrder = GraphValidator.topologicalSort(this);
    return this.cachedTopologicalOrder;
  }
  
  /**
   * Invalidate cached topological order (call when graph structure changes)
   */
  private invalidateTopologicalOrder(): void {
    this.cachedTopologicalOrder = null;
  }
  
  /**
   * Execute from a specific entry node using topological sort
   */
  private async executeFromEntry(entryNode: Node) {
    // Build dependency graph starting from entry node
    const nodesToExecute = new Set<Node>();
    const visited = new Set<string>();
    
    const collectDownstream = (node: Node) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      nodesToExecute.add(node);
      
      // Collect all downstream nodes
      for (const output of node.outputs) {
        for (const conn of output.connections) {
          const downstreamNode = this.getNode(conn.to.nodeId);
          if (downstreamNode) {
            collectDownstream(downstreamNode);
          }
        }
      }
    };
    
    collectDownstream(entryNode);
    
    // Create a subgraph with only these nodes for topological sort
    const subgraph = new Graph(this.assetManager, this.packageManager);
    subgraph.nodes = Array.from(nodesToExecute);
    subgraph.connections = this.connections.filter(conn => {
      const fromNode = this.getNode(conn.from.nodeId);
      const toNode = this.getNode(conn.to.nodeId);
      return fromNode && toNode && nodesToExecute.has(fromNode) && nodesToExecute.has(toNode);
    });
    
    // Get topological order for this subgraph
    const sortedNodeIds = GraphValidator.topologicalSort(subgraph);
    
    // Group nodes by dependency level for parallel execution
    const nodeLevels: Node[][] = [];
    const nodeToLevel = new Map<string, number>();
    
    // Calculate level for each node (distance from entry point)
    const calculateLevel = (nodeId: string): number => {
      if (nodeToLevel.has(nodeId)) {
        return nodeToLevel.get(nodeId)!;
      }
      
      const node = this.getNode(nodeId);
      if (!node) return 0;
      
      let maxUpstreamLevel = -1;
      for (const input of node.inputs) {
        for (const conn of input.connections) {
          const upstreamLevel = calculateLevel(conn.from.nodeId);
          maxUpstreamLevel = Math.max(maxUpstreamLevel, upstreamLevel);
        }
      }
      
      const level = maxUpstreamLevel + 1;
      nodeToLevel.set(nodeId, level);
      
      // Ensure level array is large enough
      while (nodeLevels.length <= level) {
        nodeLevels.push([]);
      }
      nodeLevels[level].push(node);
      
      return level;
    };
    
    // Calculate levels for all nodes
    sortedNodeIds.forEach(nodeId => calculateLevel(nodeId));
    
    // Execute nodes level by level, with parallel execution within each level
    for (const level of nodeLevels) {
      await Promise.all(level.map(node => node.execute()));
    }
  }
  
  stop() {
    this.executionState = 'stopped';
    // Stop all execution (for future use with timers/intervals)
    this.nodes.forEach(node => {
      if (node.onDestroy) {
        // Could be enhanced to stop specific operations
      }
    });
  }
  
  reset() {
    // Reset all node states
    this.nodes.forEach(node => {
      node.error = null;
      node.warning = null;
      node.markDirty(); // Mark as dirty to force re-execution
    });
    this.cookingNodes.clear();
    this.multiCookMode = false;
    this.executionState = 'idle';
    this.executionQueue = [];
  }
  
  // Behavior Control (v1.2)
  clearCookingNodes(except?: Node): void {
    if (except) {
      this.cookingNodes.forEach(node => {
        if (node !== except) {
          node.setCooking(false);
        }
      });
    } else {
      this.cookingNodes.forEach(node => {
        node.setCooking(false);
      });
    }
  }
  
  isDownstreamOfCooking(node: Node): boolean {
    // Check if node is downstream of any cooking node
    const visited = new Set<string>();
    
    const checkUpstream = (n: Node): boolean => {
      if (visited.has(n.id)) return false;
      visited.add(n.id);
      
      if (this.cookingNodes.has(n)) {
        return true;
      }
      
      // Check all upstream nodes
      for (const input of n.inputs) {
        for (const conn of input.connections) {
          const upstreamNode = this.getNode(conn.from.nodeId);
          if (upstreamNode && checkUpstream(upstreamNode)) {
            return true;
          }
        }
      }
      
      return false;
    };
    
    return checkUpstream(node);
  }
  
  // Annotation Management (v1.3)
  addAnnotation(annotation: CanvasAnnotation): void {
    this.annotations.push(annotation);
  }
  
  removeAnnotation(id: string): void {
    const index = this.annotations.findIndex(a => a.id === id);
    if (index >= 0) {
      this.annotations.splice(index, 1);
    }
  }
  
  getAnnotation(id: string): CanvasAnnotation | null {
    return this.annotations.find(a => a.id === id) || null;
  }
  
  toJSON() {
    const result: any = {
      version: '0.1',
      metadata: {
        name: 'Cascade Graph',
        created: new Date().toISOString(),
        modified: new Date().toISOString()
      }
    };
    
    // Only include packages if not empty
    const packages = this.packageManager.getCachedPackages().map((pkg: string) => {
      const [name, version] = pkg.split('@');
      return { name, version: version || 'latest' };
    });
    if (packages.length > 0) {
      result.packages = packages;
    }
    
    // Only include assets if manifest is not empty
    const assets = this.assetManager.list().map(asset => ({
      id: asset.id,
      path: asset.path,
      type: asset.type,
      size: asset.size
    }));
    if (assets.length > 0) {
      result.assets = { manifest: assets };
    }
    
    result.nodes = this.nodes.map(n => n.toJSON());
    
    // Only include connections if not empty
    const connections = this.connections.map(conn => {
      const fromNode = this.getNode(conn.from.nodeId);
      const toNode = this.getNode(conn.to.nodeId);
      if (!fromNode || !toNode) return null;
      
      // Find port indices
      const fromPortIndex = fromNode.outputs.findIndex(p => p.id === conn.from.portId);
      const toPortIndex = toNode.inputs.findIndex(p => p.id === conn.to.portId);
      
      if (fromPortIndex === -1 || toPortIndex === -1) return null;
      
      // Return as [[nodeId, portIndex], [nodeId, portIndex]]
      return [[conn.from.nodeId, fromPortIndex], [conn.to.nodeId, toPortIndex]];
    }).filter((conn): conn is [[string, number], [string, number]] => conn !== null);
    if (connections.length > 0) {
      result.connections = connections;
    }
    
    // Only include annotations if not empty
    if (this.annotations.length > 0) {
      result.annotations = this.annotations.map(ann => {
        const serialized: any = {
          id: ann.id,
          type: ann.type,
          position: [ann.position.x, ann.position.y]
        };
        if (ann.content !== undefined) serialized.content = ann.content;
        if (ann.src !== undefined) serialized.src = ann.src;
        if (ann.size) serialized.size = ann.size;
        if (ann.points) serialized.points = ann.points.map(p => [p.x, p.y]);
        if (ann.endPosition) serialized.endPosition = [ann.endPosition.x, ann.endPosition.y];
        if (ann.style) serialized.style = ann.style;
        if (ann.caption !== undefined) serialized.caption = ann.caption;
        if (ann.containedElements) serialized.containedElements = ann.containedElements;
        return serialized;
      });
    }
    
    // Execution section is redundant:
    // - entryPoints are computed dynamically from nodes with no input connections
    // - cookingNodes are derived from the 'cook' flag on each node
    // Both are restored automatically when nodes are loaded
    
    return result;
  }

  static fromJSON(json: any, assetManager?: AssetManager, packageManager?: PackageManager): Graph {
    const graph = new Graph(assetManager, packageManager);
    
    // Load packages if specified (for future use)
    if (json.packages && Array.isArray(json.packages)) {
      // Packages will be loaded on-demand when nodes require them
      // We could preload them here, but it's better to load on-demand
    }
    
    // Create nodes
    json.nodes.forEach((nodeData: any) => {
      // Use the saved ID directly, or generate a unique one if not present
      let nodeId = nodeData.id;
      if (!nodeId) {
        // Fallback: use name if available (for backward compatibility), otherwise use type
        const baseId = nodeData.name || nodeData.type;
        nodeId = graph.generateUniqueNodeId(baseId);
      } else {
        // Check if ID is unique, if not, generate a unique variant
        let counter = 1;
        let candidateId = nodeId;
        while (graph.nodes.some(n => n.id === candidateId)) {
          counter++;
          candidateId = `${nodeId}${counter}`;
        }
        nodeId = candidateId;
      }
      
      // Type must be a package path (e.g., "cascade.lens.Color")
      const nodeType = nodeData.type;
      if (!nodeType || !nodeType.includes('.')) {
        console.warn(`Invalid node type format: ${nodeType}. Expected package path (e.g., "cascade.lens.Color"). Skipping node.`);
        return;
      }
      
      // Extract short type name for internal representation
      const shortType = packagePathToType(nodeType);
      
      // Try to load template code for standard library nodes
      let nodeCode = nodeData.code || '';
      const templateCode = getNodeTemplateCode(nodeType);
      if (templateCode) {
        // Use template code instead of stored code for standard library nodes
        nodeCode = templateCode;
      }
      
      // Create node with the short type name (internal representation)
      const node = new Node(nodeId, shortType, graph);
      
      // Support both array [x, y] and object { x, y } formats for backward compatibility
      if (Array.isArray(nodeData.position)) {
        node.position = { x: nodeData.position[0] || 0, y: nodeData.position[1] || 0 };
      } else if (nodeData.position && typeof nodeData.position === 'object') {
        node.position = { x: nodeData.position.x || 0, y: nodeData.position.y || 0 };
      } else {
        node.position = { x: 0, y: 0 };
      }
      node.code = nodeCode;
      node.comment = nodeData.comment || '';
      graph.nodes.push(node);
      
      // Restore port metadata if available (avoids need to execute for port discovery)
      if (nodeData.inputs && Array.isArray(nodeData.inputs)) {
        nodeData.inputs.forEach((portData: any) => {
          // Create port using the stored metadata
          const port = node.in(portData.name, portData.defaultValue, {
            type: portData.dataType || 'any'
          });
          // Restore port ID to match saved ID (needed for connection restoration)
          if (port.id !== portData.id) {
            (port as any).id = portData.id;
          }
        });
      }
      
      if (nodeData.outputs && Array.isArray(nodeData.outputs)) {
        nodeData.outputs.forEach((portData: any) => {
          // Create port using the stored metadata
          const port = node.out(portData.name, portData.portType || 'param');
          // Restore port ID to match saved ID (needed for connection restoration)
          if (port.id !== portData.id) {
            (port as any).id = portData.id;
          }
        });
      }
      
      // Restore props
      if (nodeData.props) {
        Object.entries(nodeData.props).forEach(([key, value]: [string, any]) => {
          // Normalize color values to object format (support multiple input formats for backward compatibility)
          let normalizedValue = value;
          if (isColorValue(value)) {
            const normalized = normalizeColor(value);
            // Only include alpha if it's not 1.0
            normalizedValue = normalized.a !== undefined && normalized.a !== 1.0
              ? { r: normalized.r, g: normalized.g, b: normalized.b, a: normalized.a }
              : { r: normalized.r, g: normalized.g, b: normalized.b };
          }
          
          // Props will be defined when node code executes
          // For now, we store the values to restore later
          if (!node.props[key]) {
            node.props[key] = { value: normalizedValue } as any;
          } else {
            node.props[key].value = normalizedValue;
          }
        });
      }
      
      // Restore behavior toggles (support both old and new field names)
      const bypassValue = nodeData.bypass !== undefined ? nodeData.bypass : nodeData.bypassed;
      if (bypassValue !== undefined) {
        node.setBypassed(bypassValue);
      }
      const cookValue = nodeData.cook !== undefined ? nodeData.cook : nodeData.cooking;
      if (cookValue !== undefined) {
        node.setCooking(cookValue);
      }
      
      // Restore node function if code exists
      if (node.code) {
        try {
          // Wrap code in async function to support top-level await
          // The function should return a promise that resolves when the async code completes
          const wrappedCode = `return (async function(node, graph) {\n${node.code}\n})(node, graph);`;
          const nodeFunction = new Function('node', 'graph', wrappedCode) as (node: any, graph: any) => Promise<any>;
          node.setFunction(nodeFunction);
        } catch (err) {
          console.warn('Failed to compile node ' + node.id + ':', err);
        }
      }
    });
    
    // Restore connections (ports may not exist yet if nodes haven't executed)
    // Connections will be fully validated after nodes execute
    const connectionsToRestore = json.connections || [];
    
    // Restore annotations (support both array and object position formats)
    if (json.annotations && Array.isArray(json.annotations)) {
      graph.annotations = json.annotations.map((annData: any) => {
        const annotation: CanvasAnnotation = {
          id: annData.id,
          type: annData.type,
          position: Array.isArray(annData.position) 
            ? { x: annData.position[0] || 0, y: annData.position[1] || 0 }
            : { x: annData.position?.x || 0, y: annData.position?.y || 0 }
        };
        if (annData.content !== undefined) annotation.content = annData.content;
        if (annData.src !== undefined) annotation.src = annData.src;
        if (annData.size) annotation.size = annData.size;
        if (annData.points) {
          annotation.points = annData.points.map((p: any) => 
            Array.isArray(p) 
              ? { x: p[0] || 0, y: p[1] || 0 }
              : { x: p.x || 0, y: p.y || 0 }
          );
        }
        if (annData.endPosition) {
          annotation.endPosition = Array.isArray(annData.endPosition)
            ? { x: annData.endPosition[0] || 0, y: annData.endPosition[1] || 0 }
            : { x: annData.endPosition.x || 0, y: annData.endPosition.y || 0 };
        }
        if (annData.style) annotation.style = annData.style;
        if (annData.caption !== undefined) annotation.caption = annData.caption;
        if (annData.containedElements) annotation.containedElements = annData.containedElements;
        return annotation;
      });
    }
    
    // Store connections to restore after nodes execute (for CLI/headless environments)
    // In browser, connections are restored here but may fail silently if ports don't exist yet
    (graph as any)._connectionsToRestore = connectionsToRestore;
    
    // Try to restore connections now (will work if nodes were already executed)
    // If ports don't exist, they'll be restored later when restoreConnections() is called
    connectionsToRestore.forEach((connData: any) => {
      // Support both old format (object with nodeId/portId) and new format (array with indices)
      let fromNodeId: string, fromPortIndex: number | string;
      let toNodeId: string, toPortIndex: number | string;
      
      if (Array.isArray(connData) && Array.isArray(connData[0]) && Array.isArray(connData[1])) {
        // New format: [[nodeId, portIndex], [nodeId, portIndex]]
        [fromNodeId, fromPortIndex] = connData[0];
        [toNodeId, toPortIndex] = connData[1];
      } else if (connData.from && connData.to) {
        // Old format: { from: { nodeId, portId }, to: { nodeId, portId } }
        fromNodeId = connData.from.nodeId;
        toNodeId = connData.to.nodeId;
        const fromNode = graph.getNode(fromNodeId);
        const toNode = graph.getNode(toNodeId);
        if (fromNode && toNode) {
          const fromPort = fromNode.outputs.find(p => p.id === connData.from.portId);
          const toPort = toNode.inputs.find(p => p.id === connData.to.portId);
          if (fromPort && toPort) {
            try {
              graph.connect(fromPort, toPort);
            } catch (err) {
              // Connection failed - will be retried after nodes execute
            }
          }
        }
        return; // Skip new format processing for old format
      } else {
        return; // Invalid format
      }
      
      // New format: use indices
      const fromNode = graph.getNode(fromNodeId);
      const toNode = graph.getNode(toNodeId);
      if (fromNode && toNode && typeof fromPortIndex === 'number' && typeof toPortIndex === 'number') {
        const fromPort = fromNode.outputs[fromPortIndex];
        const toPort = toNode.inputs[toPortIndex];
        if (fromPort && toPort) {
          try {
            graph.connect(fromPort, toPort);
          } catch (err) {
            // Connection failed - will be retried after nodes execute
          }
        }
      }
    });
    
    return graph;
  }
  
  /**
   * Restore connections that were stored during fromJSON
   * Call this after nodes have been executed to ensure ports exist
   */
  restoreConnections(): void {
    const connectionsToRestore = (this as any)._connectionsToRestore || [];
    if (connectionsToRestore.length === 0) return;
    
    connectionsToRestore.forEach((connData: any) => {
      // Support both old format (object with nodeId/portId) and new format (array with indices)
      let fromNodeId: string, fromPortIndex: number | string;
      let toNodeId: string, toPortIndex: number | string;
      
      if (Array.isArray(connData) && Array.isArray(connData[0]) && Array.isArray(connData[1])) {
        // New format: [[nodeId, portIndex], [nodeId, portIndex]]
        [fromNodeId, fromPortIndex] = connData[0];
        [toNodeId, toPortIndex] = connData[1];
      } else if (connData.from && connData.to) {
        // Old format: { from: { nodeId, portId }, to: { nodeId, portId } }
        fromNodeId = connData.from.nodeId;
        toNodeId = connData.to.nodeId;
        const fromNode = this.getNode(fromNodeId);
        const toNode = this.getNode(toNodeId);
        if (fromNode && toNode) {
          const fromPort = fromNode.outputs.find(p => p.id === connData.from.portId);
          const toPort = toNode.inputs.find(p => p.id === connData.to.portId);
          if (fromPort && toPort) {
            // Check if connection already exists
            const exists = this.connections.some(c => 
              c.from.nodeId === fromNodeId &&
              c.from.portId === fromPort.id &&
              c.to.nodeId === toNodeId &&
              c.to.portId === toPort.id
            );
            if (!exists) {
              try {
                this.connect(fromPort, toPort);
              } catch (err) {
                // Connection validation failed - skip it
              }
            }
          }
        }
        return; // Skip new format processing for old format
      } else {
        return; // Invalid format
      }
      
      // New format: use indices
      const fromNode = this.getNode(fromNodeId);
      const toNode = this.getNode(toNodeId);
      if (fromNode && toNode && typeof fromPortIndex === 'number' && typeof toPortIndex === 'number') {
        const fromPort = fromNode.outputs[fromPortIndex];
        const toPort = toNode.inputs[toPortIndex];
        if (fromPort && toPort) {
          // Check if connection already exists
          const exists = this.connections.some(c => 
            c.from.nodeId === fromNodeId &&
            c.from.portId === fromPort.id &&
            c.to.nodeId === toNodeId &&
            c.to.portId === toPort.id
          );
          if (!exists) {
            try {
              this.connect(fromPort, toPort);
            } catch (err) {
              // Connection validation failed - skip it
            }
          }
        }
      }
    });
    
    // Clean up
    delete (this as any)._connectionsToRestore;
  }
}

