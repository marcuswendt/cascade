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
 * reachable without it. `/attach` follows the same shape for the same reason.
 *
 * The routes, and which of them can refuse:
 *
 *   GET  /capability           the handshake
 *   GET  /status[?sketch=]     allowlist + whether a run is live for that sketch
 *   POST /attach               NDJSON: replay then live. Never BUSY
 *   POST /prompt               NDJSON: starts a run. BUSY if one is already live
 *   POST /cancel               kills a live run
 *   POST /reset                forgets the conversation. BUSY if one is live
 *
 * A socket closing on `/prompt` or `/attach` detaches that reader and nothing
 * more — the agent keeps running and keeps being read into its buffer, which is
 * what makes a browser reload survivable. Killing it is `/cancel`, explicitly.
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
  router.get('/status', boundary.requireCapability, (req, res) => {
    const sketch = typeof req.query?.sketch === 'string' ? req.query.sketch : undefined;
    res.json({ ok: true, ...sessions.status(undefined, sketch) });
  });

  router.post('/reset', boundary.requireCapability, json({ limit: BODY_LIMIT }), (req, res) => {
    const agent = typeof req.body?.agent === 'string' ? req.body.agent : 'claude';
    const sketch = typeof req.body?.sketch === 'string' ? req.body.sketch : '';
    try {
      sessions.reset(agent, sketch);
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof AgentRequestError) res.status(409).json({ ok: false, error: error.message, code: error.code });
      else throw error;
    }
  });

  router.post('/cancel', boundary.requireCapability, json({ limit: BODY_LIMIT }), (req, res) => {
    const agent = typeof req.body?.agent === 'string' ? req.body.agent : 'claude';
    const sketch = typeof req.body?.sketch === 'string' ? req.body.sketch : '';
    res.json({ ok: true, cancelled: sessions.cancel(agent, sketch) });
  });

  /**
   * Reconnect. Answers "is there a live agent for this sketch", hands back
   * everything still buffered from `since` onward, then keeps streaming.
   *
   * Always 200 and always a stream, including when nothing is running — the
   * single `attached` line carries `running: false` and the response ends. One
   * shape for the panel to read beats a 200-or-404 branch, and it is why a
   * reload can never silently start something.
   */
  router.post('/attach', boundary.requireCapability, json({ limit: BODY_LIMIT }), async (req, res) => {
    const agent = typeof req.body?.agent === 'string' ? req.body.agent : 'claude';
    const sketch = typeof req.body?.sketch === 'string' ? req.body.sketch : '';
    const since = Number.isFinite(req.body?.since) ? Number(req.body.since) : 0;

    const controller = new AbortController();
    // Detaches this reader. The run is untouched.
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });

    const write = streamWriter(res);
    await sessions.attach({ agent, sketch, since, sink: write, signal: controller.signal });
    if (!res.writableEnded) res.end();
  });

  router.post('/prompt', boundary.requireCapability, json({ limit: BODY_LIMIT }), async (req, res) => {
    const agent = typeof req.body?.agent === 'string' ? req.body.agent : 'claude';
    const sketch = typeof req.body?.sketch === 'string' ? req.body.sketch : '';
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';

    const controller = new AbortController();
    // The browser going away detaches this reader; it does not stop the agent.
    // That is the whole reconnect story in one line: a reload used to SIGTERM a
    // process mid-edit, and now it just stops listening.
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });

    // Errors that are knowable before the process starts are ordinary HTTP
    // failures with a body the panel can print; anything after the first byte
    // of the stream has to arrive as a stream event instead.
    const write = streamWriter(res);
    let streaming = false;
    const send = (event: AgentEvent) => { streaming = true; write(event); };

    try {
      await sessions.prompt({ agent, sketch, prompt, sink: send, signal: controller.signal });
      if (!res.writableEnded) res.end();
    } catch (error) {
      const payload = error instanceof AgentRequestError
        ? { ok: false as const, error: error.message, code: error.code }
        : { ok: false as const, error: error instanceof Error ? error.message : 'Agent launch failed' };
      if (streaming) {
        send({ type: 'error', message: payload.error, code: 'code' in payload ? payload.code : undefined });
        if (!res.writableEnded) res.end();
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

/** One NDJSON line per event, with the streaming headers set on the first one
 *  so a pre-stream failure can still be an ordinary JSON error response. */
function streamWriter(res: Response): (event: AgentEvent) => void {
  let open = false;
  return (event) => {
    if (!open) {
      res.status(200).set({
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();
      open = true;
    }
    if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
}

/** The allowlist error already names the file and the line to add; this just
 *  makes it a separate field so the panel can show it as its own block. */
function hintFor(error: unknown, project: ProjectRoot): string | null {
  if (!(error instanceof AgentRequestError) || error.code !== 'COMMAND_NOT_ALLOWED') return null;
  return `${project.root}/cascade.json`;
}
