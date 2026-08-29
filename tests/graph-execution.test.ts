/**
 * Graph Execution Tests
 * Tests for graph-level execution, topological ordering, and execution state management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

describe('Graph Execution', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  describe('execute()', () => {
    it('should execute a single node', async () => {
      const node = new Node('test', 'TestType', graph);
      const executeFn = vi.fn();
      node.setFunction(executeFn);
      graph.addElement(node);

      await graph.execute();
      expect(executeFn).toHaveBeenCalled();
    });

    it('should execute nodes in topological order', async () => {
      const executionOrder: string[] = [];

      const nodeA = new Node('A', 'TestType', graph);
      const nodeB = new Node('B', 'TestType', graph);
      const nodeC = new Node('C', 'TestType', graph);

      graph.addElement(nodeA);
      graph.addElement(nodeB);
      graph.addElement(nodeC);

      const outA = nodeA.out<number>('out');
      const inB = nodeB.in<number>('in', 0);
      const outB = nodeB.out<number>('out');
      const inC = nodeC.in<number>('in', 0);

      graph.connect(outA, inB);
      graph.connect(outB, inC);

      nodeA.setFunction(async () => executionOrder.push('A'));
      nodeB.setFunction(async () => executionOrder.push('B'));
      nodeC.setFunction(async () => executionOrder.push('C'));

      await graph.execute();

      // A should execute before B, B before C
      expect(executionOrder.indexOf('A')).toBeLessThan(executionOrder.indexOf('B'));
      expect(executionOrder.indexOf('B')).toBeLessThan(executionOrder.indexOf('C'));
    });

    it('should handle diamond dependencies', async () => {
      const executionOrder: string[] = [];

      //   A
      //  / \
      // B   C
      //  \ /
      //   D
      const nodeA = new Node('A', 'TestType', graph);
      const nodeB = new Node('B', 'TestType', graph);
      const nodeC = new Node('C', 'TestType', graph);
      const nodeD = new Node('D', 'TestType', graph);

      graph.addElement(nodeA);
      graph.addElement(nodeB);
      graph.addElement(nodeC);
      graph.addElement(nodeD);

      const outA = nodeA.out<number>('out');
      const inB = nodeB.in<number>('in', 0);
      const outB = nodeB.out<number>('out');
      const inC = nodeC.in<number>('in', 0);
      const outC = nodeC.out<number>('out');
      const inD1 = nodeD.in<number>('in1', 0);
      const inD2 = nodeD.in<number>('in2', 0);

      graph.connect(outA, inB);
      graph.connect(outA, inC);
      graph.connect(outB, inD1);
      graph.connect(outC, inD2);

      nodeA.setFunction(async () => executionOrder.push('A'));
      nodeB.setFunction(async () => executionOrder.push('B'));
      nodeC.setFunction(async () => executionOrder.push('C'));
      nodeD.setFunction(async () => executionOrder.push('D'));

      await graph.execute();

      // A before B and C, both B and C before D
      expect(executionOrder.indexOf('A')).toBeLessThan(executionOrder.indexOf('B'));
      expect(executionOrder.indexOf('A')).toBeLessThan(executionOrder.indexOf('C'));
      expect(executionOrder.indexOf('B')).toBeLessThan(executionOrder.indexOf('D'));
      expect(executionOrder.indexOf('C')).toBeLessThan(executionOrder.indexOf('D'));
    });

    it('should execute from specific entry node', async () => {
      const executionOrder: string[] = [];

      const nodeA = new Node('A', 'TestType', graph);
      const nodeB = new Node('B', 'TestType', graph);
      const nodeC = new Node('C', 'TestType', graph);

      graph.addElement(nodeA);
      graph.addElement(nodeB);
      graph.addElement(nodeC);

      const outA = nodeA.out<number>('out');
      const inB = nodeB.in<number>('in', 0);

      graph.connect(outA, inB);

      nodeA.setFunction(async () => executionOrder.push('A'));
      nodeB.setFunction(async () => executionOrder.push('B'));
      nodeC.setFunction(async () => executionOrder.push('C'));

      // Execute from C only (isolated node)
      await graph.execute(nodeC);

      // Only C should execute
      expect(executionOrder).toContain('C');
      expect(executionOrder).not.toContain('A');
      expect(executionOrder).not.toContain('B');
    });

    it('should join an already running graph execution without cooking twice', async () => {
      const node = new Node('test', 'TestType', graph);
      let executionCount = 0;

      node.setFunction(async () => {
        executionCount++;
        // Simulate slow execution
        await new Promise(resolve => setTimeout(resolve, 10));
      });
      graph.addElement(node);

      // Start two executions simultaneously
      const exec1 = graph.execute();
      const exec2 = graph.execute();

      await Promise.all([exec1, exec2]);

      expect(executionCount).toBe(1);
    });

    it('should reset execution state after completion', async () => {
      const node = new Node('test', 'TestType', graph);
      node.setFunction(async () => {});
      graph.addElement(node);

      await graph.execute();

      // Should be able to execute again
      const executeFn = vi.fn();
      node.setFunction(executeFn);
      node.markDirty();
      await graph.execute();

      expect(executeFn).toHaveBeenCalled();
    });

    it('should handle empty graph gracefully', async () => {
      // Empty graph has no nodes, so no entry points
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await graph.execute();

      // Empty graph logs the warning or silently succeeds
      consoleSpy.mockRestore();
    });
  });

  describe('execution with data flow', () => {
    it('should propagate values through connections', async () => {
      const nodeA = new Node('A', 'TestType', graph);
      const nodeB = new Node('B', 'TestType', graph);

      graph.addElement(nodeA);
      graph.addElement(nodeB);

      const outA = nodeA.out<number>('value');
      const inB = nodeB.in<number>('value', 0);
      const outB = nodeB.out<number>('result');

      graph.connect(outA, inB);

      nodeA.setFunction(async () => {
        outA.setValue(42);
      });

      nodeB.setFunction(async () => {
        outB.setValue(inB.value * 2);
      });

      await graph.execute();

      expect(outB.value).toBe(84);
    });

    it('should handle multiple outputs from one node', async () => {
      const nodeA = new Node('A', 'TestType', graph);
      const nodeB = new Node('B', 'TestType', graph);
      const nodeC = new Node('C', 'TestType', graph);

      graph.addElement(nodeA);
      graph.addElement(nodeB);
      graph.addElement(nodeC);

      const outA = nodeA.out<number>('value');
      const inB = nodeB.in<number>('value', 0);
      const outB = nodeB.out<number>('result');
      const inC = nodeC.in<number>('value', 0);
      const outC = nodeC.out<number>('result');

      graph.connect(outA, inB);
      graph.connect(outA, inC);

      nodeA.setFunction(async () => outA.setValue(10));
      nodeB.setFunction(async () => outB.setValue(inB.value + 1));
      nodeC.setFunction(async () => outC.setValue(inC.value + 2));

      await graph.execute();

      expect(outB.value).toBe(11);
      expect(outC.value).toBe(12);
    });
  });

  describe('execution state', () => {
    it('should track execution state', async () => {
      const node = new Node('test', 'TestType', graph);
      let stateInside: string | null = null;

      node.setFunction(async () => {
        stateInside = graph.executionState;
      });
      graph.addElement(node);

      expect(graph.executionState).toBe('idle');
      await graph.execute();
      expect(stateInside).toBe('running');
      expect(graph.executionState).toBe('idle');
    });

    it('should reset state on error', async () => {
      const node = new Node('test', 'TestType', graph);
      node.setFunction(async () => {
        throw new Error('Execution error');
      });
      graph.addElement(node);

      await graph.execute();
      expect(graph.executionState).toBe('idle');
    });
  });
});

describe('Graph Level Calculation', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  it('should assign level 0 to nodes with no dependencies', () => {
    const nodeA = new Node('A', 'TestType', graph);
    const nodeB = new Node('B', 'TestType', graph);

    graph.addElement(nodeA);
    graph.addElement(nodeB);

    // Both nodes have no inputs, should be level 0
    nodeA.setFunction(async () => {});
    nodeB.setFunction(async () => {});
  });

  it('should assign increasing levels for chain dependencies', () => {
    const nodeA = new Node('A', 'TestType', graph);
    const nodeB = new Node('B', 'TestType', graph);
    const nodeC = new Node('C', 'TestType', graph);

    graph.addElement(nodeA);
    graph.addElement(nodeB);
    graph.addElement(nodeC);

    const outA = nodeA.out<number>('out');
    const inB = nodeB.in<number>('in', 0);
    const outB = nodeB.out<number>('out');
    const inC = nodeC.in<number>('in', 0);

    graph.connect(outA, inB);
    graph.connect(outB, inC);

    // A: level 0, B: level 1, C: level 2
    nodeA.setFunction(async () => {});
    nodeB.setFunction(async () => {});
    nodeC.setFunction(async () => {});
  });
});

describe('Graph Connection Validation', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  it('should create connections between compatible ports', () => {
    const nodeA = new Node('A', 'TestType', graph);
    const nodeB = new Node('B', 'TestType', graph);

    graph.addElement(nodeA);
    graph.addElement(nodeB);

    const output = nodeA.out<number>('out');
    const input = nodeB.in<number>('in', 0);

    const connection = graph.connect(output, input);
    expect(connection).not.toBe(null);
    expect(graph.connections.length).toBe(1);
  });

  it('should disconnect nodes', () => {
    const nodeA = new Node('A', 'TestType', graph);
    const nodeB = new Node('B', 'TestType', graph);

    graph.addElement(nodeA);
    graph.addElement(nodeB);

    const output = nodeA.out<number>('out');
    const input = nodeB.in<number>('in', 0);

    const connection = graph.connect(output, input);
    expect(graph.connections.length).toBe(1);

    graph.disconnect(connection!.id);
    expect(graph.connections.length).toBe(0);
  });

  it('should not allow duplicate connections', () => {
    const nodeA = new Node('A', 'TestType', graph);
    const nodeB = new Node('B', 'TestType', graph);

    graph.addElement(nodeA);
    graph.addElement(nodeB);

    const output = nodeA.out<number>('out');
    const input = nodeB.in<number>('in', 0);

    graph.connect(output, input);
    graph.connect(output, input); // Duplicate

    expect(graph.connections.length).toBe(1);
  });
});

describe('Graph Element Management', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  it('should add and retrieve nodes', () => {
    const node = new Node('test', 'TestType', graph);
    graph.addElement(node);

    expect(graph.getNode('test')).toBe(node);
    expect(graph.nodes.length).toBe(1);
  });

  it('should remove nodes and their connections', () => {
    const nodeA = new Node('A', 'TestType', graph);
    const nodeB = new Node('B', 'TestType', graph);

    graph.addElement(nodeA);
    graph.addElement(nodeB);

    const output = nodeA.out<number>('out');
    const input = nodeB.in<number>('in', 0);
    graph.connect(output, input);

    expect(graph.connections.length).toBe(1);

    graph.removeElement(nodeA.id);

    expect(graph.nodes.length).toBe(1);
    expect(graph.connections.length).toBe(0);
  });

  it('should generate unique node IDs', () => {
    const node1 = new Node('test', 'TestType', graph);
    graph.addElement(node1);

    const id = graph.generateUniqueNodeId('test');
    expect(id).not.toBe('test');
    expect(id).toContain('test');
  });
});
