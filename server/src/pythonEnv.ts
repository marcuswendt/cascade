/**
 * A project's declared Python environment.
 *
 * Commons stages failed for agents on a missing numpy or Pillow, because a
 * stage ran under whatever `python3` was on the PATH. A project can now say
 * what its stages need, in cascade.json:
 *
 *     "python": { "requirements": ["numpy", "Pillow>=10"] }
 *     "python": { "requirements": "requirements.txt", "interpreter": "python3.12" }
 *
 * and Cascade keeps a virtual environment for it inside the project's
 * `.cascade-cache/python/venv` (never system-wide): `cascade doctor` says
 * whether it is there and current, `cascade doctor --fix` creates or updates
 * it. When one is declared, stages run under its interpreter instead of a
 * bare `python`/`python3`; a project-relative `exec.stages.python` still wins.
 *
 * Current means the venv's marker records the same requirements (the list,
 * or the requirements file's contents) and interpreter as cascade.json now.
 */
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface PythonEnvSpec {
  /** pip requirement specifiers, or a project-relative requirements file. */
  readonly requirements: readonly string[] | string;
  /** The interpreter that creates the venv. Default `python3`. */
  readonly interpreter: string;
}

export interface PythonEnvStatus {
  readonly declared: boolean;
  /** The venv directory, absolute. */
  readonly directory: string;
  /** Its interpreter, absolute. */
  readonly python: string;
  readonly state: 'none' | 'missing' | 'stale' | 'current';
  readonly reason?: string;
}

const RELATIVE_DIRECTORY = path.join('.cascade-cache', 'python', 'venv');
const MARKER = 'cascade-env.json';

export function pythonEnvDirectory(root: string): string {
  return path.join(root, RELATIVE_DIRECTORY);
}

export function pythonEnvInterpreter(root: string): string {
  const directory = pythonEnvDirectory(root);
  return process.platform === 'win32' ? path.join(directory, 'Scripts', 'python.exe') : path.join(directory, 'bin', 'python');
}

/** The `python` section of cascade.json, or null when the project declares none. */
export function readPythonEnv(root: string): PythonEnvSpec | null {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(root, 'cascade.json'), 'utf8'));
  } catch {
    return null;
  }
  const value = (raw as { python?: unknown })?.python;
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('cascade.json python must be an object: { "requirements": ["numpy", ...] | "requirements.txt", "interpreter"?: "python3" }');
  }
  const { requirements, interpreter } = value as { requirements?: unknown; interpreter?: unknown };
  const list = Array.isArray(requirements) && requirements.every((item) => typeof item === 'string' && item.trim());
  if (!list && !(typeof requirements === 'string' && requirements.trim())) {
    throw new Error('cascade.json python.requirements must be a list of pip requirements or a project-relative requirements file');
  }
  if (typeof requirements === 'string') containedPath(root, requirements, 'python.requirements');
  if (interpreter !== undefined && (typeof interpreter !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(interpreter))) {
    throw new Error('cascade.json python.interpreter must be an executable name such as python3.12');
  }
  return { requirements: requirements as string[] | string, interpreter: (interpreter as string | undefined) ?? 'python3' };
}

/** What the marker must say for the venv to be current. */
export function pythonEnvKey(root: string, spec: PythonEnvSpec): string {
  const requirements = typeof spec.requirements === 'string'
    ? `file ${spec.requirements}\n${fs.readFileSync(containedPath(root, spec.requirements, 'python.requirements'), 'utf8')}`
    : `list\n${spec.requirements.join('\n')}`;
  return crypto.createHash('sha256').update(`${spec.interpreter}\0${requirements}`).digest('hex');
}

