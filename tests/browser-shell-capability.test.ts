/**
 * `cascade/shell` in Studio.
 *
 * The gap, reported by Marcus on 2026-09-09 from a live `cloud-volumes` graph:
 * *"Error executing node source: project.series-source requires the Studio
 * shell capability."* The server has had an allowlist-gated `/api/shell` for a
 * while and Studio never wired it as a node capability — so a definition
 * declaring `capabilities: ['shell']` ran headlessly through `cascade run` and
 * threw in Studio. A node marked `runsOn: 'portable'` that only runs in one
 * host is the thing `runsOn` exists to prevent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  browserShellCapability,
  forgetShellCapability,
  shellRouteAvailable,
} from '@/nodes/definition/browserShellCapability';

const original = globalThis.fetch;

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** The route's own two-step: `/capability` issues a token, then the POST
 *  carries it in a header. */
function server(options: {
  capability?: number;
  post?: (body: any, headers: Record<string, string>) => Response;
} = {}) {
  const calls: Array<{ url: string; body?: any; headers: Record<string, string> }> = [];
  let issued = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body, headers });
    if (url.endsWith('/capability')) {
      const status = options.capability ?? 200;
      issued += 1;
      return response(status, status === 200 ? { capability: `token-${issued}` } : {});
    }
    return options.post?.(body, headers)
      ?? response(200, { ok: true, stdout: '', stderr: '', code: 0, timedOut: false, cancelled: false, outputLimited: false });
  });
  globalThis.fetch = fetchMock as never;
  return { calls, fetchMock };
}

describe('the Studio shell capability', () => {
  // The issued capability is module state — one handshake per page is the
  // point of it — so each test starts without one.
  beforeEach(() => { vi.restoreAllMocks(); forgetShellCapability(); });
  afterEach(() => { globalThis.fetch = original; });

  it('runs a command through the route, carrying the issued capability', async () => {
    const { calls } = server({
      post: () => response(200, {
        ok: true, stdout: 'hello\n', stderr: '', code: 0,
        timedOut: false, cancelled: false, outputLimited: false,
      }),
    });

    const result = await browserShellCapability.run('echo', ['hello']);
    expect(result.stdout).toBe('hello\n');
    expect(result.code).toBe(0);
    // `ok` is the envelope's and must not leak into the result a node reads.
    expect((result as any).ok).toBeUndefined();

    const post = calls.find(call => !call.url.endsWith('/capability'))!;
    expect(post.body).toEqual({ command: 'echo', args: ['hello'] });
    expect(post.headers['X-Cascade-Shell-Capability']).toMatch(/^token-/);
  });

  /** A server restart issues a new capability. Exactly one retry: a 403 that
   *  survives a fresh token is the allowlist refusing, and retrying that
   *  forever turns a clear error into a hang. */
  it('re-handshakes once on a 403 and then reports', async () => {
    let posts = 0;
    const { calls } = server({
      post: () => {
        posts += 1;
        return posts === 1
          ? response(403, { ok: false, error: 'stale capability' })
          : response(200, { ok: true, stdout: 'ok', stderr: '', code: 0, timedOut: false, cancelled: false, outputLimited: false });
      },
    });

    expect((await browserShellCapability.run('echo')).stdout).toBe('ok');
    expect(calls.filter(call => call.url.endsWith('/capability'))).toHaveLength(2);
  });

  it('stops after one retry when the allowlist is the reason', async () => {
    const { calls } = server({
      post: () => response(403, { ok: false, error: 'Command not allowed: rm', code: 'COMMAND_NOT_ALLOWED' }),
    });

    // The message points at the fix rather than at the status code — the
    // Allowed Commands editor is where a person resolves this.
    await expect(browserShellCapability.run('rm')).rejects.toThrow(/Allowed Commands in Project Settings/);
    expect(calls.filter(call => !call.url.endsWith('/capability'))).toHaveLength(2);
  });

  it('names the disabled route rather than the status', async () => {
    server({ capability: 404 });
    await expect(browserShellCapability.run('echo')).rejects.toThrow(/disabled on this server/);
  });

  /** A `CascadeAbortSignal` is not a DOM `AbortSignal` — it carries `aborted`
   *  and two listener methods and nothing else, on purpose, so the contract has
   *  no browser global in it. It must not reach `JSON.stringify`. */
  it('bridges the abort signal instead of serialising it', async () => {
    const { calls } = server();
    const listeners: Array<() => void> = [];
    await browserShellCapability.run('echo', [], {
      timeout: 500,
      signal: {
        aborted: false,
        addEventListener: (_type: 'abort', listener: () => void) => listeners.push(listener),
        removeEventListener: () => {},
      } as never,
    });

    const post = calls.find(call => !call.url.endsWith('/capability'))!;
    expect(post.body.options).toEqual({ timeout: 500 });
    expect(post.body.options.signal).toBeUndefined();
    // Bridged, so aborting the Cascade signal has somewhere to go.
    expect(listeners).toHaveLength(1);
  });

  it('reports a non-JSON stdout as its own fault, not as a shell failure', async () => {
    server({
      post: () => response(200, {
        ok: true, stdout: 'not json', stderr: '', code: 0,
        timedOut: false, cancelled: false, outputLimited: false,
      }),
    });
    await expect(browserShellCapability.runJson('thing')).rejects.toThrow(/did not print JSON/);
  });

  it('parses JSON output', async () => {
    server({
      post: () => response(200, {
        ok: true, stdout: '{"moments":3}', stderr: '', code: 0,
        timedOut: false, cancelled: false, outputLimited: false,
      }),
    });
    expect(await browserShellCapability.runJson('moments')).toEqual({ moments: 3 });
  });
});

describe('the route probe', () => {
  beforeEach(() => { forgetShellCapability(); });
  afterEach(() => { globalThis.fetch = original; });

  it('reports available when the route issues a capability', async () => {
    server();
    expect(await shellRouteAvailable()).toBe(true);
  });

  /** Absent rather than stubbed: the capability is withdrawn from Studio's map
   *  so the preflight can say `runtime/missing-capability` before a cook. */
  it('reports unavailable on a 404', async () => {
    server({ capability: 404 });
    expect(await shellRouteAvailable()).toBe(false);
  });

  it('reports unavailable rather than throwing when there is no server', async () => {
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as never;
    expect(await shellRouteAvailable()).toBe(false);
  });

  /** A token issued before a restart is a claim about a route that may be gone,
   *  so a failed probe drops it — otherwise the next `run` fails at the POST
   *  rather than at the gate, which is a worse-shaped error for the same fault. */
  it('drops a capability it already holds when the route goes away', async () => {
    server();
    expect(await shellRouteAvailable()).toBe(true);

    server({ capability: 404 });
    expect(await shellRouteAvailable()).toBe(false);

    const { calls } = server({ capability: 404 });
    await expect(browserShellCapability.run('echo')).rejects.toThrow(/disabled on this server/);
    // It asked again rather than reusing the token from the first probe.
    expect(calls.some(call => call.url.endsWith('/capability'))).toBe(true);
  });
});
