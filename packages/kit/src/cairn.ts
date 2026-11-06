// Cairn data, as the cairn-* sketches read it: a read-only snapshot pulled into
// the project's `data/` (cairn-strata-hd's `data/pull.py` writes it; the other
// sketches copy or link it). Two files:
//
//   data/spaces.json  one painter per entry: which Cairn spaces feed it, its
//                     pixel stream and palette source (`_`-prefixed keys are notes)
//   data/events.json  { pulled_at, since, today, version, spaces: { <space>: { events, tasks } } }
//
// File access is injected (`read` returns a file's text), so the same code runs
// under `cascade run`, in Studio, in the browser player and in tests. Nothing
// here talks to Cairn itself: the snapshot is the boundary.

export interface CairnEvent {
  id: string;
  /** kind: file, commit, meeting, time, done, person, thread, … */
  k: string;
  /** day, YYYY-MM-DD */
  d: string;
  /** instant, ISO, when the event has a clock time */
  t?: string | null;
  /** weight in the kind's own unit (minutes, bytes, …) */
  w?: number | null;
  client?: string | null;
  owner?: string | null;
  leaf?: string | null;
  [key: string]: unknown;
}

export interface CairnTask {
  id: string;
  due?: string | null;
  w?: number | null;
  client?: string | null;
  waiting_on_marcus?: boolean;
  [key: string]: unknown;
}

export interface CairnEvents {
  pulled_at?: string;
  since?: string;
  today?: string;
  version?: number;
  spaces: Record<string, { events?: CairnEvent[]; tasks?: CairnTask[] } | undefined>;
}

export interface CairnPainter {
  name: string;
  /** the Cairn spaces whose events feed this painter */
  spaces: string[];
  stream?: { index: string; tiles: string; label?: string };
  palette?: string | null;
  [key: string]: unknown;
}

export type CairnSpaces = Record<string, CairnPainter>;

export type ReadText = (path: string) => Promise<string>;

/** The painters in `spaces.json`, without the `_`-prefixed notes. */
export function painterNames(spaces: Record<string, unknown>): string[] {
  return Object.keys(spaces).filter((k) => !k.startsWith('_'));
}

/** Read `spaces.json` and `events.json` from `dir` (default `data`). */
export async function readCairnSnapshot(read: ReadText, dir = 'data'): Promise<{ spaces: CairnSpaces; events: CairnEvents }> {
  const prefix = dir ? `${dir.replace(/\/$/, '')}/` : '';
  const [spaces, events] = await Promise.all([read(`${prefix}spaces.json`), read(`${prefix}events.json`)]);
  return { spaces: JSON.parse(spaces) as CairnSpaces, events: JSON.parse(events) as CairnEvents };
}

/** A painter's entry, or an error that names the painters there are. */
export function painter(spaces: CairnSpaces, name: string): CairnPainter {
  const cfg = spaces[name];
  if (!cfg || name.startsWith('_')) {
    throw new Error(`unknown space "${name}" (data/spaces.json has ${painterNames(spaces).join(', ')})`);
  }
  return cfg;
}

/**
 * The events and tasks of several Cairn spaces, in space order. An event filed
 * under two spaces appears once (first space wins); tasks are concatenated.
 */
export function spaceEvents(data: CairnEvents, spaces: string[]): { events: CairnEvent[]; tasks: CairnTask[] } {
  const seen = new Set<string>(), events: CairnEvent[] = [];
  for (const sp of spaces) for (const e of data.spaces[sp]?.events ?? []) if (!seen.has(e.id)) { seen.add(e.id); events.push(e); }
  const tasks: CairnTask[] = spaces.flatMap((sp) => data.spaces[sp]?.tasks ?? []);
  return { events, tasks };
}

/** Events grouped by day (YYYY-MM-DD), days in ascending order. */
export function eventsByDay(events: CairnEvent[]): Map<string, CairnEvent[]> {
  const days = new Map<string, CairnEvent[]>();
  for (const e of [...events].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))) {
    const list = days.get(e.d);
    if (list) list.push(e); else days.set(e.d, [e]);
  }
  return days;
}

/** `day` plus `n` days (negative goes back), in UTC so no zone can move it. */
export function addDays(day: string, n: number): string {
  const t = new Date(day + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
