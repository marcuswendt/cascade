import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybackClock } from '@/player/editorPlayback';

/** A cook the test finishes by hand, so a slow graph can be held mid-cook. */
function cooks() {
  const started: number[] = [];
  const finish: (() => void)[] = [];
  const cook = (frame: number) => new Promise<void>((resolve) => { started.push(frame); finish.push(resolve); });
  const done = async () => { finish.shift()!(); await vi.advanceTimersByTimeAsync(0); };
  return { started, cook, done };
}

describe('editor playback clock', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts paused on frame 1 and cooks nothing until played', async () => {
    const { started, cook } = cooks();
    const clock = new PlaybackClock({ fps: 25, frames: 4 }, cook);
    await vi.advanceTimersByTimeAsync(1000);
    expect(clock.playing).toBe(false);
    expect(clock.frame).toBe(1);
    expect(started).toEqual([]);
  });

  it('steps one frame per tick at fps and loops over frames', async () => {
    const started: number[] = [];
    const clock = new PlaybackClock({ fps: 25, frames: 3 }, async (frame) => { started.push(frame); });
    clock.play();
    await vi.advanceTimersByTimeAsync(40 * 5);
    expect(started).toEqual([2, 3, 1, 2, 3]);
    clock.pause();
    await vi.advanceTimersByTimeAsync(400);
    expect(started).toHaveLength(5);
    expect(clock.frame).toBe(3);
  });

  it('drops the frames that came due during a slow cook and cooks the latest one next', async () => {
    const { started, cook, done } = cooks();
    const clock = new PlaybackClock({ fps: 10, frames: 100 }, cook);
    clock.play();
    await vi.advanceTimersByTimeAsync(100);
    expect(started).toEqual([2]);
    // Four more ticks while frame 2 is still cooking: none starts a cook.
    await vi.advanceTimersByTimeAsync(400);
    expect(started).toEqual([2]);
    expect(clock.frame).toBe(6);
    await done();
    expect(started).toEqual([2, 6]);
    await done();
    // Nothing came due while 6 cooked: the engine is idle until the next tick.
    expect(started).toEqual([2, 6]);
    await vi.advanceTimersByTimeAsync(100);
    expect(started).toEqual([2, 6, 7]);
  });

  it('pausing mid-cook stops on the current frame and cooks it once the worker is free', async () => {
    const { started, cook, done } = cooks();
    const clock = new PlaybackClock({ fps: 10, frames: 100 }, cook);
    clock.play();
    await vi.advanceTimersByTimeAsync(300);
    clock.pause();
    expect(clock.frame).toBe(4);
    await done();
    expect(started).toEqual([2, 4]);
    await done();
    await vi.advanceTimersByTimeAsync(1000);
    expect(started).toEqual([2, 4]);
    expect(clock.frame).toBe(4);
  });

  it('keeps playing after a failed cook', async () => {
    let calls = 0;
    const clock = new PlaybackClock({ fps: 10, frames: 5 }, async () => { calls++; throw new Error('bad frame'); });
    clock.play();
    await vi.advanceTimersByTimeAsync(300);
    expect(calls).toBe(3);
  });

  it('wraps a frame outside the loop back to its start', () => {
    const clock = new PlaybackClock({ fps: 25, frames: 100 }, async () => {}, 250);
    expect(clock.next(250)).toBe(1);
    expect(clock.next(99)).toBe(100);
    expect(clock.next(100)).toBe(1);
  });
});
