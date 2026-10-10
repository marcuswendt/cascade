import { describe, expect, it } from 'vitest';
import {
  clampScrub,
  createScrubState,
  quantizeScrub,
  scrubMultiplier,
  scrubPerPixel,
} from '@/editor/components/scrub';

/**
 * The scrubber's arithmetic: how far a pixel moves a value. Sensitivity comes
 * from what the parameter declares, and only from the value's size when it
 * declares nothing.
 */
describe('scrub sensitivity', () => {
  it('spreads a declared range across ~300 px', () => {
    expect(scrubPerPixel({ min: -1, max: 2 }, 0)).toBeCloseTo(0.01);
  });

  it('uses a declared step when there is no range', () => {
    expect(scrubPerPixel({ step: 0.5 }, 0)).toBe(0.5);
  });

  it('falls back to the value magnitude, never slower than 0.01', () => {
    expect(scrubPerPixel({}, 0)).toBe(0.01);
    expect(scrubPerPixel({}, -0.1)).toBe(0.01);
    expect(scrubPerPixel({}, 250)).toBe(1);
  });

  it('moves an int one unit per four pixels', () => {
    expect(scrubPerPixel({ integer: true }, 10)).toBe(0.25);
  });

  it('shift is ten times coarser, ctrl or cmd ten times finer', () => {
    expect(scrubMultiplier({})).toBe(1);
    expect(scrubMultiplier({ shiftKey: true })).toBe(10);
    expect(scrubMultiplier({ ctrlKey: true })).toBeCloseTo(0.1);
    expect(scrubMultiplier({ metaKey: true })).toBeCloseTo(0.1);
  });
});

describe('a scrub drag', () => {
  it('accumulates pixels into a value and applies modifiers per move', () => {
    const drag = createScrubState(-0.1, {});
    expect(drag.move(10, {})).toBeCloseTo(0);
    expect(drag.move(10, { shiftKey: true })).toBeCloseTo(1);
    expect(drag.move(10, { metaKey: true })).toBeCloseTo(1.01);
  });

  it('clamps to the declared range without a dead zone past it', () => {
    const drag = createScrubState(0.9, { min: 0, max: 1 });
    expect(drag.move(1000, {})).toBe(1);
    // Straight back down from the limit, not from the overshoot.
    expect(drag.move(-30, {})).toBeCloseTo(0.9);
  });

  it('snaps ints', () => {
    const drag = createScrubState(3, { integer: true });
    expect(drag.move(5, {})).toBe(4);
    expect(Number.isInteger(drag.move(3, {}))).toBe(true);
  });

  it('rounds to the precision the drag can express', () => {
    expect(quantizeScrub(0.30000000000000004, 0.01, {})).toBe(0.3);
    expect(clampScrub(-5, { min: -1 })).toBe(-1);
  });
});
