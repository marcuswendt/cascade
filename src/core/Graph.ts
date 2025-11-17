import { Node } from './Node';
import { AssetManager } from './AssetManager';
import { PackageManager } from './PackageManager';
import type { Connection } from '@/types/node.types';

export class Graph {
  nodes: Node[] = [];
  connections: Connection[] = [];
  packageManager: PackageManager;
  assetManager: AssetManager;
  sceneContainer: HTMLElement;
  
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
    const connection: Connection = {
      id: `conn_${Date.now()}`,
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
    
    this.connections.push(connection);
    fromPort.connections.push(connection);
    toPort.connections.push(connection);
    
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
  
  execute(entryNode?: Node) {
    if (entryNode) {
      entryNode.execute();
    } else {
      // Execute all nodes with no input connections
      this.nodes.forEach(node => {
        if (node.inputs.every(p => p.connections.length === 0)) {
          node.execute();
        }
      });
    }
  }
  
  toJSON() {
    return {
      version: '1.0.0',
      nodes: this.nodes.map(n => n.toJSON()),
      connections: this.connections,
      packages: this.packageManager.getCachedPackages()
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
    
    return graph;
  }
}

