import { describe, expect, it } from 'vitest';
import { layoutTopDownGrouped } from '@/utils/groupedAutoLayout';

const box = (id: string, width = 240, height = 104, decorative = false) => ({ id, width, height, decorative });
const rect = (
  id: string,
  result: ReturnType<typeof layoutTopDownGrouped>,
  fallback = { width: 240, height: 104 },
) => ({ ...result.positions.get(id)!, ...(result.groupSizes.get(id) ?? fallback) });
const intersects = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

describe('layoutTopDownGrouped', () => {
  it('keeps group members enclosed and sibling frames separate', () => {
    const result = layoutTopDownGrouped(
      [box('a'), box('b'), box('c'), box('sink')],
      [{ from: 'a', to: 'sink' }, { from: 'c', to: 'sink' }],
      [
        { id: 'sources', members: ['a', 'b'] },
        { id: 'other', members: ['c'] },
        { id: 'answer', members: ['sink'] },
      ],
    );

    const sources = rect('sources', result);
    for (const id of ['a', 'b']) {
      const member = rect(id, result);
      expect(member.x).toBeGreaterThan(sources.x);
      expect(member.y).toBeGreaterThan(sources.y);
      expect(member.x + member.width).toBeLessThan(sources.x + sources.width);
      expect(member.y + member.height).toBeLessThan(sources.y + sources.height);
    }
    expect(intersects(sources, rect('other', result))).toBe(false);
    expect(intersects(sources, rect('answer', result))).toBe(false);
    expect(rect('answer', result).y).toBeGreaterThan(sources.y);
  });

  it('recursively sizes nested groups without changing their membership model', () => {
    const groups = [
      { id: 'outer', members: ['inner', 'outside'] },
      { id: 'inner', members: ['inside'] },
    ];
    const original = structuredClone(groups);
    const result = layoutTopDownGrouped(
      [box('inside'), box('outside')],
      [],
      groups,
    );

    expect(groups).toEqual(original);
    const outer = rect('outer', result);
    const inner = rect('inner', result);
    const inside = rect('inside', result);
    expect(inner.x).toBeGreaterThan(outer.x);
    expect(inner.y).toBeGreaterThan(outer.y);
    expect(inner.x + inner.width).toBeLessThan(outer.x + outer.width);
    expect(inner.y + inner.height).toBeLessThan(outer.y + outer.height);
    expect(inside.x).toBeGreaterThan(inner.x);
    expect(inside.y).toBeGreaterThan(inner.y);
  });

  it('wraps a wide source rank before placing its downstream group', () => {
    const elements = Array.from({ length: 6 }, (_, index) => box(`source-${index}`, index === 0 ? 780 : 240));
    elements.push(box('sink'));
    const groups = elements.map(element => ({ id: `group-${element.id}`, members: [element.id] }));
    const result = layoutTopDownGrouped(
      elements,
      elements.slice(0, -1).map(element => ({ from: element.id, to: 'sink' })),
      groups,
    );

    const sourceFrames = elements.slice(0, -1).map(element => rect(`group-${element.id}`, result));
    expect(new Set(sourceFrames.map(frame => frame.y)).size).toBeGreaterThan(1);
    expect(rect('group-sink', result).y).toBeGreaterThan(Math.max(...sourceFrames.map(frame => frame.y)));
    expect(Math.max(...sourceFrames.map(frame => frame.x + frame.width))).toBeLessThanOrEqual(1890);
  });

  it('puts standalone canvas notes in a clear margin beside the arranged graph', () => {
    const result = layoutTopDownGrouped(
      [box('source'), box('sink'), box('caption', 480, 185, true)],
      [{ from: 'source', to: 'sink' }],
      [],
    );
    const caption = rect('caption', result, { width: 480, height: 185 });
    expect(caption.x + caption.width).toBeLessThan(rect('source', result).x);
  });
});
