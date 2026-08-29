import { Router } from 'express';
import type { ProjectRoot } from '../project.js';
import { PathSafetyError } from '../pathSafety.js';
import { compileProjectPanel } from '../compile.js';

function handleError(res: import('express').Response, err: unknown): void {
  if (err instanceof PathSafetyError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
    res.status(404).json({ error: 'not found' });
    return;
  }
  console.error('[panels route] error:', err);
  res.status(500).json({ error: String(err) });
}

export function createPanelsRouter(project: ProjectRoot): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      const names = await project.listPanels();
      res.json({ panels: await Promise.all(names.map((name) => project.panelMeta(name))) });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/:name/compiled', async (req, res) => {
    try {
      // Validate and resolve before compilation so path and missing-file errors
      // retain the same 400/404 semantics as the other project routes.
      await project.resolvePanelEntry(req.params.name);
      const result = await compileProjectPanel(project, req.params.name);
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
