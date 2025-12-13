/**
 * GraphValidator Tests
 * Tests for cycle detection, topological sorting, connection validation, and graph validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GraphValidator } from '@/engine/GraphValidator';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

describe('GraphValidator', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  // Helper to directly add a connection bypassing validation (for testing cycle detection)
  function forceConnection(
    g: Graph,
    fromNode: Node,
    fromPortIndex: number,
    toNode: Node,
    toPortIndex: number
  ) {
    const fromPort = fromNode.outputs[fromPortIndex];
    const toPort = toNode.inputs[toPortIndex];
    const connection = {
      id: `conn_${Date.now()}_${Math.random()}`,
      from: { nodeId: fromNode.id, portId: fromPort.id },
      to: { nodeId: toNode.id, portId: toPort.id },
      type: fromPort.portType
    };
    g.connections.push(connection);
    fromPort.connections.push(connection);
    toPort.connections.push(connection);
  }

  describe('detectCycles', () => {
    it('should return empty array for acyclic graph', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);
      const node3 = new Node('node3', 'Test', graph);

      graph.addElement(node1);
      graph.addElement(node2);
      graph.addElement(node3);

      // Create ports
      node1.out('output', 'param');
      node2.in('input', null);
      node2.out('output', 'param');
      node3.in('input', null);

      // Connect: node1 -> node2 -> node3 (linear, no cycle)
      graph.connect(node1.outputs[0], node2.inputs[0]);
      graph.connect(node2.outputs[0], node3.inputs[0]);

      const cycles = GraphValidator.detectCycles(graph);
      expect(cycles).toHaveLength(0);
    });

    it('should detect simple cycle between two nodes', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);

      graph.addElement(node1);
      graph.addElement(node2);

      // Create ports for both directions
      node1.out('output', 'param');
      node1.in('input', null);
      node2.out('output', 'param');
      node2.in('input', null);

      // Connect: node1 -> node2 (valid)
      graph.connect(node1.outputs[0], node2.inputs[0]);
      // Force connect: node2 -> node1 (creates cycle - bypass validation)
      forceConnection(graph, node2, 0, node1, 0);

      const cycles = GraphValidator.detectCycles(graph);
      expect(cycles.length).toBeGreaterThan(0);
    });

    it('should detect cycle in larger graph', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);
      const node3 = new Node('node3', 'Test', graph);

      graph.addElement(node1);
      graph.addElement(node2);
      graph.addElement(node3);

      // Create ports
      node1.out('output', 'param');
      node1.in('input', null);
      node2.out('output', 'param');
      node2.in('input', null);
      node3.out('output', 'param');
      node3.in('input', null);

      // Create cycle: node1 -> node2 -> node3 -> node1
      graph.connect(node1.outputs[0], node2.inputs[0]);
      graph.connect(node2.outputs[0], node3.inputs[0]);
      // Force the cycle-completing connection
      forceConnection(graph, node3, 0, node1, 0);

      const cycles = GraphValidator.detectCycles(graph);
      expect(cycles.length).toBeGreaterThan(0);
    });

    it('should return empty array for empty graph', () => {
      const cycles = GraphValidator.detectCycles(graph);
      expect(cycles).toHaveLength(0);
    });

    it('should handle disconnected nodes', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);

      graph.addElement(node1);
      graph.addElement(node2);

      // No connections
      const cycles = GraphValidator.detectCycles(graph);
      expect(cycles).toHaveLength(0);
    });
  });

  describe('wouldCreateCycle', () => {
    it('should return true for self-loop', () => {
      const node1 = new Node('node1', 'Test', graph);
      graph.addElement(node1);

      const wouldCycle = GraphValidator.wouldCreateCycle(graph, 'node1', 'node1');
      expect(wouldCycle).toBe(true);
    });

    it('should return false when no path exists', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);

      graph.addElement(node1);
      graph.addElement(node2);

      // No existing connections
      const wouldCycle = GraphValidator.wouldCreateCycle(graph, 'node1', 'node2');
      expect(wouldCycle).toBe(false);
    });

    it('should return true when connection would complete a cycle', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);
      const node3 = new Node('node3', 'Test', graph);

      graph.addElement(node1);
      graph.addElement(node2);
      graph.addElement(node3);

      // Create ports
      node1.out('output', 'param');
      node2.out('output', 'param');
      node2.in('input', null);
      node3.in('input', null);

      // Existing path: node1 -> node2 -> node3
      graph.connect(node1.outputs[0], node2.inputs[0]);
      graph.connect(node2.outputs[0], node3.inputs[0]);

      // Would node3 -> node1 create a cycle? Yes!
      const wouldCycle = GraphValidator.wouldCreateCycle(graph, 'node3', 'node1');
      expect(wouldCycle).toBe(true);
    });

    it('should return false when connection would not create a cycle', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);
      const node3 = new Node('node3', 'Test', graph);

      graph.addElement(node1);
      graph.addElement(node2);
      graph.addElement(node3);

      // Create ports
      node1.out('output', 'param');
      node2.in('input', null);

      // Existing: node1 -> node2
      graph.connect(node1.outputs[0], node2.inputs[0]);

      // Would node1 -> node3 create a cycle? No
      const wouldCycle = GraphValidator.wouldCreateCycle(graph, 'node1', 'node3');
      expect(wouldCycle).toBe(false);
    });
  });

  describe('topologicalSort', () => {
    it('should return correct order for linear graph', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);
      const node3 = new Node('node3', 'Test', graph);

      graph.addElement(node1);
      graph.addElement(node2);
      graph.addElement(node3);

      // Create ports
      node1.out('output', 'param');
      node2.in('input', null);
      node2.out('output', 'param');
      node3.in('input', null);

      // node1 -> node2 -> node3
      graph.connect(node1.outputs[0], node2.inputs[0]);
      graph.connect(node2.outputs[0], node3.inputs[0]);

      const sorted = GraphValidator.topologicalSort(graph);

      // node1 should come before node2, node2 before node3
      expect(sorted.indexOf('node1')).toBeLessThan(sorted.indexOf('node2'));
      expect(sorted.indexOf('node2')).toBeLessThan(sorted.indexOf('node3'));
    });

    it('should handle diamond dependency graph', () => {
      // Diamond: A -> B, A -> C, B -> D, C -> D
      const nodeA = new Node('nodeA', 'Test', graph);
      const nodeB = new Node('nodeB', 'Test', graph);
      const nodeC = new Node('nodeC', 'Test', graph);
      const nodeD = new Node('nodeD', 'Test', graph);

      graph.addElement(nodeA);
      graph.addElement(nodeB);
      graph.addElement(nodeC);
      graph.addElement(nodeD);

      // Create ports
      nodeA.out('output1', 'param');
      nodeA.out('output2', 'param');
      nodeB.in('input', null);
      nodeB.out('output', 'param');
      nodeC.in('input', null);
      nodeC.out('output', 'param');
      nodeD.in('input1', null);
      nodeD.in('input2', null);

      graph.connect(nodeA.outputs[0], nodeB.inputs[0]);
      graph.connect(nodeA.outputs[1], nodeC.inputs[0]);
      graph.connect(nodeB.outputs[0], nodeD.inputs[0]);
      graph.connect(nodeC.outputs[0], nodeD.inputs[1]);

      const sorted = GraphValidator.topologicalSort(graph);

      // A must come first, D must come last
      expect(sorted.indexOf('nodeA')).toBeLessThan(sorted.indexOf('nodeB'));
      expect(sorted.indexOf('nodeA')).toBeLessThan(sorted.indexOf('nodeC'));
      expect(sorted.indexOf('nodeB')).toBeLessThan(sorted.indexOf('nodeD'));
      expect(sorted.indexOf('nodeC')).toBeLessThan(sorted.indexOf('nodeD'));
    });

    it('should throw error for cyclic graph', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);

      graph.addElement(node1);
      graph.addElement(node2);

      // Create ports for both directions
      node1.out('output', 'param');
      node1.in('input', null);
      node2.out('output', 'param');
      node2.in('input', null);

      // Create cycle (bypass validation)
      graph.connect(node1.outputs[0], node2.inputs[0]);
      forceConnection(graph, node2, 0, node1, 0);

      expect(() => GraphValidator.topologicalSort(graph)).toThrow(/cycle/i);
    });

    it('should handle empty graph', () => {
      const sorted = GraphValidator.topologicalSort(graph);
      expect(sorted).toHaveLength(0);
    });

    it('should handle single node', () => {
      const node1 = new Node('node1', 'Test', graph);
      graph.addElement(node1);

      const sorted = GraphValidator.topologicalSort(graph);
      expect(sorted).toEqual(['node1']);
    });
  });

  describe('validateConnection', () => {
    it('should return null for valid connection', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);

      graph.addElement(node1);
      graph.addElement(node2);

      // Create matching ports
      node1.out('output', 'param');
      node2.in('input', null);

      const error = GraphValidator.validateConnection(
        graph,
        'node1',
        'node2',
        node1.outputs[0].id,
        node2.inputs[0].id
      );

      expect(error).toBeNull();
    });

    it('should return error for non-existent nodes', () => {
      const node1 = new Node('node1', 'Test', graph);
      graph.addElement(node1);
      node1.out('output', 'param');

      const error = GraphValidator.validateConnection(
        graph,
        'node1',
        'nonexistent',
        node1.outputs[0].id,
        'fake_port'
      );

      expect(error).not.toBeNull();
      expect(error?.type).toBe('invalid_connection');
    });

    it('should return error for non-existent ports', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);

      graph.addElement(node1);
      graph.addElement(node2);

      node1.out('output', 'param');
      // node2 has no input port

      const error = GraphValidator.validateConnection(
        graph,
        'node1',
        'node2',
        node1.outputs[0].id,
        'fake_input_port'
      );

      expect(error).not.toBeNull();
      expect(error?.type).toBe('invalid_connection');
    });

    it('should return error when connection would create cycle', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);

      graph.addElement(node1);
      graph.addElement(node2);

      // Create ports for both directions
      node1.out('output', 'param');
      node1.in('input', null);
      node2.out('output', 'param');
      node2.in('input', null);

      // Create existing connection: node1 -> node2
      graph.connect(node1.outputs[0], node2.inputs[0]);

      // Try to validate node2 -> node1 (would create cycle)
      const error = GraphValidator.validateConnection(
        graph,
        'node2',
        'node1',
        node2.outputs[0].id,
        node1.inputs[0].id
      );

      expect(error).not.toBeNull();
      expect(error?.type).toBe('cycle');
    });

    it('should return error for port type mismatch', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);

      graph.addElement(node1);
      graph.addElement(node2);

      // Create mismatched port types
      node1.out('output', 'trigger'); // trigger type
      node2.in('input', null); // default is param type

      const error = GraphValidator.validateConnection(
        graph,
        'node1',
        'node2',
        node1.outputs[0].id,
        node2.inputs[0].id
      );

      expect(error).not.toBeNull();
      expect(error?.type).toBe('invalid_connection');
      expect(error?.message).toMatch(/type mismatch/i);
    });
  });

  describe('validateGraph', () => {
    it('should return valid for empty graph', () => {
      const result = GraphValidator.validateGraph(graph);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return valid for acyclic graph', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);

      graph.addElement(node1);
      graph.addElement(node2);

      node1.out('output', 'param');
      node2.in('input', null);

      graph.connect(node1.outputs[0], node2.inputs[0]);

      const result = GraphValidator.validateGraph(graph);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect cycles in graph validation', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);

      graph.addElement(node1);
      graph.addElement(node2);

      node1.out('output', 'param');
      node1.in('input', null);
      node2.out('output', 'param');
      node2.in('input', null);

      // Create cycle (bypass validation)
      graph.connect(node1.outputs[0], node2.inputs[0]);
      forceConnection(graph, node2, 0, node1, 0);

      const result = GraphValidator.validateGraph(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'cycle')).toBe(true);
    });

    it('should identify entry points exist', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);

      graph.addElement(node1);
      graph.addElement(node2);

      node1.out('output', 'param');
      node2.in('input', null);

      graph.connect(node1.outputs[0], node2.inputs[0]);

      const result = GraphValidator.validateGraph(graph);
      // node1 has no inputs connected, so it's an entry point
      expect(result.warnings.some(w => w.type === 'invalid_entry_point')).toBe(false);
    });

    it('should warn when all nodes have input connections (no entry points)', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);

      graph.addElement(node1);
      graph.addElement(node2);

      // Both have inputs
      node1.in('input', null);
      node1.out('output', 'param');
      node2.in('input', null);
      node2.out('output', 'param');

      // Create cycle where all have inputs connected (bypass validation)
      graph.connect(node1.outputs[0], node2.inputs[0]);
      forceConnection(graph, node2, 0, node1, 0);

      const result = GraphValidator.validateGraph(graph);
      // This also creates a cycle which is an error
      expect(result.valid).toBe(false);
    });

    it('should handle single disconnected node', () => {
      const node1 = new Node('node1', 'Test', graph);
      graph.addElement(node1);

      // No connections - single node is an entry point
      const result = GraphValidator.validateGraph(graph);
      expect(result.valid).toBe(true);
    });
  });
});
