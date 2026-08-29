import { afterEach, describe, expect, it, vi } from 'vitest';
import { run, runJson, ShellProcessError } from '../server/src/runtime/shell.js';

afterEach(() => vi.unstubAllGlobals());

describe('cascade/shell browser facade', () => {
  it('retries capability discovery after a transient failure', async () => {
    vi.resetModules();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ capability: 'fresh' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, stdout: 'ok', stderr: '', code: 0, timedOut: false, cancelled: false, outputLimited: false }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const fresh = await import('../server/src/runtime/shell.js');

    await expect(fresh.run('tool')).rejects.toThrow('capability is unavailable');
    await expect(fresh.run('tool')).resolves.toMatchObject({ stdout: 'ok' });
  });

  it('resolves nonzero run results and rehydrates typed errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ capability: 'token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, kind: 'nonzero', error: 'bad', stdout: '', stderr: 'bad', code: 4, timedOut: false, cancelled: false, outputLimited: false }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, kind: 'timeout', error: 'timeout', stdout: '', stderr: '', code: null, timedOut: true, cancelled: false, outputLimited: false }), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(run('tool')).resolves.toMatchObject({ code: 4, stderr: 'bad' });
    await expect(run('tool')).rejects.toMatchObject({ name: 'ShellProcessError', kind: 'timeout', result: { timedOut: true } });
  });

  it('parses last-line JSON and preserves invalid JSON output', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, stdout: 'log\n{"ok":true}\n', stderr: '', code: 0, timedOut: false, cancelled: false, outputLimited: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, stdout: 'bad', stderr: '', code: 0, timedOut: false, cancelled: false, outputLimited: false }), { status: 200 })));
    await expect(runJson('tool')).resolves.toEqual({ ok: true });
    await expect(runJson('tool')).rejects.toBeInstanceOf(ShellProcessError);
  });
});
