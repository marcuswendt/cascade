/**
 * Measures the repository's shape for the architecture ratchets in
 * tests/architecture-*.test.ts: the import graph (layers, cycles, files nothing
 * imports), file sizes, and duplicated blocks. Regex over the source rather
 * than the TypeScript API, so it reads all ~450 files in well under a second.
 *
 * `node scripts/architecture.mjs [--root=<checkout>]` prints the current numbers.
 */
import fs from 'node:fs';
import path from 'node:path';

// `--root=<checkout>` measures another checkout (a before/after comparison).
const rootArgument = process.argv.find((arg) => arg.startsWith('--root='));
export const ROOT = path.resolve(rootArgument ? rootArgument.slice('--root='.length) : path.join(import.meta.dirname, '..'));

const SKIP = new Set(['node_modules', 'dist', '.git', 'archive', '.omx']);
const CODE = /\.(ts|svelte|mjs|js)$/;

/** Repo-relative POSIX paths of matching files under each directory. */
export function listFiles(dirs, match = CODE) {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIP.has(entry.name)) walk(full); }
      else if (match.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  };
  for (const dir of dirs) walk(path.join(ROOT, dir));
  return out.sort();
}

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** Lines as `wc -l` plus one for a final unterminated line (what an editor shows). */
export const lineCount = (file) => read(file).split('\n').length;

/** Production code: what the layer, cycle and dead-file rules apply to. */
export const SOURCE_DIRS = ['src', 'packages/contracts/src', 'packages/runtime/src', 'packages/kit/src', 'server/src', 'scripts'];

const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

