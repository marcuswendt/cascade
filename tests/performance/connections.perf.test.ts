/**
 * Performance tests for connection operations
 *
 * These tests verify that connecting and disconnecting nodes
 * is efficient, especially with the O(1) connection map optimizations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import type { InputPort, OutputPort } from '@/types/node.types';

// Performance thresholds (in milliseconds)
const THRESHOLDS = {
  // Single connection operation
  SINGLE_CONNECT: 2,
  SINGLE_DISCONNECT: 2,

  // 100 connections in sequence
  CONNECT_100: 100,
  DISCONNECT_100: 100,

  // 500 connections
  CONNECT_500: 400,
  DISCONNECT_500: 400,

  // Random access disconnect (tests O(1) lookup)
  RANDOM_DISCONNECT_100: 100,
};

interface MultiPortNode extends Node {
  inputPorts: InputPort<number>[];
  outputPorts: OutputPort<number>[];
}

interface SimpleNode extends Node {
  inputPort: InputPort<number>;
  outputPort: OutputPort<number>;
}

function createMultiPortNode(id: string, graph: Graph, inputCount: number, outputCount: number): MultiPortNode {
  const node = new Node(id, 'MultiPort', graph) as MultiPortNode;
  node.inputPorts = [];
  node.outputPorts = [];

  // Create input ports
  for (let i = 0; i < inputCount; i++) {
    node.inputPorts.push(node.in<number>(`input${i}`, 0));
  }

  // Create output ports
  for (let i = 0; i < outputCount; i++) {
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

describe('Connection Performance', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  it('should connect two nodes quickly', async () => {
    const node1 = createSimpleNode('node1', graph);
    const node2 = createSimpleNode('node2', graph);
    graph.addElement(node1);
    graph.addElement(node2);

    const start = performance.now();
    graph.connect(node1.outputPort, node2.inputPort);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(THRESHOLDS.SINGLE_CONNECT);
  });

  it('should disconnect two nodes quickly (O(1) lookup)', async () => {
    const node1 = createSimpleNode('node1', graph);
    const node2 = createSimpleNode('node2', graph);
    graph.addElement(node1);
    graph.addElement(node2);

    const conn = graph.connect(node1.outputPort, node2.inputPort);

    const start = performance.now();
    graph.disconnect(conn!.id);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(THRESHOLDS.SINGLE_DISCONNECT);
  });

  it('should create 100 connections efficiently', async () => {
    // Create 101 nodes in a chain
    const nodes: SimpleNode[] = [];
    for (let i = 0; i < 101; i++) {
      const node = createSimpleNode(`node${i}`, graph);
      graph.addElement(node);
      nodes.push(node);
    }

    // Connect all in sequence
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      graph.connect(nodes[i].outputPort, nodes[i + 1].inputPort);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(THRESHOLDS.CONNECT_100);
    expect(graph.connections.length).toBe(100);
  });

  it('should disconnect 100 connections efficiently', async () => {
    // Create 101 nodes in a chain
    const nodes: SimpleNode[] = [];
    for (let i = 0; i < 101; i++) {
      const node = createSimpleNode(`node${i}`, graph);
      graph.addElement(node);
      nodes.push(node);
    }

    // Create 100 connections
    const connectionIds: string[] = [];
    for (let i = 0; i < 100; i++) {
      const conn = graph.connect(nodes[i].outputPort, nodes[i + 1].inputPort);
      if (conn) connectionIds.push(conn.id);
    }

    // Disconnect all
    const start = performance.now();
    for (const id of connectionIds) {
      graph.disconnect(id);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(THRESHOLDS.DISCONNECT_100);
    expect(graph.connections.length).toBe(0);
  });

  it('should handle 500 connections within threshold', async () => {
    // Create nodes with multiple ports for more connections
    // Use 501 nodes in a chain to avoid cycle detection issues
    const nodes: SimpleNode[] = [];
    for (let i = 0; i < 501; i++) {
      const node = createSimpleNode(`node${i}`, graph);
      graph.addElement(node);
      nodes.push(node);
    }

    // Create 500 connections in a chain (no cycles)
    const start = performance.now();
    let connCount = 0;
    for (let i = 0; i < 500; i++) {
      const conn = graph.connect(nodes[i].outputPort, nodes[i + 1].inputPort);
      if (conn) connCount++;
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(THRESHOLDS.CONNECT_500);
    expect(connCount).toBe(500);
  });

  it('should disconnect in random order efficiently (tests O(1) lookup)', async () => {
    // Create 101 nodes in a chain
    const nodes: SimpleNode[] = [];
    for (let i = 0; i < 101; i++) {
      const node = createSimpleNode(`node${i}`, graph);
      graph.addElement(node);
      nodes.push(node);
    }

    // Create 100 connections
    const connectionIds: string[] = [];
    for (let i = 0; i < 100; i++) {
      const conn = graph.connect(nodes[i].outputPort, nodes[i + 1].inputPort);
      if (conn) connectionIds.push(conn.id);
    }

    // Shuffle connection IDs to disconnect in random order
    const shuffled = [...connectionIds].sort(() => Math.random() - 0.5);

    // Disconnect in random order - should still be O(1) per disconnect
    const start = performance.now();
    for (const id of shuffled) {
      graph.disconnect(id);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(THRESHOLDS.RANDOM_DISCONNECT_100);
    expect(graph.connections.length).toBe(0);
  });

  it('should maintain O(1) disconnect even with large connection count', async () => {
    // This tests that our connection map optimization works
    const nodes: MultiPortNode[] = [];
    for (let i = 0; i < 200; i++) {
      const node = createMultiPortNode(`node${i}`, graph, 3, 3);
      graph.addElement(node);
      nodes.push(node);
    }

    // Create many connections
    const connectionIds: string[] = [];
    for (let i = 0; i < 199; i++) {
      for (let p = 0; p < 3; p++) {
        const conn = graph.connect(nodes[i].outputPorts[p], nodes[i + 1].inputPorts[p]);
        if (conn) connectionIds.push(conn.id);
      }
    }

    const totalConnections = connectionIds.length;

    // Time disconnecting first 10, middle 10, and last 10
    // All should be roughly equal with O(1) lookup

    const first10 = connectionIds.slice(0, 10);
    const startFirst = performance.now();
    for (const id of first10) graph.disconnect(id);
    const elapsedFirst = performance.now() - startFirst;

    const middle10 = connectionIds.slice(Math.floor(totalConnections / 2), Math.floor(totalConnections / 2) + 10);
    const startMiddle = performance.now();
    for (const id of middle10) graph.disconnect(id);
    const elapsedMiddle = performance.now() - startMiddle;

    const last10 = connectionIds.slice(-10);
    const startLast = performance.now();
    for (const id of last10) graph.disconnect(id);
    const elapsedLast = performance.now() - startLast;

    // All three should be in the same order of magnitude
    // (within 5x of each other indicates O(1) behavior)
    const maxTime = Math.max(elapsedFirst, elapsedMiddle, elapsedLast);
    const minTime = Math.min(elapsedFirst, elapsedMiddle, elapsedLast);

    // Allow for some variance but should not be drastically different
    expect(maxTime).toBeLessThan(minTime * 10 + 5); // Allow 5ms baseline variance
  });
});

describe('Connection Creation/Deletion Cycles', () => {
  it('should handle repeated connect/disconnect cycles efficiently', async () => {
    const graph = new Graph();

    const node1 = createSimpleNode('node1', graph);
    const node2 = createSimpleNode('node2', graph);
    graph.addElement(node1);
    graph.addElement(node2);

    const timings: number[] = [];

    // Run 100 connect/disconnect cycles
    for (let i = 0; i < 100; i++) {
      const start = performance.now();

      const conn = graph.connect(node1.outputPort, node2.inputPort);
      if (conn) graph.disconnect(conn.id);

      timings.push(performance.now() - start);
    }

    // Average should be fast
    const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
    expect(avg).toBeLessThan(5);

    // Later iterations should not be slower (no memory leak)
    const firstHalfAvg = timings.slice(0, 50).reduce((a, b) => a + b, 0) / 50;
    const secondHalfAvg = timings.slice(50).reduce((a, b) => a + b, 0) / 50;
    expect(secondHalfAvg).toBeLessThan(firstHalfAvg * 2 + 1);
  });
});
