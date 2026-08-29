/**
 * Loads a node module's compiled ES module from the Cascade server and
 * hands back its `execute(node, graph)` export. The browser can't strip
 * TypeScript or resolve imports itself, so this always round-trips
 * through the server's esbuild pass (server/src/compile.ts) — replacing
 * the old `new Function('node','graph', code)` sandbox, which needed no
 * server but also couldn't do real imports at all.
 *
 * Project-sourced nodes use the `project.<folderName>` module-path
 * convention (see Graph.ts's fromJSON) so the flat single-project model
 * (`nodes/<folderName>/index.ts`, no package/alias indirection) still
 * satisfies the legacy "module path must contain a dot" check elsewhere
 * in this codebase, while staying a direct, unambiguous folder lookup.
 */

export type NodeModuleExecute = (node: unknown, graph: unknown) => unknown | Promise<unknown>;

interface LoadedModule {
  execute: NodeModuleExecute;
}

const moduleCache = new Map<string, Promise<LoadedModule>>();

async function importCompiledCode(code: string): Promise<LoadedModule> {
  const blob = new Blob([code], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    const mod = await import(/* @vite-ignore */ url);
    if (typeof mod.execute !== 'function') {
      throw new Error('node module has no execute(node, graph) export');
    }
    return { execute: mod.execute };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** `modulePath` is the full `project.<folderName>` string stored on the node. */
export function loadProjectModule(modulePath: string): Promise<LoadedModule> {
  const folderName = modulePath.replace(/^project\./, '');
  const cacheKey = `project:${folderName}`;
  let cached = moduleCache.get(cacheKey);
  if (!cached) {
    cached = fetch(`/api/nodes/${encodeURIComponent(folderName)}/compiled`).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return importCompiledCode(await res.text());
    });
    moduleCache.set(cacheKey, cached);
  }
  return cached;
}

export function loadEmbeddedModule(code: string): Promise<LoadedModule> {
  const cacheKey = `embedded:${hashCode(code)}`;
  let cached = moduleCache.get(cacheKey);
  if (!cached) {
    cached = fetch('/api/nodes/compile-embedded', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return importCompiledCode(await res.text());
    });
    moduleCache.set(cacheKey, cached);
  }
  return cached;
}

/** Called when the file-watcher reports a project module's file changed, so the next execute() recompiles instead of reusing a stale bundle. */
export function invalidateProjectModule(folderName: string): void {
  moduleCache.delete(`project:${folderName}`);
}

function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
