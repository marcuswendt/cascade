/**
 * Frame-range evaluation, neutral runtime.
 *
 * The loop the engine has always been missing: set the frame, mark the
 * time-dependent nodes dirty, hand the frame to a caller, repeat. It writes no
 * files and spawns no encoder — frames are produced where the canvas is, so
 * what the caller does with each frame is the caller's business.
 *
 * The loop owns no graph and no clock of its own. It drives a `FrameClock`,
 * which a host binds to its own engine state.
 */

export interface FrameClock {
  /** Set the current frame. Fractional frames must be preserved. */
  setFrame(frame: number): void;
  /** Dirty every node whose parameters depend on time. */
  markTimeDependentDirty(): void;
  /** Integer frame — $F */
  getFrame(): number;
  /** Fractional frame — $FF */
  getFrameFraction(): number;
  /** Seconds — $T */
  getTime(): number;
  /** Rate — $FPS */
  getFps(): number;
}

/** What a caller is told about the frame it has been handed. */
export interface FrameInfo {
  /** 0-based position in the range. */
  index: number;
  /** Total frames in the range. */
  total: number;
  /** Integer frame — $F */
  frame: number;
  /** Fractional frame — $FF */
  fframe: number;
  /** Seconds — $T */
  time: number;
  /** Rate — $FPS */
  fps: number;
}

export interface FrameRangeOptions {
  /** First frame, inclusive. */
  start: number;
  /** Last frame, inclusive when the step lands on it. */
  end: number;
  /** Frame increment. Must be > 0; may be fractional for sub-frame stepping. */
  step?: number;
  /** Called once per frame, after the frame is set and dirt is marked. */
  onFrame: (info: FrameInfo) => void | Promise<void>;
  /** Cooperative cancellation, checked before each frame. */
  signal?: { readonly aborted: boolean };
  /** Restore the clock's frame when the loop finishes. Default true. */
  restoreFrame?: boolean;
}

export interface FrameRangeResult {
  /** The fractional frames visited, in order. */
  frames: number[];
  frameCount: number;
  /** True if a signal cut the loop short. */
  aborted: boolean;
}

/**
 * The frames a range visits. Pure — no clock, no side effects — so a caller can
 * size a progress bar or a sequence without running anything.
 */
export function frameRange(start: number, end: number, step: number = 1): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error(`frameRange: start and end must be finite (got ${start}, ${end})`);
  }
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error(`frameRange: step must be a finite number greater than 0 (got ${step})`);
  }
  if (end < start) {
    throw new Error(`frameRange: end (${end}) must not be before start (${start})`);
  }

  // Count from the span rather than accumulating, so a fractional step does not
  // drift and an inclusive end lands exactly.
  const span = end - start;
  const count = Math.floor(span / step + 1e-9) + 1;

  const frames: number[] = new Array(count);
  for (let i = 0; i < count; i++) frames[i] = start + i * step;
  return frames;
}

/**
 * Walk a frame range against a clock, calling back once per frame.
 *
 * Per frame, in this order: set the frame, mark time-dependent nodes dirty,
 * then call `onFrame`. The callback is where a cook happens — the loop does not
 * assume one, which is what lets the same loop serve a render, a test, or a
 * headless evaluation.
 */
export async function runFrameRange(
  clock: FrameClock,
  options: FrameRangeOptions
): Promise<FrameRangeResult> {
  const { start, end, step = 1, onFrame, signal, restoreFrame = true } = options;
  const frames = frameRange(start, end, step);
  const previousFrame = clock.getFrameFraction();

  const visited: number[] = [];
  let aborted = false;

  try {
    for (let index = 0; index < frames.length; index++) {
      if (signal?.aborted) {
        aborted = true;
        break;
      }

      clock.setFrame(frames[index]);
      clock.markTimeDependentDirty();

      await onFrame({
        index,
        total: frames.length,
        frame: clock.getFrame(),
        fframe: clock.getFrameFraction(),
        time: clock.getTime(),
        fps: clock.getFps()
      });

      visited.push(clock.getFrameFraction());
    }
  } finally {
    if (restoreFrame) {
      clock.setFrame(previousFrame);
      clock.markTimeDependentDirty();
    }
  }

  return { frames: visited, frameCount: visited.length, aborted };
}
