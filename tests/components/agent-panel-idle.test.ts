// @vitest-environment jsdom
/**
 * Studio's idle request budget, measured where it was spent.
 *
 * The Agent panel asked `/api/agent/status` once a second for as long as it was
 * mounted: 60 requests a minute from a Studio nobody was touching, and the
 * only polling Studio did (round 1 review, 2026-11-06). It now holds one
 * `/api/agent/watch` stream and reads the status the server pushes.
 *
 * The guard counts every fetch the panel makes over 20 s of fake time after
 * boot. The budget is the measured value after the change, 0. It may only go
 * down; a feature that needs idle traffic must say so here, not raise it.
 */
import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const IDLE_WINDOW_MS = 20_000;
const IDLE_REQUEST_BUDGET = 0;

const { registerStudioDocumentBridge } = await import('@/editor/studioDocumentBridge');
const AgentPanel = (await import('@/editor/panels/AgentPanel.svelte')).default;

type Session = { agent: string; sketch: string; running: boolean };

const encoder = new TextEncoder();
let requests: string[] = [];
let pushStatus: ((sessions: Session[]) => void) | null = null;
let disposeBridge: (() => void) | null = null;

function ndjson(lines: unknown[]): Response {
  return new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(''), {
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

function fakeServer(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  requests.push(url);
  if (url.startsWith('/api/agent/capability')) return Promise.resolve(Response.json({ capability: 'test' }));
  if (url.startsWith('/api/agent/status')) {
    return Promise.resolve(Response.json({
      ok: true,
      root: '/project',
      agents: [{ alias: 'claude', configured: true, resolved: true, hint: null }],
      sessions: [],
    }));
  }
  if (url.startsWith('/api/agent/attach')) {
    const body = JSON.parse(String(init?.body ?? '{}'));
    return Promise.resolve(ndjson([{ type: 'attached', agent: body.agent, sketch: body.sketch, running: false, sessionId: null, dropped: 0, replayed: 0, since: 0 }]));
  }
  if (url.startsWith('/api/agent/watch')) {
    // Held open like the real stream: the first status now, more on demand,
    // closed only when the panel aborts it.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (sessions: Session[]) => controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'status', sessions })}\n`));
        pushStatus = send;
        send([]);
        init?.signal?.addEventListener('abort', () => {
          try { controller.error(new DOMException('aborted', 'AbortError')); } catch { /* already closed */ }
        });
      },
    });
    return Promise.resolve(new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } }));
  }
  return Promise.resolve(new Response('not found', { status: 404 }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  requests = [];
  pushStatus = null;
  vi.stubGlobal('fetch', vi.fn(fakeServer));
  disposeBridge = registerStudioDocumentBridge({ file: () => 'sketch.cascade', isDirty: () => false, save: async () => true });
});

afterEach(() => {
  disposeBridge?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Agent panel idle traffic', () => {
  it(`makes at most ${IDLE_REQUEST_BUDGET} requests in ${IDLE_WINDOW_MS / 1000} s of idle after boot`, async () => {
    const view = render(AgentPanel, { props: { panelId: 'agent', panelParams: {} as never } });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(requests.some((url) => url.startsWith('/api/agent/watch'))).toBe(true);

    const before = requests.length;
    await vi.advanceTimersByTimeAsync(IDLE_WINDOW_MS);
    const idle = requests.slice(before);

    expect(idle, `idle requests: ${idle.join(', ')}`).toHaveLength(IDLE_REQUEST_BUDGET);
    view.unmount();
  });

  it('joins a run started elsewhere when the watch reports it, without asking', async () => {
    const view = render(AgentPanel, { props: { panelId: 'agent', panelParams: {} as never } });
    await vi.advanceTimersByTimeAsync(2_000);
    const attachesBefore = requests.filter((url) => url.startsWith('/api/agent/attach')).length;

    pushStatus?.([{ agent: 'claude', sketch: 'sketch.cascade', running: true }]);
    await vi.advanceTimersByTimeAsync(10);

    const attaches = requests.filter((url) => url.startsWith('/api/agent/attach')).length;
    expect(attaches).toBe(attachesBefore + 1);
    expect(requests.filter((url) => url.startsWith('/api/agent/status')).length).toBe(1);
    view.unmount();
  });
});
