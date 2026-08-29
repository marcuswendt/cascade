import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ProjectRoot } from '../project.js';
import { CredentialStore } from '../credentials.js';
import { readProjectManifest } from '../projectConfig.js';
import { ShellProcessError, ShellRequestError, type ShellAuditRecord, type ShellCapability, type ShellRunOptions, type ShellRunResult } from './types.js';

const MAX_BUFFER = 64 * 1024 * 1024;
const MAX_ARGS = 4096;
const MAX_ARG_BYTES = 1024 * 1024;
const MAX_STDIN_BYTES = 16 * 1024 * 1024;
const MAX_ENV_BYTES = 1024 * 1024;
const MAX_ENV_KEYS = 128;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const ALIAS = /^[A-Za-z0-9._-]+$/;
const BLOCKED_ENV = /^(?:PATH|NODE_OPTIONS|PYTHONPATH|RUBYOPT|PERL5OPT|BASH_ENV|ENV|SHELLOPTS|IFS|CDPATH|GLOBIGNORE|LD_.*|DYLD_.*)$/i;

interface ShellConfig {
  commands: Record<string, string>;
  shell: { timeout: number; env: Record<string, string>; allowedRequestEnv: Set<string> };
}

type AuditSink = (record: ShellAuditRecord) => void;

export class ShellService implements ShellCapability {
  private config: ShellConfig;
  private configRevision: string;
  private readonly executables = new Map<string, string | null>();
  private auditSink: AuditSink = (record) => console.info('[cascade-shell]', JSON.stringify(record));

  constructor(private readonly project: ProjectRoot) {
    this.config = loadConfig(project.root);
    this.configRevision = readConfigRevision(project.root);
    for (const [alias, target] of Object.entries(this.config.commands)) {
      if (!ALIAS.test(alias)) {
        console.warn(`[cascade-shell] ignoring invalid command alias ${JSON.stringify(alias)}`);
        continue;
      }
      const executable = resolveExecutable(project.root, target);
      this.executables.set(alias, executable);
      if (!executable) console.warn(`[cascade-shell] command ${JSON.stringify(alias)} could not be resolved`);
    }
  }

  setAuditSink(sink: AuditSink): void {
    this.auditSink = sink;
  }

  async run(command: string, args: readonly string[] = [], options: ShellRunOptions = {}): Promise<ShellRunResult> {
    const started = Date.now();
    const id = randomUUID();
    let cwd = '.';
    let result: ShellRunResult = emptyResult();
    let errorKind: ShellAuditRecord['errorKind'];
    try {
      this.reloadConfig();
      const executable = this.resolveCommand(command);
      const validated = this.validate(args, options);
      cwd = validated.relativeCwd;
      result = await execute(executable, validated.args, {
        cwd: validated.cwd,
        timeout: validated.timeout,
        stdin: validated.stdin,
        env: validated.env,
        signal: options.signal,
      });
      return result;
    } catch (error) {
      if (error instanceof ShellProcessError) {
        result = error.result;
        errorKind = error.kind;
      } else if (error instanceof ShellRequestError) {
        errorKind = error.code;
      }
      throw error;
    } finally {
      this.auditSink({ id, command, cwd, durationMs: Date.now() - started, code: result.code, errorKind,
        timedOut: result.timedOut, cancelled: result.cancelled, outputLimited: result.outputLimited });
    }
  }

  private reloadConfig(): void {
    const revision = readConfigRevision(this.project.root);
    if (revision === this.configRevision) return;
    this.config = loadConfig(this.project.root);
    this.configRevision = revision;
    this.executables.clear();
    for (const [alias, target] of Object.entries(this.config.commands)) {
      if (!ALIAS.test(alias)) continue;
      this.executables.set(alias, resolveExecutable(this.project.root, target));
    }
  }

  async runJson<T = unknown>(command: string, args: readonly string[] = [], options: ShellRunOptions = {}): Promise<T> {
    const result = await this.run(command, args, options);
    if (result.code !== 0) throw new ShellProcessError('nonzero', result, result.stderr || `Command exited with code ${result.code}`);
    const lines = result.stdout.split(/\r?\n/).filter((value) => value.trim());
    const line = lines[lines.length - 1] ?? '';
    try {
      return JSON.parse(line) as T;
    } catch {
      throw new ShellProcessError('invalid-json', result, 'Command output was not valid JSON');
    }
  }