const IMPORT = /(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * file -> { files: imported repo files, bare: [{ spec, typeOnly }] }.
 * Aliases resolve to source: `@/` is src/, `@cascade/<pkg>[/<sub>]` is packages/<pkg>/src.
 */
export function importGraph(files = listFiles(SOURCE_DIRS)) {
  const known = new Set(files);
  const resolve = (from, spec) => {
    let base;
    if (spec.startsWith('.')) base = path.posix.join(path.posix.dirname(from), spec);
    else if (spec.startsWith('@/')) base = `src/${spec.slice(2)}`;
    else {
      const match = spec.match(/^@cascade\/(contracts|runtime)(?:\/(.*))?$/);
      if (!match) return undefined;
      base = `packages/${match[1]}/src/${match[2] ?? 'index'}`;
    }
    const stem = base.replace(/\.(js|mjs|ts)$/, '');
    for (const candidate of [base, `${stem}.ts`, `${stem}.svelte`, `${stem}.mjs`, `${stem}.js`, `${base}.ts`, `${base}.svelte`, `${stem}/index.ts`]) {
      if (known.has(candidate)) return candidate;
    }
    return null;
  };
  const graph = new Map();
  for (const file of files) {
    const text = stripComments(read(file));
    const imports = new Set();
    const bare = [];
    for (const match of text.matchAll(IMPORT)) {
      const spec = match[2] ?? match[3];
      const target = resolve(file, spec);
      if (target === undefined) bare.push({ spec, typeOnly: Boolean(match[1]) });
      else if (target && target !== file) imports.add(target);
    }
    graph.set(file, { files: [...imports].sort(), bare });
  }
  return graph;
}

/** Strongly connected groups of more than one file (Tarjan), each sorted. */
export function importCycles(graph) {
  let next = 0;
  const index = new Map(); const low = new Map(); const stack = []; const onStack = new Set(); const groups = [];
  const visit = (v) => {
    index.set(v, next); low.set(v, next); next++; stack.push(v); onStack.add(v);
    for (const w of graph.get(v)?.files ?? []) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const group = []; let w;
      do { w = stack.pop(); onStack.delete(w); group.push(w); } while (w !== v);
      if (group.length > 1) groups.push(group.sort());
    }
  };
  for (const file of graph.keys()) if (!index.has(file)) visit(file);
  return groups.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

const under = (file, ...prefixes) => prefixes.some((prefix) => file.startsWith(prefix));
const STUDIO = (file) => under(file, 'src/editor/') || /^src\/[^/]+$/.test(file);

/**
 * The boundaries ARCHITECTURE.md states, as edges that break them.
 * Each entry: { rule, from, to } where `to` is a repo file or a bare specifier.
 */
export function layerViolations(graph) {
  const out = [];
  for (const [from, { files, bare }] of graph) {
    const edges = [...files.map((to) => ({ to, bare: false })), ...bare.map(({ spec, typeOnly }) => ({ to: typeOnly ? `type ${spec}` : spec, bare: true }))];
    for (const { to, bare: isBare } of edges) {
      if (under(from, 'packages/contracts/src/') && (isBare || !under(to, 'packages/contracts/src/'))) {
        out.push({ rule: 'contracts imports nothing outside contracts', from, to });
      }
      if (under(from, 'packages/runtime/src/')) {
        const ok = isBare ? to === '@cascade/contracts' : under(to, 'packages/runtime/src/', 'packages/contracts/src/');
        if (!ok) out.push({ rule: 'runtime imports only contracts', from, to });
      }
      if (!isBare && under(from, 'src/engine/', 'src/nodes/', 'src/cli/', 'src/player/') && STUDIO(to)) {
        out.push({ rule: 'engine, nodes, cli and player do not import the Studio editor', from, to });
      }
      if (!isBare && under(from, 'server/src/') && under(to, 'src/')) {
        out.push({ rule: 'server does not import src', from, to });
      }
      if (!isBare && !under(from, 'packages/kit/') && under(to, 'packages/kit/')) {
        out.push({ rule: 'the core does not import the sketch kit', from, to });
      }
    }
  }
  return out;
}

/** Source files no other source file imports (entry points are expected here). */
export function unimportedFiles(graph) {
  const imported = new Set();
  for (const { files } of graph.values()) for (const file of files) imported.add(file);
  return [...graph.keys()].filter((file) => /\.(ts|svelte)$/.test(file) && !/\/(main|index)\.ts$/.test(file) && !imported.has(file));
}

/** Every code file (source, tests, scripts) with its line count, over `limit` lines. */
export function filesOver(limit) {
  const files = listFiles(['src', 'packages', 'server/src', 'scripts', 'tests']);
  return files.map((file) => [file, lineCount(file)]).filter(([, lines]) => lines > limit).sort((a, b) => b[1] - a[1]);
}

/**
 * Lines in a 10-line window of normalised code that appears more than once
 * (a jscpd approximation; round 1 measured 2,360 with the same method).
 */
export function duplicatedLines() {
  const WINDOW = 10;
  const files = listFiles(['src', 'packages', 'server/src'], /\.(ts|svelte)$/);
  const windows = new Map();
  for (const file of files) {
    const lines = read(file).split('\n').map((text, i) => ({ text: text.trim(), line: i + 1 }))
      .filter(({ text }) => text.length > 3 && !/^(\/\/|\/\*|\*|import |export \{|\}|\)|\];?$|\};?$)/.test(text));
    for (let k = 0; k + WINDOW <= lines.length; k++) {
      const key = lines.slice(k, k + WINDOW).map(({ text }) => text).join('\n');
      const at = windows.get(key);
      if (at) at.push([file, lines[k].line]); else windows.set(key, [[file, lines[k].line]]);
    }
  }
  const duplicated = new Map();
  for (const at of windows.values()) {
    if (at.length < 2) continue;
    for (const [file, line] of at) {
      const set = duplicated.get(file) ?? new Set();
      for (let j = 0; j < WINDOW + 3; j++) set.add(line + j);
      duplicated.set(file, set);
    }
  }
  let total = 0;
  const byFile = {};
  for (const [file, set] of duplicated) { total += set.size; byFile[file] = set.size; }
  return { total, byFile };
}

/** Production source lines (ts, svelte, css) in src, packages/*\/src and server/src. */
export function sourceLines() {
  const files = listFiles(['src', 'packages/contracts/src', 'packages/runtime/src', 'packages/kit/src', 'server/src'], /\.(ts|svelte|css)$/);
  return files.reduce((sum, file) => sum + read(file).split('\n').length, 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const graph = importGraph();
  const cycles = importCycles(graph);
  console.log(JSON.stringify({
    sourceLines: sourceLines(),
    files: graph.size,
    cycles: cycles.map((group) => group.length),
    layerViolations: layerViolations(graph),
    unimported: unimportedFiles(graph),
    filesOver750: filesOver(750),
    duplicatedLines: duplicatedLines().total,
  }, null, 1));
}
