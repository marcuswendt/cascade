import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bindWithFallback, isHostUnavailable } from '../server/src/hostBinding.js';
import { startServer } from '../server/src/index.js';
import { ProjectRoot } from '../server/src/project.js';

// A name that can never resolve (RFC 2606) and an address on no interface (RFC 5737).
const UNRESOLVABLE = 'cascade-studio-test.invalid';
const UNAVAILABLE = '192.0.2.1';

const closers: (() => void)[] = [];
afterEach(() => { for (const close of closers.splice(0)) close(); });

let nextPort = 46_000 + (process.pid % 500) * 2;
const port = () => nextPort++;

function server() {
  const instance = http.createServer((_req, res) => res.end('ok'));
  closers.push(() => { instance.closeAllConnections(); instance.close(); });
  return instance;
}

const get = (host: string, at: number) => new Promise<string>((resolve, reject) => {
  http.get({ host, port: at, path: '/', agent: false }, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => resolve(body));
  }).once('error', reject);
});

describe('host binding with fallback', () => {
  it('falls back to 127.0.0.1 when the host name does not resolve', async () => {
    const at = port();
    const logs: string[] = [];
    const binding = bindWithFallback(server(), { port: at, preferredHost: UNRESOLVABLE, retryMs: 60_000, log: (line) => logs.push(line) });
    closers.push(() => binding.stop());
    const state = await binding.ready;
    expect(state).toMatchObject({ host: '127.0.0.1', port: at, preferredHost: UNRESOLVABLE, fallback: true });
    expect(state.reason).toMatch(/ENOTFOUND|EAI_AGAIN|EAI_NONAME/);
    expect(logs.join('\n')).toContain(`host ${UNRESOLVABLE} is unavailable`);
    expect(await get('127.0.0.1', at)).toBe('ok');
  });

  it('falls back when the address is not on this machine (EADDRNOTAVAIL)', async () => {
    const at = port();
    const binding = bindWithFallback(server(), { port: at, preferredHost: UNAVAILABLE, retryMs: 60_000, log: () => {} });
    closers.push(() => binding.stop());
    const state = await binding.ready;
    expect(state).toMatchObject({ host: '127.0.0.1', fallback: true, reason: `EADDRNOTAVAIL ${UNAVAILABLE}:${at}` });
  });

  it('uses a configured fallback list in order', async () => {
    const at = port();
    const binding = bindWithFallback(server(), { port: at, preferredHost: UNAVAILABLE, fallbackHosts: ['192.0.2.2', '127.0.0.1'], retryMs: 60_000, log: () => {} });
    closers.push(() => binding.stop());
    expect((await binding.ready).host).toBe('127.0.0.1');
  });

  it('does not hide a port that is already in use', async () => {
    const at = port();
    const blocker = net.createServer().listen(at, '127.0.0.1');
    await new Promise((resolve) => blocker.once('listening', resolve));
    closers.push(() => blocker.close());
    const binding = bindWithFallback(server(), { port: at, preferredHost: '127.0.0.1', log: () => {} });
    await expect(binding.ready).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(isHostUnavailable({ code: 'EADDRINUSE' })).toBe(false);
  });

  it('rebinds the preferred host when it comes back', async () => {
    const at = port();
    // Simulate a MagicDNS name: unresolvable while "Tailscale" is down, then
    // resolving to an address of this machine (::1, distinct from the fallback).
    let tailscaleUp = false;
    const resolveHost = (host: string) => {
      if (host !== 'kuro-test') return host;
      if (!tailscaleUp) throw Object.assign(new Error('getaddrinfo ENOTFOUND kuro-test'), { code: 'ENOTFOUND' });
      return '::1';
    };
    const changes: (string | null)[] = [];
    const instance = server();
    const binding = bindWithFallback(instance, {
      port: at, preferredHost: 'kuro-test', retryMs: 50, log: () => {}, resolveHost,
      onChange: (state) => changes.push(state.host),
    });
    closers.push(() => binding.stop());
    expect((await binding.ready).fallback).toBe(true);
    expect(await get('127.0.0.1', at)).toBe('ok');

    tailscaleUp = true;
    await expect.poll(() => binding.state().fallback, { timeout: 3_000 }).toBe(false);
    expect(binding.state()).toMatchObject({ host: 'kuro-test', fallback: false, reason: null });
    expect(await get('::1', at)).toBe('ok');
    await expect(get('127.0.0.1', at)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    expect(changes).toEqual(['127.0.0.1', 'kuro-test']);
  });
});

describe('Studio on an unavailable host', () => {
  it('starts on loopback instead of crashing, and answers a local browser', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-host-fallback-'));
    const at = port();
    const studio = startServer(new ProjectRoot(root), { host: UNRESOLVABLE, port: at, trustedHosts: [UNRESOLVABLE], hostRetryMs: 60_000 });
    closers.push(() => { studio.binding.stop(); studio.closeAllConnections(); studio.close(); fs.rmSync(root, { recursive: true, force: true }); });
    const state = await studio.binding.ready;
    expect(state).toMatchObject({ host: '127.0.0.1', fallback: true });

    const response = await fetch(`http://127.0.0.1:${at}/api/graph`, { headers: { Origin: `http://127.0.0.1:${at}` } });
    expect(response.status).toBe(200);
  });
});
