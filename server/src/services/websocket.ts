/**
 * File watcher / live-update broadcaster — round 32 re-scope: watches the
 * single project root (not a multi-project PROJECTS_DIR), and this is the
 * mechanism Marcus pointed at as "the UI could just channel into Claude
 * Code running alongside the server" — Claude Code edits a node's file on
 * disk exactly like any other edit, this notices, connected browser
 * clients re-render. No new transport needed for that loop; it already
 * existed, just pointed at the wrong directory.
 */
import { WebSocketServer, WebSocket } from 'ws';
import chokidar from 'chokidar';
import path from 'path';
import type { ProjectRoot } from '../project.js';

interface WSEvent {
  type: 'file-changed' | 'graph-updated' | 'node-changed' | 'asset-added';
  data: { path: string };
}

export function setupWebSocket(wss: WebSocketServer, project: ProjectRoot) {
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    console.log('[websocket] client connected');
    ws.on('close', () => {
      clients.delete(ws);
      console.log('[websocket] client disconnected');
    });
    ws.on('error', (error) => console.error('[websocket] error:', error));
  });

  const watcher = chokidar.watch(project.root, {
    ignored: (p) => p.includes('node_modules') || p.includes('/.git/'),
    persistent: true,
    ignoreInitial: true
  });

  watcher.on('all', (_eventName, filePath) => {
    const relativePath = path.relative(project.root, filePath);
    let eventType: WSEvent['type'] = 'file-changed';
    if (relativePath.endsWith('.cascade')) eventType = 'graph-updated';
    else if (relativePath.startsWith(`nodes${path.sep}`)) eventType = 'node-changed';
    else if (relativePath.startsWith(`assets${path.sep}`)) eventType = 'asset-added';

    const event: WSEvent = { type: eventType, data: { path: relativePath } };
    const payload = JSON.stringify(event);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
  });

  process.on('SIGINT', () => {
    watcher.close();
    wss.close();
  });
}
