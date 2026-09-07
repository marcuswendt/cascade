/**
 * Rewrites relative import specifiers when a module moves between the graph
 * document and a file on disk.
 *
 * Embedding and extracting change where a module's code is compiled *from*, and
 * relative imports are the casualty. A project module at `nodes/distort/index.ts`
 * reaching a helper as `../../lib/warp` is correct there and wrong the moment
 * the same text is compiled as an embedded module, which esbuild builds with the
 * project root as its resolve directory — `../../lib/warp` then points two
 * levels above the project and the compile fails.
 *
 * Found by Marcus on 2026-09-07, clicking Embed in Graph on a node the agent
 * console had just written. Extract has the same fault mirrored, and had it
 * before embedding existed: it writes root-relative code into `nodes/<Name>/`
 * without moving the specifiers the other way.
 *
 * Pure string work on purpose — no `path`, because this runs in the browser.
 */

/** Normalise a POSIX-ish path, resolving `.` and `..` without touching disk. */
function normalise(segments: readonly string[]): string[] {
  const out: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      // A `..` that escapes the root is kept, so an import that genuinely
      // pointed outside the project stays broken and visible rather than being
      // silently rewritten into something that resolves to the wrong file.
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else out.push('..');
      continue;
    }
    out.push(segment);
  }
  return out;
}

/** `nodes/distort` + `../../lib/warp` → `lib/warp` */
function resolveFrom(directory: string, specifier: string): string[] {
  return normalise([...directory.split('/'), ...specifier.split('/')]);
}

/** `lib/warp` seen from `nodes/distort` → `../../lib/warp` */
function relativeTo(directory: string, target: readonly string[]): string {
  const from = normalise(directory.split('/'));
  let shared = 0;
  while (shared < from.length && shared < target.length && from[shared] === target[shared]) shared += 1;
  const up = Array.from({ length: from.length - shared }, () => '..');
  const down = target.slice(shared);
  const joined = [...up, ...down].join('/');
  return joined.startsWith('.') ? joined : `./${joined}`;
}

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])(\.[^'"]*)\2/g;

/**
 * Move every relative specifier in `code` from one directory to another, both
 * given relative to the project root. `''` is the root itself.
 */
export function rewriteRelativeImports(code: string, fromDirectory: string, toDirectory: string): string {
  if (fromDirectory === toDirectory) return code;
  return code.replace(SPECIFIER, (match, lead: string, quote: string, specifier: string) => {
    const target = resolveFrom(fromDirectory, specifier);
    return `${lead}${quote}${relativeTo(toDirectory, target)}${quote}`;
  });
}

/** The directory a project module's code lives in, relative to the root. */
export function moduleDirectory(moduleName: string): string {
  return `nodes/${moduleName}`;
}
