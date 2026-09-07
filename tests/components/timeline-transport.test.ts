// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Transport } from '@/editor/panels/timeline/transport';

const range = { start: 1, end: 10, fps: 10, loop: false };

function transport(overrides: Partial<typeof range> = {}) {
  return new Transport({ ...range, ...overrides });
}

describe('transport stepping and jumps', () => {
  it('starts at the range start and clamps every move', () => {
    const t = transport();
    expect(t.frame).toBe(1);
    expect(t.step(-5)).toBe(1);
    expect(t.step(3)).toBe(4);
    expect(t.toEnd()).toBe(10);
    expect(t.step(4)).toBe(10);
    expect(t.toStart()).toBe(1);
  });

  it('pauses when a step or a scrub happens mid-playback', () => {
    const t = transport();
    t.play(0);
    expect(t.playing).toBe(true);
    t.step(1);
    expect(t.playing).toBe(false);
  });

  it('rounds a typed frame', () => {
    const t = transport();
    expect(t.setFrame(4.6)).toBe(5);
  });
});

describe('playback against the wall clock', () => {
  it('advances in real time at the given fps', () => {
    const t = transport();
    t.play(0);
    expect(t.advance(50)).toBeNull();      // half a frame at 10fps
    expect(t.advance(100)).toBe(2);
    expect(t.advance(300)).toBe(4);
  });

  it('drops frames rather than queuing them while a cook runs', () => {
    const t = transport();
    t.play(0);
    expect(t.advance(100, true)).toBeNull();
    expect(t.advance(200, true)).toBeNull();
    expect(t.dropped).toBe(2);
    // Real time has moved on by 300ms, so the next free tick lands on frame 4 —
    // it does not replay the two frames it skipped.
    expect(t.advance(300, false)).toBe(4);
  });

  it('stops at the end when not looping', () => {
    const t = transport();
    t.play(0);
    expect(t.advance(2000)).toBe(10);
    expect(t.playing).toBe(false);
    expect(t.advance(3000)).toBeNull();
  });

  it('wraps to the start when looping', () => {
    const t = transport({ loop: true });
    t.play(0);
    expect(t.advance(1000)).toBe(1);   // 10 frames on, back to the start
    expect(t.playing).toBe(true);
    expect(t.advance(1200)).toBe(3);
  });

  it('replays from the start when play is pressed on the last frame', () => {
    const t = transport();
    t.toEnd();
    t.play(0);
    expect(t.frame).toBe(1);
    expect(t.playing).toBe(true);
  });

  it('re-anchors on a scrub so playback resumes from where the head is', () => {
    const t = transport();
    t.setFrame(5, 1000);
    t.play(1000);
    expect(t.advance(1100)).toBe(6);
  });

  it('keeps the frame inside a range that shrinks under it', () => {
    const t = transport();
    t.setFrame(9);
    t.setRange({ end: 4 });
    expect(t.frame).toBe(4);
  });
});
