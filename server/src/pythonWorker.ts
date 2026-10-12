/**
 * Manages one persistent Python worker process per project — replacing a
 * fresh subprocess per stage execution for a project-declared worker, so
 * lazily-loaded models stay warm across calls instead of reloading each time.
 *
 * Protocol: newline-delimited JSON on stdin/stdout, correlated by a
 * per-call incrementing id — see worker.py's own docstring.
 *
 * **One request in flight at a time, queued here.** The Python side is
 * single-threaded, and until 2026-10-10 every call was written to stdin at
 * once and queued in the OS pipe buffer. That made a request impossible to
 * withdraw: once it was in the pipe the worker would run it, so a Studio edit
 * arriving while a long stage ran had to wait for that stage and then for
 * every superseded request queued behind it. Holding the queue on this side
 * means a request nobody wants any more is simply never sent.
 *
 * **Cancelling the one in flight** sends the worker SIGINT. A worker that
 * catches `KeyboardInterrupt` around a request answers `{"cancelled": true}`
 * and stays warm; one that does not dies of it, and the next call respawns it,
 * which is kill-and-respawn by default without a protocol change. A worker
 * that has not answered within `cancelGraceMs` is killed outright, so a stage
 * stuck in native code cannot hold the queue.
 *
 * **Following the code.** A warm worker keeps the modules it imported, so until
 * 12 Oct an edited stage went on running its old code in a live Studio until
 * somebody killed the process. Given `sources`, the worker fingerprints the
 * project's stage files when it starts and again before each request is sent;
 * when the fingerprint differs it restarts first, between requests, so nothing
 * in flight is lost. A file hash, not a file-system watch: it costs a directory
 * walk per request and cannot miss an event.
 *
 * **The envelope.** A request may carry a `cascade` object beside `args` (the
 * core cache key, the seed). It is outside `args` on purpose, so a project
 * cache that keys on its args is not changed by it.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import os from 'node:os';
import path from 'node:path';
import readline from 'readline';
import type { ProjectRoot } from './project.js';
import type { StageSources } from './stageSources.js';

const REQUEST_TIMEOUT_MS = 120_000;
const CANCEL_GRACE_MS = 3_000;

/** The error a cancelled call rejects with. Distinct so a caller can tell a
 *  withdrawn request from a stage that failed. */
export class StageCancelledError extends Error {
  readonly cancelled = true;
  constructor(stage: string) {
    super(`stage "${stage}" was cancelled`);
    this.name = 'StageCancelledError';
  }
}

/** What a worker answered, with what the core knows about the code that ran. */
export interface WorkerAnswer {
  readonly result: unknown;
  /** The code hash of the process that answered, when sources are watched. */
  readonly codeHash: string | null;
  /** True when this request was the first after a restart for changed code. */
  readonly restarted: boolean;
  /** A project-owned cache's own report, when the worker sends one
   *  (`"cache": "hit" | "miss"` beside `result`). */
  readonly projectCache?: string;
}

interface Request {
  readonly id: number;
  readonly stage: string;
  readonly line: string;
  resolve: (result: WorkerAnswer) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface PythonWorkerOptions {
  readonly cancelGraceMs?: number;
  readonly requestTimeoutMs?: number;
  /** The project's stage sources. Given, the worker restarts when they change. */
  readonly sources?: StageSources;
}

export interface WorkerCallOptions {
  readonly signal?: AbortSignal;
  /** Sent beside `args` as `cascade`, never inside them. */
  readonly cascade?: Readonly<Record<string, unknown>>;
}

export interface PythonWorkerStatus {
  readonly entrypoint: string;
  readonly pid: number | null;
  /** `busy` while a stage runs, `idle` when warm and waiting, `stopped` when no process is up. */
  readonly state: 'busy' | 'idle' | 'stopped';
  readonly queued: number;
  /** The stage code hash the process started with, when sources are watched. */
  readonly codeHash: string | null;
  /** Restarts because the stage code changed. */
  readonly restarts: number;
}

/** Every worker not yet shut down, so `cascade serve status` can report them
 *  and a stopping server can take them with it. */
const liveWorkers = new Set<PythonWorker>();

export function pythonWorkerStatuses(): PythonWorkerStatus[] {
  return [...liveWorkers].map((worker) => worker.status);
}

/** Shut every live worker down; used when the server itself stops. */
export function shutdownAllPythonWorkers(): void {
  for (const worker of [...liveWorkers]) worker.shutdown();
}

export class PythonWorker {
  private project: ProjectRoot;
  private entrypoint: string;
  private python: string;
  private env: NodeJS.ProcessEnv;
  private readonly cancelGraceMs: number;
  private readonly requestTimeoutMs: number;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private queue: Request[] = [];
  /** The request the worker is running, or one it was told to abandon and has
   *  not yet answered. Nothing else is written until it answers or exits. */
  private inFlight: Request | null = null;
  /** Set once the in-flight request has been cancelled: its answer is
   *  discarded whatever it says. */
  private inFlightCancelled = false;
  private killTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly sources: StageSources | null;
  /** The code hash the running process started with. */
  private spawnedCodeHash: string | null = null;
  /** Set by a restart, cleared by the answer that follows it. */
  private restartPending = false;
  /** How many times the worker restarted because its code changed. */
  restarts = 0;

