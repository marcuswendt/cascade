/**
 * `cascade serve start | stop | restart | status | logs | install | uninstall`
 *
 * Studio as a managed background service, one per project. `start` detaches a
 * supervisor (`cascade serve run`, see supervisor.ts) and waits until Studio
 * reports where it is listening; `stop` asks it to stop and makes sure the
 * server and its Python worker are gone; `restart` is the two in a row.
 * `status --json` reads the supervisor's record and Studio's own report, so
 * the running state is read rather than guessed from `ps`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { authority } from '../security.js';
import { parseStudioArgs } from '../cliCommands.js';
import {
  AlreadyRunningError,
  cascadeVersion,
  isAlive,
  listServiceIds,
  pathsForId,
  readJson,
  readLockPid,
  releaseLock,
  removeFile,
  rotateLog,
  servicePaths,
  tailLines,
  type ServicePaths,
} from './files.js';
import { guiDomain, launchctl, launchdLabel, plistPath, renderPlist } from './launchd.js';
import { runSupervisor, type ServeOptions, type SupervisorRecord } from './supervisor.js';
import type { ServerState } from './state.js';

export const SERVE_USAGE = `Usage:
  cascade serve start   [project] [--port N] [--host H] [--fallback-host H]... [--trusted-host H]...
  cascade serve stop    [project]
  cascade serve restart [project] [same options as start]
  cascade serve status  [project] [--all] [--json]
  cascade serve logs    [project] [-n LINES] [-f]
  cascade serve install [project] [options] [--no-load] [--print]   (macOS launchd)
  cascade serve uninstall [project]

Options given to start/restart are remembered: a later start without them reuses them.
State and logs live in ~/.cascade/serve/<project>-<hash>/ (override with CASCADE_SERVE_DIR).`;

const DEFAULT_PORT = 3030;

interface ServeArgs {
  readonly action: string;
  readonly project?: string;
  readonly overrides: Partial<ServeOptions>;
  readonly json: boolean;
  readonly all: boolean;
  readonly follow: boolean;
  readonly lines: number;
  readonly load: boolean;
  readonly print: boolean;
  readonly waitMs: number;
}

export function parseServeArgs(args: readonly string[]): ServeArgs {
  const [action = 'status', ...rest] = args;
  const positional: string[] = [];
  const fallbackHosts: string[] = [];
  const trustedHosts: string[] = [];
  let port: number | undefined;
  let host: string | undefined;
  let json = false, all = false, follow = false, load = true, print = false;
  let lines = 50;
  let waitMs = 30_000;

  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];
    const [name, inline] = argument.startsWith('--') ? argument.split('=', 2) : [argument, undefined];
    const value = () => {
      const next = inline ?? rest[++index];
      if (next === undefined || next.startsWith('-')) throw new Error(`${name} requires a value`);
      return next;
    };
    switch (name) {
      case '--json': json = true; break;
      case '--all': all = true; break;
      case '-f': case '--follow': follow = true; break;
      case '--no-load': load = false; break;
      case '--print': print = true; break;
      case '--no-open': break; // serve never opens a browser; accepted for muscle memory
      case '-n': case '--lines': lines = positiveInteger(value(), name); break;
      case '--wait': waitMs = positiveInteger(value(), name) * 1000; break;
      case '--port': port = positiveInteger(value(), name); break;
      case '--host': host = value(); break;
      case '--fallback-host': fallbackHosts.push(value()); break;
      case '--trusted-host': trustedHosts.push(value()); break;
      default:
        if (argument.startsWith('-')) throw new Error(`unknown serve option: ${argument}`);
        positional.push(argument);
    }
  }
  if (positional.length > 1) throw new Error(`serve ${action} takes at most one project, got: ${positional.join(' ')}`);
  if (port !== undefined && port > 65_535) throw new Error('--port must be between 1 and 65535');

  const overrides: Partial<ServeOptions> = {
    ...(port === undefined ? {} : { port }),
    ...(host === undefined ? {} : { host }),
    ...(fallbackHosts.length ? { fallbackHosts } : {}),
    ...(trustedHosts.length ? { trustedHosts } : {}),
  };
  return { action, project: positional[0], overrides, json, all, follow, lines, load, print, waitMs };
}

function positiveInteger(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

/** Studio's own command line for a project and options. */
export function studioArgs(project: string, options: ServeOptions): string[] {
  return [
    project,
    '--no-open',
    '--port', String(options.port),
    ...(options.host ? ['--host', options.host] : []),
    ...options.fallbackHosts.flatMap((host) => ['--fallback-host', host]),
    ...options.trustedHosts.flatMap((host) => ['--trusted-host', host]),
  ];
}

