import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectRoot } from '../server/src/project.js';
import type { Server } from 'node:http';
import { PythonWorker, StageCancelledError } from '../server/src/pythonWorker.js';
import { startServer } from '../server/src/index.js';

/**
 * Cancel-and-supersede at the worker: a request nobody wants any more is
 * dropped if queued and interrupted if running, its answer is never delivered,
 * and no process is left behind.
 */

const roots: string[] = [];
const workers: PythonWorker[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  })));
  for (const worker of workers.splice(0)) worker.shutdown();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** `mode` decides what SIGINT does: `cooperative` answers cancelled and stays
 *  up (the protocol), `default` dies of it (an old worker), `ignore` keeps
 *  running regardless (a stage stuck in native code). */
function fixture(mode: 'cooperative' | 'default' | 'ignore') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-worker-cancel-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'worker.py'), [
    'import json, os, signal, sys, time',
    mode === 'ignore' ? 'signal.signal(signal.SIGINT, signal.SIG_IGN)' : '',
    'def run(stage, args):',
    "    if stage == 'sleep':",
    "        end = time.time() + args['seconds']",
    '        while time.time() < end: time.sleep(0.01)',
    "        return {'slept': args['seconds'], 'pid': os.getpid()}",
    "    if stage == 'mark':",
    "        open(args['path'], 'w').write('ran')",
    "        return {'marked': True}",
    "    return {'echo': args, 'pid': os.getpid()}",
    'def main():',
    '    for line in sys.stdin:',
    '        req = json.loads(line)',
    '        try:',
    "            print(json.dumps({'id': req['id'], 'ok': True, 'result': run(req['stage'], req.get('args', {}))}), flush=True)",
    mode === 'cooperative'
      ? "        except KeyboardInterrupt:\n            print(json.dumps({'id': req['id'], 'ok': False, 'cancelled': True, 'error': 'cancelled'}), flush=True)"
      : '',
    '        except Exception as e:',
    "            print(json.dumps({'id': req['id'], 'ok': False, 'error': str(e)}), flush=True)",
    mode === 'cooperative'
      ? 'while True:\n    try:\n        main()\n        break\n    except KeyboardInterrupt:\n        continue'
      : 'main()',
  ].filter(Boolean).join('\n'));
  const worker = new PythonWorker(new ProjectRoot(root), 'worker.py', 'python3', process.env, { cancelGraceMs: 400 });
  workers.push(worker);
  return { root, worker };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

