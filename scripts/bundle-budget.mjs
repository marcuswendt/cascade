#!/usr/bin/env node
/**
 * Fails when the Studio's first-paint bundle (the entry chunk index.html
 * loads, every chunk it modulepreloads, and its CSS) grows past its budget.
 * Builds the Studio into a temporary directory, never into dist/, so it is
 * safe beside running sketches.
 *
 *   node scripts/bundle-budget.mjs              build, measure, compare
 *   node scripts/bundle-budget.mjs --dir <out>  measure an existing build
 *
 * The preloaded chunks count because they load before first paint just the
 * same: once panels went lazy (2026-11-07), Rolldown moved 52 KB the entry
 * shares with them into preloaded chunks, and an entry-only number would
 * have called that a saving.
 *
 * The budgets are ratchets. Lower them when a change makes first paint
 * smaller; do not raise them — move the new code behind a dynamic import
 * instead. Each carries headroom over the size on main (Marcus, 2026-11-06:
 * 25 KB of JS; 10 KB of CSS since 2026-11-07), so small Studio work lands
 * without a split; spend it on purpose.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BUDGET = {
  // 2026-11-07, perf round 2 move 5: Agent (with marked + DOMPurify),
  // Definition, Node Info and Timeline panels lazy; first-paint JS
  // 1,135,042 -> 968,597 B (entry 1,078,049 -> 859,801).
  // 2026-11-07, image-node port: the class image library and ImageBuffer
  // left Studio, ContactSheet and cascade.assert.* arrived (definitions in
  // the built-in list, bodies lazy): 969,706 -> 964,958 B.
  firstPaintJsBytes: 964958 + 25 * 1024,
  // Same change: those panels' CSS left the entry, 239,446 -> 223,490 B.
  // The scrub number's shared field rules in theme.css (+806, then −19,
  // 2026-11-07, on Marcus's go-ahead) sit on the Inspector's first paint and
  // come out of this headroom.
  entryCssBytes: 223490 + 10 * 1024,
};

const root = path.resolve(import.meta.dirname, '..');

export function measureEntry(outDir) {
  const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  const script = html.match(/<script[^>]*type="module"[^>]*src="\/?([^"]+\.js)"/)?.[1];
  const styles = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="\/?([^"]+\.css)"/g)].map((match) => match[1]);
  const preloads = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="\/?([^"]+\.js)"/g)].map((match) => match[1]);
  if (!script) throw new Error(`no module script in ${outDir}/index.html`);
  const size = (file) => fs.statSync(path.join(outDir, file)).size;
  return {
    firstPaintJsBytes: [script, ...preloads].reduce((sum, file) => sum + size(file), 0),
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
