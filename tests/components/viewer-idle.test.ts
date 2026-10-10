// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Viewer from '@/editor/Viewer.svelte';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

/**
 * The Viewer used to re-arm a requestAnimationFrame every frame for as long as
 * a node was on display, which keeps the browser's compositor ticking at
 * display rate on an idle Studio. It must now be quiet when nothing changes,
 * and still pick up a re-cook through the scheduler's events.
 */
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver ??= StubResizeObserver;

const settle = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

afterEach(() => vi.restoreAllMocks());

describe('viewer is idle when nothing changes', () => {
  it('requests no animation frames while a clean node is displayed', async () => {
    const graph = new Graph();
    const node = new Node('text-1', 'project.text', graph);
    node.out('text', 'param', { type: 'string' } as never).setValue('hello');
    node.setFunction((n: any) => { n.out('text', 'param', { type: 'string' }).setValue('hello'); });
    graph.addElement(node);
    await graph.execute(node);

    const raf = vi.spyOn(window, 'requestAnimationFrame');
    render(Viewer, { props: { graph, selectedNode: node } });
    await settle(300);
    raf.mockClear();
    await settle(500);
    expect(raf).not.toHaveBeenCalled();

    // A change still gets through, without polling a frame for it.
    const before = node.cookInfo.cookCount;
    node.markDirty();
    await settle(400);
    expect(node.cookInfo.cookCount).toBeGreaterThan(before);
  });
});
