import fs from 'node:fs/promises';
import path from 'node:path';

import type { CascadeAbortSignal, FileCapability } from '@cascade/contracts';

import type { ProjectRoot } from '../../server/src/project.js';

/**
 * `files`, for the CLI host — because declaring it used to get you nothing.
 *
 * Reported by MW-OBSERVATORY-ART on 2026-09-12 while building a new sketch:
 * `FileCapability` is in the contract, `'files'` is valid for the server locus,
 * and `createProjectHost` passed only `shell`, `assets` and `gpu` — so a node
 * with `capabilities: ['files']` ran with `undefined` under `cascade run`.
 *
 * **The damage is not the missing feature, it is what the gap taught authors.**
 * The path that worked was an undeclared `node:fs` import, which is strictly
 * worse than a declared capability: the declaration is the thing `cascade
 * check` and the Definition panel can see. So the system rewarded the invisible
 * version of what it exists to make visible. That is the same family as a
 * number field committing unparseable text and `cascade.core.Camera` being
 * unreachable in Studio — a capability present but not callable, with every
 * other signal green.
 *
 * ## The containment rules are the media route's, deliberately
 *
 * Reads resolve inside the project. **Writes are confined to
 * `.cascade-cache/`**, exactly as `cascade/io` and `server/src/routes/media.ts`
 * confine them, and for the same reason: a node's output is derived data that a
 * re-cook reproduces, and it does not belong beside the source material.
 *
 * Relaxing that offline is the tempting mistake. A node must behave identically
 * under both hosts, and a capability that can write anywhere headlessly and
 * nowhere in the page is not one capability — it is two, and the sketch that
 * depends on the generous one stops working in Studio without saying why.
 *
 * Escaping the project with `..` is refused rather than resolved. A graph is a
 * document that can arrive from anywhere, and a `files` capability that reads
 * outside its project is a worse thing to have than no `files` capability.
 */
export function createNodeFileCapability(project: ProjectRoot): FileCapability {
  const root = path.resolve(project.resolve('.'));

  /** Inside the project, or an error naming what was refused. */
  const within = (relative: string, what: string): string => {
    const clean = relative.replace(/^\.?\//, '');
    const full = path.resolve(project.resolve(clean));
    if (full !== root && !full.startsWith(`${root}${path.sep}`))
      throw new Error(`files: ${what} outside the project is refused — ${relative}`);
    return full;
  };

  const cacheOnly = (relative: string): string => {
    const clean = relative.replace(/^\.?\//, '');
    if (!clean.startsWith('.cascade-cache/'))
      throw new Error(
        `files: writes are confined to .cascade-cache/ — got ${clean}. A node's output is derived data, and the same rule applies in the browser.`,
      );
    return within(clean, 'writing');
  };

  /**
   * Every operation checks the signal first.
   *
   * A cancelled cook that is already inside a directory walk will otherwise
   * finish it, and the Studio's preemption exists precisely so a superseded
   * cook stops costing something.
   */
  const live = (options: { signal: CascadeAbortSignal }): void => {
    if (options.signal.aborted) throw new Error('files: cancelled');
  };

  return {
    async read(relative, options) {
      live(options);
      return new Uint8Array(await fs.readFile(within(relative, 'reading')));
    },

    async write(relative, data, options) {
      live(options);
      const full = cacheOnly(relative);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, data);
    },

    async list(relative, options) {
      live(options);
      const full = within(relative, 'listing');
      try {
        const entries = await fs.readdir(full, { withFileTypes: true });
        // Names, sorted, directories marked with a trailing slash so a caller
        // can tell them apart without a second call per entry.
        return entries
          .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
          .sort();
      } catch (error) {
        // A directory that is not there lists as empty rather than throwing:
        // `.cascade-cache/` does not exist until something writes to it, and a
        // node asking what is in it before then is not making a mistake.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    },

    async stat(relative, options) {
      live(options);
      try {
        const stats = await fs.stat(within(relative, 'reading'));
        return { size: stats.size, modifiedAt: stats.mtimeMs };
      } catch (error) {
        // `null` for absent, which is what the contract's `| null` is for — a
        // node asking whether a file exists should not have to catch.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
  };
}
