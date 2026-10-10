import { describe, expect, it } from 'vitest';
import { computeGraphFocus, nodeEmphasis, wireRole, NO_FOCUS } from '../src/editor/graphFocus';

const w = (id: string, from: string, to: string) => ({ id, from: { nodeId: from }, to: { nodeId: to } });
// a -> b -> c -> d, and e -> d
const wires = [w('ab', 'a', 'b'), w('bc', 'b', 'c'), w('cd', 'c', 'd'), w('ed', 'e', 'd')];

describe('graph focus', () => {
  it('with nothing selected or hovered, every node is plain and every wire idle', () => {
    const f = computeGraphFocus([], null, wires);
    expect(f).toBe(NO_FOCUS);
    expect(nodeEmphasis('a', f)).toBe('none');
    expect(wires.map(x => wireRole(x, f))).toEqual(['idle', 'idle', 'idle', 'idle']);
  });

  it('a selection lifts its own wires and its direct neighbours, and fades the rest', () => {
    const f = computeGraphFocus(['b'], null, wires);
    expect(f.mode).toBe('select');
    expect(['a', 'b', 'c', 'd', 'e'].map(id => nodeEmphasis(id, f)))
      .toEqual(['neighbour', 'focus', 'neighbour', 'faded', 'faded']);
    expect(wires.map(x => wireRole(x, f))).toEqual(['focus', 'focus', 'faded', 'faded']);
  });

  it('a wire between two selected nodes is focus, and neither node is a neighbour', () => {
    const f = computeGraphFocus(['b', 'c'], null, wires);
    expect(nodeEmphasis('c', f)).toBe('focus');
    expect(nodeEmphasis('d', f)).toBe('neighbour');
    expect(wireRole(wires[1], f)).toBe('focus');
  });

  it('hover previews the same focus, and a selection wins over it', () => {
    expect(computeGraphFocus([], 'd', wires).mode).toBe('hover');
    expect(nodeEmphasis('e', computeGraphFocus([], 'd', wires))).toBe('neighbour');
    const f = computeGraphFocus(['a'], 'd', wires);
    expect(f.mode).toBe('select');
    expect(nodeEmphasis('d', f)).toBe('faded');
  });

  it('a hovered wire is always in focus', () => {
    expect(wireRole(wires[3], NO_FOCUS, 'ed')).toBe('focus');
    expect(wireRole(wires[3], computeGraphFocus(['a'], null, wires), 'ed')).toBe('focus');
  });
});