function optionFlags(options: ServeOptions): string[] {
  return studioArgs('', options).slice(2); // without the project and --no-open
}

/** How to invoke this same CLI again, from a detached process or launchd. */
function cliInvocation(): { command: string; args: string[] } {
  const script = process.argv[1];
  return { command: process.execPath, args: [...process.execArgv, script ? fs.realpathSync(script) : script] };
}

function resolveOptions(paths: ServicePaths, overrides: Partial<ServeOptions>): ServeOptions {
  const saved = readJson<Partial<ServeOptions>>(paths.options) ?? {};
  const options: ServeOptions = {
    port: overrides.port ?? saved.port ?? DEFAULT_PORT,
    fallbackHosts: overrides.fallbackHosts ?? saved.fallbackHosts ?? [],
    trustedHosts: overrides.trustedHosts ?? saved.trustedHosts ?? [],
    ...((overrides.host ?? saved.host) ? { host: overrides.host ?? saved.host } : {}),
  };
  // Validate exactly as Studio will, so a bad host fails here and not in a log.
  parseStudioArgs(studioArgs('.', options).slice(1));
  return options;
}

export async function runServeCommand(args: readonly string[], resolveProject: (target: string) => string): Promise<number> {
  const parsed = parseServeArgs(args);
  const projectFor = () => resolveProject(parsed.project ?? '.');

  switch (parsed.action) {
    case 'run': {
      const project = projectFor();
      const paths = servicePaths(project);
      const options = resolveOptions(paths, parsed.overrides);
      const cli = cliInvocation();
      try {
        return await runSupervisor({
          project,
          paths,
          options,
          server: { command: cli.command, args: [...cli.args, ...studioArgs(project, options)] },
          manager: process.env.CASCADE_SERVE_MANAGER === 'launchd' ? 'launchd' : 'cascade',
          version: cascadeVersion(),
        });
      } catch (error) {
        if (error instanceof AlreadyRunningError) {
          console.error(`[cascade] ${project} is ${error.message}`);
          return 1;
        }
        throw error;
      }
    }
    case 'start': return start(projectFor(), parsed);
    case 'stop': return stop(projectFor());
    case 'restart': {
      const project = projectFor();
      const paths = servicePaths(project);
      if (fs.existsSync(plistPath(launchdLabel(paths.id))) && Object.keys(parsed.overrides).length === 0) {
        return restartLaunchd(project, paths, parsed.waitMs, parsed.json);
      }
      const stopped = await stop(project);
      if (stopped !== 0) return stopped;
      return start(project, parsed);
    }
    case 'status': {
      if (parsed.all) return printStatuses(listServiceIds(), parsed);
      if (parsed.project) return printStatuses([servicePaths(projectFor()).id], parsed);
      // No project named: this directory's Studio if it has one, else every served Studio.
      let here: ServicePaths | null = null;
      try { here = servicePaths(projectFor()); } catch { /* not a project directory */ }
      if (here && (fs.existsSync(here.record) || fs.existsSync(here.lock))) return printStatuses([here.id], parsed);
      return printStatuses(listServiceIds(), { ...parsed, all: true });
    }
    case 'logs': return logs(projectFor(), parsed);
    case 'install': return install(projectFor(), parsed);
    case 'uninstall': return uninstall(projectFor());
    case 'help': case '--help': case '-h':
      console.log(SERVE_USAGE);
      return 0;
    default:
      console.error(`unknown serve command: ${parsed.action}\n\n${SERVE_USAGE}`);
      return 1;
  }
}

// ---------------------------------------------------------------- start / stop

