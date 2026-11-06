#!/usr/bin/env node
/**
 * `npm run verify`: every gate, in order, stopping at the first failure.
 * `npm run verify -- --fast` (or `npm run verify:fast`): the type gate, the
 * generated-file and architecture checks, and the tests related to files
 * changed since HEAD — the loop to run while iterating.
 *
 * Full: packages build -> types (src + tests, server) -> package types ->
 * node reference -> svelte-check -> vitest -> package tests -> Studio bundle
 * budget. Prints each step's time and the load average, since timings on a
 * shared machine mean little without it.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const fast = process.argv.includes('--fast');
const node = process.execPath;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const bin = (...parts) => path.join(root, 'node_modules', ...parts);
const tsc = bin('typescript', 'bin', 'tsc');
const vitest = bin('vitest', 'vitest.mjs');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${path.basename(command)} ${args.join(' ')} exited ${result.status ?? result.signal}`);
};

/**
 * Type errors in tests/ that predate this gate (2026-11-06), per file. A file
 * may lose errors, never gain them; anything not listed must be clean, and
 * src/ has none. Fix tests, then lower or delete their line.
 */
const KNOWN_TEST_TYPE_ERRORS = {
  'server/src/runtime/shell.ts': 1,
  'tests/agent-console.test.ts': 3,
  'tests/atomic-build.test.ts': 1,
  'tests/bundle-ports.test.ts': 3,
  'tests/camera.test.ts': 1,
  'tests/cli-project-runtime.test.ts': 2,
  'tests/cli-render.test.ts': 3,
  'tests/components/agent-draft.test.ts': 1,
  'tests/components/agent-panel-draft.test.ts': 2,
  'tests/components/inspector-multi-select.test.ts': 2,
  'tests/components/parameter-drag-source.test.ts': 1,
  'tests/components/value-scrub.test.ts': 6,
  'tests/cook-overlap.test.ts': 3,
  'tests/cook-scheduler.test.ts': 1,
  'tests/core-nodes.test.ts': 1,
  'tests/definition-node-studio.test.ts': 21,
  'tests/editor-export.test.ts': 5,
  'tests/expression-math-functions.test.ts': 1,
  'tests/expression-time-variables.test.ts': 2,
  'tests/expressions.test.ts': 6,
  'tests/frame-range.test.ts': 2,
  'tests/geo-render.test.ts': 2,
  'tests/gpu-capability.test.ts': 1,
  'tests/graph.test.ts': 1,
  'tests/monaco-worker-routing.test.ts': 3,
  'tests/node-execution.test.ts': 3,
  'tests/node-io.test.ts': 14,
  'tests/panel-param-writes.test.ts': 1,
  'tests/parameter-promotion.test.ts': 3,
  'tests/performance/connections.perf.test.ts': 2,
  'tests/performance/runtime-inputs.perf.test.ts': 2,
  'tests/player-app.test.ts': 6,
  'tests/player-assets.test.ts': 1,
  'tests/pop-cache.test.ts': 4,
  'tests/runtime-gpu-host.test.ts': 1,
  'tests/serialization.test.ts': 3,
  'tests/server-shell.test.ts': 1,
  'tests/settings-store-migration.test.ts': 1,
};

