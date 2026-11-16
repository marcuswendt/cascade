// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Viewer from '@/editor/Viewer.svelte';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

/**
 * A slider drag in Studio showed a new frame every ~105 ms on field-logo while
 * the viewed node cooked in ~50 ms (measured 2026-11-07): the Viewer only
 * looked at a finished cook on its next throttled check, CHECK_INTERVAL
 * (100 ms) after the previous one. The viewed node's output landing must reach
 * the <img> without waiting that interval out.
 */
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver ??= StubResizeObserver;

const IMAGE = {
  path: 'renders/hue-512.png',
  size: [64, 64],
  channels: 'rgba',
  depth: 'u8',
  space: 'srgb',
} as const;

function mountedImage(container: HTMLElement) {
  return container.querySelector('img[data-cascade-src]') as HTMLImageElement | null;
}

async function settle(times = 12) {
  for (let i = 0; i < times; i++) await new Promise(resolve => setTimeout(resolve, 20));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('viewer shows a viewed-node cook as soon as it lands', () => {
  it('updates the image source before the 100 ms check interval passes', async () => {
    const graph = new Graph();
    const node = new Node('hue-1', 'project.hue', graph);
    node.out('image', 'param', { type: 'image' } as never).setValue({ ...IMAGE });
    node.setFunction((n: any) => {
      n.out('image', 'param', { type: 'image' }).setValue({ ...IMAGE });
    });
    graph.addElement(node);
    await graph.execute(node);

    const { container } = render(Viewer, { props: { graph, selectedNode: node } });
    await settle();
    const firstSrc = mountedImage(container)?.src;
    expect(firstSrc, 'the viewer never mounted an image').toContain('hue-512.png');

    // Freeze the Viewer's clock so its throttle reads "a check just ran", and
    // drive every timer by hand.
    vi.spyOn(performance, 'now').mockReturnValue(1_000_000);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    // A check runs now (any scheduler event), so the next throttled one is a
    // full CHECK_INTERVAL away.
    graph.scheduler.notifyNodeStateChange();
    await vi.advanceTimersByTimeAsync(1);

    // The slider moves: the node goes stale, the scheduler cooks it after its
    // 50 ms debounce, and the output lands at ~50 ms.
    const before = node.cookInfo.cookCount;
    node.markDirty();
    await vi.advanceTimersByTimeAsync(60);

    expect(node.cookInfo.cookCount).toBeGreaterThan(before);
    const src = mountedImage(container)?.src;
    expect(src).toMatch(/[?&]v=/);
    expect(src, 'the new cook waited for the 100 ms check').not.toBe(firstSrc);
  }, 20000);

  it('shows a cook superseded mid-drag without waiting for the interval', async () => {
    // During a drag the next input lands while the node is still cooking, so
    // the cook ends `stale`, not `clean`, but it has rewritten the file on
    // disk. Measured in Studio, that is nearly every cook of a drag.
    const graph = new Graph();
    const node = new Node('hue-2', 'project.hue', graph);
    node.out('image', 'param', { type: 'image' } as never).setValue({ ...IMAGE });
    const gates: Array<() => void> = [];
    let gated = false;
    node.setFunction(async (n: any) => {
      if (gated) await new Promise<void>(resolve => gates.push(resolve));
      n.out('image', 'param', { type: 'image' }).setValue({ ...IMAGE });
    });
    graph.addElement(node);
    await graph.execute(node);

    const { container } = render(Viewer, { props: { graph, selectedNode: node } });
    await settle();
    const firstSrc = mountedImage(container)?.src;
    expect(firstSrc, 'the viewer never mounted an image').toContain('hue-512.png');

    vi.spyOn(performance, 'now').mockReturnValue(1_000_000);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    gated = true;

    // First input: the Viewer checks at once (its last check is long past) and
    // the cook starts and holds.
    node.markDirty();
    await vi.advanceTimersByTimeAsync(5);
    expect(node.cookState).toBe('cooking');
    const before = node.cookInfo.cookCount;

    // Second input supersedes it; then the first cook finishes.
    node.markDirty();
    await vi.advanceTimersByTimeAsync(1);
    gates.shift()?.();
    await vi.advanceTimersByTimeAsync(10);

    expect(node.cookInfo.cookCount).toBeGreaterThan(before);
    const src = mountedImage(container)?.src;
    expect(src, 'the superseded cook waited for the 100 ms check').not.toBe(firstSrc);
    gates.forEach(open => open());
  }, 20000);
});
