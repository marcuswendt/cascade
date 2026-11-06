/**
 * The two things a file watcher depends on that a test cannot control: the
 * filesystem's events and the clock its debounce runs on. Both are injected
 * (`nodeWatch.ts`, `graphWatch.ts`), so their tests drive events and time by
 * hand instead of writing real files and sleeping.
 *
 * The tests used to do the latter: `fs.watch` plus fixed 400-600 ms pauses.
 * Under a loaded machine macOS FSEvents delivered late, coalesced, or replayed
 * the fixture's own setup writes, and the two files failed in all three full
 * runs of the 6 Nov 2026 review while spending 7 s and 4.5 s mostly asleep.
 */
import fs from 'node:fs';

export interface WatchClock {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface WatchHandle {
  close(): void;
  on?(event: 'error', listener: (error: unknown) => void): unknown;
}

/** `fs.watch`'s shape, reduced to what the watchers use. */
export type WatchFunction = (
  directory: string,
  options: { recursive: boolean },
  listener: (event: string, filename: string | null) => void,
) => WatchHandle;

export interface WatcherSeams {
  /** Defaults to the real timers. */
  readonly clock?: WatchClock;
  /** Defaults to `fs.watch`. */
  readonly watch?: WatchFunction;
}

export const systemClock: WatchClock = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export const systemWatch: WatchFunction = (directory, options, listener) =>
  fs.watch(directory, options, (event, filename) => listener(event, filename === null ? null : String(filename)));

/**
 * Collapses a burst of reports per key into one, `ms` after the last of them.
 * An editor's write-truncate-write arrives as several events; the listener
 * should hear about it once.
 */
export function createDebouncer(clock: WatchClock, ms: number, fire: (key: string) => void) {
  const pending = new Map<string, unknown>();
  return {
    push(key: string): void {
      const existing = pending.get(key);
      if (existing !== undefined) clock.clearTimeout(existing);
      pending.set(key, clock.setTimeout(() => {
        pending.delete(key);
        fire(key);
      }, ms));
    },
    cancel(): void {
      for (const handle of pending.values()) clock.clearTimeout(handle);
      pending.clear();
    },
  };
}
