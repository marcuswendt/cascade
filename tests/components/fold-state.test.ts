import { describe, expect, it } from 'vitest';
import { Orientation, type SerializedDockview } from 'dockview';
import {
  DEFAULT_RESTORE_SIZE,
  FOLDED_SIZE,
  MIN_RESTORE_SIZE,
  adoptOrphanFolds,
  deserializeFolds,
  fold,
  foldAxis,
  forget,
  isFolded,
  layoutGroupSizes,
  sanitizeRestoreMinimum,
  sanitizeRestoreSize,
  serializeFolds,
  unfold,
  type FoldMap,
} from '@/editor/dockview/fold';

const grid = (orientation: Orientation, root: unknown): SerializedDockview['grid'] =>
  ({ root, orientation, width: 1000, height: 800 } as never);

describe('fold bookkeeping', () => {
  it('remembers the size a group had, and gives exactly that back', () => {
    const folded = fold(new Map(), 'group-timeline', { size: 180, minimum: 100, axis: 'height' });

    expect(isFolded(folded, 'group-timeline')).toBe(true);
    expect(folded.get('group-timeline')).toEqual({ size: 180, minimum: 100, axis: 'height' });

    const { map, restore } = unfold(folded, 'group-timeline');
    expect(restore).toEqual({ size: 180, minimum: 100, axis: 'height' });
    expect(isFolded(map, 'group-timeline')).toBe(false);
  });

  it('does not mutate the map it is given', () => {
    const original: FoldMap = new Map();
    const folded = fold(original, 'group-graph', { size: 620, minimum: 100, axis: 'height' });

    expect(original.size).toBe(0);
    expect(folded).not.toBe(original);
  });

  it('is idempotent: folding an already-folded group keeps the original size', () => {
    const once = fold(new Map(), 'group-timeline', { size: 180, minimum: 100, axis: 'height' });
    // A second fold arrives with the group already at strip size — the header
    // button and the tab double-click both reach this, so it happens.
    const twice = fold(once, 'group-timeline', { size: FOLDED_SIZE, minimum: FOLDED_SIZE, axis: 'height' });

    expect(twice).toBe(once);
    expect(unfold(twice, 'group-timeline').restore?.size).toBe(180);
  });

  it('refuses to remember a size that is already collapsed', () => {
    const folded = fold(new Map(), 'group-log', { size: FOLDED_SIZE, minimum: 0, axis: 'height' });

    expect(unfold(folded, 'group-log').restore?.size).toBeGreaterThanOrEqual(MIN_RESTORE_SIZE);
  });

  it('falls back when the group reported no usable size at all', () => {
    expect(sanitizeRestoreSize(undefined)).toBe(DEFAULT_RESTORE_SIZE);
    expect(sanitizeRestoreSize(NaN)).toBe(DEFAULT_RESTORE_SIZE);
    expect(sanitizeRestoreSize(0)).toBeGreaterThanOrEqual(MIN_RESTORE_SIZE);
    expect(sanitizeRestoreSize(-40)).toBeGreaterThanOrEqual(MIN_RESTORE_SIZE);
    expect(sanitizeRestoreSize(180.6)).toBe(181);
    expect(sanitizeRestoreMinimum(undefined)).toBe(0);
    expect(sanitizeRestoreMinimum(-5)).toBe(0);
    expect(sanitizeRestoreMinimum(100.4)).toBe(100);
  });

  it('reports no restore for a group nobody folded', () => {
    const map: FoldMap = new Map();
    const result = unfold(map, 'group-viewer');

    expect(result.restore).toBeNull();
    expect(result.map).toBe(map);
  });

  it('forgets a record without claiming a restore', () => {
    const folded = fold(new Map(), 'group-log', { size: 200, minimum: 0, axis: 'height' });

    expect(forget(folded, 'group-log').size).toBe(0);
    expect(forget(folded, 'group-absent')).toBe(folded);
  });
});

