/**
 * Transport state: the play head's clock, with no clock of its own.
 *
 * The caller supplies `now` (a requestAnimationFrame timestamp) and whether a
 * cook is still in flight. That keeps the whole thing testable, and it is why
 * the panel can be honest about the one decision that matters here:
 *
 * **Playback is wall-clock driven and drops frames — it never queues them.**
 * The target frame is computed from elapsed real time against the fps, so a
 * slow cook loses frames instead of falling behind. Advancing by +1 per cook
 * would keep every frame and drift further from real time the longer it ran,
 * which is the failure this shape exists to avoid.
 */

export interface TransportRange {
  start: number;
  end: number;
  fps: number;
  loop: boolean;
}

export class Transport {
  private _frame: number;
  private _playing = false;
  /** Wall-clock time and frame at the moment play started or last wrapped. */
  private anchorMs = 0;
  private anchorFrame = 0;
  /** Frames the clock asked for while a cook was still running. Reported so
   *  the panel can say plainly that playback is not keeping up. */
  private _dropped = 0;

  constructor(public range: TransportRange, frame = range.start) {
    this._frame = frame;
  }

  get frame(): number { return this._frame; }
  get playing(): boolean { return this._playing; }
  get dropped(): number { return this._dropped; }

  setRange(range: Partial<TransportRange>, now = 0): void {
    this.range = { ...this.range, ...range };
    if (this.range.end < this.range.start) this.range.end = this.range.start;
    this.setFrame(this._frame, now);
  }

  /** Sets the frame, clamped to the range. Re-anchors so playing from a
   *  scrubbed position starts from where the head actually is. */
  setFrame(frame: number, now = 0): number {
    this._frame = Math.min(this.range.end, Math.max(this.range.start, Math.round(frame)));
    this.anchorMs = now;
    this.anchorFrame = this._frame;
    return this._frame;
  }

  play(now: number): void {
    if (this._playing) return;
    // Playing from the last frame restarts, rather than sitting still.
    if (this._frame >= this.range.end && !this.range.loop) this._frame = this.range.start;
    this._playing = true;
    this._dropped = 0;
    this.anchorMs = now;
    this.anchorFrame = this._frame;
  }

  pause(): void {
    this._playing = false;
  }

  toggle(now: number): void {
    if (this._playing) this.pause(); else this.play(now);
  }

  step(delta: number, now = 0): number {
    this.pause();
    return this.setFrame(this._frame + delta, now);
  }

  toStart(now = 0): number { return this.setFrame(this.range.start, now); }
  toEnd(now = 0): number { return this.setFrame(this.range.end, now); }

  /**
   * The frame to show at `now`, or null when nothing should change.
   *
   * `busy` true means a cook from the previous frame has not finished: the
   * request is dropped and the anchor is left alone, so the next free tick
   * lands on whatever frame real time has reached by then.
   */
  advance(now: number, busy = false): number | null {
    if (!this._playing) return null;

    const elapsed = Math.max(0, now - this.anchorMs) / 1000;
    let target = Math.floor(this.anchorFrame + elapsed * this.range.fps);
    if (target === this._frame) return null;

    if (target > this.range.end) {
      if (!this.range.loop) {
        this._playing = false;
        if (this._frame === this.range.end) return null;
        this._frame = this.range.end;
        return this._frame;
      }
      const span = this.range.end - this.range.start + 1;
      target = this.range.start + ((target - this.range.start) % span);
      // Re-anchor on the wrap so the modulo cannot accumulate rounding.
      this.anchorMs = now;
      this.anchorFrame = target;
    }

    if (busy) {
      this._dropped += 1;
      return null;
    }

    this._frame = target;
    return target;
  }
}
