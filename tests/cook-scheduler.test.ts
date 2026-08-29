import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

function connect(graph: Graph, source: Node, target: Node): void {
  graph.connect(source.out<number>('value'), target.in<number>('value', 0));
}

describe('CookScheduler', () => {
  let graph: Graph;

  beforeEach(() => {
    vi.useRealTimers();
    graph = new Graph();
  });

  it('cooks exactly a changed node and its transitive dependents', async () => {
    const source = new Node('source', 'Test', graph);
    const middle = new Node('middle', 'Test', graph);
    const target = new Node('target', 'Test', graph);
    const unrelated = new Node('unrelated', 'Test', graph);
    [source, middle, target, unrelated].forEach(node => graph.addElement(node));
    connect(graph, source, middle);
    connect(graph, middle, target);

    const cooks = new Map<string, number>();
    for (const node of graph.nodes) {
      node.setFunction(() => cooks.set(node.id, (cooks.get(node.id) ?? 0) + 1));
    }
    await graph.execute();
    cooks.clear();

    source.markDirty();
    await graph.scheduler.flush();

    expect(Object.fromEntries(cooks)).toEqual({ source: 1, middle: 1, target: 1 });
    expect(unrelated.cookState).toBe('clean');
  });

  it('coalesces rapid changes into one cook after the debounce', async () => {
    vi.useFakeTimers();
    const node = new Node('node', 'Test', graph);
    const execute = vi.fn();
    node.setFunction(execute);
    graph.addElement(node);
    await graph.execute();
    execute.mockClear();

    node.markDirty();
    await vi.advanceTimersByTimeAsync(20);
    node.markDirty();
    await vi.advanceTimersByTimeAsync(20);
    node.markDirty();
    expect(node.cookState).toBe('stale');

    await vi.advanceTimersByTimeAsync(49);
    expect(execute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await graph.scheduler.whenIdle();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('drops outputs from a superseded generation and cooks the latest one', async () => {
    const node = new Node('node', 'Test', graph);
    graph.addElement(node);
    const output = node.out<number>('value');
    let release!: () => void;
    let requestedValue = 1;
    node.setFunction(async () => {
      const value = requestedValue;
      await new Promise<void>(resolve => { release = resolve; });
      output.setValue(value);
    });

    const firstCook = graph.execute();
    await vi.waitFor(() => expect(node.cookState).toBe('cooking'));
    requestedValue = 2;
    node.markDirty();
    release();
    await vi.waitFor(() => expect(node.cookState).toBe('cooking'));
    expect(output.value).toBeUndefined();
    release();
    await firstCook;
    expect(output.value).toBe(2);
    expect(node.cookState).toBe('clean');
  });

  it('joins an active cook instead of returning before it finishes', async () => {
    const node = new Node('node', 'Test', graph);
    graph.addElement(node);
    let release!: () => void;
    node.setFunction(() => new Promise<void>(resolve => { release = resolve; }));

    const firstCook = graph.execute();
    await vi.waitFor(() => expect(node.cookState).toBe('cooking'));
    let secondFinished = false;
    const secondCook = graph.execute().then(() => { secondFinished = true; });
    await Promise.resolve();
    expect(secondFinished).toBe(false);

    release();
    await Promise.all([firstCook, secondCook]);
    expect(secondFinished).toBe(true);
    expect(node.cookState).toBe('clean');
  });

  it('continues unrelated branches after an error and leaves dependents stale', async () => {
    const failing = new Node('failing', 'Test', graph);
    const blocked = new Node('blocked', 'Test', graph);
    const healthy = new Node('healthy', 'Test', graph);
    [failing, blocked, healthy].forEach(node => graph.addElement(node));
    connect(graph, failing, blocked);
    failing.setFunction(() => { throw new Error('boom'); });
    const blockedCook = vi.fn();
    const healthyCook = vi.fn();
    blocked.setFunction(blockedCook);
    healthy.setFunction(healthyCook);

    await graph.execute();

    expect(failing.cookState).toBe('error');
    expect(blocked.cookState).toBe('stale');
    expect(blockedCook).not.toHaveBeenCalled();
    expect(healthyCook).toHaveBeenCalledTimes(1);
    expect(healthy.cookState).toBe('clean');
  });

  it('retries a failed branch once on the next explicit graph execution', async () => {
    const failing = new Node('failing', 'Test', graph);
    const dependent = new Node('dependent', 'Test', graph);
    graph.addElement(failing);
    graph.addElement(dependent);
    connect(graph, failing, dependent);
    let attempts = 0;
    failing.setFunction(() => {
      attempts++;
      if (attempts === 1) throw new Error('transient');
    });
    const dependentCook = vi.fn();
    dependent.setFunction(dependentCook);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await graph.execute();
    expect(failing.cookState).toBe('error');
    expect(dependentCook).not.toHaveBeenCalled();

    await graph.execute();

    expect(attempts).toBe(2);
    expect(failing.cookState).toBe('clean');
    expect(dependent.cookState).toBe('clean');
    expect(dependentCook).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it('retries a failed node when its output is explicitly requested', async () => {
    const node = new Node('node', 'Test', graph);
    graph.addElement(node);
    let attempts = 0;
    node.setFunction(() => {
      attempts++;
      if (attempts === 1) throw new Error('transient');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await graph.execute();
    await node.requestOutput();

    expect(attempts).toBe(2);
    expect(node.cookState).toBe('clean');
    consoleError.mockRestore();
  });

  it('does no work when every node is clean', async () => {
    const node = new Node('node', 'Test', graph);
    const execute = vi.fn();
    node.setFunction(execute);
    graph.addElement(node);
    await graph.execute();
    execute.mockClear();

    await graph.scheduler.flush();
    await graph.execute();

    expect(execute).not.toHaveBeenCalled();
  });

  it('publishes graph progress while keeping state on each node', async () => {
    const node = new Node('node', 'Test', graph);
    node.setFunction(() => {});
    graph.addElement(node);
    const phases: string[] = [];
    const unsubscribe = graph.scheduler.subscribe(status => phases.push(status.phase));

    await graph.execute();
    unsubscribe();

    expect(phases).toContain('cooking');
    expect(phases.at(-1)).toBe('idle');
    expect(node.cookState).toBe('clean');
  });

  it('reports queued work and counts blocked nodes as completed progress', async () => {
    vi.useFakeTimers();
    const failing = new Node('failing', 'Test', graph);
    const blocked = new Node('blocked', 'Test', graph);
    graph.addElement(failing);
    graph.addElement(blocked);
    connect(graph, failing, blocked);
    failing.setFunction(() => { throw new Error('boom'); });
    blocked.setFunction(() => {});
    const statuses: Array<{ phase: string; total: number; completed: number }> = [];
    graph.scheduler.subscribe(status => statuses.push({
      phase: status.phase,
      total: status.total,
      completed: status.completed,
    }));

    failing.markDirty();
    expect(graph.scheduler.status).toMatchObject({ phase: 'scheduled', total: 2 });
    await graph.scheduler.flush();

    expect(statuses).toContainEqual({ phase: 'cooking', total: 2, completed: 2 });
  });

  it('cooks each node once on a representative cold load', async () => {
    const nodes = Array.from({ length: 21 }, (_, index) => new Node(`node-${index}`, 'Test', graph));
    const cooks = nodes.map(() => vi.fn());
    nodes.forEach((node, index) => {
      graph.addElement(node);
      node.setFunction(cooks[index]);
      if (index > 0) connect(graph, nodes[index - 1], node);
    });

    await graph.execute();

    for (const cook of cooks) expect(cook).toHaveBeenCalledTimes(1);
  });

  it('invalidates the target branch when a cold-load connection binds', async () => {
    const source = new Node('source', 'Test', graph);
    const target = new Node('target', 'Test', graph);
    const unrelated = new Node('unrelated', 'Test', graph);
    [source, target, unrelated].forEach(node => graph.addElement(node));
    const sourceOutput = source.out<number>('value');
    const targetInput = target.in<number>('value', 0);
    const targetCook = vi.fn();
    const unrelatedCook = vi.fn();
    source.setFunction(() => sourceOutput.setValue(2));
    target.setFunction(targetCook);
    unrelated.setFunction(unrelatedCook);
    await graph.execute();
    targetCook.mockClear();
    unrelatedCook.mockClear();

    graph.connect(sourceOutput, targetInput);
    await graph.scheduler.flush();

    expect(targetCook).toHaveBeenCalledTimes(1);
    expect(unrelatedCook).not.toHaveBeenCalled();
  });
});