describe('fold persistence', () => {
  it('round-trips through JSON', () => {
    const folded = fold(new Map(), 'group-timeline', { size: 180, minimum: 100, axis: 'height' });
    const revived = deserializeFolds(JSON.parse(JSON.stringify(serializeFolds(folded))));

    expect(revived.get('group-timeline')).toEqual({ size: 180, minimum: 100, axis: 'height' });
  });

  it('drops corrupt records rather than pushing them into the grid', () => {
    const revived = deserializeFolds({
      'good': { size: 180, minimum: 100, axis: 'height' },
      'bad-axis': { size: 180, minimum: 100, axis: 'diagonal' },
      'bad-size': { size: 'tall', minimum: 100, axis: 'height' },
      'no-size': { minimum: 100, axis: 'height' },
      'not-an-object': 7,
    });

    expect([...revived.keys()]).toEqual(['good']);
  });

  it('survives anything localStorage might hold', () => {
    expect(deserializeFolds(null).size).toBe(0);
    expect(deserializeFolds('{}').size).toBe(0);
    expect(deserializeFolds([1, 2]).size).toBe(0);
  });
});

describe('orphan folds in a layout', () => {
  const layout = grid(Orientation.HORIZONTAL, {
    type: 'branch',
    data: [
      {
        type: 'branch',
        size: 500,
        data: [
          { type: 'leaf', size: 620, data: { id: 'group-graph' } },
          { type: 'leaf', size: 8, data: { id: 'group-timeline' } },
        ],
      },
      { type: 'leaf', size: 250, data: { id: 'group-inspector' } },
    ],
  });

  it('reads every group with its size and resize axis', () => {
    expect(layoutGroupSizes(layout)).toEqual([
      { id: 'group-graph', size: 620, axis: 'height' },
      { id: 'group-timeline', size: 8, axis: 'height' },
      { id: 'group-inspector', size: 250, axis: 'width' },
    ]);
  });

  it('sizes a column by width and a row inside it by height', () => {
    // The real default layout's shape: three columns, the left one split into
    // graph over timeline. Marcus asked for the timeline to fold to a thin
    // *height*, so getting this backwards would shrink it sideways instead.
    expect(foldAxis(layout, 'group-inspector')).toBe('width');
    expect(foldAxis(layout, 'group-timeline')).toBe('height');
    expect(foldAxis(layout, 'group-missing')).toBeNull();
  });

  it('sizes a single root group along the grid orientation', () => {
    const single = grid(Orientation.HORIZONTAL, { type: 'leaf', size: 900, data: { id: 'only' } });

    expect(foldAxis(single, 'only')).toBe('width');
  });

  it('adopts a hairline group that arrived without a record', () => {
    const adopted = adoptOrphanFolds(layout, new Map());

    // Without this, a .cascade document that travelled without its fold
    // records would open with an 8px timeline, no memory of its size and no
    // visible control — the one case where folding loses a panel for good.
    expect(isFolded(adopted, 'group-timeline')).toBe(true);
    expect(adopted.get('group-timeline')?.size).toBeGreaterThanOrEqual(MIN_RESTORE_SIZE);
    expect(adopted.get('group-timeline')?.axis).toBe('height');
    expect(isFolded(adopted, 'group-graph')).toBe(false);
    expect(isFolded(adopted, 'group-inspector')).toBe(false);
  });

  it('never overwrites a record it already has', () => {
    const known = fold(new Map(), 'group-timeline', { size: 180, minimum: 100, axis: 'height' });

    expect(adoptOrphanFolds(layout, known).get('group-timeline')?.size).toBe(180);
  });

  it('leaves a layout with nothing folded alone', () => {
    const open = grid(Orientation.VERTICAL, {
      type: 'branch',
      data: [{ type: 'leaf', size: 400, data: { id: 'group-graph' } }],
    });

    expect(adoptOrphanFolds(open, new Map()).size).toBe(0);
  });
});
