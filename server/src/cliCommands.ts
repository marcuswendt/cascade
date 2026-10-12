import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { loadConfig, saveConfig, configPath } from './config.js';
import { startServer } from './index.js';
import { isHostUnavailable } from './hostBinding.js';
import { ProjectRoot } from './project.js';
import { createNode, createProject } from './projectTemplate.js';
import { authority, isLoopbackHost, isWildcardHost, trustedAuthority } from './security.js';
import { shutdownAllPythonWorkers, pythonWorkerStatuses } from './pythonWorker.js';
import { runServeCommand } from './serve/command.js';
import { startStateReporter } from './serve/state.js';
import { cascadeVersion } from './serve/files.js';

export interface StudioCliArgs {
  readonly positional: string[];
  readonly noOpen: boolean;
  readonly host?: string;
  readonly port?: number;
  readonly trustedHosts: string[];
  /** Hosts to bind, in order, when --host is unavailable. Empty: the default (127.0.0.1). */
  readonly fallbackHosts?: string[];
}

export function parseStudioArgs(args: readonly string[]): StudioCliArgs {
  const positional: string[] = [];
  const trustedHosts: string[] = [];
  const fallbackHosts: string[] = [];
  let noOpen = false;
  let host: string | undefined;
  let port: number | undefined;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--no-open') {
      noOpen = true;
      continue;
    }
    const [name, inlineValue] = argument.startsWith('--') ? argument.split('=', 2) : [argument, undefined];
    if (name === '--host' || name === '--port' || name === '--trusted-host' || name === '--fallback-host') {
      const value = inlineValue ?? args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
      if (name === '--host') host = value;
      else if (name === '--fallback-host') {
        if (isWildcardHost(value)) throw new Error('--fallback-host must be a specific address, not a wildcard');
        fallbackHosts.push(value);
      }
      else if (name === '--trusted-host') {
        trustedAuthority(value, 1);
        trustedHosts.push(value);
      } else {
        port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65_535) {
          throw new Error('--port must be an integer between 1 and 65535');
        }
      }
      continue;
    }
    if (argument.startsWith('-')) throw new Error(`unknown option: ${argument}`);
    positional.push(argument);
  }

  // A loopback bind with a trusted host is the reverse-proxy case, and it used
  // to be refused — which made HTTPS unreachable: `tailscale serve` terminates
  // TLS and proxies to loopback, so the browser never reaches the bind address
  // and the old requirement could not be satisfied by any configuration. Three
  // constraints excluded each other and there was no way through.
  //
  // It is safe for the reason the refusal was trying to protect: a loopback
  // bind means **the only possible peer is a local process**. Measured through
  // `tailscale serve` on 2026-09-08 — the backend sees
  // `remoteAddress: 127.0.0.1` and the original `Host` verbatim, so nothing
  // needs to be inferred from a forwarded header and no trust is widened.
  if (trustedHosts.length > 0 && !host) {
    throw new Error('--trusted-host requires an explicit --host bind address, loopback or otherwise');
  }
  if (host && !isLoopbackHost(host)) {
    if (host === '0.0.0.0' || host === '::' || host === '[::]') {
      throw new Error('remote Studio must bind a specific hostname or VPN/interface address, not a wildcard address');
    }
    if (trustedHosts.length === 0) trustedHosts.push(host);
  }

  return {
    positional,
    noOpen,
    ...(host === undefined ? {} : { host }),
    ...(port === undefined ? {} : { port }),
    trustedHosts,
    ...(fallbackHosts.length ? { fallbackHosts } : {}),
  };
}

/** Run Studio/project commands without reading process.argv or exiting. */
export async function runStudioCli(args: readonly string[]): Promise<void> {
  if (args[0] === 'serve') {
    process.exitCode = await runServeCommand(args.slice(1), resolveProjectTarget);
    return;
  }
  const { noOpen, positional, host, port, trustedHosts, fallbackHosts } = parseStudioArgs(args);
  const config = loadConfig();

  if (positional[0] === 'projects') {
    if (positional[1]) {
      saveConfig({ projectsRoot: path.resolve(positional[1].replace(/^~(?=\/|$)/, process.env.HOME ?? '~')) });
      console.log(`[cascade] projects root set to ${loadConfig().projectsRoot} (${configPath()})`);
    } else console.log(loadConfig().projectsRoot);
    return;
  }

  if (positional[0] === 'new') {
    if (!positional[1]) throw new Error('usage: cascade new <name>');
    const directory = createProject(config.projectsRoot, positional[1]);
    console.log(`[cascade] created ${directory}`);
    positional[0] = directory;
  }

  if (positional[0] === 'node') {
    if (!positional[1]) throw new Error('usage: cascade node <Name> [project-directory]');
    const project = ProjectRoot.fromArg(positional[2] ?? '.');
    const directory = createNode(project.root, positional[1]);
    console.log(`[cascade] created project.${positional[1]} at ${directory}`);
    return;
  }

  const project = ProjectRoot.fromArg(resolveProjectTarget(positional[0] ?? '.'));
  const envFallbacks = (process.env.CASCADE_FALLBACK_HOSTS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const server = startServer(project, {
    host,
    port,
    trustedHosts,
    ...(fallbackHosts || envFallbacks.length ? { fallbackHosts: fallbackHosts ?? envFallbacks } : {}),
  });

  // A port or permission problem is reported in one line, not as a stack
  // trace. An unavailable host is not fatal: bindWithFallback handles it.
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (isHostUnavailable(error)) return;
    console.error(`[cascade] Studio could not listen: ${error.message}`);
    process.exit(1);
  });

  // Under `cascade serve`, report the actual binding and the workers.
  const stateFile = process.env.CASCADE_SERVE_STATE;
  const reporter = stateFile
    ? startStateReporter(stateFile, () => ({
      project: project.root,
      version: cascadeVersion(),
      binding: server.binding.state(),
      workers: pythonWorkerStatuses(),
    }))
    : null;

  // A graceful stop takes the Python worker with it, so `serve stop` (or
  // Ctrl-C) never leaves a stale worker holding old code.
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    console.log(`[cascade] ${signal}: stopping Studio`);
    server.binding.stop();
    shutdownAllPythonWorkers();
    reporter?.stop();
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 3_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  server.binding.ready.then(async (bound) => {
    reporter?.update();
    const defaultGraph = await project.resolveDefaultGraph();
    console.log(defaultGraph
      ? `📄 Opening ${defaultGraph}`
      : '📄 No default graph (name one explicitly, or add index.cascade) — starting empty');
    const port = bound.port;
    const browserHost = bound.fallback
      ? (isLoopbackHost(bound.host!) ? 'localhost' : bound.host!)
      : trustedHosts[0] ?? (host && !isLoopbackHost(host) ? host : 'localhost');
    const url = `http://${trustedAuthority(browserHost, port)}`;
    if (!noOpen) {
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      execFile(opener, [url], (error) => {
        if (error) console.warn(`[cascade] couldn't auto-open a browser (${error.message}) — open ${url} yourself.`);
      });
    }
  }, () => { /* reported by the 'error' handler above */ });
}

/** A path, or a bare project name under the configured projects root. */
export function resolveProjectTarget(target: string): string {
  if (fs.existsSync(path.resolve(target))) return path.resolve(target);
  const projectTarget = path.resolve(loadConfig().projectsRoot, target);
  return fs.existsSync(projectTarget) ? projectTarget : path.resolve(target);
}
