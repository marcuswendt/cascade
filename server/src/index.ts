import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createGraphRouter } from './routes/graph.js';
import { createAssetsRouter } from './routes/assets.js';
import { createNodesRouter } from './routes/nodes.js';
import { createExecRouter } from './routes/exec.js';
import { createMediaRouter } from './routes/media.js';
import { aiRouter } from './routes/ai.js';
import { setupWebSocket } from './services/websocket.js';
import { ProjectRoot } from './project.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// server/src/index.ts -> server/src -> server -> repo root -> dist. Resolved
// relative to THIS file's install location, not the caller's CWD, so
// `cascade` works correctly when symlinked onto PATH and run from any
// project directory.
const CASCADE_DIST = path.resolve(__dirname, '..', '..', 'dist');

export function startServer(project: ProjectRoot, opts: { port?: number; wsPort?: number } = {}) {
  const app = express();
  const PORT = opts.port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 3030);
  const WS_PORT = opts.wsPort ?? (process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 3031);

  app.use(cors());
  // The pipeline posts whole primitive sets through /api/exec — a stipple
  // render is thousands of dashes, a hatch pass thousands of curves, and
  // both terminal render nodes take all of them at once. Express's 100kb
  // default rejected exactly those two nodes with an HTML error page, which
  // surfaced in the graph as "Unexpected token '<'". Local single-user
  // server, so the ceiling is generous on purpose.
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
  app.use('/api/exec', createExecRouter(project));
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
  const wss = new WebSocketServer({ port: WS_PORT });
  setupWebSocket(wss, project);

  server.listen(PORT, () => {
    console.log(`🚀 Cascade running on http://localhost:${PORT}`);
    console.log(`📁 Project: ${project.root}${project.isGitRepo ? ' (git)' : ' (not a git repo yet)'}`);
    console.log(`📡 WebSocket on ws://localhost:${WS_PORT}`);
  });

  return server;
}
