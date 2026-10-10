/**
 * Where the Studio workspace lives: the panel layout, which viewers exist, and
 * what each viewer is pinned to.
 *
 * It used to live in one localStorage key, which failed Marcus three ways
 * (2026-10-10, "they're all just reset to a default viewer"):
 *
 * - one key for every project. Each project served on the same host:port read
 *   the last one's layout, found its pinned nodes absent and unpinned them,
 *   then saved that back. The next project inherited three plain Viewers.
 * - storage is per origin, so kuro, localhost and 127.0.0.1 (or a second
 *   browser) each had a workspace of their own.
 * - it saved on a 30 s timer and never on change, so a reload soon after
 *   arranging panels lost the arrangement, and an idle second tab rewrote the
 *   key every 30 s with its own stale layout.
 *
 * So the workspace is now a sidecar beside the graph on the server
 * (`<name>.workspace.json`, see routes/graph.ts), saved on change. localStorage
 * is only a cache, keyed by project and graph, used when the server copy is
 * unreachable or older.
 */
import type { SerializedDockview } from 'dockview';

export const LEGACY_LAYOUT_KEY = 'cascade-dockview-layout';
export const LEGACY_FOLD_KEY = 'cascade-dockview-folds';

export interface StoredWorkspace {
  version: 1;
  layout: SerializedDockview;
  /** Serialized fold records (see fold.ts); optional, folds are rare. */
  folds?: unknown;
  savedAt: string;
}

export interface WorkspaceScope {
  /** Absolute project root, so two projects never share a cache entry. */
  root: string;
  /** The `.cascade` file the workspace belongs to. */
  graph: string;
}

let scope: WorkspaceScope | null = null;
let restored: StoredWorkspace | null = null;
let pending: StoredWorkspace | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let unloadHooked = false;

export const SAVE_DEBOUNCE_MS = 400;

export function getWorkspaceScope(): WorkspaceScope | null {
  return scope;
}

/** Test seam, and what `prepareWorkspace` sets. */
export function setWorkspaceScope(next: WorkspaceScope | null): void {
  scope = next;
}

/** The cache key for the current scope. No scope (no server, or a test) keeps
 *  the legacy key, so nothing that worked before stops working. */
export function layoutCacheKey(target: WorkspaceScope | null = scope): string {
  return target ? `${LEGACY_LAYOUT_KEY}:${target.root}/${target.graph}` : LEGACY_LAYOUT_KEY;
}

export function foldCacheKey(target: WorkspaceScope | null = scope): string {
  return target ? `${LEGACY_FOLD_KEY}:${target.root}/${target.graph}` : LEGACY_FOLD_KEY;
}

export function isStoredWorkspace(value: unknown): value is StoredWorkspace {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as StoredWorkspace).layout === 'object' && (value as StoredWorkspace).layout !== null;
}

function readCache(target: WorkspaceScope | null): StoredWorkspace | null {
  try {
    const raw = localStorage.getItem(layoutCacheKey(target));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (isStoredWorkspace(parsed)) return parsed;
    // The legacy value was a bare SerializedDockview.
    if (parsed && typeof parsed === 'object' && 'grid' in parsed) {
      let folds: unknown;
      try { folds = JSON.parse(localStorage.getItem(foldCacheKey(target)) ?? 'null') ?? undefined; } catch { folds = undefined; }
      return { version: 1, layout: parsed, folds, savedAt: new Date(0).toISOString() };
    }
  } catch (error) {
    console.warn('[workspace] could not read the cached workspace:', error);
  }
  return null;
}

function writeCache(workspace: StoredWorkspace): void {
  try {
    localStorage.setItem(layoutCacheKey(), JSON.stringify(workspace));
  } catch (error) {
    console.warn('[workspace] could not cache the workspace:', error);
  }
}

function newer(a: StoredWorkspace | null, b: StoredWorkspace | null): StoredWorkspace | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b.savedAt) > Date.parse(a.savedAt) ? b : a;
}

function endpoint(target: WorkspaceScope, slot?: 'failed'): string {
  return `/api/graph/${encodeURIComponent(target.graph)}/workspace${slot ? `?slot=${slot}` : ''}`;
}