  constructor(
    project: ProjectRoot,
    entrypoint: string,
    python: string = 'python3',
    env: NodeJS.ProcessEnv = process.env,
    options: PythonWorkerOptions = {},
  ) {
    this.project = project;
    this.entrypoint = entrypoint;
    this.python = python;
    this.env = env;
    this.cancelGraceMs = options.cancelGraceMs ?? CANCEL_GRACE_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.sources = options.sources ?? null;
    liveWorkers.add(this);
  }

  get status(): PythonWorkerStatus {
    const pid = this.pid;
    return {
      entrypoint: this.entrypoint,
      pid,
      state: pid === null ? 'stopped' : this.inFlight ? 'busy' : 'idle',
      queued: this.queue.length,
      codeHash: this.spawnedCodeHash,
      restarts: this.restarts,
    };
  }

  /** The code hash the running worker started with; null before the first
   *  request or when sources are not watched. */
  get codeHash(): string | null {
    return this.spawnedCodeHash;
  }

  /** The worker's process id, or null when none is running. For tests and
   *  diagnostics: a cancelled stage must not leave an orphan behind. */
  get pid(): number | null {
    return this.proc?.pid ?? null;
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    // Not `proc.killed`: that turns true once ANY signal is delivered, so the
    // SIGINT of a cooperative cancel would orphan a healthy warm worker.
    if (this.proc && this.proc.exitCode === null && this.proc.signalCode === null) return this.proc;

    this.spawnedCodeHash = this.sources?.codeHash() ?? null;
    const scriptPath = this.project.resolve(this.entrypoint);
    const proc = spawn(this.python, [scriptPath], { cwd: this.project.root, env: this.spawnEnv() });

    readline.createInterface({ input: proc.stdout }).on('line', (line) => this.handleLine(proc, line));
    proc.stderr.on('data', (chunk) => console.error('[python-worker]', chunk.toString().trimEnd()));
    proc.stdin.on('error', () => { /* the exit handler reports it */ });
    proc.on('exit', (code, signal) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.clearKillTimer();
      const current = this.inFlight;
      const cancelled = this.inFlightCancelled;
      this.inFlight = null;
      this.inFlightCancelled = false;
      if (current && !cancelled) {
        console.warn(`[python-worker] exited (${signal ?? `code ${code}`}) — will respawn on next call`);
        this.settle(current, new Error(`python worker exited (${signal ?? `code ${code}`}) before responding`));
      }
      // Anything still queued was never sent, so it can go to a fresh worker.
      this.pump();
    });

    this.proc = proc;
    return proc;
  }

  /**
   * The environment for a new process. With sources watched, Python's bytecode
   * cache is moved to a folder named by the code hash.
   *
   * Without that a restart is not enough: Python validates a `.pyc` by the
   * source's size and its mtime in whole seconds, so an edit that keeps the
   * length (`VALUE = 1` to `VALUE = 2`) within the same second is served from
   * the old bytecode by the fresh process. Found by the respawn test.
   */
  private spawnEnv(): NodeJS.ProcessEnv {
    if (!this.spawnedCodeHash) return this.env;
    const prefix = path.join(os.tmpdir(), 'cascade-pycache', this.spawnedCodeHash);
    return { ...this.env, PYTHONPYCACHEPREFIX: prefix };
  }

  private handleLine(proc: ChildProcessWithoutNullStreams, line: string): void {
    if (this.proc !== proc) return;
    let msg: { id: number; ok: boolean; result?: unknown; error?: string; cancelled?: boolean; cache?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      console.error('[python-worker] non-JSON line from worker:', line);
      return;
    }
    const current = this.inFlight;
    if (!current || msg.id !== current.id) return; // an id we no longer wait for
    const cancelled = this.inFlightCancelled;
    this.inFlight = null;
    this.inFlightCancelled = false;
    this.clearKillTimer();
    if (!cancelled) {
      const restarted = this.restartPending;
      this.restartPending = false;
      if (msg.ok) {
        this.settle(current, null, {
          result: msg.result,
          codeHash: this.spawnedCodeHash,
          restarted,
          ...(typeof msg.cache === 'string' ? { projectCache: msg.cache } : {}),
        });
      }
      else this.settle(current, new Error(msg.error || 'python worker reported an error'));
    }
    this.pump();
  }

