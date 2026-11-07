#!/usr/bin/env node
/**
 * Fails when the Studio's first-paint bundle (the entry chunk index.html
 * loads, and its CSS) grows past its budget. Builds the Studio into a
 * temporary directory, never into dist/, so it is safe beside running sketches.
 *
 *   node scripts/bundle-budget.mjs              build, measure, compare
 *   node scripts/bundle-budget.mjs --dir <out>  measure an existing build
 *
 * The budgets are ratchets set at the size on main on 2026-11-06. Lower them
 * when a change makes the entry smaller; do not raise them — move the new
 * code behind a dynamic import instead. The JS budget carries 25 KB of
 * headroom over that size (Marcus, 2026-11-06), so small Studio work lands
 * without a split; spend it on purpose.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BUDGET = {
  entryJsBytes: 1071504 + 25 * 1024,
  // +806 on 2026-11-07 for the scrub number's shared field rules in
  // theme.css (ruler, limit edge, steppers), net of merging VectorInput's
  // duplicated button rules; it is on the Inspector's first paint, so it
  // cannot be split off. Raised by that exact amount, on Marcus's go-ahead.
  entryCssBytes: 239446,
};

const root = path.resolve(import.meta.dirname, '..');

export function measureEntry(outDir) {
  const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  const script = html.match(/<script[^>]*type="module"[^>]*src="\/?([^"]+\.js)"/)?.[1];
  const styles = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="\/?([^"]+\.css)"/g)].map((match) => match[1]);
  if (!script) throw new Error(`no module script in ${outDir}/index.html`);
  const size = (file) => fs.statSync(path.join(outDir, file)).size;
  return {
    entryJsBytes: size(script),
    entryCssBytes: styles.reduce((sum, file) => sum + size(file), 0),
    script,
  };
}

function buildStudio() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-budget-'));
  execFileSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CASCADE_DIST_DIR: outDir },
  });
  return outDir;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const given = process.argv.indexOf('--dir');
  const outDir = given >= 0 ? path.resolve(process.argv[given + 1]) : buildStudio();
  try {
    const measured = measureEntry(outDir);
    const over = Object.keys(BUDGET).filter((key) => measured[key] > BUDGET[key]);
    for (const key of Object.keys(BUDGET)) {
      console.log(`[bundle] ${key}: ${measured[key]} of ${BUDGET[key]}${measured[key] > BUDGET[key] ? '  OVER' : ''}`);
    }
    if (over.length) {
      console.error('[bundle] the Studio entry grew past its budget: load the new code with a dynamic import, or remove something from the entry.');
      process.exit(1);
    }
  } finally {
    if (given < 0) fs.rmSync(outDir, { recursive: true, force: true });
  }
}
