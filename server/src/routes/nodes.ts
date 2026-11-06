/**
 * Node-module routes — the `nodes/<module-name>/` half of the project
 * model. Scoped to the single ProjectRoot, same reasoning as graph.ts.
 * This is deliberately minimal (list / read / write / scaffold) — it's
 * the API surface a "create a new node" Claude Code skill would call
 * into, not an in-app node editor (that's the part being disabled, per
 * Marcus's "Claude writes everything" direction).
 */
import { Router } from 'express';
import type { ProjectRoot } from '../project.js';
import { PathSafetyError } from '../pathSafety.js';
import { autoCommit } from '../git.js';
import { compileProjectModule, compileEmbedded } from '../compile.js';
import { ALL_MODULES, createNodeWatcher, type NodeWatcher } from '../nodeWatch.js';

function handleError(res: import('express').Response, err: unknown) {
  if (err instanceof PathSafetyError) {
    res.status(400).json({ error: err.message });
    return;
  }
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') {
    res.status(404).json({ error: 'not found' });
    return;
  }
  console.error('[nodes route] error:', err);
  res.status(500).json({ error: String(err) });
}

/** A boot asks for every module in one request; this bounds what one request
 *  may make the server compile. */
const MAX_BATCH_MODULES = 500;

type ModuleFacts = { runsOn: 'portable' | 'server' | 'browser'; icon: string | null };