  private settle(request: Request, error: Error | null, answer?: WorkerAnswer): void {
    if (request.timer) clearTimeout(request.timer);
    request.timer = null;
    if (error) request.reject(error);
    else request.resolve(answer!);
  }

  /**
   * Stop a running worker whose code changed since it started. Only ever
   * called with nothing in flight, so no request is lost: the exit handler
   * finds no current request, and the next `ensureStarted` spawns afresh.
   */
  private restartIfCodeChanged(): void {
    if (!this.sources || !this.proc) return;
    const now = this.sources.codeHash();
    if (now === this.spawnedCodeHash) return;
    console.warn(`[python-worker] stage code changed (${this.spawnedCodeHash} -> ${now}), restarting`);
    const stale = this.proc;
    this.proc = null;
    stale.kill();
    this.restarts += 1;
    this.restartPending = true;
  }

  private clearKillTimer(): void {
    if (this.killTimer) clearTimeout(this.killTimer);
    this.killTimer = null;
  }

  /** Send the next queued request if the worker is free. */
  private pump(): void {
    if (this.inFlight) return;
    const next = this.queue.shift();
    if (!next) return;
    this.restartIfCodeChanged();
    const proc = this.ensureStarted();
    this.inFlight = next;
    this.inFlightCancelled = false;
    proc.stdin.write(next.line);
  }

  /** Run a stage and return its result. */
  async call(stage: string, args: Record<string, unknown>, options: WorkerCallOptions = {}): Promise<unknown> {
    return (await this.callWithMeta(stage, args, options)).result;
  }

  /** Run a stage and return its result with the code hash that produced it. */
  callWithMeta(stage: string, args: Record<string, unknown>, options: WorkerCallOptions = {}): Promise<WorkerAnswer> {
    const { signal, cascade } = options;
    if (signal?.aborted) return Promise.reject(new StageCancelledError(stage));
    const id = this.nextId++;
    return new Promise<WorkerAnswer>((resolve, reject) => {
      const onAbort = () => this.cancel(id);
      const request: Request = {
        id,
        stage,
        line: JSON.stringify(cascade ? { id, stage, args, cascade } : { id, stage, args }) + '\n',
        resolve: (r) => { signal?.removeEventListener('abort', onAbort); resolve(r); },
        reject: (e) => { signal?.removeEventListener('abort', onAbort); reject(e); },
        timer: null,
      };
      request.timer = setTimeout(() => {
        this.cancel(id, new Error(`python worker timed out after ${this.requestTimeoutMs}ms on stage "${stage}"`));
      }, this.requestTimeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(request);
      this.pump();
    });
  }

  /**
   * Withdraw a request. A queued one is dropped without ever reaching Python;
   * the one in flight is interrupted, and its answer — whenever it comes — is
   * discarded, so a superseded result is never delivered.
   */
  cancel(id: number, reason?: Error): void {
    const queued = this.queue.findIndex(request => request.id === id);
    if (queued >= 0) {
      const [request] = this.queue.splice(queued, 1);
      this.settle(request, reason ?? new StageCancelledError(request.stage));
      return;
    }
    const current = this.inFlight;
    if (!current || current.id !== id || this.inFlightCancelled) return;
    this.inFlightCancelled = true;
    this.settle(current, reason ?? new StageCancelledError(current.stage));
    const proc = this.proc;
    if (!proc) return;
    proc.kill('SIGINT');
    this.clearKillTimer();
    this.killTimer = setTimeout(() => {
      this.killTimer = null;
      if (this.proc === proc && this.inFlight === current) proc.kill('SIGKILL');
    }, this.cancelGraceMs);
  }

  shutdown(): void {
    liveWorkers.delete(this);
    this.clearKillTimer();
    for (const request of this.queue.splice(0)) this.settle(request, new Error('python worker shut down'));
    const current = this.inFlight;
    this.inFlight = null;
    this.inFlightCancelled = false;
    if (current) this.settle(current, new Error('python worker shut down'));
    const proc = this.proc;
    this.proc = null;
    proc?.kill();
  }
}
