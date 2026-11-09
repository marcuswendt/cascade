#!/usr/bin/env node
/**
 * `npm install` (the `prepare` script) points this checkout's git hooks at
 * the tracked `.githooks/` folder, so every clone and worktree gets the
 * pre-push gate. Does nothing outside a git checkout (a packed install).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
if (!fs.existsSync(path.join(root, '.git')) || !fs.existsSync(path.join(root, '.githooks'))) process.exit(0);
const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, stdio: 'inherit' });
if (result.status === 0) fs.chmodSync(path.join(root, '.githooks', 'pre-push'), 0o755);
