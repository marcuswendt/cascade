import {
  ShellProcessError,
  type ShellProcessErrorKind,
  type ShellRunOptions,
  type ShellRunResult,
} from '@cascade/contracts';

export { ShellProcessError } from '@cascade/contracts';
export type { ShellProcessErrorKind, ShellRunOptions, ShellRunResult } from '@cascade/contracts';

let capabilityPromise: Promise<string> | undefined;

export async function run(command: string, args: readonly string[] = [], options: ShellRunOptions = {}): Promise<ShellRunResult> {
  capabilityPromise ??= fetch('/api/shell/capability', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Cascade shell capability is unavailable');
      return (await response.json() as { capability: string }).capability;
    })
    .catch((error) => {
      capabilityPromise = undefined;
      throw error;
    });
  const capability = await capabilityPromise;
  const response = await fetch('/api/shell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Cascade-Shell-Capability': capability },
    body: JSON.stringify({ command, args, cwd: options.cwd, timeout: options.timeout, stdin: options.stdin, env: options.env }),
    signal: options.signal as AbortSignal | undefined,
  });
  const payload = await response.json() as ({ ok: true } & ShellRunResult) | ({ ok: false; error: string; kind?: ShellProcessErrorKind } & Partial<ShellRunResult>);
  if (payload.ok) return payload;
  if (payload.kind === 'nonzero') return toResult(payload);
  if (payload.kind) throw new ShellProcessError(payload.kind, toResult(payload), payload.error);
  throw new Error(payload.error);
}

export async function runJson<T = unknown>(command: string, args: readonly string[] = [], options: ShellRunOptions = {}): Promise<T> {
  const result = await run(command, args, options);
  if (result.code !== 0) throw new ShellProcessError('nonzero', result, result.stderr || `Command exited with code ${result.code}`);
  const line = result.stdout.split(/\r?\n/).filter((value) => value.trim()).at(-1) ?? '';
  try { return JSON.parse(line) as T; } catch { throw new ShellProcessError('invalid-json', result, 'Command output was not valid JSON'); }
}

function toResult(value: Partial<ShellRunResult>): ShellRunResult {
  return { stdout: value.stdout ?? '', stderr: value.stderr ?? '', code: value.code ?? null, timedOut: value.timedOut ?? false, cancelled: value.cancelled ?? false, outputLimited: value.outputLimited ?? false };
}
