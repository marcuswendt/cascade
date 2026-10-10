import { afterEach, describe, expect, it, vi } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { installStageBridge, runStage } from '../server/src/runtime/stage.js';

/**
 * Cancel-and-supersede in the scheduler: an edit arriving while a long stage
 * runs aborts that stage instead of queueing behind it, and the superseded
 * result is never applied.
 */
describe('cancel-and-supersede', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    vi.useRealTimers();
  });

  /** A stage bridge whose `slow` stage takes `ms` unless its signal aborts. */
  function bridge(ms: number) {
    const calls: Array<{ args: Record<string, unknown>; outcome: 'done' | 'aborted' | 'running' }> = [];
    dispose = installStageBridge((_stage, args, options) => {
      const call = { args, outcome: 'running' as 'done' | 'aborted' | 'running' };
      calls.push(call);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          call.outcome = 'done';
          resolve({ value: args.value });
        }, ms);
        options?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          call.outcome = 'aborted';
          reject(new Error('aborted'));
        }, { once: true });
      });
    });
    return calls;
  }

  function build() {
    const graph = new Graph();
    const source = new Node('source', 'Test', graph);
    const slow = new Node('slow', 'Test', graph);
    graph.addElement(source);
    graph.addElement(slow);
    const sourceOut = source.out<number>('value');
    graph.connect(sourceOut, slow.in<number>('value', 0));
    const slowOut = slow.out<number>('value');
    let edit = 1;
    source.setFunction(() => sourceOut.setValue(edit));
    // Calls runStage WITHOUT passing a signal: the ambient cook signal is what
    // makes an existing project node cancellable without changing it.
    slow.setFunction(async () => {
      const input = slow.inputs[0].value as number;
      const result = await runStage<{ value: number }>('slow', { value: input });
      slowOut.setValue(result.value * 100);
    });
    return { graph, source, slow, slowOut, setEdit: (value: number) => { edit = value; } };
  }

  it('aborts the stage in flight when an upstream edit arrives, and never applies its result', async () => {
    const calls = bridge(2_000);
    const { graph, source, slowOut, setEdit } = build();
    const statuses: number[] = [];
    graph.scheduler.subscribe(status => statuses.push(status.superseded ?? 0));

    const started = performance.now();
    const first = graph.scheduler.flush();
    await vi.waitFor(() => expect(calls.length).toBe(1));
    setEdit(2);
    source.markDirty();
    await first;
    await graph.scheduler.whenIdle();
    // Not 4 s (the first stage plus the second): the first was abandoned.
    // The second run of the slow stage still takes its 2 s.
    expect(performance.now() - started).toBeLessThan(3_500);
    expect(calls.map(call => call.outcome)).toEqual(['aborted', 'done']);
    expect(calls[1].args.value).toBe(2);
    expect(slowOut.value).toBe(200);
    // The status strip saw the supersede.
    expect(Math.max(...statuses)).toBeGreaterThanOrEqual(1);
  });

  it('yields the pass to the edit instead of finishing nodes queued before it', async () => {
    const graph = new Graph();
    const order: string[] = [];
    const a = new Node('a', 'Test', graph);
    const b = new Node('b', 'Test', graph);
    const c = new Node('c', 'Test', graph);
    [a, b, c].forEach(node => graph.addElement(node));
    let hold: (() => void) | null = null;
    let holding = false;
    a.setFunction(async () => {
      order.push('a');
      if (holding) {
        holding = false;
        await new Promise<void>(resolve => { hold = resolve; });
      }
    });
    b.setFunction(() => { order.push('b'); });
    c.setFunction(() => { order.push('c'); });
    await graph.execute();
    order.length = 0;
    holding = true;

    a.markDirty();
    b.markDirty();
    const run = graph.scheduler.flush();
    await vi.waitFor(() => expect(hold).not.toBeNull());
    c.markDirty();
    hold!();
    await run;
    await graph.scheduler.whenIdle();
    // `c` was edited while `a` cooked; the pass yielded after `a`, so the
    // next pass ran the remaining work in a fresh topological order. Every
    // node still cooked exactly once.
    expect(order.sort()).toEqual(['a', 'b', 'c']);
    expect([a, b, c].every(node => node.cookState === 'clean')).toBe(true);
  });

  it('a stage started after its cook was superseded never starts', async () => {
    const calls = bridge(10);
    const graph = new Graph();
    const node = new Node('late', 'Test', graph);
    graph.addElement(node);
    let release: (() => void) | null = null;
    let cooks = 0;
    node.setFunction(async () => {
      if (++cooks === 1) await new Promise<void>(resolve => { release = resolve; });
      await runStage('slow', { value: cooks });
    });
    const run = graph.scheduler.flush();
    await vi.waitFor(() => expect(release).not.toBeNull());
    node.invalidateCook();
    release!();
    await run;
    // The first cook's runStage saw an aborted signal and did not call the
    // bridge. A rerun may follow, and that one is legitimate.
    expect(calls.filter(call => call.outcome === 'aborted')).toHaveLength(0);
    expect(calls.every(call => call.args.value === 2)).toBe(true);
  });
});
