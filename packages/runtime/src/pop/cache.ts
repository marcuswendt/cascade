import { ParticleState } from "./state.js";

/**
 * Bounded, process-local simulation checkpoints. Clearing them must not change
 * outputs: cold simulation is the reference, including the full trail window.
 * The caller fingerprints every stepping prop and wired geometry value; a
 * mismatch invalidates that entry. Copies on both boundaries isolate mutable
 * particle arrays. Studio and CLI frame sequences reuse these checkpoints;
 * separate CLI processes do not share them.
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

function cloneState(state: ParticleState): ParticleState {
  return ParticleState.of({
    count: state.count,
    size: state.size,
    position: Float64Array.from(state.position),
    velocity: Float32Array.from(state.velocity),
    age: Float32Array.from(state.age),
    life: Float32Array.from(state.life),
    id: Int32Array.from(state.id),
    ...(state.colour ? { colour: Float32Array.from(state.colour) } : {}),
    nextId: state.nextId,
  });
}

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
  return best ? { frame: best.frame, state: cloneState(best.state) } : null;
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

  entry.checkpoints.push({ frame, state: cloneState(state) });
  entry.checkpoints.sort((a, b) => a.frame - b.frame);
  entry.touched = clock += 1;
  evict();
}

/**
 * Drop the least recently used key, then the oldest checkpoints in the one
 * remaining key, until the total is under the cap.
 *
 * Whole-key eviction preserves the most useful simulation when several are
 * active. The final key is trimmed from its oldest edge rather than exempted:
 * checkpoints are independent snapshots and lookup already accepts gaps, so
 * retaining the newest bounded window is correct and useful.
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
  if (total > MAX_CHECKPOINTS) {
    const remaining = entries.values().next().value as Entry | undefined;
    if (!remaining) return;
    remaining.checkpoints.splice(0, total - MAX_CHECKPOINTS);
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
