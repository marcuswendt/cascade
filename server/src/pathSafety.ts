/**
 * Path-traversal guard shared by projects.ts and assets.ts. Both routers
 * built `path.join(PROJECTS_DIR, req.params.id, ...)` straight from
 * request params with no validation — fine when this server only ever
 * talked only to a trusted local Studio page, not fine
 * once it's reachable from a browser. resolveWithinRoot is the one place
 * that check happens; every route handler goes through it before any fs
 * call.
 */
import path from 'path';
import fs from 'node:fs';

export class PathSafetyError extends Error {}

/**
 * Resolves `...segments` against `root` and throws PathSafetyError if the
 * result would land outside `root` — checked against the RESOLVED
 * absolute path, not the raw input string (a normalize-then-compare, so
 * `..`, encoded separators, or a segment that's itself an absolute path
 * can't sneak through).
 */
export function resolveWithinRoot(root: string, ...segments: string[]): string {
  for (const seg of segments) {
    if (path.isAbsolute(seg)) {
      throw new PathSafetyError(`absolute path segment not allowed: ${seg}`);
    }
  }
  const full = path.resolve(root, ...segments);
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathSafetyError(`path escapes root: ${segments.join('/')}`);
  }
  const canonicalRoot = canonical(root, `project root is not accessible: ${root}`);
  let existing = full;
  while (!existsIncludingSymlink(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) {
      throw new PathSafetyError(`path has no accessible parent: ${segments.join('/')}`);
    }
    existing = parent;
  }
  const canonicalExisting = canonical(existing, `path is not accessible: ${segments.join('/')}`);
  const canonicalRel = path.relative(canonicalRoot, canonicalExisting);
  if (canonicalRel.startsWith('..') || path.isAbsolute(canonicalRel)) {
    throw new PathSafetyError(`path escapes root through a symbolic link: ${segments.join('/')}`);
  }
  return full;
}

/**
 * Where `full` really is: the canonical path of its nearest existing ancestor
 * with the rest appended. The part that does not exist yet cannot be a link.
 */
export function canonicalPath(full: string): string {
  let existing = full;
  while (!existsIncludingSymlink(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return full;
    existing = parent;
  }
  return path.join(canonical(existing, `path is not accessible: ${full}`), path.relative(existing, full));
}

/** Whether `candidate` is `base` or below it. Both absolute. */
export function isWithin(base: string, candidate: string): boolean {
  const rel = path.relative(base, candidate);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function existsIncludingSymlink(candidate: string): boolean {
  try {
    fs.lstatSync(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function canonical(candidate: string, message: string): string {
  try {
    return fs.realpathSync(candidate);
  } catch {
    throw new PathSafetyError(message);
  }
}
