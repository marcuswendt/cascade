/**
 * Studio's `gpu` capability — Stage 0 of PLAN webgpu.
 *
 * One `GPUDevice` for the page, handed to every node that declares `gpu`, plus
 * a per-node store for the things that must outlive a cook. No textures: ports
 * still carry `image`, so every picture this produces is byte-identical to the
 * one before it. What it removes is the workaround.
 *
 * The workaround it removes, and why it was a wall rather than untidiness: a
 * sketch had no way to hold a device, so it cached one per `nodeId` in a
 * module-level `Map`. Two GPU nodes in one graph therefore held **two
 * devices**, and a texture allocated on one is not bindable, sampleable or
 * copyable on the other — the failure is a validation error at bind time,
 * which reads as nothing a graph author would recognise. So passing work
 * between GPU nodes was impossible for a reason that had nothing to do with
 * the port types.
 *
 * It is also what lets `architecture/module-state` and
 * `architecture/ambient-state` stay strict. Those rules were forbidding the
 * only available way to hold a device, and their own error text points at "a
 * declared capability" — for a capability that did not exist. This makes the
 * sentence true.
 */
import type { GpuCapability } from '@cascade/contracts';

/** A cached entry and how to take it apart again. */
interface CacheEntry {
  value: unknown;
  destroy?: (value: unknown) => void;
}

/**
 * The page-wide half: the device, the adapter it came from, and every node's
 * cache. Nodes never see this — they get a per-node view, below.
 */
export interface StudioGpuHost extends GpuCapability {
  /**
   * Bring the device up if it is not already, and resolve when a node could
   * use it. Called by the definition adapter before a cook, because
   * `requestAdapter` is async and the capability a node holds is not — nodes
   * get a resolved `device`, not a promise, which is most of why this
   * interface is split in two.
   */
  ensure(): Promise<void>;
  /** The view a single node is handed. Requires `ensure()` to have resolved. */
  forNode(nodeId: string): GpuCapability;
  /** Drop every cached resource and release the device. */
  dispose(): Promise<void>;
}

/**
 * The cache namespace the host itself uses.
 *
 * A `GpuCapability` needs a `cache`, and the host object is one so that it can
 * be installed in `RuntimeCapabilities` without a second type. Its entries are
 * page-scoped rather than belonging to any node — the right place for
 * something genuinely shared, like a bind group layout every node reuses. A
 * node never reaches this: it is handed `forNode(id)` instead, and a node id
 * cannot collide with this name.
 */
const PAGE_SCOPE = '\u0000page';

const MISSING_DEVICE = 'The gpu capability was used before its device was ready — the host must await ensure() before a cook.';

