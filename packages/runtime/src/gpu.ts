import type { GpuCapability } from "@cascade/contracts";

interface CacheEntry {
  readonly value: unknown;
  readonly destroy?: (value: unknown) => void;
}

export interface GpuHostAcquisition {
  readonly device: GpuCapability["device"];
  readonly info?: Partial<GpuCapability["adapterInfo"]>;
  /** May be a getter-backed `GPUSupportedLimits`; normalized by the host. */
  readonly limits: unknown;
  /**
   * Release provider-owned references after the device is no longer usable.
   * Native providers need this in addition to `GPUDevice.destroy()` so their
   * bindings can stop background work and allow the process to exit.
   */
  readonly release?: () => void | Promise<void>;
}

export interface GpuHostOptions {
  readonly acquire: () => Promise<GpuHostAcquisition>;
}

/**
 * A host-owned GPU device with page/process-wide and per-node cache scopes.
 *
 * The runtime can await `ensure()` before a cook while node implementations
 * continue to receive the synchronous `GpuCapability` contract. Ownership
 * remains with the injecting host: runtimes and graphs never dispose it.
 */
export interface GpuHost extends GpuCapability {
  ensure(): Promise<void>;
  forNode(nodeId: string): GpuCapability;
  dispose(): Promise<void>;
}

interface ActiveAcquisition {
  readonly device: GpuCapability["device"];
  readonly info: GpuCapability["adapterInfo"];
  readonly limits: Readonly<Record<string, number>>;
  readonly release?: () => void | Promise<void>;
  released: boolean;
}

const HOST_SCOPE = "\u0000host";
const MISSING_DEVICE =
  "The gpu capability was used before its device was ready — the host must await ensure() before a cook.";
const DISPOSED = "The gpu capability has been disposed.";

export function isGpuHost(value: unknown): value is GpuHost {
  return (
    !!value &&
    typeof (value as GpuHost).ensure === "function" &&
    typeof (value as GpuHost).forNode === "function" &&
    typeof (value as GpuHost).dispose === "function"
  );
}

export function createGpuHost(options: GpuHostOptions): GpuHost {
  let active: ActiveAcquisition | null = null;
  let starting: Promise<void> | null = null;
  let disposal: Promise<void> | null = null;
  let disposed = false;
  const caches = new Map<string, Map<string, CacheEntry>>();
  const retiring = new Set<Promise<void>>();
  const retirementErrors: unknown[] = [];

  function dropCaches(): unknown[] {
    const errors: unknown[] = [];
    const scopes = [...caches.values()];
    caches.clear();
    for (const entries of scopes) {
      for (const entry of entries.values()) {
        try {
          entry.destroy?.(entry.value);
        } catch (error) {
          errors.push(error);
        }
      }
    }
    return errors;
  }

  async function release(
    acquired: ActiveAcquisition,
    destroyDevice: boolean,
  ): Promise<unknown[]> {
    if (acquired.released) return [];
    acquired.released = true;
    const errors: unknown[] = [];
    if (destroyDevice) {
      try {
        acquired.device.destroy();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await acquired.release?.();
    } catch (error) {
      errors.push(error);
    }
    return errors;
  }

  function throwCleanupErrors(errors: readonly unknown[]): void {
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      const combined = new Error("GPU host cleanup failed");
      Object.assign(combined, { errors });
      throw combined;
    }
  }

  function watchLoss(acquired: ActiveAcquisition): void {
    void acquired.device.lost.then(() => {
      if (disposed || active !== acquired) return;
      active = null;
      retirementErrors.push(...dropCaches());
      const cleanup = release(acquired, false).then((errors) => {
        retirementErrors.push(...errors);
      });
      retiring.add(cleanup);
      void cleanup.finally(() => retiring.delete(cleanup));
    }).catch(() => {
      // A rejected loss notification cannot be acted on safely. The active
      // device remains usable until WebGPU reports otherwise or the owner
      // disposes the host.
    });
  }

  async function start(): Promise<void> {
    const result = await options.acquire();
    const acquired: ActiveAcquisition = {
      device: result.device,
      info: {
        vendor: result.info?.vendor ?? "",
        architecture: result.info?.architecture ?? "",
        device: result.info?.device ?? "",
        description: result.info?.description ?? "",
      },
      limits: readGpuLimits(result.limits),
      release: result.release,
      released: false,
    };
    if (disposed) {
      const errors = await release(acquired, true);
      throwCleanupErrors(errors);
      throw new Error(DISPOSED);
    }
    active = acquired;
    watchLoss(acquired);
  }

  const host: GpuHost = {
    get device() {
      if (!active) throw new Error(MISSING_DEVICE);
      return active.device;
    },
    get adapterInfo() {
      if (!active) throw new Error(MISSING_DEVICE);
      return active.info;
    },
    get limits() {
      return active?.limits ?? {};
    },
    cache<T>(
      key: string,
      create: (device: GpuCapability["device"]) => T,
      destroy?: (value: T) => void,
    ): T {
      return host.forNode(HOST_SCOPE).cache(key, create, destroy);
    },
    async ensure(): Promise<void> {
      if (disposed) throw new Error(DISPOSED);
      if (active) return;
      if (!starting) {
        const attempt = start();
        const tracked = attempt.finally(() => {
          if (starting === tracked) starting = null;
        });
        starting = tracked;
      }
      await starting;
    },
    forNode(nodeId: string): GpuCapability {
      return {
        get device() {
          if (!active) throw new Error(MISSING_DEVICE);
          return active.device;
        },
        get adapterInfo() {
          if (!active) throw new Error(MISSING_DEVICE);
          return active.info;
        },
        get limits() {
          return active?.limits ?? {};
        },
        cache<T>(
          key: string,
          create: (device: GpuCapability["device"]) => T,
          destroy?: (value: T) => void,
        ): T {
          if (!active) throw new Error(MISSING_DEVICE);
          let entries = caches.get(nodeId);
          if (!entries) {
            entries = new Map();
            caches.set(nodeId, entries);
          }
          const existing = entries.get(key);
          if (existing) return existing.value as T;
          const value = create(active.device);
          entries.set(key, {
            value,
            destroy: destroy as ((value: unknown) => void) | undefined,
          });
          return value;
        },
      };
    },
    dispose(): Promise<void> {
      disposal ??= performDispose();
      return disposal;
    },
  };

  async function performDispose(): Promise<void> {
    disposed = true;
    const errors = dropCaches();
    const pending = starting;
    if (pending) {
      try {
        await pending;
      } catch (error) {
        if (!(error instanceof Error && error.message === DISPOSED))
          errors.push(error);
      }
    }
    const acquired = active;
    active = null;
    if (acquired) errors.push(...(await release(acquired, true)));
    await Promise.all([...retiring]);
    errors.push(...retirementErrors);
    retirementErrors.length = 0;
    throwCleanupErrors(errors);
  }

  return host;
}

