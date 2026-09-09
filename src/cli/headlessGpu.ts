import { createGpuHost } from '../../packages/runtime/src/gpu.js';

export const MISSING_GPU_MESSAGE = 'Cascade cannot load the optional Dawn WebGPU renderer. Install "webgpu@0.6.0" on a supported platform and run again.';

/** Native loading belongs to the Node host, never the neutral runtime. Static
 * checks construct this host without loading a binary or requesting a device.
 */
export function createDawnGpuHost() {
  return createGpuHost({
    async acquire() {
      let dawn: typeof import('webgpu');
      try { dawn = await import('webgpu'); }
      catch (cause) { throw Object.assign(new Error(MISSING_GPU_MESSAGE), { cause }); }
      // No global navigator, unsafe toggles, or silent software fallback.
      // Dawn has no GPU.dispose(): releasing this reference is necessary for
      // natural process exit, in addition to destroying the device/resources.
      let gpu: GPU | undefined = dawn.create([]);
      let device: GPUDevice | undefined;
      try {
        const adapter = await gpu.requestAdapter();
        if (!adapter) throw new Error('Dawn found no WebGPU adapter. Check GPU drivers and backend availability; headless rendering still needs a hardware or explicitly configured software adapter.');
        device = await adapter.requestDevice();
        const info = adapter.info;
        return { device, info: {
          vendor: info.vendor, architecture: info.architecture,
          device: info.device, description: info.description,
        }, limits: device.limits, release: () => { gpu = undefined; } };
      } catch (error) {
        device?.destroy();
        gpu = undefined;
        throw error;
      }
    },
  });
}
