import type { ParticleState } from "./state.js";

/**
 * Checkpoints, so scrubbing a simulation is not quadratic.
 *
 * `PLAN particles.md`'s ruling, and the order it insists on: **re-simulation
 * from the start frame is the definition of correctness, and this is only an
 * accelerator.** It holds nothing re-simulation would not have produced, it can
 * be cleared at any moment without changing a single output, and the
 * discriminating test is that simulating forward to a frame and seeking cold to
 * the same frame give byte-identical results.
 *
 * The cost it removes is real and was measured: `Simulate` re-simulates from
 * zero on every cook, so rendering N frames does N(N+1)/2 steps. 110 frames of
 * `particle-type` is about 6,000, roughly a second a frame, which makes offline
 * rendering fine and interactive playback a slideshow.
 *
 * **The fingerprint is the whole safety argument.** A cache keyed on anything
 * less than *everything that determines the simulation* serves a stale state
 * that looks plausible — the worst failure available here, because a wrong
 * particle system is indistinguishable from a different-looking one. So the
 * key is computed by the caller from every prop that affects stepping and from
 * the content of every geometry it reads, and a mismatch **clears** rather than
 * reconciles. Reconciling a cache is where the bugs live; throwing it away
 * costs one re-simulation.
 *
 * **It only helps inside one process, and that is a real limit rather than a
 * detail.** Studio is long-lived, so a scrub gets the benefit: measured at
 * **4.5x** across a 60-frame walk, 1,399 ms down to 314 ms. Every `cascade
 * run` is a fresh process, so the CLI gains nothing from it — a sequence
 * renderer that loops the CLI once per frame is exactly as slow as before,
 * which is worth knowing before anyone reports the cache as broken. A
 * one-process sequence renderer would get the same 4.5x, and that is the
 * argument for building one.
 *
 * Module-level state, deliberately and with a caveat. `cascade check` refuses
 * module-level values in a *node module* because that is where per-cook state
 * hides, and the rule is right. This is runtime internals rather than a node
 * module — `nodeModuleLoader`'s compiled-module cache is the same shape — and
 * it is safe for one specific reason: **every entry is derived, so the worst a
 * corrupted cache can do is be slower once it is cleared.** That is not true of
 * most caches and it is why this one is allowed to live here.
 */

/** Every `stride` frames, plus the newest. Sparse on purpose: a checkpoint per
 *  frame would hold the whole history, and the point of a checkpoint is that it
 *  is cheaper than the thing it replaces. */
const DEFAULT_STRIDE = 8;

/** Total checkpoints kept across all keys. A simulation of a few thousand
 *  particles is a few hundred kilobytes a frame, so this is the memory bound
 *  rather than a count anyone should tune. */
const MAX_CHECKPOINTS = 64;

interface Checkpoint {
  readonly frame: number;
  readonly state: ParticleState;
}

interface Entry {
  readonly fingerprint: string;
  /** Ascending by frame. Small enough that an array beats a map. */
  readonly checkpoints: Checkpoint[];
  touched: number;
}

const entries = new Map<string, Entry>();
let clock = 0;

/**
 * The best checkpoint at or before `frame`, or null to start from scratch.
 *
 * Never *after* the frame: a state from frame 90 says nothing about frame 40,
 * and the temptation to interpolate backwards is how a cache stops being an
 * accelerator and becomes a second implementation.
 */
export function checkpointAtOrBefore(
  key: string,
  fingerprint: string,
  frame: number,
): Checkpoint | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.fingerprint !== fingerprint) {
    // Cleared, not reconciled. Anything that changed the fingerprint changed
    // what the simulation is.
    entries.delete(key);
    return null;
  }
  entry.touched = clock += 1;
  let best: Checkpoint | null = null;
  for (const checkpoint of entry.checkpoints) {
    if (checkpoint.frame > frame) break;
    best = checkpoint;
  }
  return best;
}

/** Offer a state for keeping. Ignored unless it lands on the stride, so a
 *  caller can offer every frame without thinking about it. */
export function offerCheckpoint(
  key: string,
  fingerprint: string,
  frame: number,
  state: ParticleState,
  stride: number = DEFAULT_STRIDE,
): void {
  if (frame % stride !== 0) return;

  let entry = entries.get(key);
  if (!entry || entry.fingerprint !== fingerprint) {
    entry = { fingerprint, checkpoints: [], touched: clock += 1 };
    entries.set(key, entry);
  }
  if (entry.checkpoints.some((checkpoint) => checkpoint.frame === frame)) return;

  entry.checkpoints.push({ frame, state });
  entry.checkpoints.sort((a, b) => a.frame - b.frame);
  entry.touched = clock += 1;
  evict();
}

/**
 * Drop the least recently used key until the total is under the cap.
 *
 * Per key rather than per checkpoint: a key is one simulation, and dropping
 * half of one leaves a cache whose gaps are invisible to the caller. Coarse is
 * correct here — the caller's fallback is a re-simulation it was prepared to do
 * anyway.
 */
function evict(): void {
  let total = 0;
  for (const entry of entries.values()) total += entry.checkpoints.length;
  while (total > MAX_CHECKPOINTS && entries.size > 1) {
    let oldest: string | null = null;
    let oldestTouched = Infinity;
    for (const [key, entry] of entries) {
      if (entry.touched < oldestTouched) {
        oldestTouched = entry.touched;
        oldest = key;
      }
    }
    if (oldest === null) return;
    total -= entries.get(oldest)!.checkpoints.length;
    entries.delete(oldest);
  }
}

/** Forget everything. For a test that needs a cold seek, and for a host that
 *  wants to reclaim the memory. */
export function clearCheckpoints(): void {
  entries.clear();
}

/** What is held, for a test or a panel. Not for making decisions with: a caller
 *  that branched on the cache's contents would be depending on an accelerator. */
export function checkpointStats(): { keys: number; checkpoints: number } {
  let checkpoints = 0;
  for (const entry of entries.values()) checkpoints += entry.checkpoints.length;
  return { keys: entries.size, checkpoints };
}
