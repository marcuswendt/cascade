import { Router, json, type NextFunction, type Request, type Response } from 'express';
import type { ShellService } from '../shell/service.js';
import { ShellProcessError, ShellRequestError, type ShellRunResult } from '../shell/types.js';
import { createBrowserCapabilityBoundary, isLoopbackHost, type ServerSecurityOptions } from '../security.js';

export type { ServerSecurityOptions } from '../security.js';
export { isLoopbackHost } from '../security.js';

export function createShellRouter(shell: ShellService, options: ServerSecurityOptions): Router {
  const router = Router();
  if (!isLoopbackHost(options.host)) return router.use((_req, res) => res.status(404).end());
  const boundary = createBrowserCapabilityBoundary(options, 'Shell', 'X-Cascade-Shell-Capability');
  router.use(boundary.guardOrigin);
  router.options('{*path}', boundary.preflight);
  router.get('/capability', boundary.issueCapability);
  router.post('/', boundary.requireCapability, json({ limit: '20mb' }), async (req, res) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    req.once('aborted', cancel);
    res.once('close', () => { if (!res.writableEnded) cancel(); });
    try {
      const body = parseBody(req.body);
      const result = await shell.run(body.command, body.args, { ...body.options, signal: controller.signal });
      if (result.code !== 0) {
        res.status(500).json(errorPayload(new ShellProcessError('nonzero', result, result.stderr || `Command exited with code ${result.code}`)));
      } else {
        res.json({ ok: true, ...result });
      }
    } catch (error) {
      if (error instanceof ShellRequestError) {
        res.status(error.code === 'COMMAND_NOT_ALLOWED' ? 403 : 400).json({ ok: false, error: error.message, code: error.code });
      } else if (error instanceof ShellProcessError) {
        res.status(error.kind === 'cancelled' ? 499 : 500).json(errorPayload(error));
      } else {
        res.status(500).json({ ok: false, error: 'Shell execution failed' });
      }
    }
  });
  router.use((error: any, _req: Request, res: Response, next: NextFunction) => {
    if (error?.type === 'entity.too.large' || error?.type === 'entity.parse.failed') {
      res.status(error.status ?? 400).json({ ok: false, error: error.message, type: error.type });
    } else next(error);
  });
  return router;
}

function parseBody(body: any) {
  if (!body || typeof body !== 'object' || typeof body.command !== 'string') throw new ShellRequestError('INVALID_REQUEST', 'body must include { command: string }');
  if (body.args !== undefined && !Array.isArray(body.args)) throw new ShellRequestError('INVALID_REQUEST', 'args must be an array');
  return { command: body.command, args: body.args ?? [], options: { cwd: body.cwd, timeout: body.timeout, stdin: body.stdin, env: body.env } };
}

function errorPayload(error: ShellProcessError): { ok: false; error: string; kind: string } & ShellRunResult {
  return { ok: false, error: error.message, kind: error.kind, ...error.result };
}
