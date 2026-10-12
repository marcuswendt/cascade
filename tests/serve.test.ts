import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireLock, AlreadyRunningError, isAlive, pathsForId, readLockPid, releaseLock, serviceId } from '../server/src/serve/files.js';
import { parseServeArgs, studioArgs } from '../server/src/serve/command.js';
import { renderPlist } from '../server/src/serve/launchd.js';
import { parseStudioArgs } from '../server/src/cliCommands.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cleanup: (() => void)[] = [];
afterEach(() => { for (const step of cleanup.splice(0).reverse()) step(); });

let nextPort = 47_000 + (process.pid % 400) * 2;

function tempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function until(condition: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('serve state files', () => {
  it('names a project readably and stably', () => {
    expect(serviceId('/Users/x/Cascade/cloud-plots')).toMatch(/^cloud-plots-[0-9a-f]{8}$/);
    expect(serviceId('/Users/x/Cascade/cloud-plots')).toBe(serviceId('/Users/x/Cascade/cloud-plots/'));
    expect(serviceId('/a/cloud-plots')).not.toBe(serviceId('/b/cloud-plots'));
  });

  it('holds one lock per project and replaces a stale one', () => {
    const lock = path.join(tempDir('cascade-serve-lock-'), 'serve.lock');
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);
    cleanup.push(() => holder.kill('SIGKILL'));
    acquireLock(lock, holder.pid!);
    expect(() => acquireLock(lock)).toThrow(AlreadyRunningError);

    const dead = spawnSync(process.execPath, ['-e', '0']).pid!;
    fs.writeFileSync(lock, `${dead}\n`);
    acquireLock(lock);
    expect(readLockPid(lock)).toBe(process.pid);
    releaseLock(lock);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it('parses serve options and turns them back into Studio arguments', () => {
    const parsed = parseServeArgs(['start', 'cloud-plots', '--port', '3030', '--host', 'KURO', '--fallback-host', '127.0.0.1', '--trusted-host', 'kuro.ts.net:8444']);
    expect(parsed).toMatchObject({ action: 'start', project: 'cloud-plots', overrides: { port: 3030, host: 'KURO', fallbackHosts: ['127.0.0.1'], trustedHosts: ['kuro.ts.net:8444'] } });
    expect(studioArgs('/p', { port: 3030, host: 'KURO', fallbackHosts: ['127.0.0.1'], trustedHosts: [] }))
      .toEqual(['/p', '--no-open', '--port', '3030', '--host', 'KURO', '--fallback-host', '127.0.0.1']);
    expect(() => parseServeArgs(['start', '--bogus'])).toThrow(/unknown serve option/);
    expect(parseStudioArgs(['.', '--host', 'KURO', '--fallback-host', '127.0.0.1']).fallbackHosts).toEqual(['127.0.0.1']);
    expect(() => parseStudioArgs(['.', '--host', 'KURO', '--fallback-host', '0.0.0.0'])).toThrow(/not a wildcard/);
  });

  it('renders a launchd job that runs the supervisor and logs to the known file', () => {
    const plist = renderPlist({
      label: 'io.field.cascade.cloud-plots-12345678',
      programArguments: ['/usr/local/bin/node', '/cascade/dist/cli/index.js', 'serve', 'run', '/p & q', '--port', '3030'],
      workingDirectory: '/p & q',
      logFile: '/home/.cascade/serve/x/studio.log',
      environment: { PATH: '/usr/bin', CASCADE_SERVE_MANAGER: 'launchd' },
    });
    expect(plist).toContain('<string>serve</string>\n      <string>run</string>');
    expect(plist).toContain('<string>/p &amp; q</string>');
    expect(plist).toContain('<key>StandardOutPath</key>\n    <string>/home/.cascade/serve/x/studio.log</string>');
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/);
  });
});

/** A stand-in Studio: listens, reports a Python-like worker child, optionally ignores SIGTERM or crashes. */
const FAKE_STUDIO = `
import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const port = Number(process.env.FAKE_PORT);
const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
if (process.env.FAKE_IGNORE_TERM) process.on('SIGTERM', () => {});
if (process.env.FAKE_CRASH) setTimeout(() => process.exit(3), 50);
http.createServer((_q, s) => s.end('ok')).listen(port, '127.0.0.1', () => {
  const now = new Date().toISOString();
  fs.writeFileSync(process.env.CASCADE_SERVE_STATE, JSON.stringify({
    pid: process.pid, project: 'fake', version: 'test', startedAt: now, heartbeatAt: now,
    binding: { host: '127.0.0.1', port, preferredHost: '127.0.0.1', fallback: false, reason: null, since: now },
    workers: [{ entrypoint: 'stages.py', pid: worker.pid, state: 'idle', queued: 0 }],
  }));
});
`;

function runFakeSupervisor(env: Record<string, string>) {
  const dir = tempDir('cascade-serve-sup-');
  const fake = path.join(dir, 'fake-studio.mjs');
  fs.writeFileSync(fake, FAKE_STUDIO);
  const runner = path.join(dir, 'runner.mts');
  fs.writeFileSync(runner, `
import { runSupervisor } from ${JSON.stringify(path.join(repo, 'server/src/serve/supervisor.ts'))};
import { pathsForId } from ${JSON.stringify(path.join(repo, 'server/src/serve/files.ts'))};
process.exitCode = await runSupervisor({
  project: ${JSON.stringify(dir)}, paths: pathsForId('fake'),
  options: { port: Number(process.env.FAKE_PORT), fallbackHosts: [], trustedHosts: [] },
  server: { command: process.execPath, args: [${JSON.stringify(fake)}] },
  manager: 'cascade', version: 'test', stopGraceMs: 500, maxCrashes: 3, crashWindowMs: 20_000,
  log: () => {},
});
`);
  const serveDir = path.join(dir, 'state');
  const supervisor = spawn(process.execPath, ['--import', 'tsx', runner], {
    cwd: repo,
    env: { ...process.env, ...env, CASCADE_SERVE_DIR: serveDir, FAKE_PORT: String(nextPort++) },
    stdio: 'ignore',
  });
  cleanup.push(() => { if (supervisor.exitCode === null) supervisor.kill('SIGKILL'); });
  const exited = new Promise<number | null>((resolve) => supervisor.once('exit', (code) => resolve(code)));
  process.env.CASCADE_SERVE_DIR = serveDir;
  const paths = pathsForId('fake');
  delete process.env.CASCADE_SERVE_DIR;
  return { supervisor, exited, paths };
}

describe('serve supervisor', () => {
  it('stops Studio and its worker even when Studio ignores SIGTERM, and releases the lock', async () => {
    const { supervisor, exited, paths } = runFakeSupervisor({ FAKE_IGNORE_TERM: '1' });
    await until(() => fs.existsSync(paths.server), 15_000);
    const state = JSON.parse(fs.readFileSync(paths.server, 'utf8'));
    const record = JSON.parse(fs.readFileSync(paths.record, 'utf8'));
    expect(record).toMatchObject({ pid: supervisor.pid, manager: 'cascade', version: 'test', serverPid: state.pid });
    expect(readLockPid(paths.lock)).toBe(supervisor.pid);
    const workerPid = state.workers[0].pid as number;
    expect(isAlive(workerPid)).toBe(true);

    supervisor.kill('SIGTERM');
    expect(await exited).toBe(0);
    await until(() => !isAlive(state.pid) && !isAlive(workerPid), 5_000);
    expect(fs.existsSync(paths.lock)).toBe(false);
    expect(fs.existsSync(paths.record)).toBe(false);
    expect(fs.existsSync(paths.server)).toBe(false);
  }, 30_000);

  it('restarts a crashing Studio with backoff, then gives up instead of looping', async () => {
    const { exited, paths } = runFakeSupervisor({ FAKE_CRASH: '1' });
    expect(await exited).toBe(1);
    expect(fs.existsSync(paths.lock)).toBe(false);
  }, 30_000);
});
