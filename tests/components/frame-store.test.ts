// @vitest-environment jsdom
import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { currentFrame, setCurrentFrame } from '@/editor/stores/frameStore';
import { cascade } from '@/engine/cascade';

/**
 * `$T * 0.5` showed `= 0` wherever the playhead was, because the badge that
 * displays an evaluated value recomputes only when its reactive dependencies
 * change and the frame was not one of them — nothing in the interface knew the
 * frame had moved. This store is that missing dependency, so it has to stay
 * truthful about what the engine actually holds.
 */
describe('the frame store', () => {
  it('sets the engine and reports what the engine kept', () => {
    setCurrentFrame(31);
    expect(cascade.fframe()).toBe(31);
    expect(get(currentFrame)).toBe(31);
  });

  it('carries the sub-frame remainder, so a badge can show it', () => {
    setCurrentFrame(12.25);
    expect(get(currentFrame)).toBeCloseTo(12.25, 5);
  });

  it('reports the clamped frame rather than echoing the argument', () => {
    // The engine has a minimum frame; echoing back what it was handed would
    // leave the interface showing a frame that does not exist.
    setCurrentFrame(-5);
    expect(get(currentFrame)).toBe(cascade.fframe());
    expect(get(currentFrame)).toBeGreaterThanOrEqual(1);
  });
});
