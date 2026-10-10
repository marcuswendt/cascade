import { describe, expect, it, vi } from 'vitest';
import { StudioGraphController } from '@/editor/StudioGraphController';
import type { Graph } from '@/nodes/Graph';

describe('StudioGraphController group ownership', () => {
  it('publishes refreshed elements after a successful assignment', () => {
    const elements = [{ id: 'group' }, { id: 'member' }];
    const graph = {
      elements,
      nodes: [],
      connections: [],
      assignToGroup: vi.fn(() => true),
    };
    const invalidate = vi.fn();
    const controller = new StudioGraphController(() => graph as unknown as Graph, invalidate);

    expect(controller.assignToGroup(['member'], 'group')).toBe(true);
    expect(graph.assignToGroup).toHaveBeenCalledWith(['member'], 'group');
    expect(graph.elements).toEqual(elements);
    expect(graph.elements).not.toBe(elements);
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('does not publish a failed assignment or when no graph is loaded', () => {
    const graph = {
      elements: [],
      nodes: [],
      connections: [],
      assignToGroup: vi.fn(() => false),
    };
    const invalidate = vi.fn();
    const controller = new StudioGraphController(() => graph as unknown as Graph, invalidate);

    expect(controller.assignToGroup(['missing'], 'group')).toBe(false);
    expect(new StudioGraphController(() => undefined, invalidate).assignToGroup([], null)).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
