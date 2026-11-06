/**
 * `cascade doctor [project-directory] [--fix] [--json]`: what a headless run
 * in this project will find, checked before a render fails on it.
 *
 * - the declared Python environment (cascade.json "python"): there and
 *   current, or with `--fix` created/updated in `.cascade-cache/python/venv`;
 * - the interpreter stages will run under, and that it starts;
 * - ffmpeg (videos) and the headless canvas (drawing nodes), which are
 *   optional and so only warnings.
 *
 * Exits 1 when something the project declares is not ready.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { provisionPythonEnv, pythonEnvStatus } from '../../server/src/pythonEnv.js';

export interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  /** A failed optional check is a warning and does not fail the command. */
  readonly optional?: boolean;
  readonly detail: string;
}

export const DOCTOR_USAGE = 'cascade doctor [project-directory] [--fix] [--json]';

export async function runDoctorCommand(args: string[]): Promise<void> {
  const fix = args.includes('--fix');
  const json = args.includes('--json');
  const root = path.resolve(args.slice(1).find((arg) => !arg.startsWith('-')) ?? '.');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`${root} is not a directory`);
  const checks = await doctor(root, { fix, log: (line) => { if (!json) console.log(line); } });
  const ok = checks.every((check) => check.ok || check.optional);
  if (json) process.stdout.write(`${JSON.stringify({ project: root, ok, checks })}\n`);
  else for (const check of checks) console.log(`${check.ok ? 'ok  ' : check.optional ? 'warn' : 'FAIL'}  ${check.name}: ${check.detail}`);
  if (!ok) {
    // Under --json the envelope's error is what stderr said: say which check.
    if (json) console.error(checks.filter((check) => !check.ok && !check.optional).map((check) => `${check.name}: ${check.detail}`).join('\n'));
    process.exitCode = 1;
  }
}

export async function doctor(root: string, options: { fix?: boolean; log?: (line: string) => void } = {}): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  let env;
  try {
    env = pythonEnvStatus(root);
    if (env.declared && env.state !== 'current' && options.fix) env = await provisionPythonEnv(root, options.log);
    checks.push(env.state === 'none'
      ? { name: 'python environment', ok: true, detail: 'none declared (cascade.json "python": { "requirements": [...] } provisions one)' }
      : env.state === 'current'
        ? { name: 'python environment', ok: true, detail: `current, ${path.relative(root, env.directory)}` }
        : { name: 'python environment', ok: false, detail: `${env.state}: ${env.reason}. Run cascade doctor --fix` });
  } catch (error) {
    checks.push({ name: 'python environment', ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  if (hasStages(root)) {
    try {
      const { ProjectRoot } = await import('../../server/src/project.js');
      const { readStageConfig } = await import('../../server/src/stageRunner.js');
      const { python } = readStageConfig(new ProjectRoot(root));
      const version = await output(python, ['-c', 'import sys; print(sys.version.split()[0], sys.executable)'], root);
      checks.push({ name: 'stage interpreter', ok: true, detail: `Python ${version}` });
    } catch (error) {
      checks.push({ name: 'stage interpreter', ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  }

  const { hasFfmpeg } = await import('./encode.js');
  checks.push((await hasFfmpeg())
    ? { name: 'ffmpeg', ok: true, detail: 'on the PATH' }
    : { name: 'ffmpeg', ok: false, optional: true, detail: 'not on the PATH: --mp4 and cascade render videos need it (brew install ffmpeg)' });

  const { canvasAvailable, CANVAS_PACKAGE } = await import('./headlessCanvas.js');
  checks.push((await canvasAvailable())
    ? { name: 'headless canvas', ok: true, detail: CANVAS_PACKAGE }
    : { name: 'headless canvas', ok: false, optional: true, detail: `${CANVAS_PACKAGE} is not installed: drawing nodes cannot run headlessly (npm install ${CANVAS_PACKAGE})` });

  return checks;
}

function hasStages(root: string): boolean {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'cascade.json'), 'utf8'));
    return Boolean(manifest?.exec?.stages);
  } catch {
    return false;
  }
}

function output(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} does not start: ${(stderr || error.message).trim().slice(-500)}`));
      else resolve(stdout.trim());
    });
  });
}
