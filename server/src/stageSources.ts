/**
 * The identity of a project's Python stage code: one hash over every source
 * file the stages can import.
 *
 * Two faults made this necessary (doc/PRODUCTION_READINESS.md, item 2). A
 * project cache keyed without the stage's source served an edited stage its
 * old result, and the persistent worker kept the modules it had imported until
 * somebody killed it, so an edit in a live Studio ran the old code. Both are
 * the same question — "is this still the code that ran?" — and this answers it
 * by content, never by asking the process.
 *
 * Deliberately coarse: any change to any listed file changes the hash. A
 * project that wants finer keys (cloud-plots traces each stage's own imports)
 * can do so on top; the core key only has to be never stale.
 *
 * Which files count is declared in `cascade.json` as `exec.stages.sources`, a
 * list of project-relative files or directories. When it is absent, the folders
 * holding the entrypoint and the worker, plus `src/` if the project has one.
 * Directories are walked for `*.py`; a symlinked directory is followed only
 * when it is named in the list itself, so a link to a shared library is
 * watched when asked for and never walked into by accident.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ProjectRoot } from './project.js';

const SKIPPED_DIRECTORIES = new Set(['__pycache__', 'node_modules', 'venv', '.venv', '.git', '.cascade', '.cascade-cache']);

interface FileDigest {
  /** Size, mtime and ctime in nanoseconds: an edit that keeps the length
   *  (`VALUE = 1` to `VALUE = 2`) within one millisecond still shows. */
  readonly stamp: string;
  readonly digest: string;
}

/** absolute path -> digest, valid while the stamp matches. The stamp only
 *  validates a digest; it never stands in for one. Shared by the source hash
 *  and the cache's input hashes, so a file is read once per version. */
const digests = new Map<string, FileDigest>();

/**
 * SHA-256 of a file's bytes, hex, or null when it is not a readable file.
 * Memoised per file version, so asking again costs one stat.
 */
export function contentDigest(fullPath: string): string | null {
  let stat: fs.BigIntStats;
  try {
    stat = fs.statSync(fullPath, { bigint: true });
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const stamp = `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  const known = digests.get(fullPath);
  if (known?.stamp === stamp) return known.digest;
  const hash = createHash('sha256');
  const handle = fs.openSync(fullPath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1 << 20);
    let read: number;
    while ((read = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  } finally {
    fs.closeSync(handle);
  }
  const digest = hash.digest('hex');
  digests.set(fullPath, { stamp, digest });
  return digest;
}

export class StageSources {
  readonly project: ProjectRoot;
  /** Project-relative files or directories, as declared. */
  readonly roots: readonly string[];
  constructor(project: ProjectRoot, roots: readonly string[]) {
    this.project = project;
    this.roots = [...new Set(roots)].sort();
  }

  /** The default roots for a stage configuration without `sources`. */
  static defaultRoots(project: ProjectRoot, entrypoint: string, worker?: string): string[] {
    const roots = [path.posix.dirname(entrypoint)];
    if (worker) roots.push(path.posix.dirname(worker));
    if (fs.existsSync(project.resolve('src'))) roots.push('src');
    return roots.map((root) => (root === '' ? '.' : root));
  }

  /** Every source file, project-relative and sorted. */
  files(): string[] {
    const found = new Set<string>();
    for (const root of this.roots) {
      let full: string;
      try {
        full = this.project.resolveMedia(root);
      } catch {
        continue; // a declared root outside the project is ignored, not followed
      }
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue; // not created yet; its appearance will change the hash
      }
      if (stat.isFile()) found.add(root);
      else if (stat.isDirectory()) this.walk(full, root, found);
    }
    return [...found].sort();
  }

  private walk(directory: string, relative: string, found: Set<string>): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = relative === '.' ? entry.name : path.posix.join(relative, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;
        this.walk(path.join(directory, entry.name), child, found);
      } else if (entry.isFile() && entry.name.endsWith('.py')) {
        found.add(child);
      }
    }
  }

  private digest(relative: string): string {
    return contentDigest(this.project.resolveMedia(relative)) ?? 'missing';
  }

  /**
   * The code hash, 16 hex characters. A file added, removed or edited changes
   * it. Cheap to call per request: one directory walk and one stat per file,
   * with a file read only when its stat changed.
   */
  codeHash(): string {
    const hash = createHash('sha256');
    for (const file of this.files()) hash.update(`${file}\0${this.digest(file)}\n`);
    return hash.digest('hex').slice(0, 16);
  }
}
