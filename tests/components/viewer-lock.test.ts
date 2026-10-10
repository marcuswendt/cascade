// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ViewerPanel from '@/editor/panels/ViewerPanel.svelte';
import {
  lockPanelToNode,
  panelLockStore,
  reconcilePanelLock,
  resolveLockedNode,
  restorePanelLock,
  setSharedContext,
  sharedContextStore,
  unlockPanel,
} from '@/editor/dockview/renderer';
import type { PanelContext } from '@/editor/dockview/types';
import { attachShowInViewerDrag, DROP_TARGET_CLASS, viewerTitle } from '@/editor/viewerDrag';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

/**
 * Show-in-viewer: drag a node out of the graph onto a Viewer to pin it there.
 * Marcus, 2026-10-10: each viewer locks on its own, the lock survives a
 * reload, and a deleted node unlocks rather than crashing.
 */
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver ??= StubResizeObserver;

function sketch() {
  const graph = new Graph();
  const a = new Node('render-composite', 'project.render-composite', graph);
  const b = new Node('noise', 'project.noise', graph);
  graph.addElement(a);
  graph.addElement(b);
  return { graph, a, b };
}

function context(graph: Graph, selectedNode: Node | null): PanelContext {
  return {
    graph,
    selectedNode,
    selectedAnnotation: null,
    activeTool: 'select',
    activeLibrary: null,
    documentName: 'test',
    presentationMode: false,
  };
}

beforeEach(() => {
  panelLockStore.set(new Map());
  sharedContextStore.set(null);
});
afterEach(() => vi.restoreAllMocks());

describe('viewer node locks', () => {
  it('two viewers lock independently', () => {
    const { graph, a } = sketch();
    lockPanelToNode('viewer-1', a, graph);
    expect(get(panelLockStore).get('viewer-1')?.lockedNode).toBe(a);
    expect(get(panelLockStore).has('viewer-2')).toBe(false);
    unlockPanel('viewer-1');
    expect(get(panelLockStore).has('viewer-1')).toBe(false);
  });

  it('follows a rename, re-binds a rebuilt node by id, and unlocks on delete', () => {
    const { graph, a } = sketch();
    lockPanelToNode('v', a, graph);

    expect(graph.renameElement('render-composite', 'final')).toBe(true);
    reconcilePanelLock('v', graph);
    expect(get(panelLockStore).get('v')?.lockedNodeId).toBe('final');

    // Undo/reload rebuilds node objects under the same ids.
    graph.removeElement('final');
    const rebuilt = new Node('final', 'project.render-composite', graph);
    graph.addElement(rebuilt);
    reconcilePanelLock('v', graph);
    expect(get(panelLockStore).get('v')?.lockedNode).toBe(rebuilt);

    graph.removeElement('final');
    reconcilePanelLock('v', graph);
    expect(get(panelLockStore).has('v')).toBe(false);
  });

  it('a lock restored from a saved layout waits for its node, then binds', () => {
    restorePanelLock('v', 'noise');
    const lock = get(panelLockStore).get('v')!;
    expect(resolveLockedNode(lock, undefined).kind).toBe('pending');
    expect(resolveLockedNode(lock, new Graph()).kind).toBe('pending');
    const { graph, b } = sketch();
    reconcilePanelLock('v', graph);
    expect(get(panelLockStore).get('v')?.lockedNode).toBe(b);
  });

  it('a restored lock whose node did not survive the reload unlocks', () => {
    restorePanelLock('v', 'never-saved');
    reconcilePanelLock('v', sketch().graph);
    expect(get(panelLockStore).has('v')).toBe(false);
  });

  it('titles the tab with what it shows', () => {
    expect(viewerTitle('render-composite')).toBe('Viewer · render-composite');
    expect(viewerTitle(null)).toBe('Viewer');
  });
});

describe('ViewerPanel', () => {
  function panelApi() {
    return { setTitle: vi.fn(), updateParameters: vi.fn() };
  }

  it('a locked viewer ignores the selection and persists its node id', async () => {
    const { graph, a, b } = sketch();
    setSharedContext(context(graph, b));
    const api = panelApi();
    render(ViewerPanel, { props: { panelId: 'v', panelApi: api } });
    await tick();
    expect(api.setTitle).toHaveBeenLastCalledWith('Viewer · noise');

    lockPanelToNode('v', a, graph);
    await tick();
    expect(api.setTitle).toHaveBeenLastCalledWith('Viewer · render-composite');
    expect(api.updateParameters).toHaveBeenLastCalledWith({ lockedNodeId: 'render-composite' });

    setSharedContext(context(graph, b));
    await tick();
    expect(api.setTitle).toHaveBeenLastCalledWith('Viewer · render-composite');

    unlockPanel('v');
    await tick();
    expect(api.setTitle).toHaveBeenLastCalledWith('Viewer · noise');
    expect(api.updateParameters).toHaveBeenLastCalledWith({ lockedNodeId: undefined });
  });

  it('restores a lock from its saved panel params', async () => {
    const { graph, a, b } = sketch();
    setSharedContext(context(graph, b));
    const api = panelApi();
    render(ViewerPanel, {
      props: { panelId: 'v', panelApi: api, panelParams: { id: 'v', type: 'viewer', title: 'Viewer', lockedNodeId: 'render-composite' } },
    });
    await tick();
    expect(get(panelLockStore).get('v')?.lockedNode).toBe(a);
    expect(api.setTitle).toHaveBeenLastCalledWith('Viewer · render-composite');
    expect(api.updateParameters).not.toHaveBeenCalledWith({ lockedNodeId: undefined });
  });

  it('unlocks without a crash when the locked node is deleted', async () => {
    const { graph, a, b } = sketch();
    setSharedContext(context(graph, b));
    const api = panelApi();
    render(ViewerPanel, { props: { panelId: 'v', panelApi: api } });
    lockPanelToNode('v', a, graph);
    await tick();
    graph.removeElement('render-composite');
    setSharedContext(context(graph, b));
    await tick();
    expect(get(panelLockStore).has('v')).toBe(false);
    expect(api.setTitle).toHaveBeenLastCalledWith('Viewer · noise');
  });
});