export function createStudioGpuCapability(): StudioGpuHost | undefined {
  // No `navigator.gpu` means no capability installed, and that is deliberate
  // rather than a silent degradation: the preflight already answers a missing
  // capability with `runtime/missing-capability`, and Studio's own adapter
  // throws "requires the Studio gpu capability". A browser without WebGPU
  // therefore produces a sentence naming what is absent, which is the whole
  // reason capabilities are declared.
  const gpu = (globalThis.navigator as Navigator | undefined)?.gpu;
  if (!gpu) return undefined;

  let device: GPUDevice | null = null;
  let adapterInfo: GpuCapability['adapterInfo'] | null = null;
  let limits: Record<string, number> = {};
  let starting: Promise<void> | null = null;
  let destroyed = false;
  /** nodeId -> key -> entry. Two maps rather than a composite key so a node's
   *  resources can be dropped together when it goes. */
  const caches = new Map<string, Map<string, CacheEntry>>();

  function dropCaches(): void {
    for (const entries of caches.values()) {
      for (const entry of entries.values()) entry.destroy?.(entry.value);
    }
    caches.clear();
  }

  async function start(): Promise<void> {
    const adapter = await gpu!.requestAdapter();
    if (!adapter) {
      throw new Error('No WebGPU adapter is available — the browser reports WebGPU but the system offers no GPU to render on.');
    }
    const next = await adapter.requestDevice();
    const info = (adapter as unknown as { info?: Partial<GpuCapability['adapterInfo']> }).info;
    device = next;
    adapterInfo = {
      vendor: info?.vendor ?? '',
      architecture: info?.architecture ?? '',
      device: info?.device ?? '',
      description: info?.description ?? '',
    };
    limits = readLimits(next.limits ?? adapter.limits);

    /**
     * `device.lost` resolves once, and from that moment every resource on the
     * device is invalid — a driver reset, a laptop switching GPUs, or our own
     * `destroy()`. Handled rather than watched: a dead device with no message
     * is the failure shape this codebase keeps producing, so the cache is
     * dropped and the next `ensure()` requests a fresh device.
     *
     * A reason of `destroyed` means we did it deliberately on dispose, and
     * nothing is re-created.
     */
    void next.lost.then((info) => {
      if (destroyed || info?.reason === 'destroyed') return;
      device = null;
      starting = null;
      dropCaches();
      console.warn(`The GPU device was lost (${info?.reason ?? 'unknown'}) — ${info?.message || 'no message given'}. A fresh device will be requested on the next cook.`);
    });
  }

  const host: StudioGpuHost = {
    get device() {
      if (!device) throw new Error(MISSING_DEVICE);
      return device;
    },
    get adapterInfo() {
      if (!adapterInfo) throw new Error(MISSING_DEVICE);
      return adapterInfo;
    },
    get limits() {
      return limits;
    },
    cache<T>(key: string, create: (device: GPUDevice) => T, destroy?: (value: T) => void): T {
      return host.forNode(PAGE_SCOPE).cache(key, create, destroy);
    },

    async ensure(): Promise<void> {
      if (destroyed) throw new Error('The gpu capability has been disposed.');
      if (device) return;
      // One in-flight request however many nodes ask at once. Two nodes
      // cooking in the same pass must not race into two devices, which is the
      // bug this whole capability exists to remove.
      starting ??= start().catch((error) => {
        starting = null;
        throw error;
      });
      await starting;
    },

    forNode(nodeId: string): GpuCapability {
      return {
        get device() {
          if (!device) throw new Error(MISSING_DEVICE);
          return device;
        },
        get adapterInfo() {
          if (!adapterInfo) throw new Error(MISSING_DEVICE);
          return adapterInfo;
        },
        get limits() {
          return limits;
        },
        cache<T>(key: string, create: (device: GPUDevice) => T, destroy?: (value: T) => void): T {
          if (!device) throw new Error(MISSING_DEVICE);
          let entries = caches.get(nodeId);
          if (!entries) {
            entries = new Map();
            caches.set(nodeId, entries);
          }
          const existing = entries.get(key);
          if (existing) return existing.value as T;
          const value = create(device);
          entries.set(key, { value, destroy: destroy as ((value: unknown) => void) | undefined });
          return value;
        },
      };
    },

    async dispose(): Promise<void> {
      destroyed = true;
      dropCaches();
      device?.destroy();
      device = null;
      starting = null;
    },
  };
  return host;
}

/** `GPUSupportedLimits` is an interface with getters rather than a plain
 *  object, so `{...limits}` yields nothing. Walked by prototype instead. */
function readLimits(source: unknown): Record<string, number> {
  if (!source || typeof source !== 'object') return {};
  const out: Record<string, number> = {};
  for (const key of limitNames(source)) {
    const value = (source as Record<string, unknown>)[key];
    if (typeof value === 'number') out[key] = value;
  }
  return out;
}

function limitNames(source: object): string[] {
  const names = new Set<string>(Object.keys(source));
  for (let cursor = Object.getPrototypeOf(source); cursor && cursor !== Object.prototype; cursor = Object.getPrototypeOf(cursor)) {
    for (const key of Object.getOwnPropertyNames(cursor)) if (key !== 'constructor') names.add(key);
  }
  return [...names];
}
