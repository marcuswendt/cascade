import { describe, expect, it } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { sameOutputValue } from '@/nodes/outputEquality';

/**
 * Early cutoff: a node that re-cooks and produces the same output does not
 * invalidate the graph below it. Every doubt resolves to "cook".
 */
describe('early cutoff', () => {
  function chain(produce: () => unknown) {
    const graph = new Graph();
    const cooks: string[] = [];
    const source = new Node('source', 'Test', graph);
    const middle = new Node('middle', 'Test', graph);
    const sink = new Node('sink', 'Test', graph);
    [source, middle, sink].forEach(node => graph.addElement(node));
    const sourceOut = source.out<unknown>('value');
    const middleOut = middle.out<unknown>('value');
    graph.connect(sourceOut, middle.in<unknown>('value', 0));
    graph.connect(middleOut, sink.in<unknown>('value', 0));
    let middleMap = (value: unknown) => value;
    source.setFunction(() => { cooks.push('source'); sourceOut.setValue(produce()); });
    middle.setFunction(() => { cooks.push('middle'); middleOut.setValue(middleMap(middle.inputs[0].value)); });
    sink.setFunction(() => { cooks.push('sink'); });
    return { graph, cooks, source, middle, sink, setMiddle: (fn: (value: unknown) => unknown) => { middleMap = fn; } };
  }

  it('keeps everything below a re-cook that produced identical output', async () => {
    const { graph, cooks, source } = chain(() => ({ path: '.cascade-cache/a.png', size: [4, 4] }));
    await graph.execute();
    cooks.length = 0;
    const cutOff: number[] = [];
    graph.scheduler.subscribe(status => cutOff.push(status.cutOff ?? 0));

    source.markDirty();
    await graph.scheduler.flush();

    expect(cooks).toEqual(['source']);
    expect(Math.max(...cutOff)).toBe(2);
    expect(graph.nodes.every(node => node.cookState === 'clean')).toBe(true);
  });

  it('cuts off where the values converge, not before', async () => {
    let n = 1;
    const { graph, cooks, source, setMiddle } = chain(() => n);
    setMiddle(value => (value as number) > 0 ? 'positive' : 'not');
    await graph.execute();
    cooks.length = 0;

    n = 2; // changes the source, but not what middle makes of it
    source.markDirty();
    await graph.scheduler.flush();
    expect(cooks).toEqual(['source', 'middle']);

    cooks.length = 0;
    n = -1; // now middle changes too
    source.markDirty();
    await graph.scheduler.flush();
    expect(cooks).toEqual(['source', 'middle', 'sink']);
  });

  it('cooks downstream when the same object comes back, since it may be mutated in place', async () => {
    const shared = { pixels: [0] };
    const { graph, cooks, source } = chain(() => { shared.pixels[0] += 1; return shared; });
    await graph.execute();
    cooks.length = 0;
    source.markDirty();
    await graph.scheduler.flush();
    expect(cooks).toEqual(['source', 'middle', 'sink']);
  });

  it('cooks downstream when the upstream set no output this cook', async () => {
    const graph = new Graph();
    const cooks: string[] = [];
    const a = new Node('a', 'Test', graph);
    const b = new Node('b', 'Test', graph);
    graph.addElement(a);
    graph.addElement(b);
    graph.connect(a.out<number>('value'), b.in<number>('value', 0));
    a.setFunction(() => { cooks.push('a'); });
    b.setFunction(() => { cooks.push('b'); });
    await graph.execute();
    cooks.length = 0;
    a.markDirty();
    await graph.scheduler.flush();
    expect(cooks).toEqual(['a', 'b']);
  });

  it('always cooks a node that was itself invalidated, and one that opts out', async () => {
    const { graph, cooks, source, middle, sink } = chain(() => 7);
    await graph.execute();
    cooks.length = 0;

    middle.markDirty(); // its own parameter changed: identical inputs do not excuse it
    await graph.scheduler.flush();
    expect(cooks).toEqual(['middle']);

    cooks.length = 0;
    sink.earlyCutoff = false;
    source.markDirty();
    await graph.scheduler.flush();
    expect(cooks).toEqual(['source', 'sink']);
  });

  it('cooks again after a failure even if inputs did not change', async () => {
    const { graph, cooks, source, middle, setMiddle } = chain(() => 1);
    await graph.execute();
    let fail = true;
    // Not setFunction: that resets the node and would make it cook anyway.
    setMiddle(value => { if (fail) throw new Error('boom'); return value; });
    const errors = console.error;
    console.error = () => {};
    middle.markDirty();
    await graph.scheduler.flush();
    console.error = errors;
    expect(middle.cookState).toBe('error');
    fail = false;
    cooks.length = 0;
    source.markDirty(); // identical source output; middle must still retry
    await graph.scheduler.flush();
    // Middle retried; it then produced what sink last cooked against, so sink
    // is correctly cut off.
    expect(cooks).toEqual(['source', 'middle']);
    expect(graph.nodes.every(node => node.cookState === 'clean')).toBe(true);
  });
});

describe('sameOutputValue', () => {
  it('compares plain data structurally and refuses what it cannot see into', () => {
    expect(sameOutputValue(1, 1)).toBe(true);
    expect(sameOutputValue(NaN, NaN)).toBe(true);
    expect(sameOutputValue('a', 'b')).toBe(false);
    expect(sameOutputValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameOutputValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameOutputValue([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(sameOutputValue(new Float32Array([1, 2]), new Float32Array([1, 2]))).toBe(true);
    expect(sameOutputValue(new Float32Array([1, 2]), new Float32Array([1, 3]))).toBe(false);
    expect(sameOutputValue(new Float32Array([1]), new Uint32Array([1]))).toBe(false);
    const object = { a: 1 };
    expect(sameOutputValue(object, object)).toBe(false);
    // Shared plain parts inside distinct containers are fine; a shared
    // non-plain part is not.
    const size = [4, 4];
    expect(sameOutputValue({ size }, { size })).toBe(true);
    class Texture {}
    const texture = new Texture();
    expect(sameOutputValue({ texture }, { texture })).toBe(false);
    expect(sameOutputValue(new Map(), new Map())).toBe(false);
    expect(sameOutputValue(() => 1, () => 1)).toBe(false);
  });

  it('gives up past its budget rather than walking forever', () => {
    const big = Array.from({ length: 1000 }, (_, i) => i);
    expect(sameOutputValue(big, big.slice(), 100)).toBe(false);
    expect(sameOutputValue(big, big.slice())).toBe(true);
  });
});
