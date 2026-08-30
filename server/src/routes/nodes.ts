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

export function createNodesRouter(project: ProjectRoot): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      const modules = await project.listNodeModules();
      const runsOn: Record<string, 'portable' | 'server' | 'browser'> = {};
      const icons: Record<string, string> = {};
      await Promise.all(modules.map(async (name) => {
        runsOn[name] = await project.moduleRunsOn(name);
        const icon = await project.moduleIcon(name);
        if (icon) icons[name] = icon;
      }));
      res.json({ modules, runsOn, icons });
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
