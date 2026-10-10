import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import type { Server } from 'node:http';
import { ProjectRoot } from '../server/src/project.js';
import { startServer } from '../server/src/index.js';

/**
 * The Studio workspace is a sidecar beside the graph, so it survives a
 * different host alias, browser or project open on the same origin
 * (Marcus, 2026-10-10: pinned viewers kept resetting).
 */
const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => (address && typeof address !== 'string' ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

async function serve(): Promise<{ base: string; root: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-workspace-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'art.cascade'), JSON.stringify({ version: '1', nodes: [] }));
  const port = await freePort();
  const server = startServer(new ProjectRoot(root), { port });
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return { base: `http://127.0.0.1:${port}`, root };
}

const workspace = { version: 1, layout: { grid: {}, panels: { 'viewer-red': { params: { lockedNodeId: 'Red' } } } }, savedAt: '2026-10-10T12:00:00.000Z' };

describe('graph workspace sidecar', () => {
  it('is absent until saved, then round-trips beside the graph without touching it', async () => {
    const { base, root } = await serve();
    expect((await fetch(`${base}/api/graph/art.cascade/workspace`)).status).toBe(404);
    const put = await fetch(`${base}/api/graph/art.cascade/workspace`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(workspace),
    });
    expect(put.status).toBe(200);
    expect(fs.existsSync(path.join(root, 'art.workspace.json'))).toBe(true);
    expect(await (await fetch(`${base}/api/graph/art.cascade/workspace`)).json()).toEqual(workspace);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'art.cascade'), 'utf-8')).nodes).toEqual([]);
  });

  it('keeps a failed restore in its own slot', async () => {
    const { base, root } = await serve();
    await fetch(`${base}/api/graph/art.cascade/workspace?slot=failed`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(workspace),
    });
    expect(fs.existsSync(path.join(root, 'art.workspace.failed.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'art.workspace.json'))).toBe(false);
  });

  it('rejects a body without a layout and a name that is not a graph', async () => {
    const { base } = await serve();
    const bad = await fetch(`${base}/api/graph/art.cascade/workspace`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nope: true }),
    });
    expect(bad.status).toBe(400);
    expect((await fetch(`${base}/api/graph/${encodeURIComponent('../x.cascade')}/workspace`)).status).toBe(400);
    expect((await fetch(`${base}/api/graph/notes.txt/workspace`)).status).toBe(400);
  });
});
