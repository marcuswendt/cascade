/**
 * Serialization Tests
 * Tests for graph save/load functionality (toJSON)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { SubnetNode } from '@/nodes/core/nodes/SubnetNode';

describe('Serialization', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  describe('toJSON()', () => {
    it('should serialize empty graph', () => {
      const json = graph.toJSON();

      expect(json).toHaveProperty('version');
      expect(json).toHaveProperty('nodes');
      expect(json.nodes).toHaveLength(0);
    });

    it('should serialize nodes with positions', () => {
      const node = new Node('node1', 'Test', graph);
      node.position = { x: 100, y: 200 };
      graph.addElement(node);

      const json = graph.toJSON();

      expect(json.nodes).toHaveLength(1);
      expect(json.nodes[0].id).toBe('node1');
      // Type is serialized as 'module' with full package path
      expect(json.nodes[0].module).toContain('Test');
      // Position is serialized as array [x, y]
      expect(json.nodes[0].position).toEqual([100, 200]);
    });

    it('should serialize node props', () => {
      const node = new Node('node1', 'Test', graph);
      node.props.value = {
        name: 'value',
        type: 'number',
        value: 42
      };
      node.props.label = {
        name: 'label',
        type: 'string',
        value: 'test'
      };
      graph.addElement(node);

      const json = graph.toJSON();

      expect(json.nodes[0].props).toBeDefined();
      expect(json.nodes[0].props.value).toBe(42);
      expect(json.nodes[0].props.label).toBe('test');
    });

    it('should serialize expressions in props', () => {
      const node = new Node('node1', 'Test', graph);
      node.props.value = {
        name: 'value',
        type: 'number',
        value: 0,
        expression: 'time * 10'
      };
      graph.addElement(node);

      const json = graph.toJSON();

      // Expressions are stored inline in props as { value, expression }
      expect(json.nodes[0].props.value).toEqual({ value: 0, expression: 'time * 10' });
    });

    it('should serialize connections', () => {
      const nodeA = new Node('nodeA', 'Test', graph);
      const nodeB = new Node('nodeB', 'Test', graph);
      graph.addElement(nodeA);
      graph.addElement(nodeB);

      nodeA.out('output', 'param');
      nodeB.in('input', null);

      graph.connect(nodeA.outputs[0], nodeB.inputs[0]);

      const json = graph.toJSON();

      expect(json.connections).toBeDefined();
      expect(json.connections.length).toBeGreaterThan(0);
    });

    it('should serialize node comments', () => {
      const node = new Node('node1', 'Test', graph);
      node.comment = 'This is a test node';
      graph.addElement(node);

      const json = graph.toJSON();

      expect(json.nodes[0].comment).toBe('This is a test node');
    });

    it('should serialize bypassed state', () => {
      const node = new Node('node1', 'Test', graph);
      node.bypass = true;
      graph.addElement(node);

      const json = graph.toJSON();

      expect(json.nodes[0].bypass).toBe(true);
    });

    it('should include version in output', () => {
      const json = graph.toJSON();
      expect(json.version).toBeDefined();
      expect(typeof json.version).toBe('string');
    });

    it('should include metadata', () => {
      const json = graph.toJSON();
      expect(json.metadata).toBeDefined();
      expect(json.metadata.created).toBeDefined();
      expect(json.metadata.modified).toBeDefined();
    });
  });

  describe('Graph.fromJSON() static method', () => {
    it('should create graph from empty JSON', () => {
      const json = {
        version: '0.2',
        nodes: [],
        connections: []
      };

      const newGraph = Graph.fromJSON(json);

      expect(newGraph).toBeInstanceOf(Graph);
      expect(newGraph.elements).toHaveLength(0);
    });

    // Note: Full node deserialization tests require registered node types
    // These are integration tests that would need the full node library loaded
  });

  describe('Hierarchical serialization', () => {
    it('should serialize subnet nodes', () => {
      const subnet = new SubnetNode('mySubnet', graph);
      graph.addElement(subnet);

      const json = graph.toJSON();

      const subnetData = json.nodes.find((n: any) => n.id === 'mySubnet');
      expect(subnetData).toBeDefined();
      // SubnetNode serializes with 'module' containing package path
      expect(subnetData.module).toContain('Subnet');
    });

    it('should serialize subnet with children', () => {
      const subnet = new SubnetNode('mySubnet', graph);
      const child = new Node('child1', 'Test', graph);
      graph.addElement(subnet);
      subnet.addChild(child);

      const json = graph.toJSON();

      // Subnet should be in the output
      const subnetData = json.nodes.find((n: any) => n.id === 'mySubnet');
      expect(subnetData).toBeDefined();
    });
  });

  describe('Multiple nodes serialization', () => {
    it('should serialize multiple nodes', () => {
      for (let i = 0; i < 5; i++) {
        const node = new Node(`node${i}`, 'Test', graph);
        node.position = { x: i * 100, y: i * 50 };
        graph.addElement(node);
      }

      const json = graph.toJSON();

      expect(json.nodes).toHaveLength(5);
      expect(json.nodes[0].id).toBe('node0');
      expect(json.nodes[4].id).toBe('node4');
    });

    it('should preserve node order', () => {
      const nodes = ['alpha', 'beta', 'gamma'].map(id => {
        const node = new Node(id, 'Test', graph);
        graph.addElement(node);
        return node;
      });

      const json = graph.toJSON();
      const ids = json.nodes.map((n: any) => n.id);

      expect(ids).toEqual(['alpha', 'beta', 'gamma']);
    });
  });
});
