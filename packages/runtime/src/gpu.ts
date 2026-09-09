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