  private resolveCommand(command: string): string {
    if (!ALIAS.test(command)) throw new ShellRequestError('INVALID_REQUEST', 'command must be an allowlist alias');
    if (!this.executables.has(command)) {
      throw new ShellRequestError('COMMAND_NOT_ALLOWED',
        `Command "${command}" is not allowed. Add this under "commands" in ${this.project.root}/cascade.json: "${command}": "<path>"`);
    }
    const executable = this.executables.get(command);
    if (!executable) throw new ShellRequestError('MISSING_EXECUTABLE', `Configured command "${command}" is not available`);
    return executable;
  }

  private validate(args: readonly string[], options: ShellRunOptions) {
    if (!Array.isArray(args) || args.length > MAX_ARGS || args.some((arg) => typeof arg !== 'string' || Buffer.byteLength(arg) > MAX_ARG_BYTES || arg.includes('\0'))) {
      throw new ShellRequestError('INVALID_REQUEST', 'args must be an array of bounded strings');
    }
    if (options.stdin !== undefined && (typeof options.stdin !== 'string' || Buffer.byteLength(options.stdin) > MAX_STDIN_BYTES || options.stdin.includes('\0'))) {
      throw new ShellRequestError('INVALID_REQUEST', 'stdin exceeds the 16 MiB limit or is invalid');
    }
    const { cwd, relativeCwd } = resolveCwd(this.project.root, options.cwd ?? '.');
    const requestEnv = options.env ?? {};
    const entries = Object.entries(requestEnv);
    if (entries.length > MAX_ENV_KEYS || entries.reduce((sum, [key, value]) => sum + Buffer.byteLength(key) + Buffer.byteLength(String(value)), 0) > MAX_ENV_BYTES) {
      throw new ShellRequestError('INVALID_REQUEST', 'request environment exceeds its limit');
    }
    for (const [key, value] of entries) {
      if (!ENV_NAME.test(key) || typeof value !== 'string' || value.length > 65_536 || value.includes('\0') || BLOCKED_ENV.test(key) || !this.config.shell.allowedRequestEnv.has(key)) {
        throw new ShellRequestError('INVALID_REQUEST', `request environment variable ${JSON.stringify(key)} is not allowed`);
      }
    }
    if (options.timeout !== undefined && (typeof options.timeout !== 'number' || !Number.isFinite(options.timeout))) {
      throw new ShellRequestError('INVALID_REQUEST', 'timeout must be a finite number');
    }
    const timeout = Math.min(600_000, Math.max(1, Math.trunc(options.timeout ?? this.config.shell.timeout)));
    const credentialEnv = new CredentialStore().environment(readProjectManifest(this.project.root).credentials);
    return { args: [...args], cwd, relativeCwd, timeout, stdin: options.stdin,
      env: { ...process.env, ...this.config.shell.env, ...requestEnv, ...credentialEnv } as NodeJS.ProcessEnv };
  }
}

