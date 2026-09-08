import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http, { type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ProjectRoot } from '../server/src/project.js';
import { startServer } from '../server/src/index.js';
import { allowedAuthorities } from '../server/src/security.js';

const roots: string[] = [];
const servers: Server[] = [];
// Ask the OS for a free port and then bind it explicitly. The server bakes its
// configured port into the allowed Host authorities, so binding port 0 and
// reading the real port back makes every request fail the Host check. A
// computed base port is not an option either: two test files sharing a worker
// process both counted from it and the run died with EADDRINUSE, while a
// re-run of the file alone passed.
async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('missing probe address');
  const port = address.port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function fixture(): Promise<{ base: string; root: string; host: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-project-security-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'index.cascade'), '{}');
  const server = startServer(new ProjectRoot(root), { port: await freePort() });
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
  const port = await freePort();
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

  it('keeps serving the host it is bound to when a trusted host is added', () => {
    /**
     * The regression that took Marcus's Studios out on 2026-09-08.
     *
     * They run as `--host KURO --trusted-host kuro.hydra-diatonic.ts.net`, and
     * naming a trusted host used to *replace* the bind host in the allowlist
     * rather than add to it. So `http://kuro:3030` answered **403 on every API
     * call while still serving the page** — which reads as a broken app rather
     * than a host rule, and cost an evening to attribute. Nobody adds a
     * trusted host meaning "and stop trusting the one I am serving on".
     *
     * Checked against the rule rather than through a socket: binding to a real
     * hostname is not portable in a test, and this is a question about the
     * allowlist, not about listening.
     */
    const authorities = allowedAuthorities(
      { host: 'KURO', port: 3030, trustedHosts: ['kuro.hydra-diatonic.ts.net'] } as never,
      new Set<string>(),
    );

    expect([...authorities].sort()).toEqual([
      'kuro.hydra-diatonic.ts.net:3030',
      'kuro:3030',
    ]);
  });

  it('starts with a trusted host that carries a port', async () => {
    /**
     * The call site I missed. `allowedAuthorities` was updated and
     * `startServer`'s own origin construction was not, so a trusted host with
     * a port threw **before the server bound**:
     * `Invalid trusted host: kuro.hydra-diatonic.ts.net:8444`.
     *
     * `authority()` refuses a colon outside IPv6, which is right for its
     * contract — it takes host and port separately. `trustedAuthority` is the
     * one that parses `name:port`. Two consumers of one rule, one updated,
     * which is the shape of half of today.
     *
     * The unit test above covers the rule; this covers the server actually
     * starting, which is what a user hits first.
     */
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-proxy-boot-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'index.cascade'), '{}');
    const port = await freePort();
    const server = startServer(new ProjectRoot(root), {
      port,
      host: '127.0.0.1',
      trustedHosts: ['kuro.hydra-diatonic.ts.net:8444'],
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));

    const base = `http://127.0.0.1:${port}`;
    // The proxy's authority is accepted even though the bind port differs.
    expect(await rawStatus(`${base}/api/graph`, { Host: `kuro.hydra-diatonic.ts.net:8444` })).toBe(200);
    // And loopback still works, so a local browser is not locked out.
    expect(await rawStatus(`${base}/api/graph`, { Host: `127.0.0.1:${port}` })).toBe(200);
  });

  it('accepts a browser Origin over https through a proxy', async () => {
    /**
     * The defect that would have met Marcus within minutes of using the new
     * HTTPS URLs. `defaultOrigins` was built `http://` only, so behind a TLS
     * proxy a browser sending `Origin: https://name:port` passed the Host
     * check and was **refused by the Origin check** — 403 on every POST and
     * PUT, while GETs without an Origin header sailed through. A Studio that
     * loads, renders, and silently cannot save.
     *
     * Measured before fixing: `httpsOrigin: 403`, `httpOrigin: 200` on the
     * same server. Curl proved nothing here because curl sends no Origin,
     * which is exactly why the proxy verification came back green.
     */
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-https-origin-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'index.cascade'), '{}');
    const port = await freePort();
    const server = startServer(new ProjectRoot(root), {
      port, host: '127.0.0.1', trustedHosts: ['kuro.hydra-diatonic.ts.net:8445'],
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${port}`;
    const proxied = 'kuro.hydra-diatonic.ts.net:8445';

    expect(await rawStatus(`${base}/api/graph`, { Host: proxied, Origin: `https://${proxied}` })).toBe(200);
    expect(await rawStatus(`${base}/api/graph`, { Host: proxied, Origin: `http://${proxied}` })).toBe(200);
    // Still refused: an origin nobody declared, and the null origin.
    expect(await rawStatus(`${base}/api/graph`, { Host: proxied, Origin: 'https://elsewhere:8445' })).toBe(403);
    expect(await rawStatus(`${base}/api/graph`, { Host: proxied, Origin: 'null' })).toBe(403);
  });

  it('matches a default-port trusted host against the bare name a browser sends', () => {
    // A browser omits 443 from `Host` on an https URL, so `name:443` could
    // never match — and 443 is the first port anybody reaches for, because it
    // gives the tidiest URL. Putting a sketch there answered 403 on every
    // call, which looks exactly like the host bug fixed earlier tonight.
    const authorities = allowedAuthorities(
      { host: '127.0.0.1', port: 3030, trustedHosts: ['kuro.hydra-diatonic.ts.net:443'] } as never,
      new Set<string>(),
    );

    expect(authorities.has('kuro.hydra-diatonic.ts.net')).toBe(true);
    expect(authorities.has('kuro.hydra-diatonic.ts.net:443')).toBe(true);
  });

  it('honours a port written into a trusted host, which is the proxy case', () => {
    /**
     * Behind a reverse proxy the public port is not the bind port. Measured
     * with `tailscale serve` on 2026-09-08: a request to
     * `https://kuro.hydra-diatonic.ts.net:8444` reaches a loopback backend with
     * `Host: kuro.hydra-diatonic.ts.net:8444` **verbatim, port included**, and
     * `remoteAddress: 127.0.0.1`.
     *
     * So an allowlist built from the bind port would still 403 and the fix
     * would look like it had not worked. This is the case nothing exercised.
     */
    const authorities = allowedAuthorities(
      { host: '127.0.0.1', port: 3030, trustedHosts: ['kuro.hydra-diatonic.ts.net:8444'] } as never,
      new Set<string>(),
    );

    expect(authorities.has('kuro.hydra-diatonic.ts.net:8444')).toBe(true);
    // Loopback stays reachable, so a local browser and the proxy both work.
    expect(authorities.has('127.0.0.1:3030')).toBe(true);
    expect(authorities.has('localhost:3030')).toBe(true);
    // And the bind port is not silently attached to the trusted name.
    expect(authorities.has('kuro.hydra-diatonic.ts.net:3030')).toBe(false);
  });

  it('falls back to the server port when a trusted host names none', () => {
    const authorities = allowedAuthorities(
      { host: 'kuro', port: 3030, trustedHosts: ['kuro.hydra-diatonic.ts.net'] } as never,
      new Set<string>(),
    );

    expect([...authorities].sort()).toEqual(['kuro.hydra-diatonic.ts.net:3030', 'kuro:3030']);
  });

  it('never admits a wildcard bind address as a hostname', () => {
    // `0.0.0.0` means every interface, not a name a browser sends — so it must
    // not become an allowed `Host`, which is what the case below already
    // asserts end to end.
    const authorities = allowedAuthorities(
      { host: '0.0.0.0', port: 4000, trustedHosts: ['kuro'] } as never,
      new Set<string>(),
    );

    expect([...authorities]).toEqual(['kuro:4000']);
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

  it('serves media from the project shared link without allowing other symlink escapes', async () => {
    if (process.platform === 'win32') return;
    const { base, root } = await fixture();
    const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-project-shared-'));
    roots.push(shared);
    fs.mkdirSync(path.join(shared, 'cache'));
    fs.writeFileSync(path.join(shared, 'cache', 'preview.txt'), 'shared media');
    fs.symlinkSync(shared, path.join(root, 'shared'));

    const response = await fetch(`${base}/api/media/shared/cache/preview.txt?raw=1`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('shared media');
  });

  it('applies EXIF orientation before resizing raster previews', async () => {
    const { base, root } = await fixture();
    await sharp({
      create: { width: 40, height: 20, channels: 3, background: '#ff0000' },
    }).withMetadata({ orientation: 6 }).jpeg().toFile(path.join(root, 'rotated.jpg'));

    const response = await fetch(`${base}/api/media/rotated.jpg?w=20&fmt=png`);
    expect(response.status).toBe(200);
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    expect([metadata.width, metadata.height]).toEqual([20, 40]);
  });
});
