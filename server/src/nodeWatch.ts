/**
 * Watches a project's node sources and reports which module changed.
 *
 * Studio caches every project module's compiled bundle, so a node edited on
 * disk kept running its previous code until the whole app was reloaded. The
 * invalidation hook for that cache already existed and had no caller; this is
 * the caller.
 *
 * Watching happens on the server because only the server can see the
 * filesystem. The browser-side polling watcher this replaces could not, and
 * was never instantiated.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ProjectRoot } from './project.js';
import { createDebouncer, systemClock, systemWatch, type WatcherSeams, type WatchHandle } from './watchSeam.js';

export type NodeChangeListener = (moduleName: string) => void;

/** Sent instead of a module name when the change cannot be attributed to one. */
export const ALL_MODULES = '*';

/** Long enough that an editor's write-truncate-write lands as one event,
 *  short enough to feel immediate. */
export const NODE_WATCH_DEBOUNCE_MS = 120;

export interface NodeWatcher {
  subscribe(listener: NodeChangeListener): () => void;
  close(): void;
}

/** The changed path's first segment is the module folder. A file directly
 *  inside `nodes/` belongs to no module and is ignored. */
function moduleNameFor(relative: string): string | null {
  const segments = relative.split(path.sep).filter(Boolean);
  if (segments.length < 2) return null;
  const name = segments[0];
  if (!name || name.startsWith('.')) return null;
  return name;
}

/** `seams` replaces the clock and `fs.watch` for tests; see `watchSeam.ts`. */
export function createNodeWatcher(project: ProjectRoot, seams: WatcherSeams = {}): NodeWatcher {
  const listeners = new Set<NodeChangeListener>();
  const watchers: WatchHandle[] = [];
  const watchDirectory = seams.watch ?? systemWatch;
  const debounce = createDebouncer(seams.clock ?? systemClock, NODE_WATCH_DEBOUNCE_MS, (moduleName) => {
    for (const listener of listeners) listener(moduleName);
  });
  const emit = (moduleName: string) => debounce.push(moduleName);

  function watch(directory: string, scope: 'project' | 'shared'): void {
    if (!fs.existsSync(directory)) return;
    try {
      // Recursive watching is supported on macOS and Windows. Where it is
      // not, the watch still reports the top level, so a new module folder
      // is noticed even though edits inside it are not.
      const watcher = watchDirectory(directory, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        if (scope === 'shared') {
          // A shared node is reached through a project module that re-exports
          // it, and the two names need not match, so the project module that
          // has to recompile cannot be derived from the changed path. Clearing
          // every module is honest and costs nothing: invalidation only drops
          // cached bundles, and each one recompiles when it is next needed.
          emit(ALL_MODULES);
          return;
        }
        const moduleName = moduleNameFor(String(filename));
        if (moduleName) emit(moduleName);
      });
      watcher.on?.('error', (error) => console.warn('[node watch] stopped watching', directory, error));
      watchers.push(watcher);
    } catch (error) {
      console.warn('[node watch] could not watch', directory, error);
    }
  }

  watch(project.resolve('nodes'), 'project');
  // A shared library reached through the project's `shared/` link is edited
  // just as often, and a project that re-exports one of its nodes has to see
  // that change too. realpath because fs.watch does not follow the link.
  try {
    const sharedNodes = fs.realpathSync(path.join(project.root, 'shared'));
    watch(path.join(sharedNodes, 'nodes'), 'shared');
  } catch {
    // No shared library, which is the common case.
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      debounce.cancel();
      for (const watcher of watchers) watcher.close();
      watchers.length = 0;
      listeners.clear();
    },
  };
}
