import { describe, expect, it, vi } from 'vitest';
import { RENDER_TARGET_USAGE, TextureUsage, renderTarget, writeTexture } from '../server/src/runtime/gpu';

function fakeGpu() {
  const textures: Array<{ width: number; height: number; usage: number; destroy: ReturnType<typeof vi.fn> }> = [];
  const cache = new Map<string, unknown>();
  const destroyers: Array<() => void> = [];
  const bytes = new Uint8Array(512);
  bytes.set([10, 20, 30, 255, 40, 50, 60, 255]);
  const buffer = { mapAsync: vi.fn(async () => {}), getMappedRange: () => bytes.buffer, unmap: vi.fn(), destroy: vi.fn() };
  const device = {
    createTexture: vi.fn((descriptor: { size: [number, number]; usage: number }) => {
      const texture = { width: descriptor.size[0], height: descriptor.size[1], usage: descriptor.usage,
        format: 'rgba8unorm', dimension: '2d', depthOrArrayLayers: 1, sampleCount: 1, destroy: vi.fn() };
      textures.push(texture);
      return texture;
    }),
    createBuffer: () => buffer,
    createCommandEncoder: () => ({ copyTextureToBuffer: vi.fn(), finish: () => ({}) }),
    queue: { submit: vi.fn() },
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async () => null),
  };
  const gpu = {
    device,
    cache<T>(key: string, create: (d: unknown) => T, destroy?: (value: T) => void): T {
      if (!cache.has(key)) {
        const value = create(device);
        cache.set(key, value);
        if (destroy) destroyers.push(() => destroy(value));
      }
      return cache.get(key) as T;
    },
  };
  return { gpu, device, textures, dispose: () => destroyers.forEach((d) => d()) };
}

describe('renderTarget', () => {
  it('keeps one texture between cooks and replaces it when the size changes', () => {
    const f = fakeGpu();
    const context = { nodeId: 'chrome', capabilities: { gpu: f.gpu } };
    const a = renderTarget(context, 4.4, 2);
    expect(renderTarget(context, 4, 2)).toBe(a);
    expect(a).toMatchObject({ width: 4, height: 2, usage: RENDER_TARGET_USAGE });
    const b = renderTarget(context, 8, 2);
    expect(b).not.toBe(a);
    expect(f.textures[0].destroy).toHaveBeenCalledOnce();
    expect(renderTarget(context, 8, 2, { key: 'mask' })).not.toBe(b);
    f.dispose();
    expect(f.textures[1].destroy).toHaveBeenCalledOnce();
    expect(f.textures[2].destroy).toHaveBeenCalledOnce();
  });
  it('always keeps COPY_SRC so the target can be written out', () => {
    const f = fakeGpu();
    const texture = renderTarget({ capabilities: { gpu: f.gpu } }, 2, 2, { usage: TextureUsage.RENDER_ATTACHMENT });
    expect(texture.usage & TextureUsage.COPY_SRC).toBeTruthy();
  });
  it('names the missing declaration', () => {
    expect(() => renderTarget({ nodeId: 'n', capabilities: {} }, 2, 2)).toThrow("Declare capabilities: ['gpu']");
  });
});

describe('writeTexture', () => {
  it('reads the texture back and stores its pixels as an image ref', async () => {
    const f = fakeGpu();
    const keepImage = vi.fn(async () => ({ path: '.cascade-cache/chrome.abc.png' }));
    const context = { nodeId: 'chrome', capabilities: { gpu: f.gpu, assets: { read: vi.fn(), write: vi.fn(), keepImage } } };
    const ref = await writeTexture(context, renderTarget(context, 2, 1));
    expect(ref).toEqual({ path: '.cascade-cache/chrome.abc.png', size: [2, 1], channels: 'rgba', depth: 'u8', space: 'srgb' });
    const [pixels, metadata] = keepImage.mock.calls[0] as unknown as [{ data: Uint8ClampedArray }, { suggestedName: string }];
    expect([...pixels.data]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
    expect(metadata.suggestedName).toBe('chrome.png');
  });
  it('names the missing assets declaration', async () => {
    const f = fakeGpu();
    const context = { nodeId: 'n', capabilities: { gpu: f.gpu } };
    await expect(writeTexture(context, renderTarget(context, 2, 1))).rejects.toThrow("capabilities: ['gpu', 'assets']");
  });
});
