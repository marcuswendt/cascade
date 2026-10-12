#!/usr/bin/env node
/**
 * `npm run build` (everything) and `npm run build:cli` (`--cli`: packages, the
 * CLI and the node reference, keeping the current Studio bundle).
 *
 * Order matters: the workspace packages build first, because the Studio and
 * CLI bundles import their output, and a stale package dist is exactly what
 * broke a build once. Every step writes into a staging directory; `dist/` is
 * replaced only when all of them succeed (see atomic-build.mjs).
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { atomicBuild } from './atomic-build.mjs';

const root = resolve(import.meta.dirname, '..');
const cliOnly = process.argv.includes('--cli');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const run = (command, args) => (staging) => execFileSync(command, args, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CASCADE_DIST_DIR: staging },
});

const steps = [
  { name: 'packages (contracts, runtime)', run: run(npm, ['run', 'build:workspaces']) },
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
