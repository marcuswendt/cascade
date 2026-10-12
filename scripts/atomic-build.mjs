/**
 * Build into a staging directory and swap it in only when every step passed.
 *
 * Vite empties `dist/` before it builds, so a step that failed afterwards (on
 * one occasion a stale `packages/contracts/dist` missing an export) used to
 * leave no CLI at all. Here the live `dist/` is never written to: steps write
 * to `.dist-staging/` beside it, and the swap is two renames on the same
 * filesystem. A failure deletes the staging directory and leaves `dist/` as it
 * was.
 */
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export class BuildStepError extends Error {
  constructor(step, cause) {
    super(`build step "${step}" failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.step = step;
    this.cause = cause;
  }
}

/**
 * @param {object} options
 * @param {string} options.distDir           the directory to replace, e.g. <repo>/dist
 * @param {{ name: string, run: (staging: string) => unknown }[]} options.steps
 * @param {boolean} [options.seedFromExisting] start staging as a copy of distDir (for partial rebuilds)
 * @param {(message: string) => void} [options.log]
 */
export async function atomicBuild({ distDir, steps, seedFromExisting = false, log = console.log }) {
  const parent = dirname(distDir);
  const name = basename(distDir);
  const staging = join(parent, `.${name}-staging`);
  const previous = join(parent, `.${name}-previous`);

  rmSync(staging, { recursive: true, force: true });
  if (seedFromExisting && existsSync(distDir)) cpSync(distDir, staging, { recursive: true });
  else mkdirSync(staging, { recursive: true });

  for (const step of steps) {
    log(`[build] ${step.name}`);
    try {
      await step.run(staging);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      log(`[build] FAILED at "${step.name}"; ${name}/ left as it was`);
      throw new BuildStepError(step.name, error);
    }
  }

  rmSync(previous, { recursive: true, force: true });
  if (existsSync(distDir)) renameSync(distDir, previous);
  try {
    renameSync(staging, distDir);
  } catch (error) {
    if (existsSync(previous)) renameSync(previous, distDir);
    throw error;
  }
  rmSync(previous, { recursive: true, force: true });
  log(`[build] ${name}/ replaced`);
}
