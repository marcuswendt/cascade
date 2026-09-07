/**
 * Listens for node sources changing on disk and makes the graph pick them up
 * without a page reload.
 *
 * The compiled-bundle cache in nodeModuleLoader has always had an
 * invalidation hook and never had a caller, so editing a node's file left
 * Studio running the bundle it compiled when the app started. The server
 * watches the files; this consumes what it reports.
 */
import { invalidateProjectModule } from './nodeModuleLoader.js';
import { invalidateDefinitionFacts } from '../editor/panels/nodeDefinitionFacts.js';

/** Matches the server's sentinel for a change it cannot attribute to one module. */
const ALL_MODULES = '*';

export interface NodeSourceWatchTarget {
  /** Nodes carrying `project.<folder>` module paths, and a way to restale them. */
  nodes: Array<{ modulePath?: string; markDirty(): void }>;
}

export interface NodeSourceWatchOptions {
  /** Read lazily on each event: the open graph changes over a session. */
  getTarget: () => NodeSourceWatchTarget | null | undefined;
  onReload?: (moduleName: string, affected: number) => void;
}

/** Returns a disposer. EventSource reconnects on its own, honouring the
 *  retry interval the server sends, so a server restart heals itself. */
export function watchNodeSources(options: NodeSourceWatchOptions): () => void {
  if (typeof EventSource === 'undefined') return () => {};

  const source = new EventSource('/api/nodes/events');

  source.addEventListener('module-changed', (event) => {
    let moduleName: string;
    try {
      moduleName = String(JSON.parse((event as MessageEvent).data)?.module ?? '');
    } catch {
      return;
    }
    if (!moduleName) return;

    const target = options.getTarget();
    const nodes = target?.nodes ?? [];
    const affected = moduleName === ALL_MODULES
      ? nodes.filter(node => node.modulePath?.startsWith('project.'))
      : nodes.filter(node => node.modulePath === `project.${moduleName}`);

    // Two caches, one edit. The compiled bundle is what runs; the definition
    // facts are what the Definition panel reads about where a node comes from
    // and what it declares. Invalidating only the first left the panel showing
    // the previous definition's ports after an edit, which is the kind of stale
    // read that gets believed.
    if (moduleName === ALL_MODULES) {
      for (const node of affected) {
        const folder = node.modulePath!.slice('project.'.length);
        invalidateProjectModule(folder);
        invalidateDefinitionFacts(folder);
      }
    } else {
      // Invalidate even with nothing on the canvas using it, so dropping the
      // node in afterwards does not resurrect the stale bundle.
      invalidateProjectModule(moduleName);
      invalidateDefinitionFacts(moduleName);
    }

    for (const node of affected) node.markDirty();
    options.onReload?.(moduleName, affected.length);
  });

  // Logged rather than surfaced: the stream reconnects by itself, and a
  // transient drop is not something to put in front of the user.
  source.addEventListener('error', () => console.debug('[node watch] stream interrupted, reconnecting'));

  return () => source.close();
}
