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
 * Both builds now copy the directory rather than a list, so this asserts the
 * two builds agree and that the built CLI actually carries them.
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

  it('copies them into the server build too, so dev and CLI resolve the same files', () => {
    const built = path.resolve('server/dist/runtime');
    if (!fs.existsSync(built)) return;
    const copied = fs.readdirSync(built).filter((name) => name.endsWith('.ts')).sort();
    expect(copied).toEqual(shipped());
  });
});