export function pythonEnvStatus(root: string): PythonEnvStatus {
  const directory = pythonEnvDirectory(root);
  const python = pythonEnvInterpreter(root);
  const spec = readPythonEnv(root);
  if (!spec) return { declared: false, directory, python, state: 'none' };
  if (!fs.existsSync(python)) return { declared: true, directory, python, state: 'missing', reason: `no environment at ${path.relative(root, directory)}` };
  let marker: { key?: string } = {};
  try { marker = JSON.parse(fs.readFileSync(path.join(directory, MARKER), 'utf8')); } catch { /* stale below */ }
  let key: string;
  try { key = pythonEnvKey(root, spec); } catch (error) {
    return { declared: true, directory, python, state: 'stale', reason: error instanceof Error ? error.message : String(error) };
  }
  if (marker.key !== key) return { declared: true, directory, python, state: 'stale', reason: 'cascade.json python changed since the environment was built' };
  return { declared: true, directory, python, state: 'current' };
}

/**
 * Create or update the venv: a fresh `<interpreter> -m venv` when it is
 * missing or stale (so a removed requirement goes too), then `pip install`.
 * The old one is moved aside to `_archive/` inside `.cascade-cache/python`
 * rather than deleted, then the marker is written last, so an interrupted
 * install is never reported current.
 */
export async function provisionPythonEnv(root: string, log: (line: string) => void = () => {}): Promise<PythonEnvStatus> {
  const spec = readPythonEnv(root);
  if (!spec) throw new Error('cascade.json declares no python environment ("python": { "requirements": [...] })');
  const before = pythonEnvStatus(root);
  if (before.state === 'current') return before;
  const directory = pythonEnvDirectory(root);
  if (fs.existsSync(directory)) {
    const archive = path.join(path.dirname(directory), '_archive');
    fs.mkdirSync(archive, { recursive: true });
    fs.renameSync(directory, path.join(archive, `venv-${Date.now()}`));
  }
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  const file = typeof spec.requirements === 'string' ? containedPath(root, spec.requirements, 'python.requirements') : undefined;
  const fileHasRequirements = file !== undefined && fs.readFileSync(file, 'utf8').split('\n').some((line) => line.trim() && !line.trim().startsWith('#'));
  const requirements = file !== undefined ? (fileHasRequirements ? ['-r', file] : []) : [...spec.requirements as readonly string[]];
  log(`Creating ${path.relative(root, directory)} with ${spec.interpreter}`);
  await run(spec.interpreter, ['-m', 'venv', ...(requirements.length ? [] : ['--without-pip']), directory], root);
  if (requirements.length) {
    log(`Installing ${typeof spec.requirements === 'string' ? spec.requirements : spec.requirements.join(', ')}`);
    await run(pythonEnvInterpreter(root), ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', ...requirements], root);
  }
  fs.writeFileSync(path.join(directory, MARKER), `${JSON.stringify({ key: pythonEnvKey(root, spec), requirements: spec.requirements, interpreter: spec.interpreter, builtAt: new Date().toISOString() }, null, 2)}\n`);
  return pythonEnvStatus(root);
}

/**
 * The interpreter stages should run under when the project declares an
 * environment, or undefined when it declares none. Throws, naming the command
 * that fixes it, when it is declared and not current: a stage run under the
 * wrong interpreter fails later on an ImportError that says nothing about why.
 */
export function declaredStagePython(root: string): string | undefined {
  const status = pythonEnvStatus(root);
  if (status.state === 'none') return undefined;
  if (status.state !== 'current') {
    throw new Error(`This project declares a Python environment (cascade.json "python") that is ${status.state}: ${status.reason}. Run \`cascade doctor --fix\` in ${root} to build it.`);
  }
  return status.python;
}

function containedPath(root: string, file: string, name: string): string {
  const resolved = path.resolve(root, file);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`cascade.json ${name} must be a project-relative path`);
  return resolved;
}

function run(command: string, args: readonly string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { cwd, maxBuffer: 16 * 1024 * 1024, timeout: 20 * 60_000 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`${path.basename(command)} ${args.slice(0, 3).join(' ')} failed: ${(stderr || error.message).trim().slice(-2000)}`));
      else resolve();
    });
  });
}
