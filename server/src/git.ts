/**
 * Auto-commit — "every save auto-commits to that project's own existing
 * git history" (Marcus's own call, confirmed: auto over manual). Scoped
 * to whatever ProjectRoot it's given; never touches any other repo.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import fssync from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd });
}

/** Initializes a git repo in `root` if one doesn't already exist. Cascade
 * projects are expected to already be git repos (Marcus's model), but a
 * brand-new project scaffolded fresh has nothing to commit to yet — this
 * makes `cascade ./` work from an empty directory too, without a separate
 * manual `git init` step. Never re-inits an existing repo. */
export async function ensureGitRepo(root: string): Promise<void> {
  if (fssync.existsSync(path.join(root, '.git'))) return;
  await git(root, ['init']);
}

/** Stages everything and commits, IF there's actually something to
 * commit — `git commit` on a clean tree is a real error, not a no-op, so
 * this checks `git status --porcelain` first rather than letting every
 * save-with-no-changes surface a commit failure. */
export async function autoCommit(
  root: string,
  message: string,
  paths?: string[]
): Promise<{ committed: boolean; sha?: string }> {
  await ensureGitRepo(root);
  // Scoped to the files the request actually touched when the caller names
  // them. Without this a graph save sweeps up every unrelated change in the
  // working tree, which makes the per-file history useless for reverting —
  // and the whole point of auto-commit is that you can go back.
  const scope = paths && paths.length ? ['--', ...paths] : [];
  await git(root, scope.length ? ['add', ...scope] : ['add', '-A']);
  const { stdout } = await git(root, ['status', '--porcelain', ...scope]);
  if (!stdout.trim()) {
    return { committed: false };
  }
  await git(root, ['commit', '-m', message, ...scope]);
  const { stdout: sha } = await git(root, ['rev-parse', 'HEAD']);
  return { committed: true, sha: sha.trim() };
}

export interface FileVersion {
  sha: string;
  shortSha: string;
  date: string;
  message: string;
}

const LOG_SEP = '\x1f';

/** Commits that touched one file, newest first. Empty when the file has no
 * history yet (never committed, or not a git repo) — an empty list, never
 * an error, because "no versions yet" is a normal state the UI shows. */
export async function listFileVersions(
  root: string,
  file: string,
  limit = 50
): Promise<FileVersion[]> {
  if (!fssync.existsSync(path.join(root, '.git'))) return [];
  try {
    const { stdout } = await git(root, [
      'log',
      `--max-count=${limit}`,
      `--format=%H${LOG_SEP}%aI${LOG_SEP}%s`,
      '--',
      file,
    ]);
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, date, ...rest] = line.split(LOG_SEP);
        return { sha, shortSha: sha.slice(0, 7), date, message: rest.join(LOG_SEP) };
      });
  } catch {
    return [];
  }
}

/** True when the file on disk differs from the last commit — i.e. there are
 * changes that no version captures yet. */
export async function isFileDirty(root: string, file: string): Promise<boolean> {
  if (!fssync.existsSync(path.join(root, '.git'))) return false;
  try {
    const { stdout } = await git(root, ['status', '--porcelain', '--', file]);
    return Boolean(stdout.trim());
  } catch {
    return false;
  }
}

/** The file's contents as of one commit. Throws if the commit doesn't have it. */
export async function readFileAtVersion(root: string, file: string, sha: string): Promise<string> {
  if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) {
    throw new Error(`Not a commit hash: ${sha}`);
  }
  try {
    const { stdout } = await git(root, ['show', `${sha}:${file}`]);
    return stdout;
  } catch (err) {
    // A commit that doesn't exist, or one that predates the file, is a
    // not-found rather than a server fault — the version list can outlive
    // the history it was read from.
    const notFound = new Error(`No version ${sha} of ${file}`) as NodeJS.ErrnoException;
    notFound.code = 'ENOENT';
    throw notFound;
  }
}
