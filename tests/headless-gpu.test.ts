import { describe, expect, it, vi } from 'vitest';
import { createDawnGpuHost } from '../src/cli/headlessGpu';
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('webgpu', () => mocks);

describe('optional Dawn host', () => {
  it('does not touch native GPU code during static host construction/disposal', async () => {
    mocks.create.mockClear();
    const host = createDawnGpuHost();
    await host.dispose();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('reports a missing adapter without installing ambient navigator state', async () => {
    const before = globalThis.navigator;
    mocks.create.mockReturnValue({ requestAdapter: async () => null });
    const host = createDawnGpuHost();
    await expect(host.ensure()).rejects.toThrow('Dawn found no WebGPU adapter');
    await host.dispose();
    expect(globalThis.navigator).toBe(before);
    expect(mocks.create).toHaveBeenLastCalledWith([]);
  });
  it('destroys a device when acquisition fails after requestDevice', async () => {
    const device = { destroy: vi.fn() };
    mocks.create.mockReturnValue({
      requestAdapter: async () => ({
        requestDevice: async () => device,
        get info() { throw new Error('adapter metadata failed'); },
      }),
    });
    const host = createDawnGpuHost();

    await expect(host.ensure()).rejects.toThrow('adapter metadata failed');
    expect(device.destroy).toHaveBeenCalledOnce();
    await host.dispose().catch(() => {});
  });
});
