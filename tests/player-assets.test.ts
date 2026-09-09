import { describe, expect, it, vi } from 'vitest';

import type { NodeDefinition } from '../packages/contracts/src/index.js';
import { createBrowserRuntimeHost } from '../packages/runtime/src/browser.js';
import { createRuntime } from '../packages/runtime/src/index.js';
import type { DefinitionNodeRegistration } from '../packages/runtime/src/types.js';
import { PlayerAssetStore, mediaTypeForName, throwCollectedErrors } from '../src/player/assets.js';

const signal = new AbortController().signal;

describe('PlayerAssetStore', () => {
  it.each([
    ['frame.PNG', 'image/png'], ['frame.svg', 'image/svg+xml'],
    ['frame.JPEG', 'image/jpeg'], ['frame.webp', 'image/webp'], ['frame.bin', undefined],
  ])('preserves IO MIME inference for %s', async (name, mediaType) => {
    expect(mediaTypeForName(name)).toBe(mediaType);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    const store = new PlayerAssetStore({});
    try {
      const path = await store.write(name, new Uint8Array([1]));
      store.url(path);
      expect(createObjectURL.mock.calls[0][0].type).toBe(mediaType ?? 'application/octet-stream');
    } finally { store.dispose(); createObjectURL.mockRestore(); }
  });

  it('preserves single-error identity and reports every collected cleanup error', () => {
    expect.assertions(4);
    const first = new Error('first');
    const second = new Error('second');
    expect(() => throwCollectedErrors([], 'cleanup')).not.toThrow();
    try { throwCollectedErrors([first], 'cleanup'); } catch (error) { expect(error).toBe(first); }
    expect(() => throwCollectedErrors([first, second], 'cleanup')).toThrow('cleanup');
    try { throwCollectedErrors([first, second], 'cleanup'); } catch (error) {
      expect(error).toHaveProperty('errors', [first, second]);
    }
  });
  it('adapts the runtime structural cancellation signal to a native fetch signal', async () => {
    const store = new PlayerAssetStore({ 'assets/input.bin': 'https://example.test/input.bin' });
    const definition = {
      apiVersion: 1,
      runsOn: 'portable',
      capabilities: ['assets'],
      outputs: { size: { kind: 'data', type: 'int' } },
    } as const satisfies NodeDefinition;
    const registration = {
      kind: 'definition-v1', moduleId: 'project.ReadAsset', definition,
      loadExecute: async () => async (context) => {
        const bytes = await context.capabilities.assets.read(
          { path: 'assets/input.bin' },
          { signal: context.signal },
        );
        context.outputs.size.set(bytes.byteLength);
      },
    } satisfies DefinitionNodeRegistration<typeof definition>;
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(new Uint8Array([1, 2, 3]));
    });
    vi.stubGlobal('fetch', fetch);
    const runtime = createRuntime({
      host: createBrowserRuntimeHost({
        modules: { resolve: async (id) => id === registration.moduleId ? registration : null },
        assets: store,
      }),
      nodes: [registration],
    });
    const graph = await runtime.load({
      version: '0.2', nodes: [{ id: 'read', module: registration.moduleId }], connections: [],
    } as never);

    const result = await graph.run();
    expect(result.status).toBe('completed');
    expect(graph.getOutput('read', 'size')).toBe(3);
    expect(fetch).toHaveBeenCalledOnce();
    await graph.dispose();
    await runtime.dispose();
    vi.unstubAllGlobals();
  });

  it('relays cancellation through a native controller and removes its listener', async () => {
    const store = new PlayerAssetStore({ 'assets/input.bin': 'https://example.test/input.bin' });
    let abortListener: (() => void) | undefined;
    let aborted = false;
    let reason: unknown;
    const structuralSignal = {
      get aborted() { return aborted; },
      get reason() { return reason; },
      addEventListener: vi.fn((_type: 'abort', listener: () => void) => { abortListener = listener; }),
      removeEventListener: vi.fn(),
    };
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return await new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetch);

    const reading = store.read({ path: 'assets/input.bin' }, { signal: structuralSignal });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    aborted = true;
    reason = new Error('stop player asset read');
    abortListener!();
    await expect(reading).rejects.toThrow('stop player asset read');
    expect(structuralSignal.removeEventListener)
      .toHaveBeenCalledWith('abort', abortListener);
    vi.unstubAllGlobals();
  });

  it('keeps generated writes immutable and collects values that are no longer rooted', async () => {
    const store = new PlayerAssetStore({}, { maxGeneratedBytes: 32, maxGeneratedEntries: 4 });

    const first = await store.write(new Uint8Array([1, 2]), { suggestedName: 'frame.png' }, { signal });
    const second = await store.write(new Uint8Array([3, 4]), { suggestedName: 'frame.png' }, { signal });

    expect(first.path).not.toBe(second.path);
    expect(await store.read(first, { signal })).toEqual(new Uint8Array([1, 2]));
    expect(await store.read(second, { signal })).toEqual(new Uint8Array([3, 4]));

    store.collect([second]);
    expect(store.stats()).toEqual({ generatedBytes: 2, generatedEntries: 1, objectUrls: 0 });
    await expect(store.read(first, { signal })).rejects.toThrow(first.path);
  });

  it('does not collect a displayed value until its URL lease is released', async () => {
    const createObjectURL = vi.fn(() => 'blob:player-output');
    const revokeObjectURL = vi.fn();
    class PlayerUrl extends URL {}
    Object.assign(PlayerUrl, { createObjectURL, revokeObjectURL });
    vi.stubGlobal('URL', PlayerUrl);
    const store = new PlayerAssetStore({});
    const output = await store.write(new Uint8Array([1]), { mediaType: 'image/png' }, { signal });
    const lease = await store.resolveUrl(output);

    store.collect([]);
    expect(store.stats().generatedEntries).toBe(1);

    await lease.release();
    store.collect([]);
    expect(store.stats()).toEqual({ generatedBytes: 0, generatedEntries: 0, objectUrls: 0 });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:player-output');
    vi.unstubAllGlobals();
  });

  it('keeps a generated media URL while that URL string is rooted', async () => {
    const createObjectURL = vi.fn(() => 'blob:rooted-player-output');
    const revokeObjectURL = vi.fn();
    class PlayerUrl extends URL {}
    Object.assign(PlayerUrl, { createObjectURL, revokeObjectURL });
    vi.stubGlobal('URL', PlayerUrl);
    const store = new PlayerAssetStore({});
    const path = await store.write('frame.png', new Uint8Array([1, 2, 3]));
    const url = store.url(path);

    store.collect([url]);
    expect(store.stats()).toEqual({ generatedBytes: 3, generatedEntries: 1, objectUrls: 1 });
    expect(revokeObjectURL).not.toHaveBeenCalled();

    store.collect([]);
    expect(store.stats()).toEqual({ generatedBytes: 0, generatedEntries: 0, objectUrls: 0 });
    expect(revokeObjectURL).toHaveBeenCalledWith(url);
    vi.unstubAllGlobals();
  });

  it('fails explicitly at byte and entry limits instead of evicting reachable values', async () => {
    const bytes = new PlayerAssetStore({}, { maxGeneratedBytes: 2, maxGeneratedEntries: 10 });
    await bytes.write(new Uint8Array([1, 2]), {}, { signal });
    await expect(bytes.write(new Uint8Array([3]), {}, { signal }))
      .rejects.toThrow(/3 bytes.*2 bytes/);

    const entries = new PlayerAssetStore({}, { maxGeneratedBytes: 10, maxGeneratedEntries: 1 });
    await entries.write(new Uint8Array([1]), {}, { signal });
    await expect(entries.write(new Uint8Array([2]), {}, { signal }))
      .rejects.toThrow(/2 entries.*1 entries/);
  });

  it('rejects media transformations and never falls back to a Cascade API route', () => {
    const store = new PlayerAssetStore({ 'assets/source.png': 'https://example.test/base/assets/source.png' });
    expect(store.url('assets/source.png', { raw: true })).toBe('https://example.test/base/assets/source.png');
    expect(() => store.url('assets/source.png', { width: 320 })).toThrow(/transform/);
    expect(() => store.url('missing.png')).toThrow(/missing.png/);
  });

  it('treats generated string paths as roots and checks aborts and read transforms', async () => {
    const store = new PlayerAssetStore({});
    const path = await store.write('frame.png', new Uint8Array([7]));
    store.collect([path]);
    expect(store.stats().generatedEntries).toBe(1);

    await expect(store.read(path, { width: 10 })).rejects.toThrow(/transform/);
    const controller = new AbortController();
    controller.abort(new Error('stop read'));
    await expect(store.read({ path }, { signal: controller.signal })).rejects.toThrow('stop read');
  });

  it('stays bounded across a thousand immutable frame writes', async () => {
    const store = new PlayerAssetStore({});
    let current: { path: string } | undefined;
    for (let frame = 0; frame < 1_000; frame += 1) {
      current = await store.write(new Uint8Array([frame & 255]), {}, { signal });
      store.collect([current]);
      expect(store.stats().generatedEntries).toBeLessThanOrEqual(1);
    }
    expect(await store.read(current!, { signal })).toEqual(new Uint8Array([999 & 255]));
  });

  it('attempts every URL revocation when disposal encounters an error', async () => {
    const revokeObjectURL = vi.fn((url: string) => {
      if (url.endsWith('1')) throw new Error('first revoke failed');
    });
    let next = 0;
    class PlayerUrl extends URL {}
    Object.assign(PlayerUrl, {
      createObjectURL: () => `blob:${++next}`,
      revokeObjectURL,
    });
    vi.stubGlobal('URL', PlayerUrl);
    const store = new PlayerAssetStore({});
    const first = await store.write(new Uint8Array([1]), {}, { signal });
    const second = await store.write(new Uint8Array([2]), {}, { signal });
    store.url(first.path);
    store.url(second.path);

    expect(() => store.dispose()).toThrow('first revoke failed');
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(store.stats().generatedEntries).toBe(0);
    vi.unstubAllGlobals();
  });
});
