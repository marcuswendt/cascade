/**
 * Time state for expression evaluation.
 *
 * Frames are stored as a real number so sub-frame time exists. `frame` is the
 * integer frame ($F), `frameFraction` is the exact fractional frame ($FF), and
 * `time` is seconds ($T). Nothing here reads a clock: time is set by the caller
 * (a cook request, a frame-range loop, a transport) and the engine only ever
 * reports what it was told. That is what keeps a cook deterministic.
 */

export const DEFAULT_FPS = 30;
export const MIN_FRAME = 1;

export class TimeState {
  /** Exact, possibly fractional frame. Never below MIN_FRAME. */
  private _frame: number = MIN_FRAME;
  private _fps: number = DEFAULT_FPS;

  /**
   * Set the current frame. Fractional values are preserved; only the lower
   * bound is enforced. Non-finite input is ignored.
   */
  setFrame(frame: number): void {
    if (!Number.isFinite(frame)) return;
    this._frame = Math.max(MIN_FRAME, frame);
  }

  /** Set the current time in seconds, keeping the sub-frame remainder. */
  setTime(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    this.setFrame(seconds * this._fps + MIN_FRAME);
  }

  setFps(fps: number): void {
    if (!Number.isFinite(fps)) return;
    this._fps = Math.max(1, fps);
  }

  /** Integer frame — $F. */
  get frame(): number {
    return Math.floor(this._frame);
  }

  /** Fractional frame — $FF. */
  get frameFraction(): number {
    return this._frame;
  }

  /**
   * Seconds — $T. Derived from the fractional frame, so it round-trips.
   *
   * Zero at the first frame, which is Houdini's convention: $T = ($FF - 1)/$FPS.
   * The previous definition was frame/fps, making $T equal 1/fps at frame 1 —
   * so `sin($T)` started part-way through its cycle and an animation's first
   * frame was never t=0. Changed 2026-09-07 because Marcus named Houdini as the
   * reference for these variables, and because "time starts at zero" is the
   * thing anybody writing an expression will assume.
   */
  get time(): number {
    return (this._frame - MIN_FRAME) / this._fps;
  }

  /** Frame rate — $FPS. */
  get fps(): number {
    return this._fps;
  }

  /** Immutable snapshot of the four time variables. */
  snapshot(): TimeVariables {
    return {
      frame: this.frame,
      frameFraction: this.frameFraction,
      time: this.time,
      fps: this.fps
    };
  }
}

export interface TimeVariables {
  /** Integer frame — $F */
  frame: number;
  /** Fractional frame — $FF */
  frameFraction: number;
  /** Seconds — $T */
  time: number;
  /** Frame rate — $FPS */
  fps: number;
}
