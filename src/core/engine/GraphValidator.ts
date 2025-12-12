import type { Graph } from './Graph.js';
import type { Node } from './Node.js';
import type { Connection } from '../../types/node.types.js';

export interface ValidationError {
  type: 'cycle' | 'invalid_connection' | 'orphaned_node' | 'invalid_entry_point';
  message: string;
  nodeIds?: string[];
  connectionId?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Graph validator for detecting cycles, invalid connections, and other graph problems
 */
export class GraphValidator {
  /**
   * Detect cycles in the graph using DFS
   * Returns array of node IDs involved in cycles
   */
  static detectCycles(graph: Graph): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const path: string[] = [];

    const dfs = (nodeId: string): boolean => {
      if (recStack.has(nodeId)) {
        // Found a cycle - extract the cycle path
        const cycleStart = path.indexOf(nodeId);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), nodeId]);
        }
        return true;
      }

      if (visited.has(nodeId)) {
        return false;
      }

      visited.add(nodeId);
      recStack.add(nodeId);
      path.push(nodeId);

      const node = graph.getNode(nodeId);
      if (node) {
        // Check all downstream nodes (outputs -> inputs)
        for (const output of node.outputs) {
          for (const conn of output.connections) {
            dfs(conn.to.nodeId);
          }
        }
      }

      recStack.delete(nodeId);
      path.pop();
      return false;
    };

    // Check all nodes (filter elements by type)
    const nodes = graph.nodes;
    for (const node of nodes) {
      if (!visited.has(node.id)) {
        dfs(node.id);
      }
    }

    return cycles;
  }

  /**
   * Check if adding a connection would create a cycle
   */
  static wouldCreateCycle(
    graph: Graph,
    fromNodeId: string,
    toNodeId: string
  ): boolean {
    // If connecting to the same node, it's a self-loop (cycle)
    if (fromNodeId === toNodeId) {
      return true;
    }

    // Check if there's already a path from toNode to fromNode
    // If so, adding this connection would create a cycle
    const visited = new Set<string>();
    
    const hasPath = (startId: string, targetId: string): boolean => {
      if (startId === targetId) return true;
      if (visited.has(startId)) return false;
      
      visited.add(startId);
      const node = graph.getNode(startId);
      if (!node) return false;

      for (const output of node.outputs) {
        for (const conn of output.connections) {
          if (hasPath(conn.to.nodeId, targetId)) {
            return true;
          }
        }
      }
      return false;
    };

    return hasPath(toNodeId, fromNodeId);
  }

  /**
   * Perform topological sort of nodes
   * Returns sorted node IDs, or throws if cycles exist
   */
  static topologicalSort(graph: Graph): string[] {
    const cycles = this.detectCycles(graph);
    if (cycles.length > 0) {
      throw new Error(
        `Graph contains cycles: ${cycles.map(c => c.join(' -> ')).join(', ')}`
      );
    }

    const sorted: string[] = [];
    const visited = new Set<string>();
    const tempMark = new Set<string>();

    const visit = (nodeId: string) => {
      if (tempMark.has(nodeId)) {
        throw new Error(`Cycle detected involving node ${nodeId}`);
      }
      if (visited.has(nodeId)) {
        return;
      }

      tempMark.add(nodeId);
      const node = graph.getNode(nodeId);
      if (node) {
        // Visit all upstream nodes first
        for (const input of node.inputs) {
          for (const conn of input.connections) {
            visit(conn.from.nodeId);
          }
        }
      }

      tempMark.delete(nodeId);
      visited.add(nodeId);
      sorted.push(nodeId);
    };

    // Visit all nodes (filter elements by type)
    const nodes = graph.nodes;
    for (const node of nodes) {
      if (!visited.has(node.id)) {
        visit(node.id);
      }
    }

    return sorted;
  }

  /**
   * Validate a connection before it's added
   */
  static validateConnection(
    graph: Graph,
    fromNodeId: string,
    toNodeId: string,
    fromPortId: string,
    toPortId: string
  ): ValidationError | null {
    const fromNode = graph.getNode(fromNodeId);
    const toNode = graph.getNode(toNodeId);

    if (!fromNode || !toNode) {
      return {
        type: 'invalid_connection',
        message: `Invalid connection: node not found`,
        nodeIds: [fromNodeId, toNodeId]
      };
    }

    const fromPort = fromNode.outputs.find(p => p.id === fromPortId);
    const toPort = toNode.inputs.find(p => p.id === toPortId);

    if (!fromPort || !toPort) {
      return {
        type: 'invalid_connection',
        message: `Invalid connection: port not found`,
        nodeIds: [fromNodeId, toNodeId]
      };
    }

    // Check port types match
    if (fromPort.portType !== toPort.portType) {
      return {
        type: 'invalid_connection',
        message: `Port type mismatch: cannot connect ${fromPort.portType} to ${toPort.portType}`,
        nodeIds: [fromNodeId, toNodeId]
      };
    }

    // Check for cycles
    if (this.wouldCreateCycle(graph, fromNodeId, toNodeId)) {
      return {
        type: 'cycle',
        message: `Connection would create a cycle: ${fromNodeId} -> ${toNodeId}`,
        nodeIds: [fromNodeId, toNodeId]
      };
    }

    return null;
  }

  /**
   * Validate the entire graph
   */
  static validateGraph(graph: Graph): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Check for cycles
    const cycles = this.detectCycles(graph);
    if (cycles.length > 0) {
      cycles.forEach(cycle => {
        errors.push({
          type: 'cycle',
          message: `Cycle detected: ${cycle.join(' -> ')}`,
          nodeIds: cycle
        });
      });
    }

    // Validate all connections
    for (const conn of graph.connections) {
      const fromNode = graph.getNode(conn.from.nodeId);
      const toNode = graph.getNode(conn.to.nodeId);

      if (!fromNode || !toNode) {
        errors.push({
          type: 'invalid_connection',
          message: `Connection references non-existent node`,
          connectionId: conn.id,
          nodeIds: [conn.from.nodeId, conn.to.nodeId]
        });
        continue;
      }

      const fromPort = fromNode.outputs.find(p => p.id === conn.from.portId);
      const toPort = toNode.inputs.find(p => p.id === conn.to.portId);

      if (!fromPort || !toPort) {
        errors.push({
          type: 'invalid_connection',
          message: `Connection references non-existent port`,
          connectionId: conn.id,
          nodeIds: [conn.from.nodeId, conn.to.nodeId]
        });
        continue;
      }

      // Check port types match
      if (fromPort.portType !== toPort.portType) {
        errors.push({
          type: 'invalid_connection',
          message: `Port type mismatch in connection`,
          connectionId: conn.id,
          nodeIds: [conn.from.nodeId, conn.to.nodeId]
        });
      }
    }

    // Check for orphaned nodes (nodes with no connections)
    // Entry point nodes (nodes with no input connections) are not considered orphaned
    const connectedNodes = new Set<string>();
    for (const conn of graph.connections) {
      connectedNodes.add(conn.from.nodeId);
      connectedNodes.add(conn.to.nodeId);
    }

    const nodes = graph.nodes;
    const orphanedNodes = nodes.filter(n => {
      // A node is orphaned if it has no connections AND is not an entry point
      const hasNoConnections = !connectedNodes.has(n.id);
      const isEntryPoint = n.inputs.every(p => p.connections.length === 0);
      return hasNoConnections && !isEntryPoint;
    });
    
    if (orphanedNodes.length > 0) {
      warnings.push({
        type: 'orphaned_node',
        message: `Found ${orphanedNodes.length} orphaned node(s) with no connections`,
        nodeIds: orphanedNodes.map(n => n.id)
      });
    }

    // Check entry points exist
    const entryPoints = nodes.filter(
      node => node.inputs.every(p => p.connections.length === 0)
    );
    if (entryPoints.length === 0 && nodes.length > 0) {
      warnings.push({
        type: 'invalid_entry_point',
        message: 'No entry points found (all nodes have input connections)'
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}

