/**
 * Frame-to-pixel mapping for the timeline ruler and dope sheet.
 *
 * Pure on purpose: every interaction in the panel (scrub, drag a key, pick a
 * tick spacing) is this arithmetic plus a DOM event, so it is the half worth
 * testing and the half that must not touch Svelte, the graph or the clock.
 */

export interface TimelineView {
  /** First frame shown at the left edge of the track area. */
  start: number;
  /** Last frame shown at the right edge. */
  end: number;
  /** Width of the track area in CSS pixels (excluding the label gutter). */
  width: number;
}

/** Pixels a single frame occupies. Never zero, so callers can divide by it. */
export function pixelsPerFrame(view: TimelineView): number {
  const span = frameSpan(view);
  return view.width / span;
}

/** The number of frame intervals across the view. At least 1 — a one-frame
 *  range is a point, and a zero span would make every mapping infinite. */
export function frameSpan(view: TimelineView): number {
  return Math.max(1, view.end - view.start);
}

/** Position of a (possibly fractional) frame, in pixels from the track's left edge. */
export function frameToX(frame: number, view: TimelineView): number {
  return (frame - view.start) * pixelsPerFrame(view);
}

/** The fractional frame under a pixel offset. Not clamped — callers decide. */
export function xToFrame(x: number, view: TimelineView): number {
  return view.start + x / pixelsPerFrame(view);
}

export function clampFrame(frame: number, view: TimelineView): number {
  return Math.min(view.end, Math.max(view.start, frame));
}

/** The frame a click lands on: the fractional position rounded and clamped. */
export function frameAt(x: number, view: TimelineView): number {
  return clampFrame(Math.round(xToFrame(x, view)), view);
}

const TICK_STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/**
 * A round frame interval whose labels will not collide at this zoom.
 * Falls back to the largest known step rather than looping forever on a very
 * long range at a very small width.
 */
export function tickStep(view: TimelineView, minSpacingPx = 56): number {
  const perFrame = pixelsPerFrame(view);
  for (const step of TICK_STEPS) {
    if (step * perFrame >= minSpacingPx) return step;
  }
  return TICK_STEPS[TICK_STEPS.length - 1];
}

/** Labelled frames for the ruler, on round multiples of the tick step. */
export function frameTicks(view: TimelineView, minSpacingPx = 56): number[] {
  const step = tickStep(view, minSpacingPx);
  const first = Math.ceil(view.start / step) * step;
  const ticks: number[] = [];
  for (let frame = first; frame <= view.end; frame += step) ticks.push(frame);
  // A range that never crosses a multiple of the step would draw no ruler at
  // all, which reads as a broken panel rather than as a tight zoom.
  if (ticks.length === 0) ticks.push(view.start, view.end);
  return ticks;
}

/**
 * The key nearest a pixel offset within `radiusPx`, or null.
 *
 * Returns the frame rather than an index so a caller holding a stale copy of
 * the track cannot address the wrong key after an edit.
 */
export function hitTestKey(
  x: number,
  keyFrames: readonly number[],
  view: TimelineView,
  radiusPx = 6
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const frame of keyFrames) {
    const distance = Math.abs(frameToX(frame, view) - x);
    if (distance <= radiusPx && distance < bestDistance) {
      best = frame;
      bestDistance = distance;
    }
  }
  return best;
}
