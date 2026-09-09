/** Browser acquisition for the shared runtime GPU host. */
import type { GpuCapability } from '@cascade/contracts';
import {
  createGpuHost,
  type GpuHost,
} from '../../packages/runtime/src/gpu.js';

export function createBrowserGpuHost(): GpuHost | undefined {
  const gpu = (globalThis.navigator as Navigator | undefined)?.gpu;
  if (!gpu) return undefined;

  return createGpuHost({
    async acquire() {
      const adapter = await gpu.requestAdapter();
      if (!adapter) {
        throw new Error(
          'No WebGPU adapter is available — the browser reports WebGPU but the system offers no GPU to render on.',
        );
      }
      const device = await adapter.requestDevice();
      const info = (adapter as unknown as {
        info?: Partial<GpuCapability['adapterInfo']>;
      }).info;
      return {
        device,
        info: {
          vendor: info?.vendor ?? '',
          architecture: info?.architecture ?? '',
          device: info?.device ?? '',
          description: info?.description ?? '',
        },
        limits: device.limits ?? adapter.limits,
      };
    },
  });
}
