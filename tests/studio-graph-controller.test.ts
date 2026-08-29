import { describe, expect, it, vi } from 'vitest';
import { StudioGraphController } from '@/editor/StudioGraphController';
import type { Graph } from '@/nodes/Graph';

function graphStub() {
  return {
    connections: [{ id: 'connection' }],
    nodes: [{ id: 'node' }],
    elements: [{ id: 'element' }],
    restoreConnections: vi.fn(),
    connect: vi.fn(() => ({ id: 'created' })),
    disconnect: vi.fn(),
    getElement: vi.fn(() => ({ id: 'element' })),
    getNode: vi.fn(() => ({ id: 'parent' })),
    reparentElement: vi.fn(() => true),
    removeElement: vi.fn(),
    renameElement: vi.fn(() => true)
  };
}

describe('StudioGraphController', () => {
  it('restores connections and publishes one structural change', () => {
    const graph = graphStub();
    const originalConnections = graph.connections;
    const originalElements = graph.elements;
    const invalidate = vi.fn();
    const controller = new StudioGraphController(() => graph as unknown as Graph, invalidate);

    controller.restoreConnections();

    expect(graph.restoreConnections).toHaveBeenCalledOnce();
    expect(graph.connections).toEqual(originalConnections);
    expect(graph.connections).not.toBe(originalConnections);
    expect(graph.elements).toEqual(originalElements);
    expect(graph.elements).not.toBe(originalElements);
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('connects and disconnects through one reactive boundary per operation', () => {
    const graph = graphStub();
    const invalidate = vi.fn();
    const controller = new StudioGraphController(() => graph as unknown as Graph, invalidate);
    const from = { id: 'from' };
    const to = { id: 'to' };

    expect(controller.connect(from, to)).toEqual({ id: 'created' });
    controller.disconnect('connection');

    expect(graph.connect).toHaveBeenCalledWith(from, to);
    expect(graph.disconnect).toHaveBeenCalledWith('connection');
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('disconnects a group with a single reactive publication', () => {
    const graph = graphStub();
    const invalidate = vi.fn();
    const controller = new StudioGraphController(() => graph as unknown as Graph, invalidate);

    controller.disconnectMany(['a', 'b', 'c']);

    expect(graph.disconnect.mock.calls).toEqual([['a'], ['b'], ['c']]);
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('publishes renamed and removed elements across all structural collections', () => {
    const graph = graphStub();
    const invalidate = vi.fn();
    const controller = new StudioGraphController(() => graph as unknown as Graph, invalidate);
    const originalConnections = graph.connections;
    const originalNodes = graph.nodes;
    const originalElements = graph.elements;

    expect(controller.renameElement('old', 'new')).toBe(true);
    controller.removeElement('new');

    expect(graph.renameElement).toHaveBeenCalledWith('old', 'new');
    expect(graph.removeElement).toHaveBeenCalledWith('new');
    expect(graph.connections).not.toBe(originalConnections);
    expect(graph.nodes).not.toBe(originalNodes);
    expect(graph.elements).not.toBe(originalElements);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('reparents through the graph structural API', () => {
    const graph = graphStub();
    const invalidate = vi.fn();
    const controller = new StudioGraphController(() => graph as unknown as Graph, invalidate);

    expect(controller.reparentElement('element', 'parent')).toBe(true);
    expect(graph.reparentElement).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'element' }),
      expect.objectContaining({ id: 'parent' })
    );
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('does nothing while no graph is loaded', () => {
    const invalidate = vi.fn();
    const controller = new StudioGraphController(() => undefined, invalidate);

    expect(controller.restoreConnections()).toBe(false);
    expect(controller.disconnect('missing')).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
