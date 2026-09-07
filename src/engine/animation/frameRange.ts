/**
 * Frame-range evaluation, bound to the Cascade context.
 *
 * The loop the engine already had the parts for and nothing called:
 * `setFrame`, `markTimeDependentDirty()`, cook, repeat. The walk itself lives
 * in the neutral runtime (`@cascade/runtime/animation`); this binds it to the
 * global cascade context and to a caller-supplied cook.
 *
 * It writes no files and spawns no encoder. Web technology is the default
 * renderer, so frames are produced where the canvas is — this is the
 * evaluation loop, not the pixels.
 */

import { runFrameRange } from '@cascade/runtime/animation';
import type { FrameInfo, FrameRangeResult } from '@cascade/runtime/animation';
import { cascade, CascadeContext } from '../cascade.js';

export type { FrameInfo, FrameRangeResult };

export interface EvaluateFrameRangeOptions {
  /** First frame, inclusive. */
  start: number;
  /** Last frame, inclusive when the step lands on it. */
  end: number;
  /** Frame increment. Must be > 0; may be fractional. Default 1. */
  step?: number;
  /** Frame rate to evaluate at. Leaves the context's rate alone when omitted. */
  fps?: number;
  /**
   * Called once per frame, after the frame is set and time-dependent nodes are
   * marked dirty. Cook here — synchronously or not; the loop awaits it.
   */
  onFrame: (info: FrameInfo) => void | Promise<void>;
  /** Cooperative cancellation, checked before each frame. */
  signal?: { readonly aborted: boolean };
  /** Restore the frame the context was on when the loop finishes. Default true. */
  restoreFrame?: boolean;
  /** Context to drive. Defaults to the global cascade context. */
  context?: CascadeContext;
}

/**
 * Walk a frame range, cooking once per frame through `onFrame`.
 *
 * ```ts
 * await evaluateFrameRange({
 *   start: 1,
 *   end: 100,
 *   fps: 25,
 *   onFrame: async ({ frame }) => { await graph.cook(); save(frame); }
 * });
 * ```
 */
export async function evaluateFrameRange(
  options: EvaluateFrameRangeOptions
): Promise<FrameRangeResult> {
  const { fps, context = cascade, ...rest } = options;

  const previousFps = context.fps();
  if (fps !== undefined) context.setFps(fps);

  try {
    return await runFrameRange(context.clock(), rest);
  } finally {
    if (fps !== undefined) context.setFps(previousFps);
  }
}