/**
 * Before the dock is built: learn which project and graph this Studio opens
 * (the same `/api/graph` default App.svelte loads), then fetch that graph's
 * saved workspace. The newer of the server copy and this browser's cache wins,
 * so an offline save is not lost to an older file. Never throws.
 */
export async function prepareWorkspace(fetcher: typeof fetch = fetch): Promise<StoredWorkspace | null> {
  restored = null;
  try {
    const listing = await fetcher('/api/graph');
    if (listing.ok) {
      const { root, default: graph } = await listing.json();
      if (typeof root === 'string' && typeof graph === 'string' && graph) scope = { root, graph };
    }
  } catch {
    // Not served by the cascade CLI: keep the legacy single-key behaviour.
  }

  const cached = readCache(scope);
  let remote: StoredWorkspace | null = null;
  if (scope) {
    try {
      const response = await fetcher(endpoint(scope));
      // 200 `null` is "nothing saved yet" (the graph's first open). A 404 is
      // the same from a server older than that answer, so neither warns.
      if (response.ok) {
        const value = await response.json();
        if (isStoredWorkspace(value)) remote = value;
      } else if (response.status !== 404) {
        console.warn(`[workspace] could not fetch the saved workspace (HTTP ${response.status}); using the cache`);
      }
    } catch (error) {
      console.warn('[workspace] could not fetch the saved workspace; using the cache:', error);
    }
  }
  restored = newer(remote, cached);
  if (!restored && scope) {
    // First open since workspaces moved off the shared key: take whatever the
    // old key held rather than the default. Its pins may name another
    // project's nodes; those now show as missing instead of being dropped.
    restored = readCache(null);
  }
  hookUnload();
  return restored;
}

/** What `prepareWorkspace` found, handed to the store's first load once.
 *  A later load reads the cache, which every save has kept current. */
export function takeRestoredWorkspace(): StoredWorkspace | null {
  const value = restored;
  restored = null;
  return value;
}

/**
 * Save on change. The cache is written at once (a reload a moment later still
 * finds it); the server write is debounced so a drag-resize is one request.
 */
export function persistWorkspace(layout: SerializedDockview, folds: unknown, fetcher: typeof fetch = fetch): void {
  const workspace: StoredWorkspace = { version: 1, layout, folds, savedAt: new Date().toISOString() };
  writeCache(workspace);
  if (!scope) return;
  pending = workspace;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void flushWorkspace(fetcher); }, SAVE_DEBOUNCE_MS);
}

export async function flushWorkspace(fetcher: typeof fetch = fetch, keepalive = false): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  const workspace = pending;
  const target = scope;
  pending = null;
  if (!workspace || !target) return;
  try {
    const response = await fetcher(endpoint(target), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workspace),
      keepalive,
    });
    if (!response.ok) console.warn(`[workspace] save failed (HTTP ${response.status}); the browser cache still has it`);
  } catch (error) {
    console.warn('[workspace] save failed; the browser cache still has it:', error);
  }
}

/**
 * A saved workspace that would not restore is kept, never discarded: in this
 * browser under `<key>:failed` and on the server as
 * `<name>.workspace.failed.json`, before the default replaces it.
 */
export function preserveFailedWorkspace(layout: SerializedDockview, error: unknown, fetcher: typeof fetch = fetch): void {
  const workspace: StoredWorkspace = { version: 1, layout, savedAt: new Date().toISOString() };
  const key = `${layoutCacheKey()}:failed`;
  console.error(`[workspace] the saved workspace could not be restored; it is kept in localStorage "${key}"`
    + (scope ? ` and ${scope.graph.replace(/\.cascade$/, '')}.workspace.failed.json` : ''), error);
  try { localStorage.setItem(key, JSON.stringify(workspace)); } catch { /* storage full or blocked */ }
  if (scope) {
    void fetcher(endpoint(scope, 'failed'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workspace),
    }).catch(() => {});
  }
}

function hookUnload(): void {
  if (unloadHooked || typeof window === 'undefined') return;
  unloadHooked = true;
  // A save still inside its debounce when the tab goes away.
  window.addEventListener('pagehide', () => { void flushWorkspace(fetch, true); });
}
