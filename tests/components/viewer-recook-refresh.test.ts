// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Viewer from '@/editor/Viewer.svelte';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

/**
 * A Python-backed node writes the SAME file path on every cook, so the path is
 * not the image's identity — the cook is. The viewer's anti-strobe guard keyed
 * on the path alone and took its early return before the media version could
 * reach the <img src>, so moving a parameter re-rendered the file on disk and
 * changed nothing on screen.
 */
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver ??= StubResizeObserver;

const IMAGE = {
  path: 'renders/render-1024-1024.png',
  size: [64, 64],
  channels: 'rgba',
  depth: 'u8',
  space: 'srgb',
} as const;

function imageNode() {
  const graph = new Graph();
  const node = new Node('render-1024', 'project.rasterize', graph);
  node.out('image', 'param', { type: 'image' } as never).setValue({ ...IMAGE });
  // Every cook rewrites the same file, so the port value is identical each time.
  node.setFunction((n: any) => {
    n.out('image', 'param', { type: 'image' }).setValue({ ...IMAGE });
  });
  graph.addElement(node);
  return { graph, node };
}

async function settle(times = 12) {
  for (let i = 0; i < times; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function mountedImage(container: HTMLElement) {
  return container.querySelector('img[data-cascade-src]') as HTMLImageElement | null;
}

describe('viewer refreshes a re-cooked image at the same path', () => {
  it('advances the media version when the node cooks again', async () => {
    const { graph, node } = imageNode();
    await graph.execute(node);
    const { container } = render(Viewer, { props: { graph, selectedNode: node } });
    await settle();

    const first = mountedImage(container);
    expect(first, 'the viewer never mounted an image').toBeTruthy();
    const firstSrc = first!.src;
    expect(firstSrc).toContain('render-1024-1024.png');

    // The reported gesture: a parameter changes, the node re-cooks, and the
    // file at the same path now holds different bytes.
    node.markDirty();
    await settle();

    const second = mountedImage(container);
    expect(second).toBeTruthy();
    expect(node.cookInfo.cookCount).toBeGreaterThan(1);
    expect(second!.src).toMatch(/[?&]v=/);
    expect(second!.src).not.toBe(firstSrc);
  }, 20000);
});
