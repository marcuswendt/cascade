import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import http from 'node:http';
import { ProjectRoot } from '../server/src/project.js';
import { startServer } from '../server/src/index.js';

const roots: string[] = [];
const servers: Server[] = [];
let nextPort = 32_000 + (process.pid % 8_000);
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-shell-route-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify({ commands: { node: process.execPath } }));
  const project = new ProjectRoot(root);
  const port = nextPort++;
  const server = startServer(project, { port, wsPort: false });
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  const base = `http://127.0.0.1:${address.port}`;
  const origin = base;
  const headers = { Origin: origin, Host: `127.0.0.1:${address.port}` };
  return { base, headers, project };
}

function rawStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => { res.resume(); res.once('end', () => resolve(res.statusCode ?? 0)); });
    req.once('error', reject);
  });
}

describe('/api/shell security boundary', () => {
  it('does not disclose capabilities to hostile origins or forged hosts', async () => {
    const { base, headers } = await fixture();
    expect((await fetch(`${base}/api/shell/capability`, { headers: { ...headers, Origin: 'https://evil.test' } })).status).toBe(403);
    expect(await rawStatus(`${base}/api/shell/capability`, { ...headers, Host: 'evil.test' })).toBe(403);
    expect((await fetch(`${base}/api/shell/capability`, { headers: { Host: headers.Host } })).status).toBe(403);
  });

  it('requires a token, applies no-store headers, and runs allowlisted commands', async () => {
    const { base, headers } = await fixture();
    const capabilityResponse = await fetch(`${base}/api/shell/capability`, { headers });
    expect(capabilityResponse.status).toBe(200);
    expect(capabilityResponse.headers.get('cache-control')).toContain('no-store');
    const { capability } = await capabilityResponse.json() as { capability: string };
    const noToken = await fetch(`${base}/api/shell`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
    expect(noToken.status).toBe(403);
    const response = await fetch(`${base}/api/shell`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'X-Cascade-Shell-Capability': capability },
      body: JSON.stringify({ command: 'node', args: ['-e', 'process.stdout.write("ok")'] }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, stdout: 'ok', code: 0 });
  });

  it('preserves typed nonzero and timeout results and rejects malformed input', async () => {
    const { base, headers } = await fixture();
    const { capability } = await (await fetch(`${base}/api/shell/capability`, { headers })).json() as { capability: string };
    const shellHeaders = { ...headers, 'Content-Type': 'application/json', 'X-Cascade-Shell-Capability': capability };
    const malformed = await fetch(`${base}/api/shell`, { method: 'POST', headers: shellHeaders, body: JSON.stringify({ command: 'node', args: 'bad' }) });
    expect(malformed.status).toBe(400);
    const nonzero = await fetch(`${base}/api/shell`, { method: 'POST', headers: shellHeaders,
      body: JSON.stringify({ command: 'node', args: ['-e', 'process.stderr.write("bad");process.exit(9)'] }) });
    expect(nonzero.status).toBe(500);
    await expect(nonzero.json()).resolves.toMatchObject({ kind: 'nonzero', code: 9, stderr: 'bad' });
    const timeout = await fetch(`${base}/api/shell`, { method: 'POST', headers: shellHeaders,
      body: JSON.stringify({ command: 'node', args: ['-e', 'setInterval(()=>{},1000)'], timeout: 10 }) });
    expect(timeout.status).toBe(500);
    await expect(timeout.json()).resolves.toMatchObject({ kind: 'timeout', timedOut: true, code: null });
  });

  it('does not expose browser shell endpoints on a remote-bound server', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-shell-remote-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify({ commands: { node: process.execPath } }));
    const port = nextPort++;
    const server = startServer(new ProjectRoot(root), { port, wsPort: false, host: '0.0.0.0' });
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${port}/api/shell/capability`, { headers: { Origin: `http://127.0.0.1:${port}` } });
    expect(response.status).toBe(404);
  });
});
