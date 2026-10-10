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
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import readline from 'readline';
import type { ProjectRoot } from './project.js';

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

interface Request {
  readonly id: number;
  readonly stage: string;
  readonly line: string;
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface PythonWorkerOptions {
  readonly cancelGraceMs?: number;
  readonly requestTimeoutMs?: number;
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

    const scriptPath = this.project.resolve(this.entrypoint);
    const proc = spawn(this.python, [scriptPath], { cwd: this.project.root, env: this.env });

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

  private handleLine(proc: ChildProcessWithoutNullStreams, line: string): void {
    if (this.proc !== proc) return;
    let msg: { id: number; ok: boolean; result?: unknown; error?: string; cancelled?: boolean };
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
      if (msg.ok) this.settle(current, null, msg.result);
      else this.settle(current, new Error(msg.error || 'python worker reported an error'));
    }
    this.pump();
  }

  private settle(request: Request, error: Error | null, result?: unknown): void {
    if (request.timer) clearTimeout(request.timer);
    request.timer = null;
    if (error) request.reject(error);
    else request.resolve(result);
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
    const proc = this.ensureStarted();
    this.inFlight = next;
    this.inFlightCancelled = false;
    proc.stdin.write(next.line);
  }

  call(stage: string, args: Record<string, unknown>, options: { signal?: AbortSignal } = {}): Promise<unknown> {
    const { signal } = options;
    if (signal?.aborted) return Promise.reject(new StageCancelledError(stage));
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const onAbort = () => this.cancel(id);
      const request: Request = {
        id,
        stage,
        line: JSON.stringify({ id, stage, args }) + '\n',
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