async function start(project: string, parsed: ServeArgs): Promise<number> {
  const paths = servicePaths(project);
  if (fs.existsSync(plistPath(launchdLabel(paths.id)))) return startLaunchd(project, paths, parsed.waitMs, parsed.json);

  const running = supervisorPid(paths);
  if (running) {
    console.log(`[cascade] already running (pid ${running}); use \`cascade serve restart\` to restart`);
    printStatus(statusOf(paths), parsed.json);
    return 0;
  }
  const options = resolveOptions(paths, parsed.overrides);

  fs.mkdirSync(paths.dir, { recursive: true });
  rotateLog(paths.log);
  const logFd = fs.openSync(paths.log, 'a');
  const cli = cliInvocation();
  const supervisor = spawn(cli.command, [...cli.args, 'serve', 'run', project, ...optionFlags(options)], {
    cwd: project,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, CASCADE_SERVE_MANAGER: 'cascade' },
  });
  supervisor.unref();
  fs.closeSync(logFd);

  const state = await waitForListening(paths, supervisor.pid ?? 0, parsed.waitMs);
  if (!state) {
    console.error(`[cascade] Studio did not start within ${parsed.waitMs / 1000}s. Last log lines (${paths.log}):`);
    for (const line of tailLines(paths.log, 20)) console.error(`  ${line}`);
    if (supervisor.pid && isAlive(supervisor.pid)) await stop(project, true);
    return 1;
  }
  printStatus(statusOf(paths), parsed.json);
  return 0;
}

