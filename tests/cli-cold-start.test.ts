/**
 * What `cascade` loads before it knows which verb it is running.
 *
 * The CLI used to import the runner (and through it the engine, the server's
 * compiler, TypeScript, esbuild, sharp and express) at the top of index.ts,
 * so `cascade --version`, every graph command and every child the MCP server
 * spawns paid ~270 ms over bare node before doing anything. Verbs now load
 * their handler on use, and the published bundle is split so a handler's
 * packages travel with its chunk.
 *
 * This is a count, not a stopwatch: it builds the CLI the way
 * scripts/build-cli.mjs does and walks the chunks reachable from the entry
 * through static imports only, which is exactly what node evaluates on
 * start. A ceiling may only go down (round 1 build brief).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { build, type Metafile } from 'esbuild';

/**
 * Source modules on the start-up path: index.ts, verbs.ts, jsonEnvelope.ts,
 * measured 2026-11-06 (before: 225 modules in one 1.2 MB file).
 */
const STARTUP_MODULES_CEILING = 3;
/** npm packages imported on the start-up path (before: typescript, esbuild, sharp, express, multer). */
const STARTUP_PACKAGES_CEILING = 0;

const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

async function startupClosure() {
  const result = await build({
    entryPoints: [path.resolve('src/cli/index.ts')],
    outdir: '/virtual/cli',
    splitting: true,
    bundle: true,
    write: false,
    metafile: true,
    packages: 'external',
    platform: 'node',
    target: 'node20',
    format: 'esm',
    logLevel: 'silent',
    tsconfig: path.resolve('tsconfig.json'),
  });
  const outputs: Metafile['outputs'] = result.metafile.outputs;
  const entry = Object.keys(outputs).find((file) => outputs[file]!.entryPoint?.endsWith('src/cli/index.ts'))!;
  const seen = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const imported of outputs[file]!.imports) {
      if (imported.kind !== 'import-statement') continue;
      if (imported.external) {
        if (!builtins.has(imported.path)) packages.add(imported.path);
      } else visit(imported.path);
    }
  };
  visit(entry);
  const modules = new Set([...seen].flatMap((file) => Object.keys(outputs[file]!.inputs)));
  const bytes = [...seen].reduce((sum, file) => sum + outputs[file]!.bytes, 0);
  return { modules: [...modules].sort(), packages: [...packages].sort(), bytes, chunks: seen.size };
}

describe('CLI cold start', () => {
  it('loads only the verb table and the envelope before choosing a verb', async () => {
    const closure = await startupClosure();
    // On failure, the lists say what crept onto the start-up path.
    expect(closure.packages, `packages on the start-up path: ${closure.packages.join(', ')}`).toHaveLength(STARTUP_PACKAGES_CEILING);
    expect(closure.modules.length, `modules on the start-up path:\n${closure.modules.join('\n')}`).toBeLessThanOrEqual(STARTUP_MODULES_CEILING);
    expect(closure.modules.some((file) => /runner|projectRuntime|graphFile|server\//.test(file))).toBe(false);
  }, 60_000);

  it('is split in the published build, so handlers keep their packages to themselves', () => {
    const script = fs.readFileSync(path.resolve('scripts/build-cli.mjs'), 'utf8');
    const cliBuild = script.slice(script.indexOf("entryPoints: ['src/cli/index.ts']"), script.indexOf('});', script.indexOf("entryPoints: ['src/cli/index.ts']")));
    expect(cliBuild).toContain('splitting: true');
  });
});
