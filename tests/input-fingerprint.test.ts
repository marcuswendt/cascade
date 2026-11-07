/**
 * A clean node fed a different image must cook again, whatever the image's size.
 *
 * The fault: `Node.getValueFingerprint` sampled a typed array's first, middle
 * and last value and reduced an image to width x height x channels, so two
 * different images of the same size fingerprinted the same, `isDirty` said
 * clean, and the node skipped the re-cook and kept showing the old picture.
 * Found by the 6 Nov 2026 architecture review (Node.ts:2074-2086).
 */
import { describe, expect, it } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { hashBytes, valueFingerprint } from '@/nodes/inputFingerprint';
import { Planar } from '../packages/runtime/src/builtins/image/planar.js';

/** Two same-size images that agree on every value the old fingerprint read:
 *  first, middle and last of every channel. They differ in one pixel. (A
 *  planar float image, the shape the class image nodes passed around.) */
function twins(width = 64, height = 64): [Planar, Planar] {
  const a = Planar.rgba(width, height);
  const b = Planar.rgba(width, height);
  for (const image of [a, b]) for (const channel of image.channels) channel.fill(0.5);
  b.channels[0]![7] = 0.9;
  return [a, b];
}

function consumer(graph: Graph) {
  const node = new Node('consumer', 'test/consumer', graph);
  const seen: unknown[] = [];
  const input = node.in<unknown>('image', null);
  node.setFunction(() => { seen.push(input.value); });
  graph.addElement(node);
  return { node, input, seen };
}

describe('input fingerprint', () => {
  it('re-cooks a node handed a different image of the same size', async () => {
    const graph = new Graph();
    const { node, input, seen } = consumer(graph);
    const [a, b] = twins();

    input.value = a;
    await node.execute();
    expect(node.isDirty).toBe(false);

    input.value = b;
    expect(node.isDirty).toBe(true);
    await node.requestOutput();
    expect(seen[seen.length - 1]).toBe(b);
  });

  it('re-cooks when a typed array input is changed in place, away from the sampled positions', async () => {
    const graph = new Graph();
    const { node, input, seen } = consumer(graph);
    const data = new Float32Array(1000).fill(1);

    input.value = data;
    await node.execute();
    expect(node.isDirty).toBe(false);

    data[123] = 2;
    expect(node.isDirty).toBe(true);
    await node.requestOutput();
    expect(seen).toHaveLength(2);
  });

  it('re-cooks downstream of a producer that commits a different same-size image', async () => {
    const graph = new Graph();
    const producer = new Node('producer', 'test/producer', graph);
    const output = producer.out<unknown>('image');
    graph.addElement(producer);
    const { node, input, seen } = consumer(graph);
    graph.connect(output, input);
    const [a, b] = twins();

    output.setValue(a);
    await node.execute();
    expect(node.isDirty).toBe(false);

    output.setValue(b);
    expect(node.isDirty).toBe(true);
    await node.requestOutput();
    expect(seen[seen.length - 1]).toBe(b);
  });

  it('stays clean when nothing changed, so the cut-off still holds', async () => {
    const graph = new Graph();
    const { node, input, seen } = consumer(graph);

    input.value = { radius: 3, mode: 'gauss' };
    await node.execute();
    input.value = { radius: 3, mode: 'gauss' }; // a new object, the same value
    expect(node.isDirty).toBe(false);
    await node.requestOutput();
    expect(seen).toHaveLength(1);
  });

  it('tells apart values the sampled fingerprint confused', () => {
    const [a, b] = twins();
    expect(valueFingerprint(a)).not.toBe(valueFingerprint(b));
    const x = new Float32Array([1, 2, 3, 4, 5]);
    const y = new Float32Array([1, 9, 3, 4, 5]);
    expect(valueFingerprint(x)).not.toBe(valueFingerprint(y));
    // A large plain object whose first 100 characters and length agree.
    const big = (last: number) => ({ items: Array.from({ length: 200 }, (_, i) => (i === 199 ? last : 0)) });
    expect(valueFingerprint(big(1))).not.toBe(valueFingerprint(big(2)));
    // And a number is not its string.
    expect(valueFingerprint(1)).not.toBe(valueFingerprint('1'));
  });

  it('does not let two changes in one hash lane cancel out', () => {
    const base = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const flipped = base.slice();
    flipped[0] = -flipped[0]!;
    flipped[4] = -flipped[4]!; // the same lane, four words on
    expect(hashBytes(flipped)).not.toBe(hashBytes(base));
    const swapped = base.slice();
    swapped[0] = base[4]!;
    swapped[4] = base[0]!;
    expect(hashBytes(swapped)).not.toBe(hashBytes(base));
  });

  it('hashes unaligned views and tails byte by byte', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    const unaligned = new Uint8Array(bytes.buffer, 1, 6);
    const changed = new Uint8Array([1, 2, 3, 4, 5, 6, 8]);
    expect(hashBytes(bytes)).not.toBe(hashBytes(changed));
    expect(hashBytes(unaligned)).toBe(hashBytes(new Uint8Array([2, 3, 4, 5, 6, 7])));
  });
});
