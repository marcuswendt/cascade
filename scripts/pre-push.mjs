#!/usr/bin/env node
/**
 * The pre-push gate, run by `.githooks/pre-push` (installed by `npm install`
 * through the `prepare` script, which points core.hooksPath at .githooks).
 *
 * Git hands the hook one line per ref on stdin: `<local ref> <local sha>
 * <remote ref> <remote sha>`. The files to test are the ones touched by the
 * commits that no remote has yet; if none of them is code (ts, svelte, mjs,
 * js, json), the push goes through untouched. Otherwise it runs
 * `verify.mjs --push`: types, node reference, svelte-check, architecture and
 * the tests related to those files, under 20 s.
 *
 * It checks the working tree, so a colleague's uncommitted edit in the same
 * checkout can fail it. Skip once with `git push --no-verify`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const ZERO = /^0+$/;
const CODE = /\.(ts|svelte|mjs|js|json)$/;

const input = fs.readFileSync(0, 'utf8');
const files = new Set();
for (const line of input.split('\n')) {
  const [, localSha] = line.trim().split(/\s+/);
  if (!localSha || ZERO.test(localSha)) continue; // a branch deletion pushes no code
  const listed = execFileSync('git', ['log', '--format=', '--name-only', localSha, '--not', '--remotes'], { cwd: root, encoding: 'utf8' });
  for (const file of listed.split('\n')) if (file.trim()) files.add(file.trim());
}

const code = [...files].filter((file) => CODE.test(file));
if (!code.length) {
  console.log('[pre-push] no code in the pushed commits; gate skipped');
  process.exit(0);
}
if (!fs.existsSync(path.join(root, 'node_modules'))) {
  console.error('[pre-push] no node_modules in this checkout: run `npm install`, or push with --no-verify');
  process.exit(1);
}

console.log(`[pre-push] ${code.length} code file(s) in the pushed commits`);
const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'verify.mjs'), '--push', '--', ...code], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) console.error('[pre-push] gate failed; fix it, or push once with `git push --no-verify`');
process.exit(result.status ?? 1);
