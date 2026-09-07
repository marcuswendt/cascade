/**
 * The per-sketch agent console's process bridge.
 *
 * Gated exactly like /api/exec and /api/shell, and for a stronger reason than
 * either: this launches a process whose whole job is rewriting the project. The
 * entire router 404s unless the server is on loopback or has an explicit
 * trusted host, and every POST needs the capability token issued to a
 * same-origin caller. Nothing outside the project's own `cascade.json`
 * allowlist can be spawned.
 *
 * Streaming is NDJSON over a POST rather than Server-Sent Events, because
 * EventSource cannot send the capability header and this endpoint must not be
 * reachable without it.
 */
import { Router, json, type NextFunction, type Request, type Response } from 'express';
import type { ProjectRoot } from '../project.js';
import { allowsSensitiveCapabilities, createBrowserCapabilityBoundary, type ServerSecurityOptions } from '../security.js';
import { AgentSessions, type AgentEvent } from '../agent/session.js';
import { AgentRequestError } from '../agent/allowlist.js';

const BODY_LIMIT = '1mb';

export function createAgentRouter(project: ProjectRoot, security: ServerSecurityOptions): Router {
  const router = Router();
  if (!allowsSensitiveCapabilities(security)) return router.use((_req, res) => res.status(404).end());

  const boundary = createBrowserCapabilityBoundary(security, 'Agent', 'X-Cascade-Agent-Capability');
  const sessions = new AgentSessions(project);

  router.use(boundary.guardOrigin);
  router.options('{*path}', boundary.preflight);
  router.get('/capability', boundary.issueCapability);

  // What the panel reads before anything is typed: which agents this project
  // allows, and for the ones it does not, the line to add to cascade.json.
  router.get('/status', boundary.requireCapability, (_req, res) => {
    res.json({ ok: true, ...sessions.status() });
  });

  router.post('/reset', boundary.requireCapability, json({ limit: BODY_LIMIT }), (req, res) => {
    const agent = typeof req.body?.agent === 'string' ? req.body.agent : 'claude';
    const sketch = typeof req.body?.sketch === 'string' ? req.body.sketch : '';
    sessions.reset(agent, sketch);
    res.json({ ok: true });
  });

  router.post('/prompt', boundary.requireCapability, json({ limit: BODY_LIMIT }), async (req, res) => {
    const agent = typeof req.body?.agent === 'string' ? req.body.agent : 'claude';
    const sketch = typeof req.body?.sketch === 'string' ? req.body.sketch : '';
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';

    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.once('close', () => { if (!res.writableEnded) cancel(); });

    // Errors that are knowable before the process starts are ordinary HTTP
    // failures with a body the panel can print; anything after the first byte
    // of the stream has to arrive as a stream event instead.
    let streaming = false;
    const write = (event: AgentEvent) => {
      if (!streaming) {
        res.status(200).set({
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store, no-transform',
          'X-Accel-Buffering': 'no',
        });
        res.flushHeaders?.();
        streaming = true;
      }
      res.write(`${JSON.stringify(event)}\n`);
    };

    try {
      await sessions.prompt({ agent, sketch, prompt, sink: write, signal: controller.signal });
      res.end();
    } catch (error) {
      const payload = error instanceof AgentRequestError
        ? { ok: false as const, error: error.message, code: error.code }
        : { ok: false as const, error: error instanceof Error ? error.message : 'Agent launch failed' };
      if (streaming) {
        write({ type: 'error', message: payload.error, code: 'code' in payload ? payload.code : undefined });
        res.end();
        return;
      }
      const status = error instanceof AgentRequestError
        ? ({ COMMAND_NOT_ALLOWED: 403, MISSING_EXECUTABLE: 409, BUSY: 409, INVALID_REQUEST: 400 } as const)[error.code]
        : 500;
      res.status(status).json({ ...payload, hint: hintFor(error, project) });
    }
  });

  router.use((error: any, _req: Request, res: Response, next: NextFunction) => {
    if (error?.type === 'entity.too.large' || error?.type === 'entity.parse.failed') {
      res.status(error.status ?? 400).json({ ok: false, error: error.message, type: error.type });
    } else next(error);
  });

  return router;
}

/** The allowlist error already names the file and the line to add; this just
 *  makes it a separate field so the panel can show it as its own block. */
function hintFor(error: unknown, project: ProjectRoot): string | null {
  if (!(error instanceof AgentRequestError) || error.code !== 'COMMAND_NOT_ALLOWED') return null;
  return `${project.root}/cascade.json`;
}
