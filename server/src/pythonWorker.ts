/**
 * Manages one persistent Python worker process per project — replacing a
 * fresh subprocess per stage execution for a project-declared worker, so
 * lazily-loaded models stay warm across calls instead of reloading each time.
 *
 * Protocol: newline-delimited JSON on stdin/stdout, correlated by a
 * per-call incrementing id — see worker.py's own docstring. The Python
 * side is single-threaded (one request at a time), so no request queue
 * is needed here: writes to stdin queue naturally in the OS pipe buffer,
 * and the id map makes response order irrelevant.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import readline from 'readline';
import type { ProjectRoot } from './project.js';

const REQUEST_TIMEOUT_MS = 120_000;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

export class PythonWorker {
  private project: ProjectRoot;
  private entrypoint: string;
  private python: 'python' | 'python3';
  private env: NodeJS.ProcessEnv;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  constructor(project: ProjectRoot, entrypoint: string, python: 'python' | 'python3' = 'python3', env: NodeJS.ProcessEnv = process.env) {
    this.project = project;
    this.entrypoint = entrypoint;
    this.python = python;
    this.env = env;
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.proc && !this.proc.killed) return this.proc;

    const scriptPath = this.project.resolve(this.entrypoint);
    const proc = spawn(this.python, [scriptPath], { cwd: this.project.root, env: this.env });

    readline.createInterface({ input: proc.stdout }).on('line', (line) => this.handleLine(line));
    proc.stderr.on('data', (chunk) => console.error('[python-worker]', chunk.toString().trimEnd()));
    proc.on('exit', (code) => {
      console.warn(`[python-worker] exited (code ${code}) — will respawn on next call`);
      this.failAllPending(new Error(`python worker exited (code ${code}) before responding`));
      if (this.proc === proc) this.proc = null;
    });

    this.proc = proc;
    return proc;
  }

  private handleLine(line: string): void {
    let msg: { id: number; ok: boolean; result?: unknown; error?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      console.error('[python-worker] non-JSON line from worker:', line);
      return;
    }
    const pending = this.pending.get(msg.id);
    if (!pending) return; // already timed out, or an id we don't recognize
    this.pending.delete(msg.id);
    if (msg.ok) pending.resolve(msg.result);
    else pending.reject(new Error(msg.error || 'python worker reported an error'));
  }

  private failAllPending(err: Error): void {
    for (const pending of this.pending.values()) pending.reject(err);
    this.pending.clear();
  }

  async call(stage: string, args: Record<string, unknown>): Promise<unknown> {
    const proc = this.ensureStarted();
    const id = this.nextId++;

    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`python worker timed out after ${REQUEST_TIMEOUT_MS}ms on stage "${stage}"`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });

    proc.stdin.write(JSON.stringify({ id, stage, args }) + '\n');
    return result;
  }

  shutdown(): void {
    this.proc?.kill();
    this.proc = null;
  }
}