function readConfigRevision(root: string): string {
  try { return fs.readFileSync(path.join(root, 'cascade.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; }
}

/** Bind the single project service to a headless runtime/run signal. */
export function createDirectShellCapability(shell: ShellCapability, runtimeSignal?: AbortSignal): ShellCapability {
  const bind = (options: ShellRunOptions = {}): ShellRunOptions => ({
    ...options,
    signal: combineSignals(runtimeSignal, options.signal),
  });
  return Object.freeze({
    run: (command: string, args?: readonly string[], options?: ShellRunOptions) => shell.run(command, args, bind(options)),
    runJson: <T = unknown>(command: string, args?: readonly string[], options?: ShellRunOptions) => shell.runJson<T>(command, args, bind(options)),
  });
}

function combineSignals(first?: AbortSignal, second?: AbortSignal): AbortSignal | undefined {
  if (!first) return second;
  if (!second || first === second) return first;
  return AbortSignal.any([first, second]);
}

function loadConfig(root: string): ShellConfig {
  let raw: any = {};
  try {
    raw = JSON.parse(fs.readFileSync(path.join(root, 'cascade.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    commands: raw?.commands && typeof raw.commands === 'object' ? raw.commands : {},
    shell: {
      timeout: Number.isFinite(raw?.shell?.timeout) ? Math.min(600_000, Math.max(1, Math.trunc(raw.shell.timeout))) : 120_000,
      env: stringRecord(raw?.shell?.env),
      allowedRequestEnv: new Set(Array.isArray(raw?.shell?.allowedRequestEnv) ? raw.shell.allowedRequestEnv.filter((v: unknown) => typeof v === 'string') : []),
    },
  };
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, item]) =>
    ENV_NAME.test(key) && !BLOCKED_ENV.test(key) && typeof item === 'string' && item.length <= 65_536 && !item.includes('\0')) as [string, string][]);
}

function resolveExecutable(root: string, target: unknown): string | null {
  if (typeof target !== 'string' || !target || target.includes('\0')) return null;
  const expanded = target.replace(/^~(?=\/|$)/, os.homedir());
  if (!path.isAbsolute(expanded) && !/[\\/]/.test(expanded)) {
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      const found = executableFile(path.join(dir, expanded));
      if (found) return found;
    }
    return null;
  }
  const candidate = path.isAbsolute(expanded) ? expanded : path.resolve(root, expanded);
  if (!path.isAbsolute(expanded) && !within(fs.realpathSync(root), safeRealpath(candidate))) return null;
  return executableFile(candidate);
}

function executableFile(candidate: string): string | null {
  try { fs.accessSync(candidate, fs.constants.X_OK); return fs.statSync(candidate).isFile() ? fs.realpathSync(candidate) : null; } catch { return null; }
}

function safeRealpath(candidate: string): string {
  try { return fs.realpathSync(candidate); } catch { return candidate; }
}

function resolveCwd(root: string, requested: string): { cwd: string; relativeCwd: string } {
  if (typeof requested !== 'string' || path.isAbsolute(requested) || requested.includes('\0')) throw new ShellRequestError('INVALID_REQUEST', 'cwd must be project-relative');
  const lexical = path.resolve(root, requested);
  if (!within(root, lexical)) throw new ShellRequestError('INVALID_REQUEST', 'cwd escapes project root');
  let real: string;
  try { real = fs.realpathSync(lexical); } catch { throw new ShellRequestError('INVALID_REQUEST', 'cwd does not exist'); }
  const realRoot = fs.realpathSync(root);
  if (!within(realRoot, real)) throw new ShellRequestError('INVALID_REQUEST', 'cwd escapes project root through a symlink');
  return { cwd: real, relativeCwd: path.relative(realRoot, real) || '.' };
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function emptyResult(): ShellRunResult {
  return { stdout: '', stderr: '', code: null, timedOut: false, cancelled: false, outputLimited: false };
}

function execute(executable: string, args: string[], options: { cwd: string; timeout: number; stdin?: string; env: NodeJS.ProcessEnv; signal?: AbortSignal }): Promise<ShellRunResult> {
  return new Promise((resolve, reject) => {
    type TerminalCause = 'exit' | 'signal' | 'spawn' | 'timeout' | 'cancelled' | 'output-limit';
    let terminal: TerminalCause | null = null;
    let spawnError: Error | undefined;
    let termination: TreeTermination | undefined;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const finishCause = (cause: TerminalCause) => {
      if (terminal) return;
      terminal = cause;
      if (cause === 'timeout' || cause === 'cancelled' || cause === 'output-limit') termination = terminateTree(child);
    };
    const timer = setTimeout(() => finishCause('timeout'), options.timeout);
    const abort = () => finishCause('cancelled');
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= MAX_BUFFER) stdout.push(chunk);
      else finishCause('output-limit');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_BUFFER) stderr.push(chunk);
      else finishCause('output-limit');
    });
    child.once('error', (error) => {
      spawnError = error;
      finishCause('spawn');
    });
    child.once('exit', (code, signal) => finishCause(code === null || signal ? 'signal' : 'exit'));
    child.once('close', async (code, signal) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      await termination?.beforeSettle();
      const output = { stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') };
      if (terminal === 'timeout' || terminal === 'cancelled' || terminal === 'output-limit') {
        const result = { ...output, code: null, timedOut: terminal === 'timeout', cancelled: terminal === 'cancelled', outputLimited: terminal === 'output-limit' };
        reject(new ShellProcessError(terminal, result));
      } else if (terminal === 'spawn' || terminal === 'signal' || spawnError || code === null || signal) {
        const reason = spawnError ? 'Unable to spawn configured command' : `Command terminated by signal ${signal ?? 'unknown'}`;
        reject(new ShellProcessError('spawn', { ...emptyResult(), ...output }, reason));
      } else {
        resolve({ ...output, code, timedOut: false, cancelled: false, outputLimited: false });
      }
    });
    if (options.stdin !== undefined) child.stdin.end(options.stdin); else child.stdin.end();
    if (options.signal?.aborted) abort();
  });
}

interface TreeTermination {
  beforeSettle(): Promise<void>;
}

function terminateTree(child: ChildProcess): TreeTermination {
  if (!child.pid) return { beforeSettle: async () => undefined };
  if (process.platform === 'win32') {
    const taskkill = new Promise<void>((resolve) => {
      execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], () => resolve());
    });
    return { beforeSettle: () => taskkill };
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  const killTimer = setTimeout(() => {
    forceKillTree(child);
  }, 2_000);
  killTimer.unref();
  return {
    beforeSettle: async () => {
      clearTimeout(killTimer);
      forceKillTree(child);
    },
  };
}

function forceKillTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
}
