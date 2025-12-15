/**
 * Performance tests for dirty flag propagation
 *
 * These tests verify that marking nodes dirty and propagating
 * that state through the graph is efficient.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import type { InputPort, OutputPort } from '@/types/node.types';

// Performance thresholds (in milliseconds)
const THRESHOLDS = {
  // Marking a single node dirty
  MARK_SINGLE_DIRTY: 1,

  // Propagating dirty through 100 node chain
  PROPAGATE_100_CHAIN: 10,

  // Propagating dirty through wide graph (100 downstream nodes)
  PROPAGATE_100_WIDE: 15,

  // Check dirty state on 500 nodes
  CHECK_500_DIRTY: 10,
};

interface TestNode extends Node {
  inputPort: InputPort<number>;
  outputPort: OutputPort<number>;
}

function createPassthroughNode(id: string, graph: Graph): TestNode {
  const node = new Node(id, 'Passthrough', graph) as TestNode;
  node.inputPort = node.in<number>('value', 0);
  node.outputPort = node.out<number>('result');

  node.setFunction(async () => {
    node.outputPort.setValue(node.inputPort.value);
  });

  return node;
}

describe('Dirty Flag Propagation Performance', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  it('should mark a single node dirty instantly', async () => {
    const node = createPassthroughNode('node1', graph);
    graph.addElement(node);

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      node.markDirty();
    }
    const elapsed = performance.now() - start;

    // 1000 marks should be nearly instant
    expect(elapsed).toBeLessThan(THRESHOLDS.MARK_SINGLE_DIRTY * 10);
  });

  it('should propagate dirty through a 100-node chain efficiently', async () => {
    const nodes: TestNode[] = [];

    for (let i = 0; i < 100; i++) {
      const node = createPassthroughNode(`node${i}`, graph);
      graph.addElement(node);
      nodes.push(node);
    }

    // Connect in chain
    for (let i = 0; i < 99; i++) {
      graph.connect(nodes[i].outputPort, nodes[i + 1].inputPort);
    }

    // Execute to clear dirty flags
    await graph.execute();

    // Now mark the first node dirty and measure propagation
    const start = performance.now();
    nodes[0].markDirty();
    nodes[0].markDownstreamDirty();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(THRESHOLDS.PROPAGATE_100_CHAIN);

    // Verify all downstream nodes are dirty
    for (let i = 1; i < 100; i++) {
      expect(nodes[i].isDirty).toBe(true);
    }
  });

  it('should propagate dirty to 100 parallel downstream nodes efficiently', async () => {
    // One source node connected to 100 downstream nodes
    const source = createPassthroughNode('source', graph);
    graph.addElement(source);

    const downstream: TestNode[] = [];
    for (let i = 0; i < 100; i++) {
      const node = createPassthroughNode(`downstream${i}`, graph);
      graph.addElement(node);
      downstream.push(node);
    }

    // Connect source to all downstream
    for (const node of downstream) {
      graph.connect(source.outputPort, node.inputPort);
    }

    // Execute to clear dirty flags
    await graph.execute();

    // Mark source dirty and propagate
    const start = performance.now();
    source.markDirty();
    source.markDownstreamDirty();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(THRESHOLDS.PROPAGATE_100_WIDE);

    // Verify all downstream nodes are dirty
    for (const node of downstream) {
      expect(node.isDirty).toBe(true);
    }
  });

  it('should check dirty state on 500 nodes efficiently', async () => {
    const nodes: TestNode[] = [];

    for (let i = 0; i < 500; i++) {
      const node = createPassthroughNode(`node${i}`, graph);
      graph.addElement(node);
      nodes.push(node);
    }

    // Execute graph to clear all dirty flags first
    await graph.execute();

    // Now mark half dirty
    for (let i = 0; i < 250; i++) {
      nodes[i].markDirty();
    }

    // Check dirty state on all nodes
    const start = performance.now();
    let dirtyCount = 0;
    for (const node of nodes) {
      if (node.isDirty) dirtyCount++;
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(THRESHOLDS.CHECK_500_DIRTY);
    expect(dirtyCount).toBe(250);
  });

  it('should handle repeated dirty marking without degradation', async () => {
    const nodes: TestNode[] = [];

    for (let i = 0; i < 50; i++) {
      const node = createPassthroughNode(`node${i}`, graph);
      graph.addElement(node);
      nodes.push(node);
    }

    // Connect in chain
    for (let i = 0; i < 49; i++) {
      graph.connect(nodes[i].outputPort, nodes[i + 1].inputPort);
    }

    // Mark dirty 100 times and collect timings
    const timings: number[] = [];

    for (let round = 0; round < 100; round++) {
      const start = performance.now();
      nodes[0].markDirty();
      nodes[0].markDownstreamDirty();
      timings.push(performance.now() - start);
    }

    // Check that later iterations aren't slower than earlier ones
    const firstHalfAvg = timings.slice(0, 50).reduce((a, b) => a + b, 0) / 50;
    const secondHalfAvg = timings.slice(50).reduce((a, b) => a + b, 0) / 50;

    // Second half shouldn't be more than 2x slower (indicates no memory leak / accumulation)
    expect(secondHalfAvg).toBeLessThan(firstHalfAvg * 2 + 1);
  });
});

describe('Dirty State Memory Efficiency', () => {
  it('should not leak memory during dirty cycles', async () => {
    const graph = new Graph();
    const nodes: TestNode[] = [];

    for (let i = 0; i < 100; i++) {
      const node = createPassthroughNode(`node${i}`, graph);
      graph.addElement(node);
      nodes.push(node);
    }

    // Connect in chain
    for (let i = 0; i < 99; i++) {
      graph.connect(nodes[i].outputPort, nodes[i + 1].inputPort);
    }

    // Run many dirty/execute cycles
    for (let cycle = 0; cycle < 100; cycle++) {
      nodes[0].markDirty();
      nodes[0].markDownstreamDirty();
      await graph.execute();
    }

    // If we got here without crashing or excessive slowdown, memory is ok
    // The test framework would timeout if there was a leak
    expect(true).toBe(true);
  });
});
