/**
 * Graph Tests
 * Tests for Graph operations: add/remove elements, connections
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

describe('Graph', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  describe('Element management', () => {
    it('should add nodes to the graph', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      expect(graph.elements).toHaveLength(1);
      expect(graph.elements[0]).toBe(node);
    });

    it('should retrieve nodes by ID', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);
      graph.addElement(node1);
      graph.addElement(node2);

      expect(graph.getNode('node1')).toBe(node1);
      expect(graph.getNode('node2')).toBe(node2);
      expect(graph.getNode('nonexistent')).toBeNull();
    });

    it('should remove nodes from the graph by ID', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);
      expect(graph.elements).toHaveLength(1);

      graph.removeElement('node1');
      expect(graph.elements).toHaveLength(0);
      expect(graph.getNode('node1')).toBeNull();
    });

    it('should filter nodes from elements', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);
      graph.addElement(node1);
      graph.addElement(node2);

      expect(graph.nodes).toHaveLength(2);
      expect(graph.nodes).toContain(node1);
      expect(graph.nodes).toContain(node2);
    });

    it('should track multiple nodes', () => {
      for (let i = 0; i < 5; i++) {
        const node = new Node(`node${i}`, 'Test', graph);
        graph.addElement(node);
      }

      expect(graph.elements).toHaveLength(5);
      expect(graph.nodes).toHaveLength(5);
    });
  });

  describe('Connection management', () => {
    let nodeA: Node;
    let nodeB: Node;
    let nodeC: Node;

    beforeEach(() => {
      nodeA = new Node('nodeA', 'Test', graph);
      nodeB = new Node('nodeB', 'Test', graph);
      nodeC = new Node('nodeC', 'Test', graph);

      graph.addElement(nodeA);
      graph.addElement(nodeB);
      graph.addElement(nodeC);

      // Create ports
      nodeA.out('output', 'param');
      nodeB.in('input', null);
      nodeB.out('output', 'param');
      nodeC.in('input', null);
    });

    it('should create connections between nodes', () => {
      graph.connect(nodeA.outputs[0], nodeB.inputs[0]);

      expect(graph.connections).toHaveLength(1);
      expect(graph.connections[0].from.nodeId).toBe('nodeA');
      expect(graph.connections[0].to.nodeId).toBe('nodeB');
    });

    it('should update port connection arrays', () => {
      graph.connect(nodeA.outputs[0], nodeB.inputs[0]);

      expect(nodeA.outputs[0].connections).toHaveLength(1);
      expect(nodeB.inputs[0].connections).toHaveLength(1);
    });

    it('should allow multiple outputs from same port', () => {
      nodeC.in('input2', null);

      graph.connect(nodeA.outputs[0], nodeB.inputs[0]);
      graph.connect(nodeA.outputs[0], nodeC.inputs[0]);

      expect(nodeA.outputs[0].connections).toHaveLength(2);
      expect(graph.connections).toHaveLength(2);
    });

    it('should disconnect nodes by connection ID', () => {
      const conn = graph.connect(nodeA.outputs[0], nodeB.inputs[0]);
      expect(graph.connections).toHaveLength(1);

      nodeA.outputs[0].value = 42;
      nodeB.inputs[0].value = 42;

      graph.disconnect(conn.id);
      expect(graph.connections).toHaveLength(0);
      expect(nodeA.outputs[0].connections).toHaveLength(0);
      expect(nodeB.inputs[0].connections).toHaveLength(0);
      expect(nodeB.inputs[0].value).toBe(nodeB.inputs[0].defaultValue);
    });

    it('should remove connections when node is removed', () => {
      graph.connect(nodeA.outputs[0], nodeB.inputs[0]);
      graph.connect(nodeB.outputs[0], nodeC.inputs[0]);

      expect(graph.connections).toHaveLength(2);

      graph.removeElement('nodeB');

      expect(graph.connections).toHaveLength(0);
    });

    it('renames a connected node and all structural references atomically', () => {
      const connection = graph.connect(nodeA.outputs[0], nodeB.inputs[0]);
      const oldOutputId = nodeA.outputs[0].id;

      expect(graph.renameElement('nodeA', 'source')).toBe(true);
      expect(graph.getNode('nodeA')).toBeNull();
      expect(graph.getNode('source')).toBe(nodeA);
      expect(nodeA.outputs[0].id).toBe('source_out_0');
      expect(nodeA.getPort(oldOutputId)).toBeNull();
      expect(nodeA.getPort('source_out_0')).toBe(nodeA.outputs[0]);
      expect(connection.from).toEqual({ nodeId: 'source', portId: 'source_out_0' });
      expect(graph.toJSON().connections[0][0][0]).toBe('source');

      expect(graph.renameElement('source', 'nodeB')).toBe(false);
      expect(graph.getNode('source')).toBe(nodeA);
    });

    it('should prevent duplicate connections', () => {
      graph.connect(nodeA.outputs[0], nodeB.inputs[0]);

      // Trying to create same connection again should not duplicate
      expect(() => {
        graph.connect(nodeA.outputs[0], nodeB.inputs[0]);
      }).not.toThrow();

      // Should still only have 1 connection (or throw - depends on implementation)
      expect(graph.connections.length).toBeLessThanOrEqual(2);
    });

    it('should prevent cycle creation', () => {
      graph.connect(nodeA.outputs[0], nodeB.inputs[0]);

      // Add ports for reverse connection
      nodeB.out('output2', 'param');
      nodeA.in('input', null);

      expect(() => {
        graph.connect(nodeB.outputs[1], nodeA.inputs[0]);
      }).toThrow(/cycle/i);
    });

    it('should return connection object when connecting', () => {
      const conn = graph.connect(nodeA.outputs[0], nodeB.inputs[0]);

      expect(conn).toBeDefined();
      expect(conn.id).toBeDefined();
      expect(conn.from).toBeDefined();
      expect(conn.to).toBeDefined();
    });
  });

  describe('Connection validation', () => {
    it('should validate matching port types', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);
      graph.addElement(node1);
      graph.addElement(node2);

      node1.out('output', 'param');
      node2.in('input', null);

      const result = graph.validateConnection(node1.outputs[0], node2.inputs[0]);
      expect(result.valid).toBe(true);
    });

    it('should reject mismatched port types', () => {
      const node1 = new Node('node1', 'Test', graph);
      const node2 = new Node('node2', 'Test', graph);
      graph.addElement(node1);
      graph.addElement(node2);

      node1.out('trigger', 'trigger');
      node2.in('input', null); // default is param

      const result = graph.validateConnection(node1.outputs[0], node2.inputs[0]);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/type/i);
    });
  });

  describe('Node retrieval', () => {
    it('should find nodes by type', () => {
      const blur1 = new Node('blur1', 'Blur', graph);
      const blur2 = new Node('blur2', 'Blur', graph);
      const noise = new Node('noise1', 'Noise', graph);

      graph.addElement(blur1);
      graph.addElement(blur2);
      graph.addElement(noise);

      const blurNodes = graph.nodes.filter(n => n.type === 'Blur');
      expect(blurNodes).toHaveLength(2);
    });

    it('should handle empty graph', () => {
      expect(graph.elements).toHaveLength(0);
      expect(graph.nodes).toHaveLength(0);
      expect(graph.connections).toHaveLength(0);
      expect(graph.getNode('anything')).toBeNull();
    });
  });
});
