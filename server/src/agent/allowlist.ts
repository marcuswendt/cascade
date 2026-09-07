/**
 * Which coding agents this project is allowed to launch.
 *
 * The rule is the shell service's rule, and deliberately the same one: an
 * alias declared under `"commands"` in the project's own `cascade.json`, never
 * a path supplied by the browser. A console that can rewrite the project is at
 * least as sensitive as `cascade/shell`, so it gets the same posture —
 * explicit, per sketch, visible in the file rather than a global switch someone
 * forgets is on.
 *
 * This reads the allowlist rather than calling ShellService, because
 * `ShellService.run` buffers a process to completion and the console has to
 * stream. The error text is copied from the shell service on purpose: the
 * useful thing about that message is that it names exactly what to add, and two
 * different phrasings of the same fix would be worse than one duplicated line.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ALIAS = /^[A-Za-z0-9._-]+$/;

export type AgentRequestErrorCode = 'COMMAND_NOT_ALLOWED' | 'MISSING_EXECUTABLE' | 'INVALID_REQUEST' | 'BUSY';

export class AgentRequestError extends Error {
  constructor(readonly code: AgentRequestErrorCode, message: string) {
    super(message);
    this.name = 'AgentRequestError';
  }
}

/** What to put in cascade.json, named exactly. Shown in the console panel when
 *  the alias is missing, so the fix never has to be looked up. */
export function allowlistHint(root: string, alias: string): string {
  return `Add this under "commands" in ${root}/cascade.json: "${alias}": "<path>"`;
}

function readManifest(root: string): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'cascade.json'), 'utf8'));
  } catch {
    return {};
  }
}

function readCommands(root: string): Record<string, unknown> {
  const raw = readManifest(root);
  return raw?.commands && typeof raw.commands === 'object' && !Array.isArray(raw.commands) ? raw.commands : {};
}

/**
 * Extra flags for one agent, declared per project.
 *
 * The reason this exists rather than being hardcoded: a headless Claude cannot
 * prompt for permission, so by default it will *refuse* the edits the console
 * exists to make. The fix is a flag — `"args": ["--permission-mode",
 * "acceptEdits"]` — and it is a decision about what a process may do to a
 * project, which belongs in the project's own file beside the allowlist rather
 * than baked into Cascade. Declared as:
 *
 *     "agent": { "claude": { "args": ["--permission-mode", "acceptEdits"] } }
 */
export function agentExtraArgs(root: string, alias: string): string[] {
  const raw = readManifest(root);
  const args = raw?.agent?.[alias]?.args;
  if (!Array.isArray(args)) return [];
  return args.filter((value: unknown): value is string => typeof value === 'string' && !value.includes('\0'));
}

function executableFile(candidate: string): string | null {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile() ? fs.realpathSync(candidate) : null;
  } catch {
    return null;
  }
}

/** Absolute, `~`-relative, or a bare name looked up on PATH — the shell
 *  service's own three shapes, minus project-relative targets, which an agent
 *  binary never is. */
export function resolveExecutable(target: unknown): string | null {
  if (typeof target !== 'string' || !target || target.includes('\0')) return null;
  const expanded = target.replace(/^~(?=\/|$)/, os.homedir());
  if (path.isAbsolute(expanded)) return executableFile(expanded);
  if (!/[\\/]/.test(expanded)) {
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      const found = executableFile(path.join(dir, expanded));
      if (found) return found;
    }
    return null;
  }
  return null;
}

export interface AgentAvailability {
  readonly alias: string;
  readonly configured: boolean;
  /** Present only when the alias is declared but cannot be run. */
  readonly resolved: boolean;
  readonly hint: string | null;
}

export function agentAvailability(root: string, alias: string): AgentAvailability {
  if (!ALIAS.test(alias)) {
    return { alias, configured: false, resolved: false, hint: 'Agent name must be an allowlist alias' };
  }
  const commands = readCommands(root);
  if (!(alias in commands)) {
    return { alias, configured: false, resolved: false, hint: allowlistHint(root, alias) };
  }
  const executable = resolveExecutable(commands[alias]);
  return {
    alias,
    configured: true,
    resolved: Boolean(executable),
    hint: executable ? null : `Configured command "${alias}" is not available — check the path in ${root}/cascade.json`,
  };
}

/** The absolute executable for an allowlisted alias, or an error naming the fix. */
export function requireExecutable(root: string, alias: string): string {
  if (!ALIAS.test(alias)) throw new AgentRequestError('INVALID_REQUEST', 'agent must be an allowlist alias');
  const commands = readCommands(root);
  if (!(alias in commands)) {
    throw new AgentRequestError('COMMAND_NOT_ALLOWED', `Command "${alias}" is not allowed. ${allowlistHint(root, alias)}`);
  }
  const executable = resolveExecutable(commands[alias]);
  if (!executable) throw new AgentRequestError('MISSING_EXECUTABLE', `Configured command "${alias}" is not available`);
  return executable;
}
