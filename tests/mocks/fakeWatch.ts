/**
 * A hand-driven clock and filesystem watcher for the node and graph watchers
 * (`server/src/watchSeam.ts`). A test says which file changed and how much
 * time passed; nothing sleeps and nothing depends on FSEvents.
 */
import type { WatchClock, WatchFunction } from '../../server/src/watchSeam.js';

export class FakeClock implements WatchClock {
  private now = 0;
  private nextHandle = 1;
  private timers = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, ms: number): number {
    const handle = this.nextHandle++;
    this.timers.set(handle, { at: this.now + ms, callback });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Move time forward, firing every timer that falls due, in order. */
  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      let due: [number, { at: number; callback: () => void }] | null = null;
      for (const entry of this.timers) if (entry[1].at <= until && (!due || entry[1].at < due[1].at)) due = entry;
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].callback();
    }
    this.now = until;
  }

  get pending(): number {
    return this.timers.size;
  }
}

export class FakeWatch {
  private watches = new Map<string, { recursive: boolean; listener: (event: string, filename: string | null) => void; closed: boolean }>();

  readonly watch: WatchFunction = (directory, options, listener) => {
    const entry = { recursive: options.recursive, listener, closed: false };
    this.watches.set(directory, entry);
    return { close: () => { entry.closed = true; }, on: () => undefined };
  };

  /** The directories being watched and still open. */
  get directories(): string[] {
    return [...this.watches].filter(([, entry]) => !entry.closed).map(([directory]) => directory);
  }

  /** Report a change to `filename`, relative to the watched `directory`. */
  change(directory: string, filename: string | null, event = 'change'): void {
    const entry = this.watches.get(directory);
    if (!entry) throw new Error(`not watching ${directory}; watching ${[...this.watches.keys()].join(', ') || 'nothing'}`);
    if (!entry.closed) entry.listener(event, filename);
  }
}
