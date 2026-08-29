import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http, { type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ProjectRoot } from '../server/src/project.js';
import { startServer } from '../server/src/index.js';

const roots: string[] = [];
const servers: Server[] = [];
let nextPort = 43_000 + (process.pid % 5_000);

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function fixture(): Promise<{ base: string; root: string; host: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-project-security-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'index.cascade'), '{}');
  const server = startServer(new ProjectRoot(root), { port: nextPort++ });
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing server address');
  return { base: `http://127.0.0.1:${address.port}`, host: `127.0.0.1:${address.port}`, root };
}

async function trustedHostFixture(): Promise<{ base: string; host: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-trusted-host-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'index.cascade'), '{}');
  const port = nextPort++;
  const server = startServer(new ProjectRoot(root), {
    port,
    host: '0.0.0.0',
    trustedHosts: ['kuro'],
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return { base: `http://127.0.0.1:${port}`, host: `kuro:${port}` };
}

function rawStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    request.once('error', reject);
  });
}

function rawJson(url: string, headers: Record<string, string>): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.once('end', () => resolve({
        status: response.statusCode ?? 0,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.once('error', reject);
  });
}

describe('project API security boundary', () => {
  it('rejects hostile origins and forged hosts across ordinary project routes', async () => {
    const { base, host } = await fixture();
    for (const route of ['/api/graph', '/api/assets/missing', '/api/nodes', '/api/panels', '/api/media/index.cascade', '/api/ai/claude-cli/status']) {
      const hostile = await fetch(`${base}${route}`, { headers: { Host: host, Origin: 'https://evil.test' } });
      expect(hostile.status, route).toBe(403);
      expect(hostile.headers.get('access-control-allow-origin'), route).toBeNull();
      expect(await rawStatus(`${base}${route}`, { Host: 'evil.test' }), route).toBe(403);
    }
  });

  it('preserves same-origin and origin-less same-host Studio requests without wildcard CORS', async () => {
    const { base, host } = await fixture();
    const direct = await fetch(`${base}/api/graph`);
    expect(direct.status).toBe(200);
    expect(direct.headers.get('access-control-allow-origin')).toBeNull();

    const sameOrigin = await fetch(`${base}/api/graph`, { headers: { Host: host, Origin: base } });
    expect(sameOrigin.status).toBe(200);
    expect(sameOrigin.headers.get('access-control-allow-origin')).toBe(base);

    const preflight = await fetch(`${base}/api/graph`, { method: 'OPTIONS', headers: { Host: host, Origin: base } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(base);
    expect(preflight.headers.get('access-control-allow-origin')).not.toBe('*');

    const removedAiRoute = await fetch(`${base}/api/ai/claude-cli/status`);
    expect(removedAiRoute.status).toBe(404);
  });

  it('allows explicitly trusted hostnames and keeps sensitive capabilities available', async () => {
    const { base, host } = await trustedHostFixture();
    expect(await rawStatus(`${base}/api/graph`, { Host: host })).toBe(200);

    const capability = await rawJson(`${base}/api/exec/capability`, { Host: host });
    expect(capability.status).toBe(200);
    expect(capability.body).toMatchObject({ capability: expect.any(String) });

    expect(await rawStatus(`${base}/api/graph`, { Host: `0.0.0.0:${new URL(base).port}` })).toBe(403);
    expect(await rawStatus(`${base}/api/graph`, { Host: `other:${new URL(base).port}` })).toBe(403);
  });

  it('rejects symlink escapes for existing reads and writes below an existing parent', async () => {
    if (process.platform === 'win32') return;
    const { base, root } = await fixture();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-project-outside-'));
    roots.push(outside);
    fs.writeFileSync(path.join(outside, 'secret.cascade'), '{"secret":true}');
    fs.symlinkSync(path.join(outside, 'secret.cascade'), path.join(root, 'escaped.cascade'));
    fs.mkdirSync(path.join(root, '.cascade-cache'));
    fs.symlinkSync(outside, path.join(root, '.cascade-cache', 'escaped'));

    const read = await fetch(`${base}/api/graph/escaped.cascade`);
    expect(read.status).toBe(400);
    expect(await read.text()).not.toContain('secret');

    const write = await fetch(`${base}/api/media/.cascade-cache/escaped/new.bin?exact=1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: 'outside write',
    });
    expect(write.status).toBe(400);
    expect(fs.existsSync(path.join(outside, 'new.bin'))).toBe(false);
  });
});
