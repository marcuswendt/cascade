/**
 * Performance tests for graph execution
 *
 * These tests establish baselines and detect regressions in:
 * - Graph execution speed
 * - Node cooking performance
 * - Parallel execution efficiency
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import type { InputPort, OutputPort } from '@/types/node.types';

// Performance thresholds (in milliseconds)
const THRESHOLDS = {
  // Single node execution should be very fast
  SINGLE_NODE_EXEC: 5,

  // Linear chain of 100 nodes
  CHAIN_100_NODES: 100,

  // Wide graph with 100 parallel nodes
  WIDE_100_NODES: 150,

  // Mixed graph with 50 nodes, various connections
  MIXED_50_NODES: 100,

  // Large graph with 500 nodes
  LARGE_500_NODES: 750,
};

interface TestNode extends Node {
  inputPort: InputPort<number>;
  outputPort: OutputPort<number>;
}

function createSimpleNode(id: string, graph: Graph): TestNode {
  const node = new Node(id, 'TestNode', graph) as TestNode;
  node.inputPort = node.in<number>('value', 0);
  node.outputPort = node.out<number>('result');

  node.setFunction(async () => {
    node.outputPort.setValue(node.inputPort.value * 2);
  });

  return node;
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

describe('Graph Execution Performance', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  it('should execute a single node quickly', async () => {
    const node = createSimpleNode('node1', graph);
    graph.addElement(node);

    const start = performance.now();
    await node.execute();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(THRESHOLDS.SINGLE_NODE_EXEC);
  });

  it('should execute a chain of 100 nodes within threshold', async () => {
    // Create a linear chain: node0 -> node1 -> node2 -> ... -> node99
    const nodes: TestNode[] = [];

    for (let i = 0; i < 100; i++) {
      const node = createPassthroughNode(`node${i}`, graph);
      graph.addElement(node);
      nodes.push(node);
    }

    // Connect them in a chain using actual port objects
    for (let i = 0; i < 99; i++) {
      graph.connect(nodes[i].outputPort, nodes[i + 1].inputPort);
    }

    // Set initial value
    nodes[0].inputPort.value = 42;

    // Execute the entire graph
    const start = performance.now();
    await graph.execute();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(THRESHOLDS.CHAIN_100_NODES);
  });

  it('should execute 100 parallel nodes efficiently', async () => {
    // Create 100 independent nodes (no connections between them)
    const nodes: TestNode[] = [];

    for (let i = 0; i < 100; i++) {
      const node = createSimpleNode(`node${i}`, graph);
      graph.addElement(node);
      nodes.push(node);
    }

    // Execute the entire graph (should run in parallel)
    const start = performance.now();
    await graph.execute();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(THRESHOLDS.WIDE_100_NODES);
  });

  it('should execute a mixed topology graph within threshold', async () => {
    // Create a diamond/mesh pattern:
    // Layer 0: 5 source nodes
    // Layer 1: 15 nodes, each connected to 2-3 sources
    // Layer 2: 20 nodes, each connected to 2-3 from layer 1
    // Layer 3: 10 output nodes

    const layers: TestNode[][] = [[], [], [], []];

    // Layer 0: 5 source nodes
    for (let i = 0; i < 5; i++) {
      const node = createSimpleNode(`l0_${i}`, graph);
      graph.addElement(node);
      layers[0].push(node);
    }

    // Layer 1: 15 nodes
    for (let i = 0; i < 15; i++) {
      const node = createPassthroughNode(`l1_${i}`, graph);
      graph.addElement(node);
      layers[1].push(node);
    }

    // Layer 2: 20 nodes
    for (let i = 0; i < 20; i++) {
      const node = createPassthroughNode(`l2_${i}`, graph);
      graph.addElement(node);
      layers[2].push(node);
    }

    // Layer 3: 10 output nodes
    for (let i = 0; i < 10; i++) {
      const node = createPassthroughNode(`l3_${i}`, graph);
      graph.addElement(node);
      layers[3].push(node);
    }

    // Connect layer 0 -> layer 1 (each L1 connects to 1-2 L0)
    for (let i = 0; i < layers[1].length; i++) {
      const srcIdx = i % layers[0].length;
      graph.connect(layers[0][srcIdx].outputPort, layers[1][i].inputPort);
    }

    // Connect layer 1 -> layer 2
    for (let i = 0; i < layers[2].length; i++) {
      const srcIdx = i % layers[1].length;
      graph.connect(layers[1][srcIdx].outputPort, layers[2][i].inputPort);
    }

    // Connect layer 2 -> layer 3
    for (let i = 0; i < layers[3].length; i++) {
      const srcIdx = (i * 2) % layers[2].length;
      graph.connect(layers[2][srcIdx].outputPort, layers[3][i].inputPort);
    }

    // Execute
    const start = performance.now();
    await graph.execute();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(THRESHOLDS.MIXED_50_NODES);
  });

  it('should handle large graphs (500 nodes) within threshold', async () => {
    const nodes: TestNode[] = [];

    // Create 500 nodes in 10 layers of 50
    for (let layer = 0; layer < 10; layer++) {
      for (let i = 0; i < 50; i++) {
        const node = createPassthroughNode(`l${layer}_n${i}`, graph);
        graph.addElement(node);
        nodes.push(node);
      }
    }

    // Connect each layer to the next (sparse connections)
    for (let layer = 0; layer < 9; layer++) {
      const layerStart = layer * 50;
      const nextLayerStart = (layer + 1) * 50;

      // Connect every 5th node to the next layer
      for (let i = 0; i < 50; i += 5) {
        graph.connect(nodes[layerStart + i].outputPort, nodes[nextLayerStart + i].inputPort);
      }
    }

    // Execute
    const start = performance.now();
    await graph.execute();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(THRESHOLDS.LARGE_500_NODES);
  });

  it('should re-execute only dirty nodes efficiently', async () => {
    // Create a chain of 20 nodes
    const nodes: TestNode[] = [];

    for (let i = 0; i < 20; i++) {
      const node = createPassthroughNode(`node${i}`, graph);
      graph.addElement(node);
      nodes.push(node);
    }

    // Connect in chain
    for (let i = 0; i < 19; i++) {
      graph.connect(nodes[i].outputPort, nodes[i + 1].inputPort);
    }

    // Initial execution
    await graph.execute();

    // Mark only the first node dirty
    nodes[0].markDirty();

    // Re-execute - should only cook dirty nodes
    const start = performance.now();
    await graph.execute();
    const elapsed = performance.now() - start;

    // Re-execution of dirty chain should be fast
    expect(elapsed).toBeLessThan(THRESHOLDS.CHAIN_100_NODES / 5);
  });
});

describe('Execution Timing Statistics', () => {
  it('should cook every node exactly once per execution', async () => {
    const graph = new Graph();
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

    // Warm-up run (first run is often slower due to JIT compilation)
    nodes.forEach(n => n.markDirty());
    await graph.execute();

    // Measure small batches rather than individual sub-millisecond runs. A
    // single scheduler tick is below the timer/noise floor on fast machines.
    const timings: number[] = [];

    for (let sample = 0; sample < 12; sample++) {
      const start = performance.now();
      for (let run = 0; run < 5; run++) {
        nodes.forEach(n => n.markDirty());
        await graph.execute();
      }
      timings.push((performance.now() - start) / 5);
    }

    expect(timings).toHaveLength(12);
    expect(timings.every(Number.isFinite)).toBe(true);
    expect(nodes.every(node => node.cookInfo.cookCount === 61)).toBe(true);
  });
});
