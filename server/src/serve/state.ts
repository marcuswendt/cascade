/**
 * server.json: what a supervised Studio reports about itself.
 *
 * The supervisor knows what it asked for; only Studio knows where it actually
 * bound (a fallback, after a missing tailnet name) and which Python workers
 * are up. So Studio writes this file when `CASCADE_SERVE_STATE` names one,
 * on every binding change and as a heartbeat, and removes it on exit.
 */
import type { BindingState } from '../hostBinding.js';
import type { PythonWorkerStatus } from '../pythonWorker.js';
import { removeFile, writeJsonAtomic } from './files.js';

export interface ServerState {
  readonly pid: number;
  readonly project: string;
  readonly version: string;
  readonly startedAt: string;
  readonly heartbeatAt: string;
  readonly binding: BindingState;
  readonly workers: readonly PythonWorkerStatus[];
}

export interface StateReporter {
  /** Write now, e.g. after the binding changed. */
  update(): void;
  /** Stop the heartbeat and remove the file. */
  stop(): void;
}

export function startStateReporter(
  file: string,
  snapshot: () => Omit<ServerState, 'pid' | 'startedAt' | 'heartbeatAt'>,
  intervalMs = 2_000,
): StateReporter {
  const startedAt = new Date().toISOString();
  const update = () => {
    try {
      writeJsonAtomic(file, { pid: process.pid, startedAt, heartbeatAt: new Date().toISOString(), ...snapshot() });
    } catch (error) {
      console.warn(`[cascade] could not write serve state to ${file}: ${(error as Error).message}`);
    }
  };
  update();
  const timer = setInterval(update, intervalMs);
  timer.unref();
  return {
    update,
    stop() {
      clearInterval(timer);
      removeFile(file);
    },
  };
}