describe('PythonWorker cancellation', () => {
  it('interrupts the stage in flight and stays warm for the next one', async () => {
    const { worker } = fixture('cooperative');
    const first = await worker.call('echo', { warm: true }) as { pid: number };

    const abort = new AbortController();
    const long = worker.call('sleep', { seconds: 20 }, { signal: abort.signal });
    await new Promise(resolve => setTimeout(resolve, 150));
    const cancelledAt = Date.now();
    abort.abort();
    await expect(long).rejects.toBeInstanceOf(StageCancelledError);

    const next = await worker.call('echo', { after: true }) as { echo: unknown; pid: number };
    expect(Date.now() - cancelledAt).toBeLessThan(1500);
    expect(next.echo).toEqual({ after: true });
    // The same process: a cancel must not cost the warm model.
    expect(next.pid).toBe(first.pid);
  });

  it('never sends a queued request that was withdrawn', async () => {
    const { root, worker } = fixture('cooperative');
    const marker = path.join(root, 'marker');
    const running = worker.call('sleep', { seconds: 0.3 });
    const abort = new AbortController();
    const queued = worker.call('mark', { path: marker }, { signal: abort.signal });
    abort.abort();
    await expect(queued).rejects.toBeInstanceOf(StageCancelledError);
    await running;
    await worker.call('echo', {});
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('never delivers a superseded result, even when the stage finishes anyway', async () => {
    const { worker } = fixture('ignore');
    const abort = new AbortController();
    const stale = worker.call('sleep', { seconds: 0.2 }, { signal: abort.signal });
    const fresh = worker.call('echo', { fresh: 1 });
    await new Promise(resolve => setTimeout(resolve, 50));
    abort.abort();
    await expect(stale).rejects.toBeInstanceOf(StageCancelledError);
    // The worker ignored SIGINT and finished its sleep; that answer is
    // discarded, and the queued request gets its own answer, not the stale one.
    expect(await fresh).toMatchObject({ echo: { fresh: 1 } });
  });

  it('kills a worker that does not answer the interrupt, and respawns cleanly', async () => {
    const { worker } = fixture('ignore');
    const abort = new AbortController();
    const long = worker.call('sleep', { seconds: 30 }, { signal: abort.signal });
    await new Promise(resolve => setTimeout(resolve, 150));
    const pid = worker.pid!;
    expect(alive(pid)).toBe(true);
    abort.abort();
    await expect(long).rejects.toBeInstanceOf(StageCancelledError);

    const next = await worker.call('echo', { respawned: true }) as { pid: number };
    expect(next.pid).not.toBe(pid);
    // No orphan: the stuck process is gone, not merely forgotten.
    await waitFor(() => !alive(pid));
  });

  it('respawns a worker that dies of the interrupt (no cancel protocol)', async () => {
    const { worker } = fixture('default');
    const abort = new AbortController();
    const long = worker.call('sleep', { seconds: 30 }, { signal: abort.signal });
    await new Promise(resolve => setTimeout(resolve, 300));
    const pid = worker.pid!;
    abort.abort();
    await expect(long).rejects.toBeInstanceOf(StageCancelledError);
    await waitFor(() => !alive(pid));
    expect(await worker.call('echo', { ok: 1 })).toMatchObject({ echo: { ok: 1 } });
  });

  it('shutdown leaves no process behind', async () => {
    const { worker } = fixture('cooperative');
    const long = worker.call('sleep', { seconds: 30 });
    await new Promise(resolve => setTimeout(resolve, 150));
    const pid = worker.pid!;
    worker.shutdown();
    await expect(long).rejects.toThrow('shut down');
    await waitFor(() => !alive(pid));
  });
});

describe('the exec route withdraws a stage when the page aborts its request', () => {
  it('an aborted fetch interrupts the worker, and the next request is not queued behind it', async () => {
    const { root } = fixture('cooperative');
    fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify({
      exec: { stages: { entrypoint: 'worker.py', worker: 'worker.py' } },
    }));
    // A fixed port, as server-exec-route does: the exec boundary checks the
    // Host against the configured port, which port 0 never matches.
    const server = startServer(new ProjectRoot(root), { port: 48_500 + (process.pid % 1_000) });
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { Origin: base, Host: `127.0.0.1:${address.port}` };
    const token = (await (await fetch(`${base}/api/exec/capability`, { headers })).json() as { capability: string }).capability;
    const post = (body: unknown, signal?: AbortSignal) => fetch(`${base}/api/exec`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'X-Cascade-Exec-Capability': token },
      body: JSON.stringify(body),
      signal,
    });

    const warm = await (await post({ stage: 'echo', args: {} })).json() as { stdout: string };
    const warmPid = JSON.parse(warm.stdout).pid;
    const abort = new AbortController();
    const long = post({ stage: 'sleep', args: { seconds: 20 } }, abort.signal);
    await new Promise(resolve => setTimeout(resolve, 200));
    abort.abort();
    await expect(long).rejects.toThrow();
    const started = Date.now();
    const next = await (await post({ stage: 'echo', args: { n: 2 } })).json() as { ok: boolean; stdout: string };
    expect(Date.now() - started).toBeLessThan(1500);
    expect(next.ok).toBe(true);
    expect(JSON.parse(next.stdout)).toMatchObject({ echo: { n: 2 }, pid: warmPid });
  });
});
