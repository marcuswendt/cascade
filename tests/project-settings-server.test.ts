import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectRoot } from '../server/src/project.js';
import { CredentialStore } from '../server/src/credentials.js';
import { readProjectManifest, writeProjectManifest } from '../server/src/projectConfig.js';
import { authorizedProxyRequest } from '../server/src/routes/net.js';
import { compileProjectModule } from '../server/src/compile.js';
import type { Server } from 'node:http';
import { startServer } from '../server/src/index.js';

const roots: string[] = [];
const servers: Server[] = [];
let nextPort = 48_000 + (process.pid % 4_000);
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-project-settings-'));
  roots.push(root);
  return root;
}

describe('project manifest and credentials', () => {
  it('treats a missing manifest as normal and shares one manifest across graph files', () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'one.cascade'), '{}');
    fs.writeFileSync(path.join(root, 'two.cascade'), '{}');
    expect(readProjectManifest(root)).toMatchObject({ name: '', credentials: [], settings: {} });
    expect(fs.existsSync(path.join(root, 'cascade.json'))).toBe(false);
    writeProjectManifest(root, { name: 'Shared Project', commands: {}, credentials: ['service'], settings: { width: 1400 } });
    expect(readProjectManifest(root)).toMatchObject({ name: 'Shared Project', credentials: ['service'], settings: { width: 1400 } });
  });

  it('keeps credential values outside the project and exposes only presence plus environment injection', () => {
    const root = fixture();
    const file = path.join(fixture(), 'credentials.yaml');
    fs.writeFileSync(file, 'service:\n  api_key: "top-secret"\n  env: SERVICE_API_KEY\n  hosts: [api.example.test]\n  header: Authorization\n  scheme: Bearer\n');
    writeProjectManifest(root, { name: '', commands: {}, credentials: ['service'], settings: {} });
    const store = new CredentialStore(file);
    expect(store.has('service')).toBe(true);
    expect(store.environment(['service'])).toMatchObject({ SERVICE_API_KEY: 'top-secret' });
    expect(fs.readFileSync(path.join(root, 'cascade.json'), 'utf8')).not.toContain('top-secret');
  });

  it('reports missing credentials without returning values and creates cascade.json only on save', async () => {
    const root = fixture();
    const credentialRoot = fixture();
    const file = path.join(credentialRoot, 'credentials.yaml');
    fs.writeFileSync(file, 'configured:\n  api_key: "never-return-this"\n');
    const previous = process.env.CASCADE_CREDENTIALS;
    process.env.CASCADE_CREDENTIALS = file;
    try {
      const port = nextPort++;
      const server = startServer(new ProjectRoot(root), { port });
      servers.push(server);
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const base = `http://127.0.0.1:${port}`;
      const headers = { Origin: base, Host: `127.0.0.1:${port}` };
      const capabilityResponse = await fetch(`${base}/api/project/capability`, { headers });
      const { capability } = await capabilityResponse.json() as { capability: string };
      const protectedHeaders = { ...headers, 'X-Cascade-Project-Capability': capability };
      const initial = await fetch(`${base}/api/project`, { headers: protectedHeaders });
      expect(initial.status).toBe(200);
      expect(fs.existsSync(path.join(root, 'cascade.json'))).toBe(false);
      const saved = await fetch(`${base}/api/project`, { method: 'PUT', headers: { ...protectedHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Shared', commands: {}, credentials: ['configured', 'missing'], settings: { width: 1200 } }) });
      const text = await saved.text();
      expect(saved.status).toBe(200);
      expect(text).not.toContain('never-return-this');
      expect(JSON.parse(text)).toMatchObject({ missingCredentials: ['missing'], requiredCredentials: [{ name: 'configured', set: true }, { name: 'missing', set: false }] });
      expect(fs.existsSync(path.join(root, 'cascade.json'))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.CASCADE_CREDENTIALS;
      else process.env.CASCADE_CREDENTIALS = previous;
    }
  });

  it('injects declared credentials into allowlisted shell processes', async () => {
    const root = fixture();
    const credentialRoot = fixture();
    const file = path.join(credentialRoot, 'credentials.yaml');
    fs.writeFileSync(file, 'service:\n  api_key: "server-secret"\n  env: SERVICE_API_KEY\n');
    const previous = process.env.CASCADE_CREDENTIALS;
    process.env.CASCADE_CREDENTIALS = file;
    try {
      const project = new ProjectRoot(root);
      writeProjectManifest(root, { name: '', commands: { node: process.execPath }, credentials: ['service'], settings: {} });
      const result = await project.shell.run('node', ['-e', 'process.stdout.write(process.env.SERVICE_API_KEY || "missing")']);
      expect(result.stdout).toBe('server-secret');
    } finally {
      if (previous === undefined) delete process.env.CASCADE_CREDENTIALS;
      else process.env.CASCADE_CREDENTIALS = previous;
    }
  });

  it('rejects secret-shaped settings keys', () => {
    const root = fixture();
    expect(() => writeProjectManifest(root, { name: '', commands: {}, credentials: [], settings: { apiKey: 'nope' } }))
      .toThrow(/credentials belong outside/);
  });

  it('constrains authorized proxy credentials to declared hosts and never returns the secret', async () => {
    const root = fixture();
    const credentialRoot = fixture();
    const file = path.join(credentialRoot, 'credentials.yaml');
    fs.writeFileSync(file, 'service:\n  api_key: "top-secret"\n  hosts: [api.example.test]\n  header: Authorization\n  scheme: Bearer\n');
    writeProjectManifest(root, { name: '', commands: {}, credentials: ['service'], settings: {} });
    const fetcher = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer top-secret');
      return new Response('{"answer":42}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const result = await authorizedProxyRequest(new ProjectRoot(root), new CredentialStore(file), {
      credential: 'service', url: 'https://api.example.test/v1', method: 'POST', headers: { Authorization: 'attacker' }, body: '{}',
    }, fetcher);
    expect(result).toMatchObject({ status: 200, body: '{"answer":42}' });
    expect(JSON.stringify(result)).not.toContain('top-secret');
    await expect(authorizedProxyRequest(new ProjectRoot(root), new CredentialStore(file), {
      credential: 'service', url: 'https://evil.example/v1',
    }, fetcher)).rejects.toThrow(/not authorized/);
  });

  it('compiles cascade/config as an immutable typed settings reader', async () => {
    const root = fixture();
    fs.mkdirSync(path.join(root, 'nodes', 'configured'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify({ settings: { width: 1400, mode: 'print' } }));
    fs.writeFileSync(path.join(root, 'nodes', 'configured', 'index.ts'), `
      import { config } from 'cascade/config';
      import { authorizedFetch } from 'cascade/net';
      export const width = config.number('width', 1);
      export const mode = config.string('mode', 'screen');
      export const request = () => authorizedFetch('service', 'https://api.example.test/v1');
      export function execute() {}
    `);
    const result = await compileProjectModule(new ProjectRoot(root), 'configured');
    expect(result.ok).toBe(true);
    expect(result.code).toContain('1400');
    expect(result.code).toContain('Object.freeze');
    expect(result.code).toContain('/api/net');
  });
});
