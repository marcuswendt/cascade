import type { AssetRef, ImageRef, JsonValue } from "./values.js";

export interface CascadeAbortSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(
    type: "abort",
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: "abort", listener: () => void): void;
}
export interface ResourceLease<T> {
  readonly value: T;
  release(): void | Promise<void>;
}
export interface ProgressReporter {
  report(event: {
    progress?: number;
    message?: string;
    detail?: JsonValue;
  }): void;
}
export interface FileCapability {
  read(
    path: string,
    options: { signal: CascadeAbortSignal },
  ): Promise<Uint8Array>;
  write(
    path: string,
    data: Uint8Array,
    options: { signal: CascadeAbortSignal },
  ): Promise<void>;
  list(
    path: string,
    options: { signal: CascadeAbortSignal },
  ): Promise<readonly string[]>;
  stat(
    path: string,
    options: { signal: CascadeAbortSignal },
  ): Promise<{ size: number; modifiedAt?: number } | null>;
}
export interface AssetCapability {
  read(
    ref: AssetRef,
    options: { signal: CascadeAbortSignal },
  ): Promise<Uint8Array>;
  write(
    data: Uint8Array,
    metadata: { mediaType?: string; suggestedName?: string },
    options: { signal: CascadeAbortSignal },
  ): Promise<AssetRef>;
  resolveUrl?(ref: AssetRef | ImageRef): Promise<ResourceLease<string>>;
}
export interface MediaCapability {
  decodeImage(
    ref: ImageRef | AssetRef,
    options: { signal: CascadeAbortSignal },
  ): Promise<ResourceLease<unknown>>;
  encodeImage(
    value: unknown,
    encoding: JsonValue,
    options: { signal: CascadeAbortSignal; progress: ProgressReporter },
  ): Promise<ImageRef | AssetRef>;
}
export interface PythonCapability {
  invoke(
    request: {
      operation: string;
      input: JsonValue;
      assets?: readonly AssetRef[];
    },
    options: { signal: CascadeAbortSignal; progress: ProgressReporter },
  ): Promise<JsonValue | AssetRef | ImageRef>;
}
/**
 * A GPU a node can compute on, and the state that has to outlive one cook.
 *
 * This replaces `WebGLCapability`, which nothing implemented, nothing declared
 * and no host installed — its one method was WebGL2-shaped, and keeping both
 * names would have meant two devices in one page. Two devices cannot exchange
 * a texture: an allocation made on one is not bindable, sampleable or copyable
 * on the other, and the failure is a validation error at bind time rather than
 * anything a graph author would recognise. So a shared device is not a
 * preference, it is the precondition for a chain of GPU nodes at all.
 *
 * **Stage 0 deliberately carries three members and no textures.** Ports still
 * pass `image`, so every picture is byte-identical to before; what this buys is
 * one device instead of one per node module, an owner for `device.lost`, and
 * somewhere legitimate to keep a pipeline — which is what lets the
 * `architecture/ambient-state` rule stay strict. The texture store, the
 * generation-stamped handles and the readback are Stage 1, and the shape of
 * this interface is meant to be lived with for a few days first.
 *
 * The `GPUDevice` type comes from `@webgpu/types`, added to this package's
 * `tsconfig.json` as its only `types` entry. Contracts compiles with
 * `lib: ["ES2022"]` and no DOM on purpose — it is the vocabulary both hosts
 * share, so pulling in the whole browser would let a browser-only type reach a
 * portable definition by accident. A hand-written stub was the alternative and
 * would have been worse than a dependency: it would shadow the genuine
 * `GPUDevice` at the node's own call site, so every real method call would
 * stop typechecking.
 *
 * The device is raw on purpose. A wrapped pipeline API would be a second thing
 * to learn, would lag the spec, and would fight the reason to reach for WebGPU
 * at all, which is that you write WGSL and encode passes. The capability wraps
 * only what carries lifetime or identity, because those are the parts a host
 * has to be able to account for.
 */
export interface GpuCapability {
  /**
   * The one device for this page. Shared by every node declaring `gpu`, which
   * is the whole point — see the note above on why two would be useless.
   */
  readonly device: GPUDevice;
  /**
   * Who is actually rendering, recorded so a difference between two runs of
   * the same graph is attributable rather than a mystery. WebGPU output can
   * differ across adapters, and today there is no way to answer "which one".
   */
  readonly adapterInfo: Readonly<{
    vendor: string;
    architecture: string;
    device: string;
    description: string;
  }>;
  /** What this adapter will actually allow — `maxTextureDimension3D` and the
   *  rest. Read at runtime rather than assumed; the 3D default is far below
   *  the 2D one and a hard-coded guess would be wrong on some machines. */
  readonly limits: Readonly<Record<string, number>>;
  /**
   * A resource that outlives one cook — a compiled pipeline, a sampler, a
   * bind group layout. Keyed per node by the host, so two instances of one
   * module do not share a cache entry and a module-level `Map` is never the
   * right answer again.
   *
   * `create` runs once per key. `destroy` is called when the entry is dropped:
   * when the device is lost, or when the graph disposes. This is the member
   * that makes `architecture/module-state` keepable — it was previously
   * forbidding the only available way to hold a pipeline.
   */
  cache<T>(key: string, create: (device: GPUDevice) => T, destroy?: (value: T) => void): T;
}
export interface ShellRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly outputLimited: boolean;
}
export type ShellProcessErrorKind =
  | "nonzero"
  | "invalid-json"
  | "spawn"
  | "timeout"
  | "cancelled"
  | "output-limit";
export class ShellProcessError extends Error {
  readonly name = "ShellProcessError";
  constructor(
    readonly kind: ShellProcessErrorKind,
    readonly result: ShellRunResult,
    message = `Shell process failed: ${kind}`,
  ) {
    super(message);
  }
}
export interface ShellRunOptions {
  readonly cwd?: string;
  readonly timeout?: number;
  readonly stdin?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly signal?: CascadeAbortSignal;
}
export interface ShellCapability {
  run(
    command: string,
    args?: readonly string[],
    options?: ShellRunOptions,
  ): Promise<ShellRunResult>;
  runJson<T = unknown>(
    command: string,
    args?: readonly string[],
    options?: ShellRunOptions,
  ): Promise<T>;
}
export interface CapabilityMap {
  readonly files: FileCapability;
  readonly assets: AssetCapability;
  readonly media: MediaCapability;
  readonly python: PythonCapability;
  readonly gpu: GpuCapability;
  readonly shell: ShellCapability;
}
export type NodeCapabilityName = keyof CapabilityMap;
