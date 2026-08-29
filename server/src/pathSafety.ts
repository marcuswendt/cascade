/**
 * Path-traversal guard shared by projects.ts and assets.ts. Both routers
 * built `path.join(PROJECTS_DIR, req.params.id, ...)` straight from
 * request params with no validation — fine when this server only ever
 * talked to a trusted Electron renderer on the same machine, not fine
 * once it's reachable from a browser. resolveWithinRoot is the one place
 * that check happens; every route handler goes through it before any fs
 * call.
 */
import path from 'path';

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
  return full;
}
