/**
 * `cascade serve run`: the foreground supervisor behind `cascade serve start`
 * and the launchd job.
 *
 * It holds the project's lock, starts Studio as a child in its own process
 * group, and restarts it if it dies (with backoff, giving up after repeated
 * crashes rather than looping forever). On SIGTERM or SIGINT it stops Studio
 * gracefully, then kills whatever is left of the group, which is where the
 * Python worker lives. That replaces the old routine of finding the right
 * `screen`, killing the server, and then hunting a stale worker by hand.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import {
  acquireLock,
  isAlive,
  readJson,
  releaseLock,
  removeFile,
  writeJsonAtomic,
  type ServicePaths,
} from './files.js';
import type { ServerState } from './state.js';

export interface ServeOptions {
  readonly port: number;
  readonly host?: string;
  readonly fallbackHosts: readonly string[];
  readonly trustedHosts: readonly string[];
}

/** serve.json: what the supervisor is and what it is running. */
export interface SupervisorRecord {
  readonly pid: number;
  readonly project: string;
  readonly id: string;
  readonly options: ServeOptions;
  readonly manager: 'cascade' | 'launchd';
  readonly version: string;
  readonly startedAt: string;
  readonly logFile: string;
  readonly serverPid: number | null;
  readonly serverStartedAt: string | null;
  readonly restarts: number;
  readonly lastExit: { readonly code: number | null; readonly signal: string | null; readonly at: string } | null;
}

export interface SupervisorConfig {
  readonly project: string;
  readonly paths: ServicePaths;
  readonly options: ServeOptions;
  /** How to start Studio. The supervisor adds `CASCADE_SERVE_STATE` to its env. */
  readonly server: { readonly command: string; readonly args: readonly string[] };
  readonly manager: 'cascade' | 'launchd';
  readonly version: string;
  readonly maxCrashes?: number;
  readonly crashWindowMs?: number;
  readonly stopGraceMs?: number;
  readonly log?: (message: string) => void;
}

const MAX_BACKOFF_MS = 30_000;

/** Run until stopped by a signal (resolves 0) or until Studio keeps crashing (resolves 1). */
export function runSupervisor(config: SupervisorConfig): Promise<number> {
  const { paths } = config;
  const maxCrashes = config.maxCrashes ?? 5;
  const crashWindowMs = config.crashWindowMs ?? 60_000;
  const stopGraceMs = config.stopGraceMs ?? 8_000;
  const log = config.log ?? ((message: string) => console.log(`${new Date().toISOString()} [serve] ${message}`));

  acquireLock(paths.lock);
  removeFile(paths.server);

  let record: SupervisorRecord = {
    pid: process.pid,
    project: config.project,
    id: paths.id,
    options: config.options,
    manager: config.manager,
    version: config.version,
    startedAt: new Date().toISOString(),
    logFile: paths.log,
    serverPid: null,
    serverStartedAt: null,
    restarts: 0,
    lastExit: null,
  };
  const save = (next: Partial<SupervisorRecord>) => {
    record = { ...record, ...next };
    writeJsonAtomic(paths.record, record);
  };
  save({});
  writeJsonAtomic(paths.options, config.options);

  return new Promise<number>((resolve) => {
    let child: ChildProcess | null = null;
    let stopping = false;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    const crashes: number[] = [];

    const startChild = () => {
      const proc = spawn(config.server.command, [...config.server.args], {
        cwd: config.project,
        env: { ...process.env, CASCADE_SERVE_STATE: paths.server },
        stdio: ['ignore', 'inherit', 'inherit'],
        detached: true, // its own process group, so stop can take its workers with it
      });
      child = proc;
      log(`started Studio (pid ${proc.pid}) for ${config.project}`);
      save({ serverPid: proc.pid ?? null, serverStartedAt: new Date().toISOString() });
      proc.once('error', (error) => log(`could not start Studio: ${error.message}`));
      proc.once('exit', (code, signal) => onChildExit(proc, code, signal));
    };

    const onChildExit = (proc: ChildProcess, code: number | null, signal: NodeJS.Signals | null) => {
      if (child !== proc) return;
      child = null;
      killGroup(proc.pid, 'SIGKILL'); // anything the server left behind in its group
      killWorkers();
      save({ serverPid: null, lastExit: { code, signal, at: new Date().toISOString() } });
      if (stopping) return finish(0);

      const now = Date.now();
      crashes.push(now);
      while (crashes.length && now - crashes[0] > crashWindowMs) crashes.shift();
      if (crashes.length >= maxCrashes) {
        log(`Studio exited ${crashes.length} times in ${Math.round(crashWindowMs / 1000)}s (last: ${signal ?? `code ${code}`}); giving up — see this log`);
        return finish(1);
      }
      const delay = Math.min(1000 * 2 ** (crashes.length - 1), MAX_BACKOFF_MS);
      log(`Studio exited (${signal ?? `code ${code}`}); restarting in ${delay / 1000}s`);
      save({ restarts: record.restarts + 1 });
      restartTimer = setTimeout(() => { restartTimer = null; if (!stopping) startChild(); }, delay);
    };

    const stop = (signal: NodeJS.Signals) => {
      if (stopping) return;
      stopping = true;
      log(`${signal}: stopping Studio`);
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      const proc = child;
      if (!proc) return finish(0);
      killGroup(proc.pid, 'SIGTERM');
      const force = setTimeout(() => {
        log(`Studio did not stop within ${stopGraceMs / 1000}s; killing its process group`);
        killGroup(proc.pid, 'SIGKILL');
      }, stopGraceMs);
      proc.once('exit', () => clearTimeout(force));
    };

    /** Workers Studio reported, in case one escaped the process group. */
    const killWorkers = () => {
      const state = readJson<ServerState>(paths.server);
      for (const worker of state?.workers ?? []) {
        if (worker.pid && isAlive(worker.pid)) {
          try { process.kill(worker.pid, 'SIGKILL'); } catch { /* gone */ }
        }
      }
      removeFile(paths.server);
    };

    const onTerm = () => stop('SIGTERM');
    const onInt = () => stop('SIGINT');
    const onHup = () => { /* detached from any terminal; a hangup is not a stop */ };
    process.on('SIGTERM', onTerm);
    process.on('SIGINT', onInt);
    process.on('SIGHUP', onHup);

    let finished = false;
    const finish = (code: number) => {
      if (finished) return;
      finished = true;
      process.off('SIGTERM', onTerm);
      process.off('SIGINT', onInt);
      process.off('SIGHUP', onHup);
      removeFile(paths.record);
      removeFile(paths.server);
      releaseLock(paths.lock);
      log(code === 0 ? 'stopped' : 'supervisor exiting after repeated crashes');
      resolve(code);
    };

    startChild();
  });
}

function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try { process.kill(pid, signal); } catch { /* already gone */ }
  }
}
