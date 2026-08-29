import express from 'express';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createGraphRouter } from './routes/graph.js';
import { createAssetsRouter } from './routes/assets.js';
import { createNodesRouter } from './routes/nodes.js';
import { createPanelsRouter } from './routes/panels.js';
import { createExecRouter } from './routes/exec.js';
import { createShellRouter } from './routes/shell.js';
import { createProjectSettingsRouter } from './routes/projectSettings.js';
import { createNetRouter } from './routes/net.js';
import { authority, createProjectRequestBoundary, isLoopbackHost, type ServerSecurityOptions } from './security.js';
import { createMediaRouter } from './routes/media.js';
import { aiRouter } from './routes/ai.js';
import { ProjectRoot } from './project.js';

export { createDirectShellCapability } from './shell/service.js';
export type { ShellCapability, ShellRunOptions, ShellRunResult } from './shell/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// server/src/index.ts -> server/src -> server -> repo root -> dist. Resolved
// relative to THIS file's install location, not the caller's CWD, so
// `cascade` works correctly when symlinked onto PATH and run from any
// project directory.
const CASCADE_DIST = path.resolve(__dirname, '..', '..', 'dist');

export interface StartServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly trustedHosts?: readonly string[];
  readonly trustedOrigins?: readonly string[];
  /** @deprecated Use trustedOrigins. */
  readonly trustedShellOrigins?: readonly string[];
}

export function startServer(project: ProjectRoot, opts: StartServerOptions = {}) {
  const app = express();
  const PORT = opts.port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 3030);
  const HOST = opts.host ?? '127.0.0.1';
  const trustedHosts = Object.freeze([...(opts.trustedHosts ?? [])]);
  const defaultOrigins = [
    ...(isLoopbackHost(HOST) ? [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`] : []),
    ...trustedHosts.map((host) => `http://${authority(host, PORT)}`),
  ];
  const security: ServerSecurityOptions = Object.freeze({
    host: HOST,
    port: PORT,
    trustedHosts,
    sensitiveCapabilities: isLoopbackHost(HOST) || trustedHosts.length > 0,
    trustedOrigins: Object.freeze([...(opts.trustedOrigins ?? opts.trustedShellOrigins ?? defaultOrigins)]),
  });

  // Process endpoints own their authentication and bounded parsers, so they
  // must run before the broad project parsers below. Each router terminates
  // its protected prefix.
  app.use('/api/shell', createShellRouter(project.shell, security));
  app.use('/api/exec', createExecRouter(project, security));
  app.use('/api/net', createNetRouter(project, security));
  app.use('/api/project', createProjectSettingsRouter(project, security));

  const projectBoundary = createProjectRequestBoundary(security);
  app.use('/api', projectBoundary.guard);
  app.options('/api/{*splat}', projectBoundary.preflight);
  // Project graphs and assets may carry large media-derived values. Process
  // routes above use smaller independent limits.
  app.use(express.json({ limit: '512mb' }));
  app.use(express.urlencoded({ extended: true, limit: '512mb' }));

  // Body-parser failures must stay JSON. The default handler renders an HTML
  // error page, and every caller here does res.json() on the response — so an
  // oversized or malformed body arrived as a parse error about a '<' character
  // rather than as what actually went wrong.
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err && (err.type === 'entity.too.large' || err.type === 'entity.parse.failed')) {
      res.status(err.status ?? 400).json({ ok: false, error: err.message, type: err.type });
      return;
    }
    next(err);
  });

  app.use('/api/graph', createGraphRouter(project));
  app.use('/api/assets', createAssetsRouter(project));
  app.use('/api/nodes', createNodesRouter(project));
  app.use('/api/panels', createPanelsRouter(project));
  app.use('/api/media', createMediaRouter(project));
  app.use('/api/ai', aiRouter);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '2.0', projectRoot: project.root, isGitRepo: project.isGitRepo });
  });

  // Serves the built Cascade UI itself — "cascade ./" is meant to be one
  // self-contained command, not "run the server, then separately go start
  // the frontend dev server too." Falls through to the API routes above
  // (registered first) for anything under /api or /health.
  if (fs.existsSync(CASCADE_DIST)) {
    app.use(express.static(CASCADE_DIST));
    app.get('/{*splat}', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path === '/health') return next();
      res.sendFile(path.join(CASCADE_DIST, 'index.html'));
    });
  } else {
    console.warn(`[cascade-server] no build found at ${CASCADE_DIST} — run "npm run build" in the Cascade repo first. API-only for now.`);
  }

  const server = createServer(app);

  server.listen(PORT, HOST, () => {
    console.log(`🚀 Cascade running on http://${HOST}:${PORT}`);
    console.log(`📁 Project: ${project.root}${project.isGitRepo ? ' (git)' : ' (not a git repo yet)'}`);
    if (trustedHosts.length > 0) console.log(`🔐 Trusted Studio URL: http://${authority(trustedHosts[0], PORT)} (all reachable VPN/interface peers are trusted)`);
  });

  return server;
}