interface LimitedAdapter {
  readonly limits: unknown;
  requestDevice(descriptor?: { requiredLimits?: Record<string, number> }): Promise<GpuCapability["device"]>;
}

/**
 * The host's one device, asked for with everything the adapter allows.
 *
 * A bare `requestDevice()` gets WebGPU's defaults (128 MiB per storage binding,
 * 256 invocations, 16 KiB workgroup storage, 8 storage buffers per stage)
 * whatever the hardware is, and the device is shared, so a node cannot ask for
 * more later. Brand + Design chunked a ribbon into four accumulator buffers on
 * an M3 Max for that reason (3 Nov 2026). Should an adapter refuse its own
 * ceiling, the defaults are better than no device; a node that needs more
 * says so with `gpuLimits` and gets {@link gpuLimitShortfall}'s message.
 */
export async function requestDeviceWithAdapterLimits(adapter: LimitedAdapter): Promise<GpuCapability["device"]> {
  const requiredLimits = readGpuLimits(adapter.limits);
  try {
    return await adapter.requestDevice({ requiredLimits });
  } catch {
    return adapter.requestDevice();
  }
}

/**
 * What a node's declared `gpuLimits` asks for that this device does not give,
 * as one sentence, or null when it all fits. `max*` limits must reach the
 * value; `min*Alignment` limits must be at most it (smaller is better there).
 */
export function gpuLimitShortfall(
  label: string,
  required: Readonly<Record<string, number>> | undefined,
  gpu: Pick<GpuCapability, "limits" | "adapterInfo">,
): string | null {
  if (!required) return null;
  const short: string[] = [];
  for (const [name, wanted] of Object.entries(required)) {
    const have = gpu.limits[name];
    const fits = have !== undefined && (name.startsWith("min") ? have <= wanted : have >= wanted);
    if (!fits) short.push(`${name} ${wanted} (this GPU: ${have ?? "not reported"})`);
  }
  if (!short.length) return null;
  const adapter = gpu.adapterInfo.description || gpu.adapterInfo.device || gpu.adapterInfo.vendor || "this adapter";
  return `${label} needs GPU limits ${adapter} does not allow: ${short.join(", ")}.`;
}

/** Getter-backed supported-limits objects cannot be normalized with spread. */
export function readGpuLimits(source: unknown): Record<string, number> {
  if (!source || typeof source !== "object") return {};
  const names = new Set<string>(Object.keys(source));
  for (
    let cursor = Object.getPrototypeOf(source);
    cursor && cursor !== Object.prototype;
    cursor = Object.getPrototypeOf(cursor)
  ) {
    for (const key of Object.getOwnPropertyNames(cursor)) {
      if (key !== "constructor") names.add(key);
    }
  }
  const limits: Record<string, number> = {};
  for (const key of names) {
    const value = (source as Record<string, unknown>)[key];
    if (typeof value === "number") limits[key] = value;
  }
  return limits;
}
