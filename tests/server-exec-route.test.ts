import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http, { type Server } from 'node:http';
import { ProjectRoot } from '../server/src/project.js';
import { startServer } from '../server/src/index.js';
import { runProjectStage } from '../server/src/stageRunner.js';

const roots: string[] = [];
const servers: Server[] = [];
let nextPort = 40_000 + (process.pid % 8_000);

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-exec-route-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'bridge'));
  fs.writeFileSync(path.join(root, 'bridge', 'stages.py'), [
    'import argparse, json',
    'parser = argparse.ArgumentParser()',
    "parser.add_argument('--stage', required=True)",
    "parser.add_argument('--args', required=True)",
    'args = parser.parse_args()',
    "payload = json.load(__import__('sys').stdin) if args.args == '-' else json.loads(args.args)",
    "if args.stage == 'fail': print(json.dumps({'error': 'visible failure'})); raise SystemExit(1)",
    "print(json.dumps({'stage': args.stage, 'args': payload, 'transport': 'stdin' if args.args == '-' else 'argv'}))",
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify({
    exec: { stages: { entrypoint: 'bridge/stages.py' } },
  }));
  const port = nextPort++;
  const project = new ProjectRoot(root);
  const server = startServer(project, { port });
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Origin: base, Host: `127.0.0.1:${address.port}` };
  return { base, headers, project };
}

async function capability(base: string, headers: Record<string, string>) {
  const response = await fetch(`${base}/api/exec/capability`, { headers });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  return (await response.json() as { capability: string }).capability;
}

function rawStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => { res.resume(); res.once('end', () => resolve(res.statusCode ?? 0)); });
    req.once('error', reject);
  });
}

describe('/api/exec security and project boundary', () => {
  it('allows origin-less same-host capability discovery but rejects hostile origins and forged hosts', async () => {
    const { base, headers } = await fixture();
    expect((await fetch(`${base}/api/exec/capability`, { headers: { ...headers, Origin: 'https://evil.test' } })).status).toBe(403);
    const sameHost = await fetch(`${base}/api/exec/capability`, { headers: { Host: headers.Host } });
    expect(sameHost.status).toBe(200);
    await expect(sameHost.json()).resolves.toMatchObject({ capability: expect.any(String) });
    expect(await rawStatus(`${base}/api/exec/capability`, { ...headers, Host: 'evil.test' })).toBe(403);
  });

  it('requires a capability and resolves named stages from cascade.json', async () => {
    const { base, headers } = await fixture();
    const noToken = await fetch(`${base}/api/exec`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(noToken.status).toBe(403);

    const token = await capability(base, headers);
    const response = await fetch(`${base}/api/exec`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'X-Cascade-Exec-Capability': token },
      body: JSON.stringify({ stage: 'moments.list', args: { limit: 3 } }),
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as { ok: boolean; stdout: string };
    expect(payload.ok).toBe(true);
    expect(JSON.parse(payload.stdout)).toEqual({ stage: 'moments.list', args: { limit: 3 }, transport: 'stdin' });
  });

  it('passes large stage payloads over stdin in browser and headless hosts', async () => {
    const { base, headers, project } = await fixture();
    const payload = 'x'.repeat(512 * 1024);
    await expect(runProjectStage(project, 'large', { payload })).resolves.toEqual({
      stage: 'large',
      args: { payload },
      transport: 'stdin',
    });

    const token = await capability(base, headers);
    const response = await fetch(`${base}/api/exec`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'X-Cascade-Exec-Capability': token },
      body: JSON.stringify({ stage: 'large', args: { payload } }),
    });
    expect(response.status).toBe(200);
    const result = await response.json() as { stdout: string };
    expect(JSON.parse(result.stdout)).toEqual({ stage: 'large', args: { payload }, transport: 'stdin' });
  });

  it('surfaces dispatcher errors written to stdout', async () => {
    const { project } = await fixture();
    await expect(runProjectStage(project, 'fail', {})).rejects.toThrow('visible failure');
  });

  it('rejects malformed requests and project paths outside the root', async () => {
    const { base, headers } = await fixture();
    const token = await capability(base, headers);
    const execHeaders = { ...headers, 'Content-Type': 'application/json', 'X-Cascade-Exec-Capability': token };
    const malformed = await fetch(`${base}/api/exec`, {
      method: 'POST', headers: execHeaders, body: JSON.stringify({ stage: '../escape', args: [] }),
    });
    expect(malformed.status).toBe(400);
    const escaped = await fetch(`${base}/api/exec`, {
      method: 'POST', headers: execHeaders, body: JSON.stringify({ entrypoint: '../outside.py' }),
    });
    expect(escaped.status).toBe(400);
  });

  it('bounds the exec request body independently from broad project parsing', async () => {
    const { base, headers } = await fixture();
    const token = await capability(base, headers);
    const response = await fetch(`${base}/api/exec`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'X-Cascade-Exec-Capability': token },
      body: JSON.stringify({ stage: 'oversized', args: { payload: 'x'.repeat(65 * 1024 * 1024) } }),
    });
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ ok: false, type: 'entity.too.large' });
  });

  it('does not expose browser exec endpoints on a remote-bound server', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-exec-remote-'));
    roots.push(root);
    const port = nextPort++;
    const server = startServer(new ProjectRoot(root), { port, host: '0.0.0.0' });
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${port}/api/exec/capability`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    expect(response.status).toBe(404);
  });
});
