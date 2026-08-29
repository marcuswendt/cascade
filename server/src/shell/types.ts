export interface ShellRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly outputLimited: boolean;
}

export type ShellProcessErrorKind = 'nonzero' | 'invalid-json' | 'spawn' | 'timeout' | 'cancelled' | 'output-limit';

export class ShellProcessError extends Error {
  readonly name = 'ShellProcessError';

  constructor(readonly kind: ShellProcessErrorKind, readonly result: ShellRunResult, message?: string) {
    super(message ?? `Shell process failed: ${kind}`);
  }
}

export interface ShellRunOptions {
  readonly cwd?: string;
  readonly timeout?: number;
  readonly stdin?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export interface ShellCapability {
  run(command: string, args?: readonly string[], options?: ShellRunOptions): Promise<ShellRunResult>;
  runJson<T = unknown>(command: string, args?: readonly string[], options?: ShellRunOptions): Promise<T>;
}

export class ShellRequestError extends Error {
  constructor(readonly code: 'COMMAND_NOT_ALLOWED' | 'INVALID_REQUEST' | 'MISSING_EXECUTABLE', message: string) {
    super(message);
  }
}

export interface ShellAuditRecord {
  readonly id: string;
  readonly command: string;
  readonly cwd: string;
  readonly durationMs: number;
  readonly code: number | null;
  readonly errorKind?: ShellProcessErrorKind | ShellRequestError['code'];
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly outputLimited: boolean;
}
