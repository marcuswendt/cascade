/**
 * The per-session ring of agent events, so output produced while no browser is
 * attached is not lost.
 *
 * The reason this exists at all: the child is spawned `detached`, so closing or
 * reloading the browser does not end it. Something has to keep reading its
 * stdout — an unread pipe eventually blocks the writer — and something has to
 * hold what was read until a panel comes back for it. That is this.
 *
 * It is bounded on purpose and in two directions at once. **2,000 events or
 * 4 MiB of text, whichever binds first**, oldest evicted. A single event count
 * is not enough because one `stream-json` line carrying a file rewrite can be
 * hundreds of kilobytes, and a byte cap alone is not enough because a chatty
 * agent emitting tiny lines for an hour would still grow an unbounded array of
 * objects. A runaway agent must cost a bounded amount of memory, not a growing
 * one.
 *
 * Eviction is visible rather than silent: every entry carries an absolute
 * sequence number, `firstSeq` says where the surviving window starts, and a
 * reader that asks for something already evicted is told how much it missed.
 * A transcript with a hole in it is fine; a transcript with an invisible hole
 * in it is how you end up trusting an incomplete record.
 */

export interface BufferedEvent<T> {
  readonly seq: number;
  readonly event: T;
}

export interface BufferReplay<T> {
  /** Events still held, from `since` (or the oldest surviving one) onward. */
  readonly events: readonly T[];
  /** How many events between `since` and the oldest survivor were evicted. */
  readonly dropped: number;
  /** The sequence number the next event will carry. */
  readonly nextSeq: number;
}

export const MAX_BUFFERED_EVENTS = 2_000;
export const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

/** A rough cost for one event: its text plus a fixed allowance for the object
 *  and its other fields. Approximate on purpose — the cap is a guard rail, not
 *  an accounting system. */
function weigh(event: unknown): number {
  const text = (event as { text?: unknown })?.text;
  return (typeof text === 'string' ? text.length : 0) + 64;
}

export class AgentEventBuffer<T> {
  private readonly entries: BufferedEvent<T>[] = [];
  private bytes = 0;
  private next = 0;
  private lost = 0;

  constructor(
    private readonly maxEvents: number = MAX_BUFFERED_EVENTS,
    private readonly maxBytes: number = MAX_BUFFERED_BYTES,
  ) {}

  /** The sequence number the next pushed event will carry. */
  get nextSeq(): number {
    return this.next;
  }

  /** The sequence number of the oldest event still held. */
  get firstSeq(): number {
    return this.entries[0]?.seq ?? this.next;
  }

  get size(): number {
    return this.entries.length;
  }

  /** How many events have been evicted over the life of this buffer. */
  get droppedTotal(): number {
    return this.lost;
  }

  push(event: T): number {
    const seq = this.next++;
    this.entries.push({ seq, event });
    this.bytes += weigh(event);
    // Never evict the only event: a single oversized line is still the most
    // informative thing the buffer holds.
    while (this.entries.length > 1 && (this.entries.length > this.maxEvents || this.bytes > this.maxBytes)) {
      const evicted = this.entries.shift();
      if (!evicted) break;
      this.bytes -= weigh(evicted.event);
      this.lost += 1;
    }
    return seq;
  }

  replay(since = 0): BufferReplay<T> {
    const from = Math.max(0, Math.floor(Number.isFinite(since) ? since : 0));
    const start = this.firstSeq;
    return {
      events: this.entries.filter((entry) => entry.seq >= from).map((entry) => entry.event),
      dropped: Math.max(0, Math.min(start, this.next) - from),
      nextSeq: this.next,
    };
  }
}
