import { describe, expect, it, vi } from 'vitest';
import { readTexture } from '../server/src/runtime/gpu';
import { validateNodeDefinition } from '../packages/contracts/src/index';

describe('portable GPU contract', () => {
  it.each(['portable', 'server', 'browser'])('allows gpu on %s', (runsOn) => {
    expect(validateNodeDefinition({ apiVersion: 1, runsOn, capabilities: ['gpu'] })).toEqual([]);
  });
  it.each(['portable', 'server'])('keeps graph texture transport unavailable on %s', (runsOn) => {
    expect(validateNodeDefinition({ apiVersion: 1, runsOn, capabilities: ['gpu'],
      outputs: { texture: { kind: 'data', type: 'texture' } } }).map((item) => item.code))
      .toContain('definition/texture-not-portable');
  });
});

function fixture() {
  const bytes = new Uint8Array(512);
  bytes.set([1, 2, 3, 255, 4, 5, 6, 255]);
  bytes.set([7, 8, 9, 255, 10, 11, 12, 255], 256);
  const buffer = { mapAsync: vi.fn(async () => {}), getMappedRange: () => bytes.buffer, unmap: vi.fn(), destroy: vi.fn() };
  const encoder = { copyTextureToBuffer: vi.fn(), finish: () => ({}) };
  const device = {
    createBuffer: vi.fn(() => buffer),
    createCommandEncoder: () => encoder,
    queue: { submit: vi.fn() },
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async () => null),
  };
  const texture = { width: 2, height: 2, depthOrArrayLayers: 1, sampleCount: 1, dimension: '2d', format: 'rgba8unorm', usage: 1 };
  return { buffer, encoder, device: device as unknown as GPUDevice, texture: texture as GPUTexture };
}

describe('explicit RGBA texture readback', () => {
  it('strips 256-byte row padding and releases staging memory', async () => {
    const f = fixture();
    const result = await readTexture(f.device, f.texture);
    expect([...result.data]).toEqual([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]);
    expect(result).toMatchObject({ width: 2, height: 2 });
    expect(f.encoder.copyTextureToBuffer.mock.calls[0][1]).toMatchObject({ bytesPerRow: 256 });
    expect(f.buffer.unmap).toHaveBeenCalledOnce();
    expect(f.buffer.destroy).toHaveBeenCalledOnce();
  });
  it('releases a buffer if mapping fails', async () => {
    const f = fixture();
    f.buffer.mapAsync.mockRejectedValueOnce(new Error('device lost'));
    await expect(readTexture(f.device, f.texture)).rejects.toThrow('device lost');
    expect(f.buffer.destroy).toHaveBeenCalledOnce();
  });
  it('turns scoped WebGPU validation failures into a rejected readback', async () => {
    const f = fixture();
    (f.device.popErrorScope as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      message: 'bytesPerRow is invalid',
    });
    await expect(readTexture(f.device, f.texture)).rejects.toThrow(
      'GPU readback validation failed: bytesPerRow is invalid',
    );
    expect(f.buffer.destroy).toHaveBeenCalledOnce();
  });
  it('cancels a pending readback without waiting for GPU completion', async () => {
    const f = fixture();
    f.buffer.mapAsync.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = readTexture(f.device, f.texture, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow(/abort/i);
    expect(f.buffer.destroy).toHaveBeenCalledOnce();
  });
  it('rejects unsupported formats before allocating', async () => {
    const f = fixture();
    await expect(readTexture(f.device, { ...f.texture, format: 'rgba16float' } as GPUTexture)).rejects.toThrow('rgba8unorm');
    expect(f.device.createBuffer).not.toHaveBeenCalled();
  });
});
