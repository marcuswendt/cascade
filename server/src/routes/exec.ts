/**
 * Python subprocess bridge — a node's compiled ESM runs in the browser,
 * which cannot spawn a subprocess itself, so a Python-backed node calls
 * this route instead of shelling out directly. Scoped to the project
 * root: the entrypoint must resolve inside it (resolveWithinRoot throws
 * otherwise), so a node can only run scripts that already live in the
 * project it belongs to, never an arbitrary path.
 *
 * The shared stage dispatcher (nodes/_shared/node_cli.py, called as
 * `--stage <name> --args <json>` — the one entrypoint every node's
 * pyexec.ts actually uses) is fast-pathed through a persistent Python
 * worker (pythonWorker.ts) instead of a fresh subprocess per call, so a
 * lazily-loaded model (MiDaS: ~7s to load) stays warm across calls. Any
 * OTHER entrypoint still gets a plain one-off subprocess below — the
 * worker only knows how to run the fixed stage dispatcher, not arbitrary
 * scripts. The response shape is identical either way (`{ok, stdout,
 * stderr}`), so pyexec.ts's client-side code needed no changes at all.
 */
import { Router } from 'express';
import { execFile } from 'child_process';
import type { ProjectRoot } from '../project.js';
import { PythonWorker } from '../pythonWorker.js';

const EXEC_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 64 * 1024 * 1024;
const WORKER_ENTRYPOINT = 'nodes/_shared/node_cli.py';

export function createExecRouter(project: ProjectRoot): Router {
  const router = Router();
  const worker = new PythonWorker(project);

  router.post('/', async (req, res) => {
    const entrypoint = String(req.body?.entrypoint ?? '');
    const args = Array.isArray(req.body?.args) ? req.body.args.map(String) : [];
    const python = req.body?.python === 'python' ? 'python' : 'python3';

    if (!entrypoint) {
      return res.status(400).json({ error: 'body must include { entrypoint: string }' });
    }

    if (entrypoint === WORKER_ENTRYPOINT) {
      const stageIdx = args.indexOf('--stage');
      const argsIdx = args.indexOf('--args');
      if (stageIdx !== -1 && argsIdx !== -1) {
        const stage = args[stageIdx + 1];
        let stageArgs: Record<string, unknown>;
        try {
          stageArgs = JSON.parse(args[argsIdx + 1]);
        } catch (err) {
          return res.status(400).json({ error: `--args was not valid JSON: ${err instanceof Error ? err.message : err}` });
        }
        try {
          const result = await worker.call(stage, stageArgs);
          return res.json({ ok: true, stdout: JSON.stringify(result), stderr: '' });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return res.status(500).json({ ok: false, error: message, stdout: '', stderr: message });
        }
      }
    }

    let scriptPath: string;
    try {
      scriptPath = project.resolve(entrypoint);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }

    execFile(
      python,
      [scriptPath, ...args],
      { cwd: project.root, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      (error, stdout, stderr) => {
        if (error) {
          return res.status(500).json({
            ok: false,
            error: error.message,
            stdout,
            stderr,
            timedOut: (error as { killed?: boolean; signal?: string }).signal === 'SIGTERM',
          });
        }
        res.json({ ok: true, stdout, stderr });
      }
    );
  });

  return router;
}
