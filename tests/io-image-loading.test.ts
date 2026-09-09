import { afterEach, describe, expect, it, vi } from 'vitest';
import { installIoBridge, loadBitmap, loadImage, mediaUrl } from '../server/src/runtime/io';
import { installHeadlessCanvas } from '../src/cli/headlessCanvas';

const dispose: Array<() => void> = [];
afterEach(() => {
  while (dispose.length) dispose.pop()!();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('image IO in browser and Node hosts', () => {
  it.each([false, true])('releases a browser decode URL (decode failure: %s)', async (fails) => {
    vi.stubGlobal('document', {});
    let assigned: unknown;
    vi.stubGlobal('Image', class {
      set src(value: unknown) { assigned = value; }
      async decode() { if (fails) throw new Error('decode failed'); }
    });
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:decode');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    dispose.push(installIoBridge({
      read: async () => new Uint8Array([1, 2, 3]),
      write: async (path) => path,
    }));

    const result = loadImage('assets/example.png');
    if (fails) await expect(result).rejects.toThrow('decode failed');
    else await result;
    expect(assigned).toBe('blob:decode');
    expect(create).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:decode');
  });

  it('keeps byte decoding for the headless canvas host', async () => {
    const host = await installHeadlessCanvas();
    dispose.push(() => host.dispose());
    const canvas = new OffscreenCanvas(4, 3);
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ff8000';
    context.fillRect(0, 0, 4, 3);
    const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
    dispose.push(installIoBridge({ read: async () => bytes, write: async (path) => path }));
    const image = await loadImage('assets/example.png');
    expect([image.width, image.height]).toEqual([4, 3]);
    context.clearRect(0, 0, 4, 3);
    context.drawImage(image, 0, 0);
    expect([...context.getImageData(0, 0, 1, 1).data]).toEqual([255, 128, 0, 255]);
  });

  it('uses a host URL resolver without reaching the Studio API', () => {
    const url = vi.fn(() => 'blob:generated-image');
    dispose.push(installIoBridge({
      read: async () => new Uint8Array(), write: async (path) => path, url,
    }));
    expect(mediaUrl('.cascade-cache/image.png', { raw: true })).toBe('blob:generated-image');
    expect(url).toHaveBeenCalledWith('.cascade-cache/image.png', { raw: true });
  });

  it('preserves the Studio route when no host URL resolver is supplied', () => {
    dispose.push(installIoBridge(null));
    expect(mediaUrl('assets/a b.png', { raw: true })).toBe('/api/media/assets/a%20b.png?raw=1');
  });

  it('preserves packaged MIME types when decoding a bitmap through a URL bridge', async () => {
    let image: { src: string; decode(): Promise<void> };
    vi.stubGlobal('Image', class {
      src = '';
      constructor() { image = this; }
      async decode() {}
    });
    const bitmap = vi.fn(async () => ({}));
    vi.stubGlobal('createImageBitmap', bitmap);
    dispose.push(installIoBridge({
      read: async () => new Uint8Array(), write: async path => path,
      url: () => 'https://example.test/assets/image.svg',
    }));
    await loadBitmap('assets/image.svg');
    expect(image!.src).toBe('https://example.test/assets/image.svg');
    expect(bitmap).toHaveBeenCalledWith(image!);
  });
});
