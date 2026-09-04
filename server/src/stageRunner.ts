/**
 * Run a project's Python stage without an HTTP request.
 *
 * The exec route does this for the page; a headless host needs the same thing
 * with no Express in the picture, and duplicating it in the CLI is how the two
 * would drift. So the mechanics live here and both callers use them.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import type { ProjectRoot } from './project.js';

const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BUFFER = 64 * 1024 * 1024;

export interface StageConfig {
  python: 'python' | 'python3';
  entrypoint: string;
  worker?: string;
}

export interface StageRunOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly timeout?: number;
  readonly signal?: AbortSignal;
}

/**
 * Reads exec.stages from cascade.json.
 *
 * Straight from the file rather than through readProjectManifest, which
 * projects the manifest down to its declared settings and drops `exec` —
 * reading it there reports every configured project as having no stages.
 */
export function readStageConfig(project: ProjectRoot): StageConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(project.resolve('cascade.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Project stages are not configured; add exec.stages to cascade.json');
    }
    throw new Error(`Cannot read cascade.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  const stages = (raw as { exec?: { stages?: unknown } })?.exec?.stages;
  const value = stages && typeof stages === 'object' && !Array.isArray(stages)
    ? stages as Record<string, unknown>
    : null;
  const entrypoint = value && typeof value.entrypoint === 'string' ? value.entrypoint : '';
  if (!entrypoint) {
    throw new Error('Project stages are not configured; add exec.stages.entrypoint to cascade.json');
  }
  // Resolving it here keeps a stage path inside the project, the same check the
  // HTTP route makes.
  project.resolve(entrypoint);
  const worker = typeof value?.worker === 'string' && value.worker ? value.worker : undefined;
  if (value?.worker !== undefined && !worker) {
    throw new Error('cascade.json exec.stages.worker must be a project-relative path');
  }
  if (worker) project.resolve(worker);
  return { python: value?.python === 'python' ? 'python' : 'python3', entrypoint, ...(worker ? { worker } : {}) };
}

/**
 * Invoke one stage and return its parsed result.
 *
 * The dispatcher's answer is the LAST line it printed, so a stage that logs on
 * its way through does not corrupt its own return value — and an `error` field
 * in that answer is raised here, because a stage that reports failure as data
 * would otherwise pass silently.
 */
export async function runProjectStage(
  project: ProjectRoot,
  stage: string,
  args: Record<string, unknown>,
  options: StageRunOptions = {},
): Promise<unknown> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(stage)) {
    throw new Error('stage contains unsupported characters');
  }
  const { python, entrypoint } = readStageConfig(project);
  const script = project.resolve(entrypoint);
  const payload = JSON.stringify(args);
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      python,
      [script, '--stage', stage, '--args', '-'],
      {
        cwd: project.root,
        timeout: options.timeout ?? TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        env: options.env ?? process.env,
        signal: options.signal,
      },
      (error, out, err) => {
        if (error) {
          const output = err?.trim() || out.trim().split('\n').pop() || error.message;
          return reject(new Error(`stage "${stage}" failed: ${output}`));
        }
        resolve(out);
      },
    );
    child.stdin?.end(payload);
  });
  const lastLine = stdout.trim().split('\n').pop() || '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(lastLine);
  } catch {
    throw new Error(`stage "${stage}" returned no JSON: ${lastLine.slice(0, 200)}`);
  }
  if (parsed && typeof parsed === 'object' && 'error' in parsed) {
    throw new Error(`stage "${stage}" failed: ${String((parsed as { error: unknown }).error)}`);
  }
  return parsed;
}
