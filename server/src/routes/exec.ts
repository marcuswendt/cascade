import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { Router, json, type NextFunction, type Request, type Response } from 'express';
import type { ProjectRoot } from '../project.js';
import { PythonWorker } from '../pythonWorker.js';
import { createBrowserCapabilityBoundary, isLoopbackHost, type ServerSecurityOptions } from '../security.js';
import { CredentialStore } from '../credentials.js';
import { readProjectManifest } from '../projectConfig.js';

const EXEC_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 64 * 1024 * 1024;
const BODY_LIMIT = '64mb';

interface StageConfig {
  readonly entrypoint: string;
  readonly worker?: string;
  readonly python: 'python' | 'python3';
}

interface WorkerSlot {
  readonly key: string;
  readonly worker: PythonWorker;
}

/** Protected project-local Python execution with no assumed project layout. */
export function createExecRouter(project: ProjectRoot, security: ServerSecurityOptions): Router {
  const router = Router();
  if (!isLoopbackHost(security.host)) return router.use((_req, res) => res.status(404).end());

  const boundary = createBrowserCapabilityBoundary(security, 'Exec', 'X-Cascade-Exec-Capability');
  let workerSlot: WorkerSlot | null = null;

  router.use(boundary.guardOrigin);
  router.options('{*path}', boundary.preflight);
  router.get('/capability', boundary.issueCapability);
  router.post('/', boundary.requireCapability, json({ limit: BODY_LIMIT }), async (req, res) => {
    try {
      const request = parseRequest(req.body);
      const credentialEnv = new CredentialStore().environment(readProjectManifest(project.root).credentials);
      if (request.kind === 'stage') {
        const config = readStageConfig(project);
        if (config.worker) {
          const key = `${config.python}\0${config.worker}\0${JSON.stringify(credentialEnv)}`;
          if (workerSlot?.key !== key) {
            workerSlot?.worker.shutdown();
            workerSlot = { key, worker: new PythonWorker(project, config.worker, config.python, { ...process.env, ...credentialEnv }) };
          }
          try {
            const result = await workerSlot.worker.call(request.stage, request.args);
            res.json({ ok: true, stdout: JSON.stringify(result), stderr: '' });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.status(500).json({ ok: false, error: message, stdout: '', stderr: message });
          }
          return;
        }
        await runPython(res, project, config.python, config.entrypoint, [
          '--stage', request.stage,
          '--args', JSON.stringify(request.args),
        ], credentialEnv);
        return;
      }

      await runPython(res, project, request.python, request.entrypoint, request.args, credentialEnv);
    } catch (error) {
      res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  router.use((error: any, _req: Request, res: Response, next: NextFunction) => {
    if (error?.type === 'entity.too.large' || error?.type === 'entity.parse.failed') {
      res.status(error.status ?? 400).json({ ok: false, error: error.message, type: error.type });
    } else next(error);
  });
  return router;
}

function parseRequest(body: unknown):
  | { kind: 'stage'; stage: string; args: Record<string, unknown> }
  | { kind: 'entrypoint'; entrypoint: string; args: string[]; python: 'python' | 'python3' } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('body must be an object');
  const value = body as Record<string, unknown>;
  if (typeof value.stage === 'string') {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.stage)) throw new Error('stage contains unsupported characters');
    if (value.args !== undefined && (!value.args || typeof value.args !== 'object' || Array.isArray(value.args))) {
      throw new Error('stage args must be an object');
    }
    return { kind: 'stage', stage: value.stage, args: (value.args ?? {}) as Record<string, unknown> };
  }
  if (typeof value.entrypoint !== 'string' || !value.entrypoint) {
    throw new Error('body must include either { stage: string } or { entrypoint: string }');
  }
  if (value.args !== undefined && !Array.isArray(value.args)) throw new Error('entrypoint args must be an array');
  const python = value.python === 'python' ? 'python' : 'python3';
  return { kind: 'entrypoint', entrypoint: value.entrypoint, args: (value.args ?? []).map(String), python };
}

function readStageConfig(project: ProjectRoot): StageConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(project.resolve('cascade.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Project stages are not configured; add exec.stages to cascade.json');
    }
    throw new Error(`Cannot read cascade.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  const stages = (raw as { exec?: { stages?: unknown } })?.exec?.stages;
  if (!stages || typeof stages !== 'object' || Array.isArray(stages)) {
    throw new Error('Project stages are not configured; add exec.stages to cascade.json');
  }
  const value = stages as Record<string, unknown>;
  if (typeof value.entrypoint !== 'string' || !value.entrypoint) {
    throw new Error('cascade.json exec.stages.entrypoint must be a project-relative path');
  }
  if (value.worker !== undefined && (typeof value.worker !== 'string' || !value.worker)) {
    throw new Error('cascade.json exec.stages.worker must be a project-relative path');
  }
  const python = value.python === 'python' ? 'python' : 'python3';
  project.resolve(value.entrypoint);
  if (typeof value.worker === 'string') project.resolve(value.worker);
  return { entrypoint: value.entrypoint, ...(typeof value.worker === 'string' ? { worker: value.worker } : {}), python };
}

function runPython(
  res: Response,
  project: ProjectRoot,
  python: 'python' | 'python3',
  entrypoint: string,
  args: string[],
  credentialEnv: Record<string, string>,
): Promise<void> {
  const scriptPath = project.resolve(entrypoint);
  return new Promise((resolve) => {
    const child = execFile(
      python,
      [scriptPath, ...args],
      { cwd: project.root, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER, env: { ...process.env, ...credentialEnv } },
      (error, stdout, stderr) => {
        if (error) {
          res.status(500).json({
            ok: false,
            error: error.message,
            stdout,
            stderr,
            timedOut: (error as { signal?: string }).signal === 'SIGTERM',
          });
        } else {
          res.json({ ok: true, stdout, stderr });
        }
        resolve();
      },
    );
    res.once('close', () => { if (!res.writableEnded) child.kill(); });
  });
}
