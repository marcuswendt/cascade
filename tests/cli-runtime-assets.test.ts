import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The CLI resolves `cascade/io`, `cascade/shell`, `cascade/net` and
 * `cascade/stage` by reading their TypeScript source out of its own build
 * directory. A module missing from that copy fails as "cascade/<name> runtime
 * not found" — a 422 from /api/nodes/:name/compiled that reads like a broken
 * node rather than a short build. `net` was once missing from the CLI's list
 * while present in the server's, so it failed under `cascade .` and worked in
 * dev.
 *
 * Both builds copy the directory rather than a list, so the CLI's copy is
 * asserted against the source.
 *
 * **The server's copy is deliberately not asserted, and that is a change.** It
 * used to be, and on 2026-09-08 it cost an afternoon's confusion: adding
 * `gpu.ts` turned this file red, `npm run build` did not clear it, and the
 * reason is that nothing in `build` or `postbuild` touches `server/` at all —
 * the server build is `npm run build:server`, a separate command. So the file
 * asserted an agreement that no single script produced.
 *
 * Checked before narrowing it rather than after: `server/dist` is gitignored,
 * and the only references to it anywhere are this test and an **archived**
 * Electron spec. Nothing in the live system reads it — the sketch servers run
 * the root `dist/cli/index.js`, and `npm run dev` runs the server from source
 * through `tsx`. So the old assertion made every build a two-command sequence
 * to keep an artefact in step that nothing consumes, and it punished having
 * built once: a *stale* `server/dist` failed while an *absent* one passed,
 * which rewarded deleting the directory over building it.
 *
 * The CLI half stays exactly as it was, because that is the copy the running
 * servers read at request time and it is the half that caught the real gap.
 */
const runtimeDir = path.resolve('server/src/runtime');

function shipped(): string[] {
  return fs.readdirSync(runtimeDir).filter((name) => name.endsWith('.ts')).sort();
}

describe('CLI runtime assets', () => {
  it('ships at least the four runtime modules nodes can import', () => {
    expect(shipped()).toEqual(expect.arrayContaining(['io.ts', 'net.ts', 'shell.ts', 'stage.ts']));
  });

  it('copies every server runtime module into the CLI build', () => {
    const built = path.resolve('dist/cli/runtime');
    if (!fs.existsSync(built)) return;   // nothing built yet in this checkout
    const copied = fs.readdirSync(built).filter((name) => name.endsWith('.ts')).sort();
    expect(copied).toEqual(shipped());
  });

  it('names the server build, so keeping that copy in step is a command and not folklore', () => {
    // `npm run build:server`. The copy itself is not asserted — see the note
    // at the top of this file for what was checked before dropping it.
    const scripts = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).scripts;
    expect(scripts['build:server']).toContain('server');
  });
});
