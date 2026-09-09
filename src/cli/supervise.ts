import { spawn } from 'node:child_process';

/** Bound a CLI render in a separate process. A JS timer inside the renderer
 * cannot interrupt a blocked native driver call or synchronous project code.
 * The caller owns this exact process/group; no unrelated processes are killed.
 */
export function superviseProcess(command: string, args: string[], timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', detached: process.platform !== 'win32' });
    let timedOut = false;
    let cancelled = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    };
    const cancel = () => {
      cancelled = true;
      kill('SIGTERM');
      grace ??= setTimeout(() => kill('SIGKILL'), 1000);
    };
    process.on('SIGINT', cancel);
    process.on('SIGTERM', cancel);
    const timeout = setTimeout(() => {
      timedOut = true;
      console.error(`Render timed out after ${timeoutMs} ms`);
      kill('SIGKILL');
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(grace);
      process.off('SIGINT', cancel);
      process.off('SIGTERM', cancel);
    };
    child.once('error', (error) => { cleanup(); reject(error); });
    child.once('close', (code) => { cleanup(); resolve(timedOut ? 124 : cancelled ? 130 : code ?? 1); });
  });
}
