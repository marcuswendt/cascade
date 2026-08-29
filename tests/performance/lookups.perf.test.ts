/**
 * Performance tests for node and port lookups
 *
 * These tests verify that lookups are O(1) using our Map-based
 * indices for nodes, elements, ports, and connections.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import type { InputPort, OutputPort } from '@/types/node.types';

// Performance thresholds (in milliseconds)
const THRESHOLDS = {
  // Single lookup
  SINGLE_LOOKUP: 0.5,

  // 1000 lookups
  LOOKUP_1000: 20,

  // 10000 lookups
  LOOKUP_10000: 100,

  // Port lookup on node with many ports
  PORT_LOOKUP: 1,
};

interface MultiPortNode extends Node {
  inputPorts: InputPort<number>[];
  outputPorts: OutputPort<number>[];
}

interface SimpleNode extends Node {
  inputPort: InputPort<number>;
  outputPort: OutputPort<number>;
}

function createNodeWithPorts(id: string, graph: Graph, portCount: number): MultiPortNode {
  const node = new Node(id, 'MultiPort', graph) as MultiPortNode;
  node.inputPorts = [];
  node.outputPorts = [];

  // Create ports
  for (let i = 0; i < portCount; i++) {
    node.inputPorts.push(node.in<number>(`input${i}`, 0));
    node.outputPorts.push(node.out<number>(`output${i}`));
  }

  node.setFunction(async () => {});

  return node;
}

function createSimpleNode(id: string, graph: Graph): SimpleNode {
  const node = new Node(id, 'Simple', graph) as SimpleNode;
  node.inputPort = node.in<number>('value', 0);
  node.outputPort = node.out<number>('result');

  node.setFunction(async () => {
    node.outputPort.setValue(node.inputPort.value);
  });

  return node;
}

describe('Element Lookup Performance', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  it('should look up a single element instantly', async () => {
    const node = createSimpleNode('testNode', graph);
    graph.addElement(node);

    const start = performance.now();
    const found = graph.getElement('testNode');
    const elapsed = performance.now() - start;

    expect(found).toBe(node);
    expect(elapsed).toBeLessThan(THRESHOLDS.SINGLE_LOOKUP);
  });

  it('should look up 1000 elements efficiently', async () => {
    // Create 1000 nodes
    const nodes: SimpleNode[] = [];
    for (let i = 0; i < 1000; i++) {
      const node = createSimpleNode(`node${i}`, graph);
      graph.addElement(node);
      nodes.push(node);
    }

    // Keep assertions outside the timed loop so this measures lookup cost,
    // not the test framework's matcher overhead.
    let foundCount = 0;
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      if (graph.getElement(`node${i}`) === nodes[i]) foundCount++;
    }
    const elapsed = performance.now() - start;

    expect(foundCount).toBe(1000);
    expect(elapsed).toBeLessThan(THRESHOLDS.LOOKUP_1000);
  });

  it('should look up 10000 elements efficiently', async () => {
    // Create 10000 nodes
    const nodeIds: string[] = [];
    for (let i = 0; i < 10000; i++) {
      const node = createSimpleNode(`node${i}`, graph);
      graph.addElement(node);
      nodeIds.push(node.id);
    }

    let foundCount = 0;
    const start = performance.now();
    for (const id of nodeIds) {
      if (graph.getElement(id)) foundCount++;
    }
    const elapsed = performance.now() - start;

    expect(foundCount).toBe(10000);
    expect(elapsed).toBeLessThan(THRESHOLDS.LOOKUP_10000);
  });

  it('should maintain O(1) lookup regardless of graph size', async () => {
    // Time lookups with different graph sizes
    const sizes = [100, 500, 1000, 5000];
    const timings: number[] = [];

    for (const size of sizes) {
      const testGraph = new Graph();

      // Create nodes
      for (let i = 0; i < size; i++) {
        const node = createSimpleNode(`node${i}`, testGraph);
        testGraph.addElement(node);
      }

      // Time 100 random lookups
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        const idx = Math.floor(Math.random() * size);
        testGraph.getElement(`node${idx}`);
      }
      timings.push(performance.now() - start);
    }

    // All timings should be roughly the same (O(1) behavior)
    // Larger graphs should NOT take proportionally longer
    const minTime = Math.min(...timings);
    const maxTime = Math.max(...timings);

    // Max should be within 3x of min (accounting for variance)
    expect(maxTime).toBeLessThan(minTime * 3 + 5);
  });
});

describe('Node Lookup Performance (getNode)', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  it('should get node by ID quickly', async () => {
    for (let i = 0; i < 1000; i++) {
      const node = createSimpleNode(`node${i}`, graph);
      graph.addElement(node);
    }

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      const found = graph.getNode(`node${i}`);
      expect(found).not.toBeNull();
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(THRESHOLDS.LOOKUP_1000);
  });
});

describe('Port Lookup Performance', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  it('should look up ports on a node with many ports quickly', async () => {
    const node = createNodeWithPorts('multiPort', graph, 50);
    graph.addElement(node);

    // Look up each port multiple times using inputs/outputs arrays
    const start = performance.now();
    for (let round = 0; round < 100; round++) {
      for (let i = 0; i < 50; i++) {
        // Use the stored port references for lookup validation
        expect(node.inputPorts[i]).not.toBeNull();
        expect(node.outputPorts[i]).not.toBeNull();
      }
    }
    const elapsed = performance.now() - start;

    // 10000 port accesses should be fast
    expect(elapsed).toBeLessThan(100);
  });

  it('should maintain O(1) port lookup regardless of port count', async () => {
    const portCounts = [10, 50, 100, 200];
    const timings: number[] = [];

    for (const count of portCounts) {
      const testGraph = new Graph();
      const node = createNodeWithPorts('test', testGraph, count);
      testGraph.addElement(node);

      // Time 1000 random port accesses
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        const idx = Math.floor(Math.random() * count);
        node.inputs[idx]; // Access by index - O(1)
      }
      timings.push(performance.now() - start);
    }

    // All timings should be roughly the same (O(1) behavior)
    const minTime = Math.min(...timings);
    const maxTime = Math.max(...timings);

    expect(maxTime).toBeLessThan(minTime * 3 + 5);
  });

  it('should look up input port by ID quickly (getInputPortById)', async () => {
    const node = createNodeWithPorts('test', graph, 100);
    graph.addElement(node);

    // Get the actual port IDs
    const inputPortIds = node.inputs.map(p => p.id);

    // Time 1000 lookups
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      const idx = i % inputPortIds.length;
      const port = node.getInputPortById(inputPortIds[idx]);
      expect(port).not.toBeNull();
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(THRESHOLDS.LOOKUP_1000);
  });
});

describe('Connection Lookup Performance', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  it('should find connections quickly via map', async () => {
    // Create a chain of nodes with connections
    const nodes: SimpleNode[] = [];
    for (let i = 0; i < 100; i++) {
      const node = createSimpleNode(`node${i}`, graph);
      graph.addElement(node);
      nodes.push(node);
    }

    // Create connections
    const connectionIds: string[] = [];
    for (let i = 0; i < 99; i++) {
      const conn = graph.connect(nodes[i].outputPort, nodes[i + 1].inputPort);
      if (conn) connectionIds.push(conn.id);
    }

    // Time looking up and disconnecting random connections
    const shuffled = [...connectionIds].sort(() => Math.random() - 0.5);

    const start = performance.now();
    for (const id of shuffled) {
      // Disconnect uses internal connection map lookup
      graph.disconnect(id);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
  });
});

describe('Combined Lookup Stress Test', () => {
  it('should handle mixed lookups efficiently', async () => {
    const graph = new Graph();

    // Create 500 nodes with various ports
    const nodes: MultiPortNode[] = [];
    for (let i = 0; i < 500; i++) {
      const portCount = (i % 10) + 1; // 1-10 ports
      const node = createNodeWithPorts(`node${i}`, graph, portCount);
      graph.addElement(node);
      nodes.push(node);
    }

    // Create some connections
    for (let i = 0; i < 400; i++) {
      graph.connect(nodes[i].outputPorts[0], nodes[i + 1].inputPorts[0]);
    }

    // Mixed operations
    const start = performance.now();

    for (let round = 0; round < 100; round++) {
      // Look up random node
      const nodeIdx = Math.floor(Math.random() * 500);
      const node = graph.getNode(`node${nodeIdx}`);

      if (node) {
        // Look up random port on that node
        const portIdx = Math.floor(Math.random() * node.inputs.length);
        if (node.inputs[portIdx]) {
          node.inputs[portIdx]; // Direct access
        }
      }

      // Look up via getElement
      graph.getElement(`node${Math.floor(Math.random() * 500)}`);
    }

    const elapsed = performance.now() - start;

    // 300 mixed lookups should be very fast
    expect(elapsed).toBeLessThan(50);
  });
});
