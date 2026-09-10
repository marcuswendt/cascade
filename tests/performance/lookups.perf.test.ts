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

/**
 * These assert against a **baseline measured in the same run**, not against a
 * wall-clock threshold.
 *
 * The thresholds that used to be here — 20ms for a thousand lookups and so on —
 * failed at random: three consecutive full-suite runs on 2026-09-10 produced
 * 0, 3 and 2 failures with a different set each time, and every one of them
 * passed in isolation. Vitest runs these files in parallel with everything
 * else, so the machine they are timed on is a different machine each run, and a
 * suite that fails at random is a suite you learn to ignore.
 *
 * What these tests are actually for is proving the Map indices are used rather
 * than a linear scan. That is a *ratio*, and a ratio survives a busy machine
 * because the baseline is slowed down by exactly as much as the measurement.
 *
 * The one thing lost is a guard against an indexed lookup that is fast
 * relative to a scan and slow in absolute terms. That trade is deliberate: the
 * O(1)-scaling tests below cover the shape of the cost, and nothing here was
 * ever going to catch a constant-factor regression reliably at these scales.
 */

/** How much faster than a linear scan an indexed lookup has to be. Deliberately
 *  soft — the real difference at these sizes is 50x or more, and this only has
 *  to distinguish a Map from a loop. */
const INDEXED_SPEEDUP = 3;

/** Wall-clock for one operation, taking the best of several attempts so a
 *  scheduler hiccup in one attempt cannot fail the test. */
function fastest(attempts: number, run: () => void): number {
  let best = Infinity;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

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

    expect(graph.getElement('testNode')).toBe(node);
    // A single lookup is too small to time meaningfully on a loaded machine —
    // what is worth asserting is that it goes through the index at all, which
    // the identity check above already proves.
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
    const indexed = fastest(3, () => {
      foundCount = 0;
      for (let i = 0; i < 1000; i++) {
        if (graph.getElement(`node${i}`) === nodes[i]) foundCount++;
      }
    });
    // The same thousand lookups done the slow way, on the same machine, in the
    // same run. This is the comparison the test is really making.
    const scanned = fastest(3, () => {
      for (let i = 0; i < 1000; i++) {
        graph.elements.find((element: any) => element.id === `node${i}`);
      }
    });

    expect(foundCount).toBe(1000);
    expect(indexed * INDEXED_SPEEDUP).toBeLessThan(scanned);
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
    const indexed = fastest(3, () => {
      foundCount = 0;
      for (const id of nodeIds) {
        if (graph.getElement(id)) foundCount++;
      }
    });
    // A hundred scans rather than ten thousand: the scan is O(n) at n = 10000,
    // so a full pass would take minutes and prove nothing extra.
    const sample = nodeIds.slice(0, 100);
    const scanned = fastest(3, () => {
      for (const id of sample) {
        graph.elements.find((element: any) => element.id === id);
      }
    });

    expect(foundCount).toBe(10000);
    // Per lookup: 10000 indexed against 100 scanned.
    expect((indexed / 10000) * INDEXED_SPEEDUP).toBeLessThan(scanned / 100);
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

    /**
     * The matcher used to be inside the timed loop, so this measured a thousand
     * `expect()` calls rather than a thousand lookups — which is why it was the
     * flakiest test in the file. Counting inside and asserting outside is the
     * fix, and it is also what makes the number mean what it says.
     */
    let found = 0;
    const indexed = fastest(3, () => {
      found = 0;
      for (let i = 0; i < 1000; i++) if (graph.getNode(`node${i}`)) found += 1;
    });
    const scanned = fastest(3, () => {
      for (let i = 0; i < 1000; i++) graph.nodes.find((node: any) => node.id === `node${i}`);
    });

    expect(found).toBe(1000);
    expect(indexed * INDEXED_SPEEDUP).toBeLessThan(scanned);
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

    /**
     * This used to time ten thousand `expect()` calls and call the result "port
     * accesses" — the matchers were inside the loop, so the number was mostly
     * vitest and it moved with whatever else the machine was doing.
     *
     * An array index needs no performance test. What is worth asserting is that
     * every port is there and distinct, which is the property a lookup depends
     * on and the one a refactor could actually break.
     */
    expect(node.inputPorts).toHaveLength(50);
    expect(node.outputPorts).toHaveLength(50);
    expect(new Set(node.inputs.map(port => port.id)).size).toBe(50);
    expect(new Set(node.outputs.map(port => port.id)).size).toBe(50);
    for (let i = 0; i < 50; i++) {
      expect(node.inputPorts[i]).toBe(node.inputs[i]);
      expect(node.outputPorts[i]).toBe(node.outputs[i]);
    }
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

    let found = 0;
    const indexed = fastest(3, () => {
      found = 0;
      for (let i = 0; i < 1000; i++) {
        if (node.getInputPortById(inputPortIds[i % inputPortIds.length])) found += 1;
      }
    });
    const scanned = fastest(3, () => {
      for (let i = 0; i < 1000; i++) {
        const id = inputPortIds[i % inputPortIds.length];
        node.inputs.find((port: any) => port.id === id);
      }
    });

    expect(found).toBe(1000);
    expect(indexed * INDEXED_SPEEDUP).toBeLessThan(scanned);
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

    // What matters is that every one is found and removed, whatever order they
    // are asked for in — a map lookup rather than a scan that shortens as it
    // goes. The 100ms bound this replaces was two orders of magnitude of slack
    // and failed anyway when the machine was busy.
    for (const id of shuffled) graph.disconnect(id);
    expect(graph.connections).toHaveLength(0);
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

    // Mixed operations. Counted rather than timed: a stress test that asserts
    // milliseconds tells you about the machine, and this one is here to say
    // that nothing falls over at 500 nodes and 400 connections.
    let resolved = 0;

    for (let round = 0; round < 100; round++) {
      // Look up random node
      const nodeIdx = Math.floor(Math.random() * 500);
      const node = graph.getNode(`node${nodeIdx}`);
      if (node) {
        resolved += 1;
        const portIdx = Math.floor(Math.random() * node.inputs.length);
        if (node.inputs[portIdx]) resolved += 1;
      }
      if (graph.getElement(`node${Math.floor(Math.random() * 500)}`)) resolved += 1;
    }

    // Three resolutions per round, every round.
    expect(resolved).toBe(300);
  });
});