export function createNodesRouter(project: ProjectRoot): Router {
  const router = Router();
  let watcher: NodeWatcher | null = null;

  /**
   * What `GET /` reports per module, kept until the module changes.
   *
   * Classifying a module parses its source (see ProjectRoot.moduleRunsOn), and
   * doing that for every module on every request cost 33 ms a call. The
   * folder listing is still read each time — it is cheap, and it is what
   * catches a module folder appearing, vanishing or being renamed, which the
   * watcher reports only by path and cannot always attribute. Content edits
   * come through the watcher; the write routes below also drop their module
   * at once, so a read straight after a save never waits on the debounce.
   */
  const factsCache = new Map<string, Promise<ModuleFacts>>();

  function forget(moduleName: string): void {
    if (moduleName === ALL_MODULES) factsCache.clear();
    else factsCache.delete(moduleName);
  }

  function ensureWatcher(): NodeWatcher {
    if (!watcher) {
      watcher = createNodeWatcher(project);
      watcher.subscribe(forget);
    }
    return watcher;
  }

  function moduleFacts(name: string): Promise<ModuleFacts> {
    let cached = factsCache.get(name);
    if (!cached) {
      cached = Promise.all([project.moduleRunsOn(name), project.moduleIcon(name)])
        .then(([runsOn, icon]) => ({ runsOn, icon }));
      factsCache.set(name, cached);
      // A failure is not remembered: the next request tries again.
      cached.catch(() => { if (factsCache.get(name) === cached) factsCache.delete(name); });
    }
    return cached;
  }

  /**
   * Tells Studio which module changed on disk, so it can drop that module's
   * cached bundle instead of running last night's code until the app is
   * reloaded.
   *
   * Server-Sent Events rather than a socket: the traffic is one-way and
   * tiny, it needs no dependency, and it inherits the Host and Origin
   * boundary that already guards every project route. The watcher starts on
   * the first listener so a headless `cascade run` never opens one.
   */
  router.get('/events', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Without this a proxy can hold the stream in a buffer and deliver
      // every event at once when the request finally ends.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    res.write('retry: 2000\n\n');

    const unsubscribe = ensureWatcher().subscribe((moduleName) => {
      res.write(`event: module-changed\ndata: ${JSON.stringify({ module: moduleName })}\n\n`);
    });

    // A comment line keeps the connection from being reaped by an idle
    // timeout, and costs one line every half minute.
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 30_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  router.get('/', async (_req, res) => {
    try {
      // The cache is only as good as its invalidation, so it starts the
      // watcher that feeds it. A headless `cascade run` never serves this.
      ensureWatcher();
      const modules = await project.listNodeModules();
      const runsOn: Record<string, 'portable' | 'server' | 'browser'> = {};
      const icons: Record<string, string> = {};
      await Promise.all(modules.map(async (name) => {
        const facts = await moduleFacts(name);
        runsOn[name] = facts.runsOn;
        if (facts.icon) icons[name] = facts.icon;
      }));
      res.json({ modules, runsOn, icons });
    } catch (err) {
      handleError(res, err);
    }
  });

  /**
   * Every requested module's compiled bundle in one response:
   * `GET /compiled?module=A&module=B` answers
   * `{ modules: { A: { code }, B: { error } } }`.
   *
   * Studio used to fetch `/<name>/compiled` once per module on boot, about 50
   * requests for a real sketch, queued six at a time behind the browser's
   * connection limit. One module failing to compile is that module's entry,
   * not the request's status, so the rest still load.
   */
  router.get('/compiled', async (req, res) => {
    const raw = req.query.module;
    const names = [...new Set((Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map(String).filter(Boolean))];
    if (names.length === 0) {
      res.status(400).json({ error: 'name at least one module: /api/nodes/compiled?module=<name>' });
      return;
    }
    if (names.length > MAX_BATCH_MODULES) {
      res.status(400).json({ error: `at most ${MAX_BATCH_MODULES} modules per request` });
      return;
    }
    try {
      const modules: Record<string, { code: string } | { error: string }> = {};
      await Promise.all(names.map(async (name) => {
        const result = await compileProjectModule(project, name);
        modules[name] = result.ok ? { code: result.code } : { error: result.errors.join('\n') };
      }));
      res.set('Cache-Control', 'no-store').json({ modules });
    } catch (err) {
      handleError(res, err);
    }
  });

  /** Where one module's work happens. Declared or inferred — see
   * ProjectRoot.moduleRunsOn. */
  router.get('/:moduleName/runs-on', async (req, res) => {
    try {
      res.json({ module: req.params.moduleName, runsOn: await project.moduleRunsOn(req.params.moduleName) });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Registered before the generic {*file} route below so a module literally
  // named "compiled" can never shadow this — Express matches route order.
  // The absolute path of a module's source, so Studio can hand it to an
  // external editor. Declared before the catch-all file route below, which
  // would otherwise claim it.
  router.get('/:moduleName/path', (req, res) => {
    try {
      res.json({ path: project.resolve(`nodes/${req.params.moduleName}/index.ts`) });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/:moduleName/compiled', async (req, res) => {
    try {
      const result = await compileProjectModule(project, req.params.moduleName);
      if (!result.ok) {
        res.status(422).json({ error: result.errors.join('\n') });
        return;
      }
      res.type('application/javascript').send(result.code);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/:moduleName/{*file}', async (req, res) => {
    try {
      const rel = (req.params as any).file?.join('/') || 'index.ts';
      const content = await project.readNodeModuleFile(req.params.moduleName, rel);
      res.type('text/plain').send(content);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.put('/:moduleName/{*file}', async (req, res) => {
    try {
      const rel = (req.params as any).file?.join('/') || 'index.ts';
      const content = req.body?.content;
      if (typeof content !== 'string') {
        res.status(400).json({ error: 'body must be { content: string }' });
        return;
      }
      await project.writeNodeModuleFile(req.params.moduleName, rel, content);
      forget(req.params.moduleName);
      const { committed } = await autoCommit(project.root, `Update node ${req.params.moduleName}/${rel}`, [`nodes/${req.params.moduleName}`]);
      res.json({ ok: true, committed });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Scaffolds nodes/<moduleName>/index.ts with a minimal stub if it
  // doesn't already exist — the "create a new node" entry point.
  router.post('/', async (req, res) => {
    try {
      const name = String(req.body?.name ?? '');
      if (!name) {
        res.status(400).json({ error: 'body must include { name: string }' });
        return;
      }
      await project.ensureNodeModuleScaffold(name);
      forget(name);
      const { committed } = await autoCommit(project.root, `Scaffold node ${name}`, [`nodes/${name}`]);
      res.json({ ok: true, name, committed });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Compiles ad hoc code that only lives inline in the .cascade file (no
  // module directory of its own) — same esbuild pass as project modules,
  // fed as a virtual entry so it can still `import` from real project files.
  router.post('/compile-embedded', async (req, res) => {
    try {
      const code = req.body?.code;
      if (typeof code !== 'string') {
        res.status(400).json({ error: 'body must be { code: string }' });
        return;
      }
      const result = await compileEmbedded(project, code);
      if (!result.ok) {
        res.status(422).json({ error: result.errors.join('\n') });
        return;
      }
      res.type('application/javascript').send(result.code);
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}