async function stop(project: string, quiet = false): Promise<number> {
  const paths = servicePaths(project);
  const label = launchdLabel(paths.id);
  if (fs.existsSync(plistPath(label))) {
    // Unloading is what stops a launchd job; a signal alone would be restarted.
    const result = launchctl('bootout', `${guiDomain()}/${label}`);
    if (!result.ok && !/No such process|Could not find|not find service/i.test(result.output)) {
      console.error(`[cascade] launchctl bootout failed: ${result.output}`);
    }
  }

  const record = readJson<SupervisorRecord>(paths.record);
  const pid = supervisorPid(paths);
  if (!pid) {
    cleanup(paths, record);
    if (!quiet) console.log(`[cascade] not running (${project})`);
    return 0;
  }

  try { process.kill(pid, 'SIGTERM'); } catch { /* exited meanwhile */ }
  const exited = await waitFor(() => !isAlive(pid), 15_000);
  if (!exited) {
    console.warn(`[cascade] supervisor ${pid} did not stop in 15s; killing it and its Studio`);
    try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
  cleanup(paths, record);
  if (!quiet) console.log(`[cascade] stopped ${project} (was pid ${pid})`);
  return 0;
}

/**
 * Make sure nothing outlives a stop: the Studio process group (where the
 * Python worker lives) and any worker Studio reported. Then drop stale files.
 */
function cleanup(paths: ServicePaths, record: SupervisorRecord | null): void {
  const state = readJson<ServerState>(paths.server);
  const serverPid = state?.pid ?? record?.serverPid ?? null;
  if (serverPid && isAlive(serverPid)) {
    try { process.kill(-serverPid, 'SIGKILL'); } catch { try { process.kill(serverPid, 'SIGKILL'); } catch { /* gone */ } }
  }
  for (const worker of state?.workers ?? []) {
    if (worker.pid && isAlive(worker.pid)) {
      try { process.kill(worker.pid, 'SIGKILL'); } catch { /* gone */ }
    }
  }
  const lockHolder = readLockPid(paths.lock);
  if (lockHolder !== null && !isAlive(lockHolder)) releaseLock(paths.lock, lockHolder);
  if (!supervisorPid(paths)) {
    removeFile(paths.record);
    removeFile(paths.server);
  }
}

/** The live supervisor's pid, from the lock (authoritative) or the record. */
function supervisorPid(paths: ServicePaths): number | null {
  for (const pid of [readLockPid(paths.lock), readJson<SupervisorRecord>(paths.record)?.pid]) {
    if (pid && isAlive(pid)) return pid;
  }
  return null;
}

async function waitForListening(paths: ServicePaths, supervisor: number, timeoutMs: number, notServerPid?: number): Promise<ServerState | null> {
  let state: ServerState | null = null;
  await waitFor(() => {
    state = readJson<ServerState>(paths.server);
    const listening = !!state?.binding.host && isAlive(state.pid) && state.pid !== notServerPid;
    return listening || (supervisor > 0 && !isAlive(supervisor) && !readLockPid(paths.lock));
  }, timeoutMs);
  const final = state as ServerState | null;
  return final && final.binding.host && isAlive(final.pid) && final.pid !== notServerPid ? final : null;
}

async function waitFor(condition: () => boolean, timeoutMs: number, intervalMs = 200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return condition();
}

// ---------------------------------------------------------------- status

export interface ServeStatus {
  readonly project: string | null;
  readonly id: string;
  readonly running: boolean;
  readonly manager: 'cascade' | 'launchd' | null;
  readonly launchdInstalled: boolean;
  readonly pid: number | null;
  readonly serverPid: number | null;
  /** Where Studio is actually listening, which may be a fallback. */
  readonly host: string | null;
  readonly port: number | null;
  readonly preferredHost: string | null;
  readonly fallback: boolean;
  readonly fallbackReason: string | null;
  readonly url: string | null;
  readonly uptimeSeconds: number | null;
  readonly serverUptimeSeconds: number | null;
  readonly version: string | null;
  readonly workerState: 'none' | 'stopped' | 'idle' | 'busy';
  readonly workers: ServerState['workers'];
  readonly restarts: number;
  readonly lastExit: SupervisorRecord['lastExit'];
  readonly heartbeatAgeSeconds: number | null;
  readonly logFile: string;
}

export function statusOf(paths: ServicePaths): ServeStatus {
  const record = readJson<SupervisorRecord>(paths.record);
  const pid = supervisorPid(paths);
  const state = pid ? readJson<ServerState>(paths.server) : null;
  const serverAlive = !!state && isAlive(state.pid);
  const now = Date.now();
  const seconds = (iso: string | null | undefined) => (iso ? Math.round((now - Date.parse(iso)) / 1000) : null);
  const binding = serverAlive ? state!.binding : null;
  const workers = serverAlive ? state!.workers : [];
  const workerState = workers.some((worker) => worker.state === 'busy') ? 'busy'
    : workers.some((worker) => worker.state === 'idle') ? 'idle'
      : workers.length ? 'stopped' : 'none';
  return {
    project: record?.project ?? state?.project ?? null,
    id: paths.id,
    running: !!pid && serverAlive && !!binding?.host,
    manager: pid ? record?.manager ?? null : null,
    launchdInstalled: fs.existsSync(plistPath(launchdLabel(paths.id))),
    pid,
    serverPid: serverAlive ? state!.pid : null,
    host: binding?.host ?? null,
    port: binding?.port ?? (pid ? record?.options.port ?? null : null),
    preferredHost: binding?.preferredHost ?? (pid ? record?.options.host ?? null : null),
    fallback: binding?.fallback ?? false,
    fallbackReason: binding?.fallback ? binding.reason : null,
    url: binding?.host ? `http://${authority(binding.host, binding.port)}` : null,
    uptimeSeconds: pid ? seconds(record?.startedAt) : null,
    serverUptimeSeconds: serverAlive ? seconds(state!.startedAt) : null,
    version: serverAlive ? state!.version : pid ? record?.version ?? null : null,
    workerState,
    workers,
    restarts: pid ? record?.restarts ?? 0 : 0,
    lastExit: record?.lastExit ?? null,
    heartbeatAgeSeconds: serverAlive ? seconds(state!.heartbeatAt) : null,
    logFile: paths.log,
  };
}

function printStatuses(ids: string[], parsed: ServeArgs): number {
  const statuses = ids.map((id) => statusOf(pathsForId(id)));
  const shown = parsed.all ? statuses.filter((entry) => entry.running || entry.pid) : statuses;
  if (parsed.json) {
    console.log(JSON.stringify(parsed.all ? shown : shown[0] ?? null, null, 2));
  } else if (shown.length === 0) {
    console.log('[cascade] no Studio is being served');
  } else {
    for (const entry of shown) printStatus(entry, false);
  }
  return 0;
}

function printStatus(entry: ServeStatus, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(entry, null, 2));
    return;
  }
  const lines = [`${entry.project ?? entry.id}`];
  if (!entry.pid) {
    lines.push('  stopped');
  } else {
    lines.push(`  ${entry.running ? 'running' : 'starting'}  ${entry.url ?? '(not listening yet)'}${entry.fallback ? `  FALLBACK — ${entry.preferredHost} unavailable: ${entry.fallbackReason}` : ''}`);
    lines.push(`  pid ${entry.pid} (supervisor, ${entry.manager}), Studio ${entry.serverPid ?? '-'}, up ${duration(entry.uptimeSeconds)}, v${entry.version ?? '?'}`);
    lines.push(`  python worker: ${entry.workerState}${entry.workers.length ? ` (${entry.workers.map((worker) => `${worker.pid ?? '-'} ${worker.state}`).join(', ')})` : ''}`);
    if (entry.restarts) lines.push(`  restarts: ${entry.restarts}${entry.lastExit ? `, last exit ${entry.lastExit.signal ?? `code ${entry.lastExit.code}`} at ${entry.lastExit.at}` : ''}`);
  }
  lines.push(`  log: ${entry.logFile}${entry.launchdInstalled ? '  (launchd job installed)' : ''}`);
  console.log(lines.join('\n'));
}

