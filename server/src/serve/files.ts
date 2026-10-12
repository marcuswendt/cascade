/**
 * Where `cascade serve` keeps a project's service state, and the small file
 * primitives it needs: an exclusive lock, atomic JSON writes, liveness checks.
 *
 * One directory per project under `~/.cascade/serve/<name>-<hash>/`:
 *
 *   serve.lock    the supervisor's pid; created exclusively, so one supervisor per project
 *   serve.json    the supervisor's record: pid, options, start time, version, restarts
 *   server.json   written by the Studio process itself: actual binding, workers, heartbeat
 *   options.json  the last options used, so `start` after `stop` comes back the same
 *   studio.log    stdout and stderr of the supervisor and Studio
 *
 * `CASCADE_SERVE_DIR` moves the whole tree, which is what the tests use.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export interface ServicePaths {
  readonly id: string;
  readonly dir: string;
  readonly lock: string;
  readonly record: string;
  readonly server: string;
  readonly options: string;
  readonly log: string;
}

export function serveRoot(): string {
  return process.env.CASCADE_SERVE_DIR ?? path.join(os.homedir(), '.cascade', 'serve');
}

/** A readable, collision-free name for a project: `cloud-plots-1a2b3c4d`. */
export function serviceId(projectRoot: string): string {
  const name = path.basename(projectRoot).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  const hash = createHash('sha256').update(path.resolve(projectRoot)).digest('hex').slice(0, 8);
  return `${name}-${hash}`;
}

export function servicePaths(projectRoot: string): ServicePaths {
  return pathsForId(serviceId(projectRoot));
}

export function pathsForId(id: string): ServicePaths {
  const dir = path.join(serveRoot(), id);
  return {
    id,
    dir,
    lock: path.join(dir, 'serve.lock'),
    record: path.join(dir, 'serve.json'),
    server: path.join(dir, 'server.json'),
    options: path.join(dir, 'options.json'),
    log: path.join(dir, 'studio.log'),
  };
}

/** Every project that has ever been served, newest state first. */
export function listServiceIds(): string[] {
  try {
    return fs.readdirSync(serveRoot(), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Write through a temporary file and rename, so a reader never sees half a file. */
export function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
}

export function removeFile(file: string): void {
  try { fs.unlinkSync(file); } catch { /* already gone */ }
}

export function isAlive(pid: number | null | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists but belongs to someone else, which still means alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export class AlreadyRunningError extends Error {
  constructor(readonly pid: number) {
    super(`already running (pid ${pid})`);
  }
}

/**
 * Take the project's lock for `pid`. A lock left by a dead process is stale and
 * is replaced; a lock held by a live one throws AlreadyRunningError.
 */
export function acquireLock(lockFile: string, pid: number = process.pid): void {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockFile, 'wx');
      fs.writeSync(fd, `${pid}\n`);
      fs.closeSync(fd);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holder = readLockPid(lockFile);
      if (holder !== null && holder !== pid && isAlive(holder)) throw new AlreadyRunningError(holder);
      removeFile(lockFile);
    }
  }
  throw new Error(`could not take the lock at ${lockFile}`);
}

export function readLockPid(lockFile: string): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(lockFile, 'utf8').trim(), 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Release the lock only if `pid` still holds it. */
export function releaseLock(lockFile: string, pid: number = process.pid): void {
  if (readLockPid(lockFile) === pid) removeFile(lockFile);
}

/** The last `count` lines of a file, without reading a large log whole. */
export function tailLines(file: string, count: number): string[] {
  let fd: number;
  try { fd = fs.openSync(file, 'r'); } catch { return []; }
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, Math.max(4096, count * 400));
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines.slice(-count);
  } finally {
    fs.closeSync(fd);
  }
}

/** Keep one previous log. Called before a supervisor starts writing. */
export function rotateLog(file: string, maxBytes = 10 * 1024 * 1024): void {
  try {
    if (fs.statSync(file).size > maxBytes) fs.renameSync(file, `${file}.1`);
  } catch { /* no log yet */ }
}

/** The Cascade package version, found by walking up from this module. */
export function cascadeVersion(): string {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth++) {
    const manifest = readJson<{ name?: string; version?: string }>(path.join(directory, 'package.json'));
    if (manifest?.name === '@field/cascade' && manifest.version) return manifest.version;
    directory = path.dirname(directory);
  }
  return 'unknown';
}
