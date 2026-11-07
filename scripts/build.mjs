#!/usr/bin/env node
/**
 * `npm run build` (everything) and `npm run build:cli` (`--cli`: packages, the
 * CLI and the node reference, keeping the current Studio bundle). `--cli`
 * skips the package build when every packages/<name>/dist is newer than its
 * sources (see packagesFresh); `--force` builds them anyway.
 *
 * Order matters: the workspace packages build first, because the Studio and
 * CLI bundles import their output, and a stale package dist is exactly what
 * broke a build once. Every step writes into a staging directory; `dist/` is
 * replaced only when all of them succeed (see atomic-build.mjs).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { atomicBuild } from './atomic-build.mjs';

const root = resolve(import.meta.dirname, '..');
const cliOnly = process.argv.includes('--cli');
const force = process.argv.includes('--force');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** Newest (or oldest) mtime under a path, directories included, so a deleted
 *  source file still counts as a change (its directory's mtime moves). */
function mtimes(path, pick) {
  if (!fs.existsSync(path)) return null;
  const stat = fs.statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let found = pick === 'newest' ? stat.mtimeMs : null;
  for (const entry of fs.readdirSync(path)) {
    const value = mtimes(join(path, entry), pick);
    if (value === null) continue;
    if (found === null || (pick === 'newest' ? value > found : value < found)) found = value;
  }
  return found;
}

/**
 * Whether every workspace package's dist was built after its last source
 * change: `build --cli` then skips the package build (2.2 of its 3.5 s).
 * Inputs are src/, package.json and tsconfig*.json; the dist time is its
 * oldest file, since each package build empties dist first. `--force`, a
 * missing dist, or any newer input rebuilds all three, in order.
 */
function packagesFresh() {
  return ['contracts', 'runtime', 'kit'].every((name) => {
    const dir = resolve(root, 'packages', name);
    const built = mtimes(join(dir, 'dist'), 'oldest');
    if (built === null) return false;
    const inputs = [join(dir, 'src'), join(dir, 'package.json'), ...fs.readdirSync(dir).filter((file) => /^tsconfig.*\.json$/.test(file)).map((file) => join(dir, file))];
    return inputs.every((input) => (mtimes(input, 'newest') ?? 0) < built);
  });
}

const skipPackages = cliOnly && !force && packagesFresh();
if (skipPackages) console.log('[build] packages/*/dist is newer than src: package build skipped (--force rebuilds)');

const run = (command, args) => (staging) => execFileSync(command, args, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CASCADE_DIST_DIR: staging },
});

const steps = [
  ...(skipPackages ? [] : [{ name: 'packages (contracts, runtime, kit)', run: run(npm, ['run', 'build:workspaces']) }]),
  ...(cliOnly ? [] : [{ name: 'studio (vite)', run: run(process.execPath, [resolve(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']) }]),
  { name: 'copy package builds', run: run(process.execPath, [resolve(root, 'scripts', 'copy-package-builds.mjs')]) },
  { name: 'cli, shims and player', run: run(process.execPath, [resolve(root, 'scripts', 'build-cli.mjs')]) },
  { name: 'node reference', run: run(npm, ['run', 'build:node-reference']) },
];

try {
  await atomicBuild({ distDir: resolve(root, 'dist'), steps, seedFromExisting: cliOnly });
} catch (error) {
  console.error(`[build] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
