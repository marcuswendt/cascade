/**
 * The code a lock keeps, and the project a replay rebuilds from it.
 *
 * A lock has to replay without checking out the commit it was made at. The
 * weekend that motivated this needed sixteen `cloud-plots-locked-<commit>`
 * worktrees to rebuild sixteen approved pieces. So a lock snapshots the
 * project's source files (node modules, Python stages, shared libraries) into
 * the object store, and a replay builds a throwaway copy of the project with
 * exactly those sources in it.
 *
 * What counts as source: every file git would track (tracked, or untracked and
 * not ignored) with a code extension, in the project and in any directory it
 * links to (`shared/` -> `../cloud-shared`). Data, environments and outputs are
 * not stored; the lock records the hashes of the inputs it read instead.
 */
import { execFile } from 'node:child_process';
import fssync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { digestFile, getObject, putObject, stableJson, type Digest } from './store.js';

const run = promisify(execFile);

/** Extensions read as code. Anything else in the tree is data and is not stored. */
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.svelte',
  '.py', '.wgsl', '.glsl', '.vert', '.frag', '.json',
]);

/** Above this a `.json` or `.py` is data that happens to have a code extension. */
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

/** Never part of the snapshot, and never copied into a replay. */
const NEVER = new Set(['.git', '.cascade', '.cascade-cache', 'locks', 'node_modules', '__pycache__']);

/** Path (project-relative, `/`-separated) to the hash of its bytes. */
export type SourceTree = Record<string, Digest>;

export interface CollectedSources {
  /** Path to absolute file on disk. */
  readonly files: Map<string, string>;
  /** Code-extension files left out for size, so a lock can say so. */
  readonly skipped: string[];
}

/** Every source file in the project, following directory links once each. */
export async function collectSources(projectRoot: string): Promise<CollectedSources> {
  const files = new Map<string, string>();
  const skipped: string[] = [];
  const visited = new Set<string>();

  const visit = async (directory: string, prefix: string): Promise<void> => {
    const real = await fs.realpath(directory);
    if (visited.has(real)) return;
    visited.add(real);
    for (const relative of await listCandidates(real)) {
      const name = path.posix.join(prefix, relative);
      if (name.split('/').some((part) => NEVER.has(part))) continue;
      const absolute = path.join(real, relative);
      let stat: fssync.Stats;
      try { stat = await fs.stat(absolute); } catch { continue; }
      if (stat.isDirectory()) {
        // git lists a symlinked directory as one entry; its contents are code
        // the project runs (`shared/`), so walk it as part of the project.
        await visit(absolute, name);
        continue;
      }
      if (!stat.isFile() || !isSource(name)) continue;
      if (stat.size > MAX_SOURCE_BYTES) skipped.push(name);
      else files.set(name, absolute);
    }
  };

  await visit(projectRoot, '');
  return { files, skipped: skipped.sort() };
}

function isSource(name: string): boolean {
  if (name.endsWith('.cascade')) return false; // graphs are stored by the lock itself
  return SOURCE_EXTENSIONS.has(path.posix.extname(name).toLowerCase());
}

/**
 * The files git would consider part of a directory, relative to it. Outside a
 * repository, a plain walk that skips hidden directories and environments.
 */
async function listCandidates(directory: string): Promise<string[]> {
  try {
    const { stdout } = await run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: directory,
      maxBuffer: 64 * 1024 * 1024,
    });
    return [...new Set(stdout.split('\0').filter(Boolean))];
  } catch {
    const found: string[] = [];
    const walk = async (relative: string): Promise<void> => {
      for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
        if (entry.name.startsWith('.') || NEVER.has(entry.name) || entry.name === 'venv') continue;
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(name);
        else found.push(name);
      }
    };
    await walk('');
    return found;
  }
}

/** Hash every collected file. */
export async function hashSources(sources: CollectedSources): Promise<SourceTree> {
  const tree: SourceTree = {};
  for (const name of [...sources.files.keys()].sort()) tree[name] = await digestFile(sources.files.get(name)!);
  return tree;
}

/**
 * Store every source file and the tree that lists them. Returns the tree's own
 * id, which is what a lock records: one hash that names all of the code.
 */
