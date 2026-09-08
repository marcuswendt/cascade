/**
 * The current frame, as something the UI can react to.
 *
 * `cascade.setFrame()` is the engine's setter and deliberately knows nothing
 * about Svelte, so nothing in the interface learns that the frame moved. The
 * Timeline kept its own local `frame` and everything else stayed ignorant —
 * which is why `$T * 0.5` showed `= 0` no matter where the playhead was: the
 * expression badge computes `evalParm()` in a reactive statement whose
 * dependencies did not include the frame, so it never recomputed after the
 * value it was first given at frame 1.
 *
 * Marcus found it by dragging the playhead. One store, written wherever the
 * frame is applied, and any panel that shows a time-dependent value can depend
 * on it.
 */
import { writable } from 'svelte/store';
import { cascade } from '@/engine/cascade';

/** Fractional, because sub-frame time exists and a badge should show it. */
export const currentFrame = writable(cascade.fframe());

/**
 * Set the engine's frame and tell the interface. Use this rather than
 * `cascade.setFrame` from anything in `src/editor`, or the screen will hold a
 * value from a frame you have left.
 */
export function setCurrentFrame(frame: number): void {
  cascade.setFrame(frame);
  // Read back rather than echoing the argument: the engine clamps to a minimum
  // frame, so what it holds is not always what it was handed.
  currentFrame.set(cascade.fframe());
}
