// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushWorkspace,
  layoutCacheKey,
  LEGACY_LAYOUT_KEY,
  persistWorkspace,
  prepareWorkspace,
  setWorkspaceScope,
  takeRestoredWorkspace,
} from '@/editor/dockview/workspacePersistence';

/**
 * Marcus, 2026-10-10: "when reloading the studio, they tend to disappear and
 * reset". One localStorage key served every project on the same host:port, and
 * nothing reached another host alias or browser.
 */
const layoutA = { grid: { root: 'A' }, panels: {} } as any;
const layoutB = { grid: { root: 'B' }, panels: {} } as any;

function server(saved: unknown, root = '/projects/a') {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === '/api/graph') return new Response(JSON.stringify({ root, default: 'art.cascade' }));
    if (url.startsWith('/api/graph/art.cascade/workspace') && !init?.method) {
      return saved ? new Response(JSON.stringify(saved)) : new Response('{}', { status: 404 });
    }
    return new Response('{"ok":true}');
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

beforeEach(() => { localStorage.clear(); setWorkspaceScope(null); takeRestoredWorkspace(); });
afterEach(() => vi.useRealTimers());

describe('studio workspace persistence', () => {
  it('restores the server copy for this project, and caches per project rather than in one key', async () => {
    const saved = { version: 1, layout: layoutA, savedAt: '2026-10-10T10:00:00.000Z' };
    const { fetcher } = server(saved);
    expect(await prepareWorkspace(fetcher)).toEqual(saved);
    expect(takeRestoredWorkspace()).toEqual(saved);
    expect(takeRestoredWorkspace()).toBeNull();
    expect(layoutCacheKey()).toBe(`${LEGACY_LAYOUT_KEY}:/projects/a/art.cascade`);
    expect(layoutCacheKey({ root: '/projects/b', graph: 'art.cascade' })).not.toBe(layoutCacheKey());
  });

  it('prefers a newer browser cache over an older server file', async () => {
    const { fetcher } = server({ version: 1, layout: layoutA, savedAt: '2026-10-10T10:00:00.000Z' });
    localStorage.setItem(`${LEGACY_LAYOUT_KEY}:/projects/a/art.cascade`,
      JSON.stringify({ version: 1, layout: layoutB, savedAt: '2026-10-10T11:00:00.000Z' }));
    expect((await prepareWorkspace(fetcher))?.layout).toEqual(layoutB);
  });

  it('migrates the old single key once, when the project has nothing of its own', async () => {
    const { fetcher } = server(null);
    localStorage.setItem(LEGACY_LAYOUT_KEY, JSON.stringify(layoutB));
    expect((await prepareWorkspace(fetcher))?.layout).toEqual(layoutB);
  });

  it('saves on change: cache at once, one debounced PUT to the sidecar', async () => {
    vi.useFakeTimers();
    const { fetcher, calls } = server(null);
    await prepareWorkspace(fetcher);
    persistWorkspace(layoutA, undefined, fetcher);
    persistWorkspace(layoutB, undefined, fetcher);
    expect(JSON.parse(localStorage.getItem(layoutCacheKey())!).layout).toEqual(layoutB);
    expect(calls.filter((call) => call.init?.method === 'PUT')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(500);
    const puts = calls.filter((call) => call.init?.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe('/api/graph/art.cascade/workspace');
    expect(JSON.parse(String(puts[0].init!.body)).layout).toEqual(layoutB);
    await flushWorkspace(fetcher);
    expect(calls.filter((call) => call.init?.method === 'PUT')).toHaveLength(1);
  });

  it('without a server keeps the legacy key, so a plain build still works', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
    await prepareWorkspace(fetcher);
    persistWorkspace(layoutA, undefined, fetcher);
    expect(layoutCacheKey()).toBe(LEGACY_LAYOUT_KEY);
    expect(JSON.parse(localStorage.getItem(LEGACY_LAYOUT_KEY)!).layout).toEqual(layoutA);
  });
});
