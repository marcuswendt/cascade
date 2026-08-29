import type { AssetRef, ImageRef, JsonValue, TextureHandle } from "./values.js";

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
export interface WebGLCapability {
  createTexture(
    descriptor: JsonValue,
    options: { signal: CascadeAbortSignal },
  ): Promise<ResourceLease<TextureHandle>>;
}
export interface AICapability {
  invoke(
    request: JsonValue,
    options: { signal: CascadeAbortSignal; progress: ProgressReporter },
  ): Promise<JsonValue | AssetRef | ImageRef>;
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
  readonly webgl: WebGLCapability;
  readonly ai: AICapability;
  readonly shell: ShellCapability;
}
export type NodeCapabilityName = keyof CapabilityMap;