function typecheckSourceAndTests() {
  const result = spawnSync(node, [tsc, '-p', 'tsconfig.tests.json', '--pretty', 'false'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lines = `${result.stdout}${result.stderr}`.split('\n').filter((line) => line.includes(': error TS'));
  const byFile = {};
  for (const line of lines) {
    const file = line.slice(0, line.indexOf('('));
    (byFile[file] ??= []).push(line);
  }
  const failures = Object.entries(byFile).filter(([file, errors]) => errors.length > (KNOWN_TEST_TYPE_ERRORS[file] ?? 0));
  for (const [file, errors] of failures) {
    console.error(`${file}: ${errors.length} type errors (allowed ${KNOWN_TEST_TYPE_ERRORS[file] ?? 0})`);
    for (const error of errors) console.error(`  ${error}`);
  }
  const improved = Object.entries(KNOWN_TEST_TYPE_ERRORS).filter(([file, allowed]) => (byFile[file]?.length ?? 0) < allowed);
  for (const [file, allowed] of improved) console.log(`[verify] ${file}: ${byFile[file]?.length ?? 0} type errors, allowed ${allowed}; lower its line in scripts/verify.mjs`);
  if (result.status !== 0 && !lines.length) throw new Error(`tsc failed without type errors:\n${result.stdout}${result.stderr}`);
  if (failures.length) throw new Error('new type errors (above)');
}

function changedFiles() {
  try {
    const listed = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
    return listed.split('\n').map((line) => line.slice(3).split(' -> ').pop()?.trim()).filter((file) => file && /\.(ts|svelte|mjs)$/.test(file) && fs.existsSync(path.join(root, file)));
  } catch {
    return [];
  }
}

const packagesBuilt = ['contracts', 'runtime', 'kit'].every((name) => fs.existsSync(path.join(root, 'packages', name, 'dist')));

const steps = [
  // tsc, the package tests and every alias import read packages/*/dist.
  { name: 'packages build', run: () => run(npm, ['run', '--silent', 'build:workspaces']), skip: fast && packagesBuilt },
  {
    // The player and editor-export tests bundle against the published
    // dist/contracts and dist/runtime; verify reads dist/ but never writes it.
    name: 'built CLI present',
    run: () => {
      if (!fs.existsSync(path.join(root, 'dist', 'contracts', 'index.js'))) throw new Error('dist/ has no package build: run `npm run build:cli` once in this checkout');
    },
  },
  { name: 'types: src + tests', run: typecheckSourceAndTests },
  { name: 'types: server', run: () => run(node, [tsc, '-p', 'server/tsconfig.json', '--noEmit']) },
  { name: 'types: packages', run: () => run(npm, ['run', '--silent', 'check:packages']), skip: fast },
  { name: 'node reference current', run: () => run(node, ['--import', 'tsx', 'scripts/build-node-reference.mjs', '--check']) },
  { name: 'svelte-check', run: () => run(node, [bin('svelte-check', 'bin', 'svelte-check'), '--tsconfig', './tsconfig.json', '--threshold', 'error', '--output', 'human']), skip: fast },
  { name: 'architecture', run: () => run(node, [vitest, 'run', 'tests/architecture-']), skip: !fast },
  {
    name: 'related tests',
    skip: !fast,
    run: () => {
      const files = changedFiles();
      if (!files.length) return console.log('[verify] nothing changed since HEAD');
      run(node, [vitest, 'related', '--run', '--passWithNoTests', ...files]);
    },
  },
  { name: 'vitest', run: () => run(node, [vitest, 'run']), skip: fast },
  {
    name: 'package tests',
    skip: fast,
    run: () => {
      for (const name of ['contracts', 'runtime', 'kit']) run(node, ['--test', 'test/*.test.mjs'], { cwd: path.join(root, 'packages', name) });
    },
  },
  { name: 'Studio bundle budget', run: () => run(node, ['scripts/bundle-budget.mjs']), skip: fast },
];

const load = () => os.loadavg().map((value) => value.toFixed(1)).join(' ');
const timings = [];
const started = Date.now();
let failed = null;
console.log(`[verify] ${fast ? 'fast' : 'full'}; load ${load()}`);
for (const step of steps) {
  if (step.skip) continue;
  const t0 = Date.now();
  console.log(`\n[verify] ${step.name}`);
  try {
    await step.run();
    timings.push([step.name, Date.now() - t0, 'ok']);
  } catch (error) {
    timings.push([step.name, Date.now() - t0, 'FAILED']);
    failed = { step: step.name, error };
    break;
  }
}
console.log('\n[verify] step                         seconds');
for (const [name, ms, status] of timings) console.log(`[verify] ${name.padEnd(28)} ${(ms / 1000).toFixed(1).padStart(6)}  ${status}`);
console.log(`[verify] total ${((Date.now() - started) / 1000).toFixed(1)} s; load ${load()}`);
if (failed) {
  console.error(`[verify] FAILED at ${failed.step}: ${failed.error instanceof Error ? failed.error.message : failed.error}`);
  process.exit(1);
}
