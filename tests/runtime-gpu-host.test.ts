import { describe, expect, it, vi } from 'vitest';

import type { GpuCapability, NodeDefinition } from '../packages/contracts/src/index.js';
import { createGpuHost } from '../packages/runtime/src/gpu.js';
import { createNodeRuntimeHost } from '../packages/runtime/src/node.js';
import { createRuntime } from '../packages/runtime/src/runtime.js';
import type { DefinitionNodeRegistration } from '../packages/runtime/src/types.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function device(lost = new Promise<GPUDeviceLostInfo>(() => {})) {
  return {
    destroy: vi.fn(),
    lost,
  } as unknown as GPUDevice;
}

function acquired(gpuDevice = device(), release = vi.fn()) {
  return {
    device: gpuDevice,
    info: { vendor: 'test', architecture: '', device: '', description: '' },
    limits: { maxTextureDimension2D: 8192 },
    release,
  };
}

describe('createGpuHost', () => {
  it('shares one concurrent acquisition and scopes caches per node', async () => {
    const pending = deferred<ReturnType<typeof acquired>>();
    const acquire = vi.fn(() => pending.promise);
    const host = createGpuHost({ acquire });

    const first = host.ensure();
    const second = host.ensure();
    expect(acquire).toHaveBeenCalledTimes(1);
    pending.resolve(acquired());
    await Promise.all([first, second]);

    expect(host.forNode('a').device).toBe(host.forNode('b').device);
    expect(host.forNode('a').cache('pipeline', () => 'a')).toBe('a');
    expect(host.forNode('b').cache('pipeline', () => 'b')).toBe('b');
  });

  it('reads getter-backed native limits into a stable record', async () => {
    const limits = Object.create(Object.defineProperties({}, {
      maxTextureDimension2D: { get: () => 4096 },
      ignored: { get: () => 'not-a-number' },
    }));
    const result = { ...acquired(), limits };
    const host = createGpuHost({ acquire: async () => result });

    await host.ensure();

    expect(host.limits).toEqual({ maxTextureDimension2D: 4096 });
    await host.dispose();
  });

  it('releases an acquisition that resolves after disposal starts', async () => {
    const pending = deferred<ReturnType<typeof acquired>>();
    const host = createGpuHost({ acquire: () => pending.promise });
    const ensuring = host.ensure();
    const disposing = host.dispose();
    const result = acquired();
    pending.resolve(result);

    await expect(ensuring).rejects.toThrow('disposed');
    await disposing;
    expect(result.device.destroy).toHaveBeenCalledTimes(1);
    expect(result.release).toHaveBeenCalledTimes(1);
  });

  it('destroys every cache and releases the device even when cleanup throws', async () => {
    const result = acquired();
    const host = createGpuHost({ acquire: async () => result });
    await host.ensure();
    const destroyA = vi.fn(() => { throw new Error('cache a'); });
    const destroyB = vi.fn();
    host.forNode('a').cache('resource', () => 'a', destroyA);
    host.forNode('b').cache('resource', () => 'b', destroyB);

    await expect(host.dispose()).rejects.toThrow('cache a');
    expect(destroyA).toHaveBeenCalledTimes(1);
    expect(destroyB).toHaveBeenCalledTimes(1);
    expect(result.device.destroy).toHaveBeenCalledTimes(1);
    expect(result.release).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale loss callback after a replacement device is acquired', async () => {
    const firstLost = deferred<GPUDeviceLostInfo>();
    const secondLost = deferred<GPUDeviceLostInfo>();
    const firstRelease = deferred<void>();
    const first = acquired(device(firstLost.promise), vi.fn(() => firstRelease.promise));
    const second = acquired(device(secondLost.promise));
    const acquire = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const host = createGpuHost({ acquire });

    await host.ensure();
    firstLost.resolve({ reason: 'unknown', message: 'reset' } as GPUDeviceLostInfo);
    await firstLost.promise;
    await vi.waitFor(() => expect(first.release).toHaveBeenCalledTimes(1));
    await host.ensure();
    expect(host.device).toBe(second.device);

    // The old callback is still completing while the replacement is current.
    firstRelease.resolve();
    await Promise.resolve();
    expect(host.device).toBe(second.device);
    expect(acquire).toHaveBeenCalledTimes(2);
  });
});

describe('neutral runtime gpu integration', () => {
  it('awaits the host and supplies a node-scoped capability without owning it', async () => {
    const definition = {
      apiVersion: 1,
      runsOn: 'server',
      capabilities: ['gpu'],
      outputs: { value: { kind: 'data', type: 'string' } },
    } as const satisfies NodeDefinition;
    const seen: GpuCapability[] = [];
    const registration = {
      kind: 'definition-v1',
      moduleId: 'project.Gpu',
      definition,
      loadExecute: async () => async (context) => {
        seen.push(context.capabilities.gpu);
        context.outputs.value.set(String(context.capabilities.gpu.cache('id', () => context.nodeId)));
      },
    } satisfies DefinitionNodeRegistration<typeof definition>;
    const result = acquired();
    const host = createGpuHost({ acquire: async () => result });
    const runtime = createRuntime({
      host: createNodeRuntimeHost({ gpu: host, modules: { resolve: async () => null } }),
      nodes: [registration],
    });
    const graph = await runtime.load({
      version: 1,
      nodes: [
        { id: 'a', module: 'project.Gpu' },
        { id: 'b', module: 'project.Gpu' },
      ],
      connections: [],
    });

    const run = await graph.run();
    expect(run.status).toBe('completed');
    expect(graph.getOutput('a', 'value')).toBe('a');
    expect(graph.getOutput('b', 'value')).toBe('b');
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen[0].device).toBe(seen[1].device);

    await runtime.dispose();
    expect(result.device.destroy).not.toHaveBeenCalled();
    expect(result.release).not.toHaveBeenCalled();
    await host.dispose();
  });
});
