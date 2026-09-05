import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function freshStageRuntime() {
  vi.resetModules();
  return import('../server/src/runtime/stage.js');
}

describe('cascade/stage host selection', () => {
  it('reports and uses an installed local bridge without fetching', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const stage = await freshStageRuntime();
    const dispose = stage.installStageBridge(async (name, args) => ({ name, args }));

    await expect(stage.stageAvailable()).resolves.toBe(true);
    await expect(stage.runStage('render', { frame: 4 })).resolves.toEqual({
      name: 'render',
      args: { frame: 4 },
    });
    expect(fetcher).not.toHaveBeenCalled();

    dispose();
  });

  it('reports unavailable in Node without attempting a relative fetch', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const stage = await freshStageRuntime();

    await expect(stage.stageAvailable()).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('treats a browser 404 as unavailable and propagates other discovery failures', async () => {
    vi.stubGlobal('document', {});
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    const stage = await freshStageRuntime();

    await expect(stage.stageAvailable()).resolves.toBe(false);
    await expect(stage.stageAvailable()).rejects.toThrow('unavailable (503)');
  });

  it('refreshes a stale capability once after a 403', async () => {
    vi.stubGlobal('document', {});
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ capability: 'stale' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'Exec capability required' }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ capability: 'fresh' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, stdout: '{"rendered":true}', stderr: '' }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const stage = await freshStageRuntime();

    await expect(stage.runStage('render')).resolves.toEqual({ rendered: true });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/exec/capability', { cache: 'no-store' });
    expect(fetcher).toHaveBeenNthCalledWith(4, '/api/exec', expect.objectContaining({
      headers: {
        'Content-Type': 'application/json',
        'X-Cascade-Exec-Capability': 'fresh',
      },
    }));
  });

  it('rejects a malformed successful response instead of inventing stage output', async () => {
    vi.stubGlobal('document', {});
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ capability: 'valid' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const stage = await freshStageRuntime();

    await expect(stage.runStage('render')).rejects.toThrow('returned an invalid response');
  });
});
