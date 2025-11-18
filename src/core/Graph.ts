import { Node } from './Node';
import { AssetManager } from './AssetManager';
import { PackageManager } from './PackageManager';
import type { Connection } from '@/types/node.types';

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

export class Graph {
  nodes: Node[] = [];
  connections: Connection[] = [];
  private connectionIdCounter: number = 0;
  annotations: CanvasAnnotation[] = [];
  packageManager: PackageManager;
  assetManager: AssetManager;
  sceneContainer: HTMLElement;
  
  // Execution Control (v1.2)
  cookingNodes: Set<Node> = new Set();
  multiCookMode: boolean = false;
  
  constructor() {
    this.sceneContainer = document.createElement('div');
    this.sceneContainer.id = 'cascade-scene';
    this.assetManager = new AssetManager();
    this.packageManager = new PackageManager();
  }
  
  addNode(type: string, position: { x: number; y: number }): Node {
    const id = `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const node = new Node(id, type, this);
    node.position = position;
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
  
  connect(fromPort: any, toPort: any): Connection {
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
  
  async execute(entryNode?: Node) {
    if (entryNode) {
      await this.executeUpstream(entryNode);
    } else {
      // Execute all nodes with no input connections
      const promises: Promise<void>[] = [];
      this.nodes.forEach(node => {
        if (node.inputs.every(p => p.connections.length === 0)) {
          promises.push(this.executeUpstream(node));
        }
      });
      await Promise.all(promises);
    }
  }
  
  async executeUpstream(node: Node) {
    // Execute all upstream nodes first
    const upstreamPromises: Promise<void>[] = [];
    node.inputs.forEach(input => {
      input.connections.forEach(conn => {
        const upstreamNode = this.getNode(conn.from.nodeId);
        if (upstreamNode) {
          upstreamPromises.push(this.executeUpstream(upstreamNode));
        }
      });
    });
    
    // Wait for all upstream nodes to finish, then execute this node
    await Promise.all(upstreamPromises);
    await node.execute();
  }
  
  stop() {
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

  static fromJSON(json: any): Graph {
    const graph = new Graph();
    
    // Load packages if specified (for future use)
    if (json.packages && Array.isArray(json.packages)) {
      // Packages will be loaded on-demand when nodes require them
      // We could preload them here, but it's better to load on-demand
    }
    
    // Create nodes
    json.nodes.forEach((nodeData: any) => {
      const node = graph.addNode(nodeData.type, nodeData.position || { x: 0, y: 0 });
      node.id = nodeData.id;
      node.name = nodeData.name || nodeData.type;
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
    
    // Restore connections
    json.connections.forEach((connData: any) => {
      const fromNode = graph.getNode(connData.from.nodeId);
      const toNode = graph.getNode(connData.to.nodeId);
      if (fromNode && toNode) {
        const fromPort = fromNode.outputs.find(p => p.id === connData.from.portId);
        const toPort = toNode.inputs.find(p => p.id === connData.to.portId);
        if (fromPort && toPort) {
          graph.connect(fromPort, toPort);
        }
      }
    });
    
    // Restore annotations
    if (json.annotations && Array.isArray(json.annotations)) {
      graph.annotations = json.annotations;
    }
    
    return graph;
  }
}

