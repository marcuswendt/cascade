import type { ViewState } from './viewCamera';

/**
 * Per-node viewport memory.
 *
 * Marcus, 2026-09-09: *"these view modes should be remembered per node, so
 * going back to a mode doesnt mean re-adjusting the camera. each node should
 * remember the view settings last used and restore them if possible."*
 *
 * ## Why local storage rather than the project file
 *
 * His ruling, same day: *"local storage for the view stage."* The argument
 * either way is short. In the project file a view travels with the sketch and
 * survives a clone — but every camera nudge becomes a diff, and `cascade-
 * sketches` would fill with commits that change nothing anybody can see. In
 * local storage there is no noise and the view does not travel.
 *
 * The durable version is explicit instead: **wire a Camera.** Ephemeral looking
 * is UI state; a committed viewpoint is a node, and `cascade.geo.Render` reads
 * the node and never this. Which is the same ruling `PLAN series` reached from
 * the other direction about layout.
 *
 * ## Why this is what makes detection work
 *
 * `sceneDimensionality` may only ever set the **initial** mode: a particle sim
 * can be planar at frame 1 and gain depth by frame 20, so re-running detection
 * every cook would flip the viewport mid-playback. Detect-once needs somewhere
 * to keep the answer, and this is it. Without it the only options are
 * re-detecting, which flips, and never detecting, which is useless.
 */
const KEY = 'cascade.viewport.views.v1';

/**
 * Views die at 200 nodes, oldest touch first.
 *
 * Unbounded, this grows with every node ever selected in every project and
 * eventually throws `QuotaExceededError` on a write — which would surface as a
 * viewport that silently stops remembering. 200 is far more than any one
 * session touches and small enough to stay a few tens of kilobytes.
 */
const LIMIT = 200;

interface Stored {
  readonly view: ViewState;
  /** Milliseconds. Only used to decide what to evict. */
  readonly touched: number;
}

type Table = Record<string, Stored>;

/**
 * Both directions are wrapped, and both have to be.
 *
 * A read throws in a private window with site data blocked, and a write throws
 * on quota. A viewport that fails to remember a camera is a small
 * disappointment; one that throws while mounting shows nothing at all, which is
 * the failure this catches.
 */
function read(): Table {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Table;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function write(table: Table): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(table));
  } catch {
    // Nothing to do and nothing to report: the next read returns what is there.
  }
}

/**
 * The key a view is stored under.
 *
 * Project *and* node, because node ids are only unique within a graph — two
 * projects both have a `node-1`, and keying on the node alone would hand one
 * project's camera to another's first node. The port is in the key as well: a
 * `pop.Simulate` outputs both `geometry` and `trails`, and they are different
 * pictures at different scales.
 */
export function viewKey(
  projectId: string | null | undefined,
  nodeId: string | null | undefined,
  portId: string | null | undefined,
): string | null {
  if (!nodeId) return null;
  return `${projectId ?? 'untitled'}::${nodeId}::${portId ?? 'out'}`;
}

export function loadView(key: string | null): ViewState | null {
  if (!key) return null;
  const stored = read()[key];
  return stored?.view ?? null;
}

export function saveView(key: string | null, view: ViewState): void {
  if (!key) return;
  const table = read();
  table[key] = { view, touched: Date.now() };
  const keys = Object.keys(table);
  if (keys.length > LIMIT) {
    keys
      .sort((a, b) => (table[a]?.touched ?? 0) - (table[b]?.touched ?? 0))
      .slice(0, keys.length - LIMIT)
      .forEach((old) => delete table[old]);
  }
  write(table);
}

/** For the Home gesture's "reset this node's view" and for tests. */
export function forgetView(key: string | null): void {
  if (!key) return;
  const table = read();
  if (!(key in table)) return;
  delete table[key];
  write(table);
}