function duration(seconds: number | null): string {
  if (seconds === null) return '?';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
}

// ---------------------------------------------------------------- logs

async function logs(project: string, parsed: ServeArgs): Promise<number> {
  const paths = servicePaths(project);
  if (!fs.existsSync(paths.log)) {
    console.error(`[cascade] no log yet at ${paths.log}`);
    return 1;
  }
  if (!parsed.follow) {
    for (const line of tailLines(paths.log, parsed.lines)) console.log(line);
    return 0;
  }
  return new Promise((resolve) => {
    const tail = spawn('tail', ['-n', String(parsed.lines), '-F', paths.log], { stdio: 'inherit' });
    tail.once('exit', (code) => resolve(code ?? 0));
  });
}

// ---------------------------------------------------------------- launchd

async function install(project: string, parsed: ServeArgs): Promise<number> {
  const paths = servicePaths(project);
  const options = resolveOptions(paths, parsed.overrides);
  const cli = cliInvocation();
  const label = launchdLabel(paths.id);
  const plist = renderPlist({
    label,
    programArguments: [cli.command, ...cli.args, 'serve', 'run', project, ...optionFlags(options)],
    workingDirectory: project,
    logFile: paths.log,
    environment: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '',
      CASCADE_SERVE_MANAGER: 'launchd',
      ...(process.env.CASCADE_SERVE_DIR ? { CASCADE_SERVE_DIR: process.env.CASCADE_SERVE_DIR } : {}),
    },
  });
  if (parsed.print) {
    process.stdout.write(plist);
    return 0;
  }
  if (process.platform !== 'darwin') {
    console.error('[cascade] serve install writes a launchd job and is macOS only; use --print to see it');
    return 1;
  }

  const file = plistPath(label);
  const wasInstalled = fs.existsSync(file);
  if (wasInstalled) launchctl('bootout', `${guiDomain()}/${label}`);
  // A detached supervisor would hold the lock and the port; hand over cleanly.
  if (supervisorPid(paths)) await stop(project, true);
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, plist);
  fs.writeFileSync(paths.options, JSON.stringify(options, null, 2) + '\n');
  console.log(`[cascade] wrote ${file}`);
  if (!parsed.load) {
    console.log(`[cascade] not loaded; run: launchctl bootstrap ${guiDomain()} ${JSON.stringify(file)}`);
    return 0;
  }
  return startLaunchd(project, paths, parsed.waitMs, parsed.json);
}

async function uninstall(project: string): Promise<number> {
  const paths = servicePaths(project);
  const label = launchdLabel(paths.id);
  const file = plistPath(label);
  if (!fs.existsSync(file)) {
    console.log(`[cascade] no launchd job installed for ${project}`);
    return 0;
  }
  await stop(project, true);
  fs.unlinkSync(file);
  console.log(`[cascade] removed ${file}; Studio is stopped`);
  return 0;
}

async function startLaunchd(project: string, paths: ServicePaths, waitMs: number, json: boolean): Promise<number> {
  const label = launchdLabel(paths.id);
  if (!supervisorPid(paths)) {
    const result = launchctl('bootstrap', guiDomain(), plistPath(label));
    if (!result.ok) {
      // Already loaded (but not running): ask launchd to start it.
      const kick = launchctl('kickstart', `${guiDomain()}/${label}`);
      if (!kick.ok) {
        console.error(`[cascade] launchctl could not start ${label}: ${result.output}; ${kick.output}`);
        return 1;
      }
    }
  }
  const state = await waitForListening(paths, 0, waitMs);
  if (!state) {
    console.error(`[cascade] launchd job ${label} did not report listening within ${waitMs / 1000}s. Last log lines:`);
    for (const line of tailLines(paths.log, 20)) console.error(`  ${line}`);
    return 1;
  }
  printStatus(statusOf(paths), json);
  return 0;
}

async function restartLaunchd(project: string, paths: ServicePaths, waitMs: number, json: boolean): Promise<number> {
  const label = launchdLabel(paths.id);
  const previous = readJson<ServerState>(paths.server)?.pid;
  const result = launchctl('kickstart', '-k', `${guiDomain()}/${label}`);
  if (!result.ok) return startLaunchd(project, paths, waitMs, json);
  const state = await waitForListening(paths, 0, waitMs, previous);
  if (!state) {
    console.error(`[cascade] ${label} did not come back within ${waitMs / 1000}s; see ${paths.log}`);
    return 1;
  }
  printStatus(statusOf(paths), json);
  return 0;
}
