import { describe, expect, it } from 'vitest';
import { layoutTopDown } from '@/utils/autoLayout';

describe('layoutTopDown', () => {
  it('is deterministic and returns positions only for authored nodes', () => {
    const ids = ['source', 'branch', 'middle', 'sink'];
    const edges = [
      { from: 'source', to: 'branch' },
      { from: 'source', to: 'middle' },
      { from: 'middle', to: 'sink' },
      { from: 'branch', to: 'sink' },
      { from: 'source', to: 'sink' }
    ];

    const first = layoutTopDown(ids, edges);
    const second = layoutTopDown(ids, edges);

    expect([...first]).toEqual([...second]);
    expect([...first.keys()].sort()).toEqual([...ids].sort());
    expect(first.get('source')!.y).toBeLessThan(first.get('middle')!.y);
    expect(first.get('middle')!.y).toBeLessThan(first.get('sink')!.y);
  });

  it('uses measured widths to keep neighbours from overlapping', () => {
    const positions = layoutTopDown(
      ['left', 'right'],
      [],
      { widths: new Map([['left', 420], ['right', 180]]) }
    );

    expect(positions.get('right')!.x - positions.get('left')!.x).toBeGreaterThanOrEqual(510);
  });

  it('never returns a routing placeholder', () => {
    // A long edge is broken into per-layer placeholders. They are an internal
    // device for the ordering and packing; a caller that saw one would try to
    // move a node that does not exist.
    const positions = layoutTopDown(
      ['a', 'b', 'c', 'd'],
      [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }, { from: 'a', to: 'd' }]
    );

    expect([...positions.keys()].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('leaves a lane for an edge that skips a layer', () => {
    // `a -> d` crosses the rows holding b and c. Without a reserved lane the
    // wire is drawn straight over whichever of them is in the way; with one,
    // the row is wide enough for the wire to pass beside them.
    const withSkip = layoutTopDown(
      ['a', 'b', 'c', 'd'],
      [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }, { from: 'a', to: 'd' }]
    );
    const withoutSkip = layoutTopDown(
      ['a', 'b', 'c', 'd'],
      [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }]
    );

    const spread = (m: Map<string, { x: number; y: number }>) =>
      Math.max(...[...m.values()].map(p => p.x)) - Math.min(...[...m.values()].map(p => p.x));

    expect(spread(withSkip)).toBeGreaterThan(spread(withoutSkip));
  });

  it('pulls a node down to its consumer rather than stranding it at the top', () => {
    // `late` feeds only the last node. Ranked by longest path from a source it
    // would sit in the first row, trailing one wire past the whole graph.
    const positions = layoutTopDown(
      ['a', 'b', 'c', 'late'],
      [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'late', to: 'c' }]
    );

    expect(positions.get('late')!.y).toEqual(positions.get('b')!.y);
  });

  it('keeps a direct vertical chain on one column inside a branching graph', () => {
    const positions = layoutTopDown(
      ['source', 'branch', 'left-detail', 'right-detail', 'detached'],
      [
        { from: 'source', to: 'branch' },
        { from: 'branch', to: 'left-detail' },
        { from: 'branch', to: 'right-detail' },
      ]
    );

    expect(positions.get('branch')!.x).toBe(positions.get('source')!.x);
  });

  it('does not hang on a cycle', () => {
    const positions = layoutTopDown(
      ['x', 'y'],
      [{ from: 'x', to: 'y' }, { from: 'y', to: 'x' }]
    );

    expect(positions.size).toBe(2);
  });

  it('handles an empty graph', () => {
    expect(layoutTopDown([], []).size).toBe(0);
  });
});