describe('dragging a node out of the graph', () => {
  function stage() {
    const { graph, a } = sketch();
    const panel = document.createElement('div');
    const canvas = document.createElement('div');
    canvas.className = 'canvas';
    const nodeEl = document.createElement('div');
    nodeEl.className = 'node';
    nodeEl.dataset.nodeId = a.id;
    canvas.appendChild(nodeEl);
    panel.appendChild(canvas);
    const viewer = document.createElement('div');
    viewer.dataset.viewerDrop = 'viewer-2';
    document.body.append(panel, viewer);
    panel.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON() {} }) as DOMRect;
    // jsdom has no layout: anything right of the graph panel is the viewer.
    (document as any).elementFromPoint = (x: number) => (x >= 100 ? viewer : nodeEl);
    const canvasEvents: string[] = [];
    canvas.addEventListener('mousemove', (e) => canvasEvents.push(`move:${e.clientX}`));
    canvas.addEventListener('mouseup', (e) => canvasEvents.push(`up:${e.clientX}`));
    const detach = attachShowInViewerDrag({ panel, getGraph: () => graph });
    const cleanup = () => { detach(); panel.remove(); viewer.remove(); };
    return { graph, a, nodeEl, viewer, canvasEvents, cleanup };
  }

  const fire = (target: EventTarget, type: string, init: MouseEventInit) =>
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));

  it('leaving the panel ends the canvas drag at the start point, and the drop pins the viewer', () => {
    const { a, nodeEl, viewer, canvasEvents, cleanup } = stage();
    fire(nodeEl, 'mousedown', { clientX: 50, clientY: 50, buttons: 1 });
    fire(window, 'mousemove', { clientX: 70, clientY: 50, buttons: 1 });
    expect(document.querySelector('.cascade-viewer-drag-ghost')).toBeNull();

    fire(window, 'mousemove', { clientX: 150, clientY: 50, buttons: 1 });
    // Canvas was handed a move back to the press point, then a release there.
    expect(canvasEvents).toEqual(['move:50', 'up:50']);
    expect(document.querySelector('.cascade-viewer-drag-ghost')?.textContent).toBe('render-composite');
    expect(viewer.classList.contains(DROP_TARGET_CLASS)).toBe(true);

    fire(viewer, 'mouseup', { clientX: 150, clientY: 50 });
    expect(get(panelLockStore).get('viewer-2')?.lockedNode).toBe(a);
    expect(document.querySelector('.cascade-viewer-drag-ghost')).toBeNull();
    expect(viewer.classList.contains(DROP_TARGET_CLASS)).toBe(false);
    cleanup();
  });

  it('Cmd-drag starts at once, inside the panel', () => {
    const { nodeEl, canvasEvents, cleanup } = stage();
    fire(nodeEl, 'mousedown', { clientX: 50, clientY: 50, buttons: 1, metaKey: true });
    fire(window, 'mousemove', { clientX: 60, clientY: 50, buttons: 1, metaKey: true });
    expect(canvasEvents).toEqual(['move:50', 'up:50']);
    expect(document.querySelector('.cascade-viewer-drag-ghost')).not.toBeNull();
    // Released back over the graph: nothing is pinned.
    fire(window, 'mouseup', { clientX: 60, clientY: 50 });
    expect(get(panelLockStore).size).toBe(0);
    cleanup();
  });

  it('Escape cancels the carry', () => {
    const { nodeEl, cleanup } = stage();
    fire(nodeEl, 'mousedown', { clientX: 50, clientY: 50, buttons: 1 });
    fire(window, 'mousemove', { clientX: 150, clientY: 50, buttons: 1 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.cascade-viewer-drag-ghost')).toBeNull();
    fire(window, 'mouseup', { clientX: 150, clientY: 50 });
    expect(get(panelLockStore).size).toBe(0);
    cleanup();
  });
});
