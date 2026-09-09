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

export interface LoadedModule {
  execute: NodeModuleExecute;
  /**
   * The module's `export const definition`, when it has one.
   *
   * Kept unknown on purpose: this loader does not validate it. A project module
   * is compiled from whatever is on disk, so the export can be anything, and
   * the one place that decides whether it is a usable definition-v1 literal is
   * the adapter (see definition/projectDefinition.ts). Discarding it here was
   * why Studio could not cook the very node `cascade node <Name>` scaffolds.
   */
  definition?: unknown;
}

const moduleCache = new Map<string, Promise<LoadedModule>>();

/**
 * A compiler the host can inject so a module can be built without a server.
 *
 * The browser has no choice but to ask the server, but a headless run has no
 * server to ask — and asking anyway is what made `cascade run` fail on every
 * project graph with "Failed to parse URL from /api/nodes/...". The CLI sets
 * this to the same esbuild pass the server uses, so both hosts compile a module
 * identically and only the transport differs.
 */
export type ProjectModuleCompiler = (folderName: string) => Promise<string>;

let projectCompiler: ProjectModuleCompiler | null = null;

export function setProjectModuleCompiler(compiler: ProjectModuleCompiler | null): void {
  projectCompiler = compiler;
  moduleCache.clear();
}

/**
 * `source` names what failed, and it is the whole reason this parameter exists.
 *
 * The message used to be a bare *"node module has no execute export"* with
 * nothing identifying it, and MW-OBSERVATORY-ART lost real time to it: a graph
 * generated into `.cascade-cache/` made `ProjectRoot.from` treat that directory
 * as the project root, so no node folder resolved, and **every node in the
 * graph failed with the same anonymous sentence**. It read as a repo full of
 * broken nodes rather than as one misplaced graph file.
 *
 * A module that compiles and exports nothing named `execute` is nearly always
 * one of two things — a module that is not a node, or a node folder that was
 * looked for in the wrong root — so the message says both rather than leaving
 * the reader to guess which.
 */
async function importCompiledCode(code: string, source: string): Promise<LoadedModule> {
  // A blob URL is the browser's route and the only one it has. Node defines
  // createObjectURL but its ESM loader refuses the blob: scheme, so testing for
  // the function is not enough — the branch has to be on the environment. Node
  // imports the same code as a data URL, which both environments accept.
  const inBrowser = typeof document !== 'undefined';
  const url = inBrowser
    ? URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    : `data:text/javascript;base64,${Buffer.from(code, 'utf-8').toString('base64')}`;
  try {
    const mod = await import(/* @vite-ignore */ url);
    if (typeof mod.execute !== 'function') {
      const exported = Object.keys(mod).filter(name => name !== 'default');
      throw new Error(
        `${source} has no execute export`
        + (exported.length > 0 ? ` (it exports ${exported.join(', ')})` : ' (it exports nothing)')
        + '. Either the module is not a node, or its folder was resolved against the wrong '
        + 'project root — a graph file outside the project root takes its own directory as one.',
      );
    }
    return {
      execute: mod.execute,
      ...(mod.definition === undefined ? {} : { definition: mod.definition }),
    };
  } finally {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}

/** `modulePath` is the full `project.<folderName>` string stored on the node. */
export function loadProjectModule(modulePath: string): Promise<LoadedModule> {
  const folderName = modulePath.replace(/^project\./, '');
  const cacheKey = `project:${folderName}`;
  let cached = moduleCache.get(cacheKey);
  if (!cached) {
    cached = projectCompiler
      ? projectCompiler(folderName).then(code => importCompiledCode(code, modulePath))
      : fetch(`/api/nodes/${encodeURIComponent(folderName)}/compiled`).then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return importCompiledCode(await res.text(), modulePath);
      });
    moduleCache.set(cacheKey, cached);
  }
  return cached;
}

/** A compiler for code that lives inline in the .cascade file rather than in a
 *  module directory. Injected for the same reason as the one above. */
export type EmbeddedCompiler = (code: string) => Promise<string>;

let embeddedCompiler: EmbeddedCompiler | null = null;

export function setEmbeddedCompiler(compiler: EmbeddedCompiler | null): void {
  embeddedCompiler = compiler;
  moduleCache.clear();
}

export function loadEmbeddedModule(code: string): Promise<LoadedModule> {
  const cacheKey = `embedded:${hashCode(code)}`;
  let cached = moduleCache.get(cacheKey);
  if (!cached) {
    if (embeddedCompiler) {
      cached = embeddedCompiler(code).then(compiled => importCompiledCode(compiled, 'this embedded module'));
      moduleCache.set(cacheKey, cached);
      return cached;
    }
    cached = fetch('/api/nodes/compile-embedded', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return importCompiledCode(await res.text(), 'this embedded module');
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
