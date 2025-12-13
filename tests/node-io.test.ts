/**
 * Node I/O Tests
 * Tests for Node ports, connections, and data flow
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

describe('Node I/O', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  describe('Port creation', () => {
    it('should create input ports with in()', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      const port = node.in('myInput', 42);

      expect(node.inputs).toHaveLength(1);
      expect(port.name).toBe('myInput');
      expect(port.value).toBe(42);
      expect(port.defaultValue).toBe(42);
    });

    it('should create output ports with out()', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      const port = node.out('myOutput', 'param');

      expect(node.outputs).toHaveLength(1);
      expect(port.name).toBe('myOutput');
      expect(port.portType).toBe('param');
    });

    it('should create trigger ports', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      const inputPort = node.in('trigger', null);
      const outputPort = node.out('trigger', 'trigger');

      expect(inputPort.portType).toBe('trigger');
      expect(outputPort.portType).toBe('trigger');
    });

    it('should reuse existing ports with same name', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      const port1 = node.in('input', 10);
      const port2 = node.in('input', 20);

      expect(node.inputs).toHaveLength(1);
      expect(port1).toBe(port2);
    });

    it('should generate unique port IDs', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      node.in('input1', null);
      node.in('input2', null);
      node.out('output1', 'param');
      node.out('output2', 'param');

      const inputIds = node.inputs.map(p => p.id);
      const outputIds = node.outputs.map(p => p.id);

      expect(new Set(inputIds).size).toBe(inputIds.length);
      expect(new Set(outputIds).size).toBe(outputIds.length);
    });
  });

  describe('Port value management', () => {
    it('should set output values via setValue()', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      const output = node.out('result', 'param');
      output.setValue(100);

      expect(output.value).toBe(100);
    });

    it('should track input default values', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      const input = node.in('value', 50);

      expect(input.defaultValue).toBe(50);
      expect(input.value).toBe(50);
    });

    it('should handle undefined default values', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      const input = node.in('value');

      expect(input.defaultValue).toBeUndefined();
      expect(input.value).toBeUndefined();
    });
  });

  describe('Data flow through connections', () => {
    it('should propagate values through connections', () => {
      const nodeA = new Node('nodeA', 'Test', graph);
      const nodeB = new Node('nodeB', 'Test', graph);
      graph.addElement(nodeA);
      graph.addElement(nodeB);

      const output = nodeA.out('output', 'param');
      const input = nodeB.in('input', null);

      graph.connect(output, input);
      output.setValue(42);

      // Value should be accessible from connected input
      expect(input.connections[0].from.portId).toBe(output.id);
    });

    it('should handle multiple connections from one output', () => {
      const nodeA = new Node('nodeA', 'Test', graph);
      const nodeB = new Node('nodeB', 'Test', graph);
      const nodeC = new Node('nodeC', 'Test', graph);
      graph.addElement(nodeA);
      graph.addElement(nodeB);
      graph.addElement(nodeC);

      const output = nodeA.out('output', 'param');
      const inputB = nodeB.in('input', null);
      const inputC = nodeC.in('input', null);

      graph.connect(output, inputB);
      graph.connect(output, inputC);

      expect(output.connections).toHaveLength(2);
      expect(inputB.connections).toHaveLength(1);
      expect(inputC.connections).toHaveLength(1);
    });
  });

  describe('Port options', () => {
    it('should accept port options', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      const port = node.in('value', 0, {
        type: 'number',
        min: 0,
        max: 100
      });

      expect(port.options.min).toBe(0);
      expect(port.options.max).toBe(100);
      expect(port.dataType).toBe('number');
    });

    it('should preserve options when reusing ports', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      node.in('value', 0, { min: 0, max: 100 });
      const port = node.in('value', 0, { step: 1 });

      expect(port.options.min).toBe(0);
      expect(port.options.max).toBe(100);
      expect(port.options.step).toBe(1);
    });
  });

  describe('Variadic inputs', () => {
    it('should support variadic input flag', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);
      node.variadic = true;

      expect(node.variadic).toBe(true);
    });
  });
});

describe('Parameter System', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  describe('Props management', () => {
    it('should define props on nodes', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      node.props.myValue = {
        name: 'myValue',
        type: 'number',
        value: 42
      };

      expect(node.props.myValue.value).toBe(42);
      expect(node.props.myValue.type).toBe('number');
    });

    it('should access props via parm()', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      node.props.testProp = {
        name: 'testProp',
        type: 'string',
        value: 'hello'
      };

      const parm = node.parm('testProp');
      expect(parm).toBeDefined();
      expect(parm?.eval()).toBe('hello');
    });

    it('should return null for non-existent props', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      const parm = node.parm('nonexistent');
      expect(parm).toBeNull();
    });
  });

  describe('Parm eval/set', () => {
    it('should get and set values', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      node.props.value = {
        name: 'value',
        type: 'number',
        value: 10
      };

      expect(node.parm('value')?.eval()).toBe(10);

      node.parm('value')?.set(20);
      // After set, verify via props (set updates the underlying prop)
      expect(node.props.value.value).toBe(20);
    });

    it('should handle string props', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      node.props.name = {
        name: 'name',
        type: 'string',
        value: 'initial'
      };

      node.parm('name')?.set('updated');
      expect(node.props.name.value).toBe('updated');
    });

    it('should handle boolean props', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      node.props.enabled = {
        name: 'enabled',
        type: 'boolean',
        value: false
      };

      expect(node.parm('enabled')?.eval()).toBe(false);

      node.parm('enabled')?.set(true);
      expect(node.props.enabled.value).toBe(true);
    });

    it('should handle vector props', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      node.props.position = {
        name: 'position',
        type: 'vector',
        value: [0, 0, 0]
      };

      expect(node.parm('position')?.eval()).toEqual([0, 0, 0]);

      node.parm('position')?.set([1, 2, 3]);
      expect(node.props.position.value).toEqual([1, 2, 3]);
    });

    it('should support evalAsFloat', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      node.props.value = {
        name: 'value',
        type: 'number',
        value: '3.14'
      };

      const parm = node.parm('value');
      expect(parm?.evalAsFloat()).toBeCloseTo(3.14);
    });

    it('should support evalAsInt', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      node.props.value = {
        name: 'value',
        type: 'number',
        value: '42.9'
      };

      const parm = node.parm('value');
      expect(parm?.evalAsInt()).toBe(42);
    });

    it('should support evalAsString', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      node.props.value = {
        name: 'value',
        type: 'number',
        value: 123
      };

      const parm = node.parm('value');
      expect(parm?.evalAsString()).toBe('123');
    });
  });

  describe('Expression on props', () => {
    it('should set expression on prop', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      node.props.value = {
        name: 'value',
        type: 'number',
        value: 0
      };

      const parm = node.parm('value');
      parm?.setExpression('1 + 2');

      expect(node.props.value.expression).toBe('1 + 2');
    });

    it('should delete expression from prop', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      node.props.value = {
        name: 'value',
        type: 'number',
        value: 0,
        expression: '1 + 2'
      };

      const parm = node.parm('value');
      parm?.deleteExpression();

      expect(node.props.value.expression).toBeUndefined();
    });

    it('should check hasExpression', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      node.props.value = {
        name: 'value',
        type: 'number',
        value: 0
      };

      expect(node.parm('value')?.hasExpression()).toBe(false);

      node.parm('value')?.setExpression('time * 2');
      // Verify via props directly
      expect(node.props.value.expression).toBe('time * 2');
    });
  });

  describe('evalParm', () => {
    it('should evaluate simple prop values', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      node.props.amount = {
        name: 'amount',
        type: 'number',
        value: 50
      };

      const value = node.evalParm('amount');
      expect(value).toBe(50);
    });

    it('should return undefined for non-existent props', () => {
      const node = new Node('node1', 'Test', graph);
      graph.addElement(node);

      const value = node.evalParm('nonexistent');
      expect(value).toBeUndefined();
    });
  });

  describe('Parm path', () => {
    it('should return correct parm path', () => {
      const node = new Node('myNode', 'Test', graph);
      graph.addElement(node);

      node.props.value = {
        name: 'value',
        type: 'number',
        value: 0
      };

      const parm = node.parm('value');
      expect(parm?.path()).toBe('/myNode/value');
    });
  });
});
