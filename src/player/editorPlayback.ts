/**
 * The exported editor's Play/Pause clock (`editor.playback`).
 *
 * It steps the same frame `cascade run --frames` steps, 1 to `frames` and
 * round again, at `fps`. It never queues: a tick only moves the frame on, and
 * at most one cook is in flight. When that cook finishes and ticks came due in
 * the meantime, the latest frame cooks next and the ones between are dropped.
 * A slow graph therefore plays at the rate it can cook, never falls behind and
 * never catches up in a burst.
 */
import type { EditorPlayback } from '../../packages/contracts/src/index.js';
import { MIN_FRAME } from '../../packages/runtime/src/editor/index.js';

export class PlaybackClock {
  /** The frame on screen, or about to be. Pausing leaves it here. */
  frame: number;
  private timer?: ReturnType<typeof setInterval>;
  private cooking = false;
  private due = false;

  constructor(
    private readonly playback: EditorPlayback,
    /** Cook and show `frame`. Resolves when it is drawn; a rejection is the caller's to report. */
    private readonly cook: (frame: number) => Promise<void>,
    frame = MIN_FRAME,
  ) {
    this.frame = frame;
  }

  get playing(): boolean {
    return this.timer !== undefined;
  }

  play(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => this.tick(), 1000 / this.playback.fps);
  }

  pause(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  toggle(): boolean {
    if (this.playing) this.pause();
    else this.play();
    return this.playing;
  }

  /** The frame after `frame` in the loop; one outside the loop starts it again. */
  next(frame: number): number {
    const last = MIN_FRAME + this.playback.frames - 1;
    return frame >= MIN_FRAME && frame < last ? Math.floor(frame) + 1 : MIN_FRAME;
  }

  private tick(): void {
    this.frame = this.next(this.frame);
    this.due = true;
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.cooking) return;
    this.cooking = true;
    try {
      while (this.due) {
        this.due = false;
        await this.cook(this.frame).catch(() => {});
      }
    } finally {
      this.cooking = false;
    }
  }
}
