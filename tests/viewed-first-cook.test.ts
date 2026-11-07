// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { paintViewedFirst, pointerParameterGesture, type ParameterGesture } from '@/editor/stores/viewedFirstCook';

function connect(graph: Graph, source: Node, target: Node): void {
  graph.connect(source.out<number>('value'), target.in<number>('value', 0));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

function fakeGesture(): ParameterGesture & { set(held: boolean): void } {
  let held = false;
  const listeners = new Set<() => void>();
  return {
    held: () => held,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      held = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

const settle = async (ms = 0) => { await new Promise(r => setTimeout(r, ms)); };

describe('paintViewedFirst', () => {
  let graph: Graph;
  let source: Node;
  let viewed: Node;
  let downstream: Node;
  let log: string[];
  let uninstall: (() => void) | null = null;

  beforeEach(async () => {
    graph = new Graph();
    source = new Node('source', 'Test', graph);
    viewed = new Node('viewed', 'Test', graph);
    downstream = new Node('downstream', 'Test', graph);
    [source, viewed, downstream].forEach(node => graph.addElement(node));
    connect(graph, source, viewed);
    connect(graph, viewed, downstream);
    log = [];
    for (const node of graph.nodes) node.setFunction(() => { log.push(node.id); });
    await graph.execute();
    log.length = 0;
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
  });

  it('lets the Viewer paint the watched node before anything downstream starts', async () => {
    const painted = deferred();
    uninstall = paintViewedFirst(graph, {
      viewerPainted: () => { log.push('painted?'); return painted.promise; },
    });
    graph.scheduler.watch(viewed);

    source.markDirty();
    const run = graph.scheduler.flush();
    await settle(10);
    expect(log).toEqual(['source', 'viewed', 'painted?']);
    expect(downstream.cookState).not.toBe('clean');

    painted.resolve();
    await run;
    expect(log).toEqual(['source', 'viewed', 'painted?', 'downstream']);
  });

  it('cooks only the watched closure while a slider is held, the rest on release', async () => {
    const gesture = fakeGesture();
    uninstall = paintViewedFirst(graph, { viewerPainted: () => Promise.resolve(), gesture });
    graph.scheduler.watch(viewed);
    gesture.set(true);

    source.markDirty();
    void graph.scheduler.flush();
    await settle(10);
    expect(log).toEqual(['source', 'viewed']);

    // A second input mid-hold supersedes the parked downstream node.
    source.markDirty();
    await settle(80);
    expect(log).toEqual(['source', 'viewed', 'source', 'viewed']);
    expect(downstream.cookState).not.toBe('clean');

    gesture.set(false);
    await graph.scheduler.whenIdle();
    expect(log).toEqual(['source', 'viewed', 'source', 'viewed', 'downstream']);
    expect(graph.nodes.every(node => node.cookState === 'clean')).toBe(true);
  });

  it('changes nothing when no node is watched', async () => {
    const gesture = fakeGesture();
    gesture.set(true);
    uninstall = paintViewedFirst(graph, { viewerPainted: () => new Promise(() => {}), gesture });
    source.markDirty();
    await graph.scheduler.flush();
    expect(log).toEqual(['source', 'viewed', 'downstream']);
  });

  it('restores the scheduler on uninstall', async () => {
    const stepBefore = (graph.scheduler as unknown as Record<string, unknown>).executeInteractive;
    paintViewedFirst(graph)();
    expect((graph.scheduler as unknown as Record<string, unknown>).executeInteractive).toBe(stepBefore);
    expect(Object.prototype.hasOwnProperty.call(graph.scheduler, 'executeInteractive')).toBe(false);
  });
});

describe('pointerParameterGesture', () => {
  it('is held while a range slider is pressed or a field scrubs', async () => {
    const gesture = pointerParameterGesture(window);
    const range = document.createElement('input');
    range.type = 'range';
    document.body.appendChild(range);
    let changes = 0;
    gesture.subscribe(() => { changes += 1; });

    expect(gesture.held()).toBe(false);
    range.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(gesture.held()).toBe(true);
    window.dispatchEvent(new Event('pointerup'));
    expect(gesture.held()).toBe(false);

    document.documentElement.classList.add('cascade-scrubbing');
    expect(gesture.held()).toBe(true);
    document.documentElement.classList.remove('cascade-scrubbing');
    await settle();
    expect(gesture.held()).toBe(false);
    expect(changes).toBeGreaterThanOrEqual(3);

    gesture.dispose();
    range.remove();
  });
});
