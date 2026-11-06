/**
 * Studio boot and the node routes it leans on, against a real server.
 *
 * Round 1 review (2026-11-06) measured 81 to 86 requests to boot cloud-plots,
 * 49 to 50 of them one `/api/nodes/<name>/compiled` per project module, and
 * `/api/nodes` recomputing every module's classification on every call (33 ms).
 *
 * The boot guard deserializes a graph of 40 project modules through
 * Graph.fromJSON, the path Studio boots through, and counts what reaches
 * `/api/nodes`. Its budget is the value measured after the change, 1. It may
 * only go down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { ProjectRoot } from '../server/src/project.js';
import { startServer } from '../server/src/index.js';
import { Graph } from '@/nodes/Graph';
import { loadProjectModule, setProjectModuleCompiler } from '@/engine/nodeModuleLoader';

const MODULE_COUNT = 40;
const BOOT_NODE_REQUEST_BUDGET = 1;

const roots: string[] = [];
const servers: Server[] = [];
let nextPort = 36_000 + (process.pid % 4_000);

afterEach(async () => {
  vi.unstubAllGlobals();
  setProjectModuleCompiler(null);
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => setProjectModuleCompiler(null));

const moduleName = (index: number) => `Mod${String(index).padStart(2, '0')}`;

function fixtureProject(): ProjectRoot {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-boot-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'index.cascade'), '{"nodes":[]}');
  for (let index = 0; index < MODULE_COUNT; index++) {
    const dir = path.join(root, 'nodes', moduleName(index));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.ts'), `export const icon = 'Circle';\nexport function execute() { return ${index}; }\n`);
  }
  const broken = path.join(root, 'nodes', 'Broken');
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(path.join(broken, 'index.ts'), 'export function execute( {\n');
  return new ProjectRoot(root);
}

async function serve(project: ProjectRoot) {
  const server = startServer(project, { port: nextPort++ });
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Origin: base, Host: `127.0.0.1:${address.port}` };
  return { base, headers };
}

/** Points Studio's relative `/api/...` fetches at the test server and records them. */
function routeStudioFetch(base: string, headers: Record<string, string>): string[] {
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push(url);
    return realFetch(url.startsWith('/') ? `${base}${url}` : url, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
  });
  return seen;
}

describe('Studio boot requests', () => {
  it(`loads ${MODULE_COUNT} project modules in at most ${BOOT_NODE_REQUEST_BUDGET} /api/nodes request`, async () => {
    const project = fixtureProject();
    const { base, headers } = await serve(project);
    const seen = routeStudioFetch(base, headers);

    const names = Array.from({ length: MODULE_COUNT }, (_, index) => moduleName(index));
    Graph.fromJSON({
      version: '0.2',
      nodes: names.map((name, index) => ({ id: `n${index}`, module: `project.${name}`, source: 'project', position: [index, 0] })),
      connections: [],
    });
    // The same cached promises fromJSON started; asking again must not fetch.
    const loaded = await Promise.all(names.map((name) => loadProjectModule(`project.${name}`)));

    expect(loaded.map((module) => module.execute(null, null))).toEqual(names.map((_, index) => index));
    const nodeRequests = seen.filter((url) => url.startsWith('/api/nodes'));
    expect(nodeRequests, nodeRequests.join('\n')).toHaveLength(BOOT_NODE_REQUEST_BUDGET);
  });

  it('reports one module failing to compile as that module, and the rest still load', async () => {
    const project = fixtureProject();
    const { base, headers } = await serve(project);
    routeStudioFetch(base, headers);

    const good = loadProjectModule('project.Mod01');
    const bad = loadProjectModule('project.Broken');

    await expect(good).resolves.toMatchObject({ execute: expect.any(Function) });
    await expect(bad).rejects.toThrow(/index\.ts|Expected|Unexpected/);
  });

  it('answers the batch route with every named module', async () => {
    const project = fixtureProject();
    const { base, headers } = await serve(project);

    const response = await fetch(`${base}/api/nodes/compiled?module=Mod03&module=Broken&module=Mod03`, { headers });
    const body = await response.json() as { modules: Record<string, { code?: string; error?: string }> };

    expect(response.status).toBe(200);
    expect(Object.keys(body.modules).sort()).toEqual(['Broken', 'Mod03']);
    expect(body.modules.Mod03.code).toContain('return 3');
    expect(body.modules.Broken.error).toBeTruthy();
    expect((await fetch(`${base}/api/nodes/compiled`, { headers })).status).toBe(400);
    const escape = await (await fetch(`${base}/api/nodes/compiled?module=${encodeURIComponent('../outside')}`, { headers })).json() as typeof body;
    expect(escape.modules['../outside'].code).toBeUndefined();
    expect(escape.modules['../outside'].error).toBeTruthy();
  });
});

describe('/api/nodes cache', () => {
  it('serves repeat calls from the cache and drops a module when its file changes', async () => {
    const project = fixtureProject();
    const { base, headers } = await serve(project);
    const runsOn = vi.spyOn(project, 'moduleRunsOn');
    const list = async () => (await fetch(`${base}/api/nodes`, { headers })).json() as Promise<{ modules: string[]; icons: Record<string, string> }>;

    const first = await list();
    const classified = runsOn.mock.calls.length;
    expect(first.modules).toHaveLength(MODULE_COUNT + 1);
    await list();
    expect(runsOn.mock.calls.length).toBe(classified);

    // Through the write route: dropped at once, no watcher debounce involved.
    const put = await fetch(`${base}/api/nodes/Mod05/index.ts`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: "export const icon = 'Square';\nexport function execute() { return 5; }\n" }),
    });
    expect(put.status).toBe(200);
    expect((await list()).icons.Mod05).toBe('Square');
    expect(runsOn.mock.calls.length).toBe(classified + 1);

    // A new module folder is noticed by the listing itself.
    fs.mkdirSync(path.join(project.root, 'nodes', 'Fresh'));
    fs.writeFileSync(path.join(project.root, 'nodes', 'Fresh', 'index.ts'), "export const icon = 'Star';\nexport function execute() {}\n");
    const after = await list();
    expect(after.modules).toContain('Fresh');
    expect(after.icons.Fresh).toBe('Star');
  });

  it('drops a module edited on disk once the watcher reports it', async () => {
    const project = fixtureProject();
    const { base, headers } = await serve(project);
    const list = async () => (await fetch(`${base}/api/nodes`, { headers })).json() as Promise<{ icons: Record<string, string> }>;

    expect((await list()).icons.Mod07).toBe('Circle');
    // FSEvents can lag, and under load drop the first event after a watch
    // starts, so the edit is repeated until it is seen. What is under test is
    // that a reported change drops the entry, not FSEvents' latency.
    let attempt = 0;
    await vi.waitFor(async () => {
      if (attempt++ % 5 === 0) {
        fs.writeFileSync(path.join(project.root, 'nodes', 'Mod07', 'index.ts'), `export const icon = 'Hexagon';\nexport function execute() { return ${attempt}; }\n`);
      }
      expect((await list()).icons.Mod07).toBe('Hexagon');
    }, { timeout: 8000, interval: 100 });
  });
});
