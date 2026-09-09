// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Graph } from '@/nodes/Graph';
import { registerDefinitionNodes } from '@/nodes/definition/DefinitionNode';
import { initializeNodeLibraries } from '@/nodes/initializeLibraries';
import { createBrowserGpuHost } from '@/browser/gpu';
import type { NodeDefinition, NodeExecutionContext } from '../packages/contracts/src/index.js';
import type { DefinitionNodeRegistration } from '../packages/runtime/src/types.js';

/**
 * Stage 0 of PLAN webgpu. The property under test is **sharing**, and it is the
 * only assertion that means anything here: a test that one node receives a
 * device would pass against the per-node design this replaces, where the
 * sketch's `lib/gpu.ts` cached a `GPUDevice` per `nodeId` in a module-level
 * Map. Two devices cannot exchange a texture, so two nodes getting the same
 * object identity is the whole point of the capability existing.
 */

const definition = {
  apiVersion: 1,
  runsOn: 'browser',
  capabilities: ['gpu'],
  outputs: { seen: { kind: 'data', type: 'string' } },
} as const satisfies NodeDefinition;

/** Every device and cache value the nodes were handed, in cook order. */
const seen: { devices: unknown[]; caches: unknown[]; infos: unknown[] } = {
  devices: [], caches: [], infos: [],
};

function execute(context: NodeExecutionContext<typeof definition>) {
  const gpu = context.capabilities.gpu;
  seen.devices.push(gpu.device);
  seen.infos.push(gpu.adapterInfo);
  // Keyed per node by the host, so two instances of one module must not
  // collide — the failure a module-level Map produces.
  seen.caches.push(gpu.cache('pipeline', () => ({ built: context.nodeId })));
  context.outputs.seen.set(context.nodeId);
}

const registration = {
  kind: 'definition-v1',
  moduleId: 'cascade.test.GpuNode',
  definition,
  loadExecute: async () => execute,
} satisfies DefinitionNodeRegistration<typeof definition>;

/** A device that is distinguishable by identity and counts its creations. */
function stubWebGpu() {
  let devices = 0;
  const requestDevice = vi.fn(async () => ({
    label: `device-${++devices}`,
    lost: new Promise(() => {}),
    destroy: vi.fn(),
    limits: { maxTextureDimension3D: 2048 },
  }));
  const adapter = {
    requestDevice,
    info: { vendor: 'test', architecture: 'test-arch', device: 'test-device', description: 'a stub' },
    limits: { maxTextureDimension3D: 2048 },
    features: new Set<string>(),
  };
  const requestAdapter = vi.fn(async () => adapter);
  (navigator as any).gpu = { requestAdapter, getPreferredCanvasFormat: () => 'bgra8unorm' };
  return { requestAdapter, requestDevice, deviceCount: () => devices };
}

/**
 * `registerDefinitionNodes` binds the capability object once, and each test
 * wants its own device and its own call counts. So one stable object is
 * registered and delegates to whichever host the current test built.
 */
let host: ReturnType<typeof createBrowserGpuHost>;
const delegating = {
  get device() { return host!.device; },
  get adapterInfo() { return host!.adapterInfo; },
  get limits() { return host!.limits; },
  cache: (...args: [any, any, any?]) => (host!.cache as any)(...args),
  ensure: () => host!.ensure(),
  forNode: (nodeId: string) => host!.forNode(nodeId),
  dispose: () => host!.dispose(),
};

describe('the gpu capability, Stage 0', () => {
  beforeAll(async () => {
    await initializeNodeLibraries();
    registerDefinitionNodes([registration], { gpu: delegating });
  });

  afterEach(async () => {
    seen.devices.length = 0;
    seen.caches.length = 0;
    seen.infos.length = 0;
    await host?.dispose();
    host = undefined;
    delete (navigator as any).gpu;
  });

  it('hands two nodes the same device', async () => {
    const gpu = stubWebGpu();
    host = createBrowserGpuHost();
    const graph = new Graph();
    graph.addNode('cascade.test.GpuNode', { x: 0, y: 0 });
    graph.addNode('cascade.test.GpuNode', { x: 0, y: 100 });

    await graph.execute();

    expect(seen.devices).toHaveLength(2);
    expect(seen.devices[0]).toBe(seen.devices[1]);
    // Asked for once, not once per node. This is the assertion that fails
    // against a per-node cache even when the identity check happens to pass.
    expect(gpu.deviceCount()).toBe(1);
    expect(gpu.requestAdapter).toHaveBeenCalledTimes(1);
  });

  it('keys the resource cache per node, so two instances do not collide', async () => {
    stubWebGpu();
    host = createBrowserGpuHost();
    const graph = new Graph();
    const first = graph.addNode('cascade.test.GpuNode', { x: 0, y: 0 });
    const second = graph.addNode('cascade.test.GpuNode', { x: 0, y: 100 });

    await graph.execute();

    expect(seen.caches).toEqual([{ built: first.id }, { built: second.id }]);
    expect(seen.caches[0]).not.toBe(seen.caches[1]);
  });

  it('builds a cached resource once and returns the same value on a re-cook', async () => {
    stubWebGpu();
    host = createBrowserGpuHost();
    const graph = new Graph();
    const node = graph.addNode('cascade.test.GpuNode', { x: 0, y: 0 });

    await graph.execute(node);
    // Explicitly dirtied, because a clean node is not re-cooked — the second
    // `execute` would otherwise do nothing and the test would pass without
    // ever exercising a second lookup.
    node.markDirty();
    await graph.execute(node);

    expect(seen.caches).toHaveLength(2);
    expect(seen.caches[0]).toBe(seen.caches[1]);
  });

  it('reports the adapter, so a difference between two runs is attributable', async () => {
    stubWebGpu();
    host = createBrowserGpuHost();
    const graph = new Graph();
    graph.addNode('cascade.test.GpuNode', { x: 0, y: 0 });

    await graph.execute();

    expect(seen.infos[0]).toMatchObject({
      vendor: 'test', architecture: 'test-arch', device: 'test-device', description: 'a stub',
    });
  });

  it('installs nothing when the browser has no WebGPU', () => {
    delete (navigator as any).gpu;
    expect(createBrowserGpuHost()).toBeUndefined();
  });
});
