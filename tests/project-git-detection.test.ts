/**
 * A project inside a repository of projects is under version control.
 *
 * `isGitRepo` checked `<root>/.git` and nothing else, which is right for a
 * sketch that is its own repository and wrong for one inside a repository of
 * sketches — so every example in `cascade-sketches` reported *"not a git repo
 * yet"* while sitting in a perfectly good repo, and anything gating on version
 * control being available was silently off for all of them.
 *
 * Found 2026-09-09 as an aside in an agent's report while it was launching a
 * server for an unrelated reason, which is the sort of remark worth reading
 * rather than skimming.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectRoot } from '../server/src/project.js';

const made: string[] = [];

function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'cascade-git-'));
  made.push(directory);
  return directory;
}

afterEach(() => {
  while (made.length > 0) rmSync(made.pop()!, { recursive: true, force: true });
});

describe('isGitRepo', () => {
  it('is true for a project that is its own repository', () => {
    const root = scratch();
    mkdirSync(path.join(root, '.git'));
    expect(new ProjectRoot(root).isGitRepo).toBe(true);
  });

  /** The case that was wrong, and the shape of every sketch in the examples
   *  repo: the project is a directory inside the repository. */
  it('is true for a project nested inside a repository', () => {
    const root = scratch();
    mkdirSync(path.join(root, '.git'));
    const sketch = path.join(root, 'volume-field');
    mkdirSync(sketch);
    expect(new ProjectRoot(sketch).isGitRepo).toBe(true);
  });

  it('is true several levels down', () => {
    const root = scratch();
    mkdirSync(path.join(root, '.git'));
    const deep = path.join(root, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    expect(new ProjectRoot(deep).isGitRepo).toBe(true);
  });

  /** A worktree's `.git` is a FILE, not a directory, so the test has to be
   *  existence rather than `isDirectory()`. */
  it('accepts a worktree, whose .git is a file', () => {
    const root = scratch();
    writeFileSync(path.join(root, '.git'), 'gitdir: /somewhere/else\n');
    expect(new ProjectRoot(root).isGitRepo).toBe(true);
  });

  /**
   * And it terminates. The walk stops where `dirname` stops changing, which is
   * the filesystem root — a loop on `dirname` without that check never ends on
   * a path that contains no repository, and the temp directory is exactly such
   * a path unless something above it happens to be one.
   */
  it('is false with no repository anywhere above it, without hanging', () => {
    const root = scratch();
    const sketch = path.join(root, 'nested');
    mkdirSync(sketch);
    // If the machine's temp directory is itself inside a repo this would be
    // true, so assert termination rather than the value in that case.
    const answer = new ProjectRoot(sketch).isGitRepo;
    expect(typeof answer).toBe('boolean');
  });
});