export async function storeSources(projectRoot: string, sources: CollectedSources): Promise<{ id: Digest; tree: SourceTree }> {
  const tree: SourceTree = {};
  for (const name of [...sources.files.keys()].sort()) {
    tree[name] = await putObject(projectRoot, await fs.readFile(sources.files.get(name)!));
  }
  const id = await putObject(projectRoot, stableJson({ format: 'cascade.tree', version: 1, files: tree }, ['format', 'version']));
  return { id, tree };
}

export async function readTree(projectRoot: string, id: Digest): Promise<SourceTree> {
  const parsed = JSON.parse((await getObject(projectRoot, id)).toString('utf8'));
  if (parsed?.format !== 'cascade.tree') throw new Error(`Object ${id} is not a source tree`);
  return parsed.files as SourceTree;
}

export interface TreeDiff {
  readonly changed: string[];
  readonly added: string[];
  readonly removed: string[];
}

/** What differs between a stored tree and another (usually the live project's). */
export function diffTrees(locked: SourceTree, other: SourceTree): TreeDiff {
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [name, id] of Object.entries(locked)) {
    if (!(name in other)) removed.push(name);
    else if (other[name] !== id) changed.push(name);
  }
  const added = Object.keys(other).filter((name) => !(name in locked));
  return { changed: changed.sort(), added: added.sort(), removed: removed.sort() };
}

/**
 * Build a throwaway copy of the project in which the code is exactly the
 * stored tree.
 *
 * 1. The live project is copied in, as an APFS clone where the platform has
 *    one (`cp -c`: instant, and copy-on-write, so a replay that writes a file
 *    never touches the original). A link to a sibling directory (`shared/`)
 *    is copied as the directory it points at, so path confinement still holds.
 *    Environments (`node_modules`, hidden folders such as `.venv`) are linked
 *    rather than copied; nothing reads them through project paths. The cache
 *    is left out, so every stage cooks fresh.
 * 2. Source files that are live now and were not in the lock are removed.
 * 3. Every stored file is written over its path.
 */
export async function materialize(projectRoot: string, tree: SourceTree, into: string): Promise<void> {
  await fs.mkdir(into, { recursive: true });
  const target = await fs.realpath(into);
  const tops = new Set(Object.keys(tree).map((name) => name.split('/')[0]!));

  for (const entry of await fs.readdir(projectRoot, { withFileTypes: true })) {
    if (NEVER.has(entry.name) && entry.name !== 'node_modules') continue;
    const source = path.join(projectRoot, entry.name);
    const destination = path.join(target, entry.name);
    const environment = (entry.name.startsWith('.') || entry.name === 'node_modules') && !tops.has(entry.name);
    if (environment) await fs.symlink(source, destination);
    else await cloneInto(await fs.realpath(source), destination);
  }

  // Listed from the live project, where git can say what is source; the copy
  // has no repository, and a plain walk there would also take ignored data.
  const live = await collectSources(projectRoot);
  for (const name of live.files.keys()) {
    if (!(name in tree)) await fs.rm(path.join(target, name), { force: true });
  }

  for (const [name, id] of Object.entries(tree)) {
    const file = path.join(target, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Refuse to write through a link that leaves the copy: a replay must never
    // change the live project.
    const parent = await fs.realpath(path.dirname(file));
    if (parent !== target && !parent.startsWith(target + path.sep)) {
      throw new Error(`Refusing to restore ${name}: its folder resolves outside the replay copy (${parent})`);
    }
    await fs.rm(file, { force: true });
    await fs.writeFile(file, await getObject(projectRoot, id));
  }
}

async function cloneInto(source: string, destination: string): Promise<void> {
  if (process.platform === 'darwin') {
    // `cp -c` clones a whole directory in one call (a 5 GB, 22,000-file
    // `out/` takes a third of a second) and never doubles the disk use.
    await run('cp', ['-c', '-R', source, destination]);
    return;
  }
  // Elsewhere: a reflink where the filesystem has them, a copy where not.
  await fs.cp(source, destination, { recursive: true, verbatimSymlinks: true, mode: fssync.constants.COPYFILE_FICLONE });
}
