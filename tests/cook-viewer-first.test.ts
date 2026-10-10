import { describe, expect, it } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

/**
 * Viewer-first order: what is on screen cooks before sinks nobody looks at,
 * and with nothing watched the order is the plain topological one.
 */
describe('viewer-first cook order', () => {
  function build() {
    const graph = new Graph();
    const order: string[] = [];
    // The export sink is added first so plain topological order reaches it
    // before the viewed branch, which is the case worth reordering.
    const ids = ['source', 'export', 'plot', 'shade', 'viewed'];
    const nodes = Object.fromEntries(ids.map(id => {
      const node = new Node(id, 'Test', graph);
      graph.addElement(node);
      return [id, node];
    })) as Record<string, Node>;
    const wire = (from: string, to: string, port: string) =>
      graph.connect(nodes[from].out<number>(`out_${port}`), nodes[to].in<number>(`in_${port}`, 0));
    wire('source', 'export', 'a');
    wire('source', 'plot', 'b');
    wire('source', 'shade', 'c');
    wire('shade', 'viewed', 'd');
    for (const node of Object.values(nodes)) node.setFunction(() => { order.push(node.id); });
    return { graph, nodes, order };
  }

  it('cooks a watched node and its inputs before unwatched sinks', async () => {
    const { graph, nodes, order } = build();
    await graph.execute();
    order.length = 0;
    const release = graph.scheduler.watch(nodes.viewed);

    nodes.source.markDirty();
    await graph.scheduler.flush();

    expect(order.slice(0, 3)).toEqual(['source', 'shade', 'viewed']);
    expect(order.slice(3).sort()).toEqual(['export', 'plot']);
    release();
  });

  it('keeps every dependency ahead of its dependent', async () => {
    const { graph, nodes, order } = build();
    await graph.execute();
    order.length = 0;
    graph.scheduler.watch(nodes.viewed);
    nodes.source.markDirty();
    await graph.scheduler.flush();
    for (const [from, to] of [['source', 'export'], ['source', 'plot'], ['source', 'shade'], ['shade', 'viewed']]) {
      expect(order.indexOf(from)).toBeLessThan(order.indexOf(to));
    }
  });

  it('falls back to topological order once nothing is watched (CLI, cook-all)', async () => {
    const { graph, nodes, order } = build();
    await graph.execute();
    const topological = order.slice();
    // The premise of the first test: unwatched, the sink comes first.
    expect(topological.indexOf('export')).toBeLessThan(topological.indexOf('viewed'));
    order.length = 0;
    const release = graph.scheduler.watch(nodes.viewed);
    release();
    release(); // idempotent
    nodes.source.markDirty();
    await graph.scheduler.flush();
    expect(order).toEqual(topological);
    expect(graph.scheduler.watchedNodeIds.size).toBe(0);
  });

  it('counts two viewers on one node separately', () => {
    const { graph, nodes } = build();
    const a = graph.scheduler.watch(nodes.viewed);
    const b = graph.scheduler.watch(nodes.viewed);
    a();
    expect(graph.scheduler.watchedNodeIds.has('viewed')).toBe(true);
    b();
    expect(graph.scheduler.watchedNodeIds.has('viewed')).toBe(false);
  });
});
