// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  clampFrame,
  frameAt,
  frameSpan,
  frameTicks,
  frameToX,
  hitTestKey,
  pixelsPerFrame,
  tickStep,
  xToFrame,
  type TimelineView
} from '@/editor/panels/timeline/timeline-math';

const view: TimelineView = { start: 1, end: 101, width: 500 };

describe('timeline frame-to-pixel mapping', () => {
  it('maps the range onto the full track width', () => {
    expect(pixelsPerFrame(view)).toBe(5);
    expect(frameToX(1, view)).toBe(0);
    expect(frameToX(101, view)).toBe(500);
    expect(frameToX(51, view)).toBe(250);
  });

  it('round-trips a pixel back to a fractional frame', () => {
    expect(xToFrame(250, view)).toBe(51);
    expect(xToFrame(252.5, view)).toBe(51.5);
    expect(frameToX(xToFrame(137, view), view)).toBeCloseTo(137, 10);
  });

  it('never divides by a zero span', () => {
    const point: TimelineView = { start: 10, end: 10, width: 200 };
    expect(frameSpan(point)).toBe(1);
    expect(Number.isFinite(pixelsPerFrame(point))).toBe(true);
    expect(frameToX(10, point)).toBe(0);
  });

  it('snaps and clamps a click to a frame inside the range', () => {
    expect(frameAt(252.5, view)).toBe(52);
    expect(frameAt(251, view)).toBe(51);
    expect(frameAt(-400, view)).toBe(1);
    expect(frameAt(9999, view)).toBe(101);
    expect(clampFrame(0, view)).toBe(1);
    expect(clampFrame(500, view)).toBe(101);
  });
});

describe('ruler ticks', () => {
  it('picks a round step that keeps labels apart', () => {
    expect(tickStep(view, 56)).toBe(25);
    expect(tickStep({ start: 1, end: 1001, width: 500 }, 56)).toBe(250);
    expect(tickStep({ start: 1, end: 11, width: 500 }, 56)).toBe(2);
    // 50px a frame is still under the 56px minimum, so it steps by 2 — the
    // spacing rule wins over the finest possible step.
    expect(tickStep({ start: 1, end: 11, width: 700 }, 56)).toBe(1);
  });

  it('lands ticks on multiples of the step, inside the range', () => {
    const ticks = frameTicks(view, 56);
    expect(ticks).toEqual([25, 50, 75, 100]);
    expect(ticks.every(f => f >= view.start && f <= view.end)).toBe(true);
  });

  it('still draws something when no multiple falls inside the range', () => {
    const narrow: TimelineView = { start: 1002, end: 1003, width: 40 };
    expect(frameTicks(narrow, 56).length).toBeGreaterThan(0);
  });
});

describe('key hit-testing', () => {
  const keys = [10, 20, 60];

  it('returns the frame of the nearest key within the radius', () => {
    expect(hitTestKey(frameToX(20, view), keys, view, 6)).toBe(20);
    expect(hitTestKey(frameToX(20, view) + 4, keys, view, 6)).toBe(20);
  });

  it('returns null when the click is not near any key', () => {
    expect(hitTestKey(frameToX(40, view), keys, view, 6)).toBeNull();
    expect(hitTestKey(0, [], view, 6)).toBeNull();
  });

  it('prefers the closer of two keys in range', () => {
    const tight: TimelineView = { start: 1, end: 11, width: 100 };
    // 10px per frame, so frames 4 and 5 are both within a 12px radius.
    expect(hitTestKey(frameToX(4, tight) + 6.5, [4, 5], tight, 12)).toBe(5);
    expect(hitTestKey(frameToX(4, tight) + 1, [4, 5], tight, 12)).toBe(4);
  });
});
