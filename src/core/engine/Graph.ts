import { Node } from './Node.js';
import { AssetManager } from './AssetManager.js';
import { PackageManager } from './PackageManager.js';
import { GraphValidator, type ValidationResult } from './GraphValidator.js';
import type { Connection } from '../../types/node.types.js';

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
  // Shared visited set for executeUpstream calls during active execution
  private activeExecutionVisited: Set<string> | null = null;
  
  constructor(assetManager?: AssetManager, packageManager?: PackageManager) {
    this.assetManager = assetManager || new AssetManager();
    this.packageManager = packageManager || new PackageManager();
  }
  
  /**
   * Generates a unique node name based on a base name.
   * Always appends a number starting from 1 (e.g., "Checkers1", "Checkers2").
   * @param baseName The base name to use (typically the node type)
   * @param excludeNodeId Optional node ID to exclude from uniqueness check (useful when renaming)
   * @returns A unique node name
   */
  generateUniqueNodeName(baseName: string, excludeNodeId?: string): string {
    // Always use numbered versions starting from 1
    let counter = 1;
    let candidateName = `${baseName}${counter}`;
    
    // Find the first available numbered name
    while (this.nodes.some(
      node => node.name === candidateName && (!excludeNodeId || node.id !== excludeNodeId)
    )) {
      counter++;
      candidateName = `${baseName}${counter}`;
    }
    
    return candidateName;
  }
  
  addNode(type: string, position: { x: number; y: number }): Node {
    const id = `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const node = new Node(id, type, this);
    node.position = position;
    // Generate unique name automatically
    node.name = this.generateUniqueNodeName(type);
    this.nodes.push(node);
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
    // Initialize shared visited set for executeUpstream calls during this execution
    this.activeExecutionVisited = new Set();
    
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
      // Clear shared visited set when execution completes
      this.activeExecutionVisited = null;
    }
  }
  
  /**
   * Execute upstream nodes for a given node, handling execution state internally.
   * This method is safe to call from within node callbacks and will automatically
   * handle cases where graph execution is already in progress.
   * 
   * @param node The node whose upstream dependencies should be executed
   */
  async executeUpstream(node: Node): Promise<void> {
    // If execution is already in progress, execute nodes directly
    // to avoid conflicts with the global execution state
    if (this.executionState === 'running') {
      // Use shared visited set for this execution context to prevent duplicate work
      // and infinite recursion in cycles
      if (!this.activeExecutionVisited) {
        this.activeExecutionVisited = new Set();
      }
      
      // Prevent infinite recursion in case of cycles
      if (this.activeExecutionVisited.has(node.id)) {
        return;
      }
      this.activeExecutionVisited.add(node.id);

      // Execute upstream nodes directly when already in execution context
      const upstreamPromises: Promise<void>[] = [];
      for (const input of node.inputs) {
        for (const conn of input.connections) {
          const upstreamNode = this.getNode(conn.from.nodeId);
          if (upstreamNode) {
            // Recursively execute upstream nodes first (with cycle detection)
            upstreamPromises.push(this.executeUpstream(upstreamNode));
          }
        }
      }
      // Wait for all upstream nodes, then execute this node
      await Promise.all(upstreamPromises);
      await node.execute();
    } else {
      // Use full execute() method for proper topological sort when not in execution context
      try {
        await this.execute(node);
      } catch (err) {
        // Handle cycle detection errors gracefully
        console.warn(`Failed to execute upstream for node ${node.name}:`, err);
      }
    }
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
    
    // Get topological order
    const sortedNodeIds = GraphValidator.topologicalSort(subgraph);
    
    // Execute nodes in topological order
    // Nodes at the same level can execute in parallel
    const executed = new Set<string>();
    
    for (const nodeId of sortedNodeIds) {
      const node = this.getNode(nodeId);
      if (!node) continue;
      
      // Wait for all upstream nodes to complete
      const upstreamPromises: Promise<void>[] = [];
      for (const input of node.inputs) {
        for (const conn of input.connections) {
          const upstreamNode = this.getNode(conn.from.nodeId);
          if (upstreamNode && !executed.has(upstreamNode.id)) {
            // This shouldn't happen with proper topological sort, but safety check
            upstreamPromises.push(
              new Promise(resolve => {
                const checkInterval = setInterval(() => {
                  if (executed.has(upstreamNode.id)) {
                    clearInterval(checkInterval);
                    resolve();
                  }
                }, 10);
              })
            );
          }
        }
      }
      
      await Promise.all(upstreamPromises);
      await node.execute();
      executed.add(nodeId);
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
      node.isDirty = false;
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
    // Get entry points (nodes with no input connections)
    const entryPoints = this.nodes
      .filter(node => node.inputs.every(p => p.connections.length === 0))
      .map(node => node.id);
    
    // Get cooking node IDs
    const cookingNodeIds = Array.from(this.cookingNodes).map(n => n.id);
    
    return {
      version: '0.1',
      metadata: {
        name: 'Cascade Graph',
        created: new Date().toISOString(),
        modified: new Date().toISOString()
      },
      packages: this.packageManager.getCachedPackages().map((pkg: string) => {
        const [name, version] = pkg.split('@');
        return { name, version: version || 'latest' };
      }),
      assets: {
        manifest: this.assetManager.list().map(asset => ({
          id: asset.id,
          path: asset.path,
          type: asset.type,
          size: asset.size
        }))
      },
      nodes: this.nodes.map(n => n.toJSON()),
      connections: this.connections,
      annotations: this.annotations,
      execution: {
        entryPoints,
        cookingNodes: cookingNodeIds,
        autoStart: false
      }
    };
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
      const node = graph.addNode(nodeData.type, nodeData.position || { x: 0, y: 0 });
      node.id = nodeData.id;
      // Generate unique name, using the saved name as base if available
      // Exclude this node from uniqueness check since it's already in the graph
      const baseName = nodeData.name || nodeData.type;
      node.name = graph.generateUniqueNodeName(baseName, node.id);
      node.code = nodeData.code || '';
      node.comment = nodeData.comment || '';
      
      // Restore props
      if (nodeData.props) {
        Object.entries(nodeData.props).forEach(([key, value]: [string, any]) => {
          // Props will be defined when node code executes
          // For now, we store the values to restore later
          if (!node.props[key]) {
            node.props[key] = { value } as any;
          } else {
            node.props[key].value = value;
          }
        });
      }
      
      // Restore behavior toggles
      if (nodeData.bypassed !== undefined) {
        node.setBypassed(nodeData.bypassed);
      }
      if (nodeData.cooking !== undefined) {
        node.setCooking(nodeData.cooking);
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
    
    // Restore annotations
    if (json.annotations && Array.isArray(json.annotations)) {
      graph.annotations = json.annotations;
    }
    
    // Store connections to restore after nodes execute (for CLI/headless environments)
    // In browser, connections are restored here but may fail silently if ports don't exist yet
    (graph as any)._connectionsToRestore = connectionsToRestore;
    
    // Try to restore connections now (will work if nodes were already executed)
    // If ports don't exist, they'll be restored later when restoreConnections() is called
    connectionsToRestore.forEach((connData: any) => {
      const fromNode = graph.getNode(connData.from.nodeId);
      const toNode = graph.getNode(connData.to.nodeId);
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
      const fromNode = this.getNode(connData.from.nodeId);
      const toNode = this.getNode(connData.to.nodeId);
      if (fromNode && toNode) {
        const fromPort = fromNode.outputs.find(p => p.id === connData.from.portId);
        const toPort = toNode.inputs.find(p => p.id === connData.to.portId);
        if (fromPort && toPort) {
          // Check if connection already exists
          const exists = this.connections.some(c => 
            c.from.nodeId === connData.from.nodeId &&
            c.from.portId === connData.from.portId &&
            c.to.nodeId === connData.to.nodeId &&
            c.to.portId === connData.to.portId
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

