/**
 * The standard library, under a Node host.
 *
 * `initializeNodeLibraries()` is Studio's entry point and it cannot be the
 * CLI's: `src/nodes/core/index.ts` imports each class's own source text with
 * Vite's `?raw`, for the in-Studio code viewer, and `?raw` is not a thing
 * outside Vite. `registerStandardNodes()` is the Node-safe half: the core
 * classes, no source text. The image library used to be the other class
 * library here; since 2026-11-07 it is definition-v1 in the runtime, and a
 * graph of it runs through `cascade run` like any other built-in.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { getNodeClass } from '@/utils/nodeTypeUtils';
import { registerStandardNodes } from '@/nodes/registerStandardNodes';

describe('the Node-safe standard library registration', () => {
  it('registers the class-based core nodes', () => {
    registerStandardNodes();
    expect(getNodeClass('cascade.core.Switch')).toBeTruthy();
  });

  it('reaches for no Vite ?raw source, which is what kept the CLI out', () => {
    const files = ['src/nodes/registerStandardNodes.ts', 'src/nodes/core/classes.ts'];
    for (const file of files) {
      const source = fs.readFileSync(path.resolve(file), 'utf8');
      // The prose in these files names `?raw`; an import of one is the fault.
      expect(source.match(/^\s*import[^\n]*\?raw/gm) ?? []).toEqual([]);
    }
  });

  it('leaves the CLI bundleable by esbuild, where ?raw does not resolve', async () => {
    const result = await build({
      entryPoints: [path.resolve('src/cli/index.ts')],
      bundle: true,
      write: false,
      packages: 'external',
      platform: 'node',
      target: 'node20',
      format: 'esm',
      logLevel: 'silent',
      tsconfig: path.resolve('tsconfig.json'),
    });
    expect(result.errors).toEqual([]);
    // `?raw` imports do not resolve outside Vite, so the CLI must never pull a
    // Studio library's `index.ts` in. The image library it does carry now is
    // the runtime's: its module ids are in the bundle as built-ins.
    // A module specifier ending in `?raw`, not the `?raw=1` of a media URL.
    expect(result.outputFiles[0].text).not.toMatch(/["'][^"'\s]+\?raw["']/);
    expect(result.outputFiles[0].text).toContain('cascade.image.');
  }, 60_000);
});
