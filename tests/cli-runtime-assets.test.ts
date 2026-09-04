import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The CLI resolves `cascade/io`, `cascade/shell` and `cascade/net` by reading
 * their TypeScript source out of its own build directory. When one is missing,
 * compiling any node that imports it fails with "cascade/<name> runtime not
 * found" — a 422 from /api/nodes/:name/compiled that reads like a broken node
 * rather than a broken build. `net` was missing from the CLI's copy list while
 * present in the server's, so it failed under `cascade .` and worked in dev.
 */
const scriptSource = fs.readFileSync(path.resolve('scripts/build-cli.mjs'), 'utf8');
const runtimeDir = path.resolve('server/src/runtime');

describe('CLI runtime assets', () => {
  it('copies every runtime module the server ships', () => {
    const shipped = fs.readdirSync(runtimeDir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => name.replace(/\.ts$/, ''))
      .sort();

    const copied = scriptSource.match(/for \(const name of \[([^\]]+)\]\)/);
    expect(copied, 'the copy loop in build-cli.mjs moved or changed shape').not.toBeNull();
    const names = [...copied![1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();

    expect(names).toEqual(shipped);
  });
});
