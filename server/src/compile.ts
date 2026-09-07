/**
 * Compiles node modules into real, importable ES modules using esbuild —
 * replacing the old `new Function('node','graph', code)` sandbox (no
 * imports at all) with genuine `import`/`export`, shared helper files,
 * and npm deps resolved server-side (the browser can't resolve any of
 * that itself). Two entry shapes, same pipeline underneath:
 *
 * - project module: a real file on disk, `nodes/<name>/index.ts` —
 *   esbuild bundles it directly, so relative imports to sibling files
 *   in that module (or elsewhere in the project) resolve normally.
 * - embedded module: code that only exists inline in the `.cascade`
 *   file — fed to esbuild as a virtual stdin entry with the project
 *   root as its resolve directory, so it can still `import` from real
 *   project files even though it has no file of its own.
 *
 * Both must export `execute(node, graph)` — see project.ts's scaffold.
 */
import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ProjectRoot } from './project.js';
import { readProjectManifest } from './projectConfig.js';

const __dirname_compile = path.dirname(fileURLToPath(import.meta.url));

/**
 * `import { loadImage, saveImage } from 'cascade/io'` — the runtime a
 * browser-side node uses to read and write project files. Provided by Cascade
 * rather than copied into each project, so the interop contract has one
 * definition and every project gets the same one. Resolved from this file's
 * install location, so it works wherever the CLI is run from.
 */
function cascadeRuntimePlugin(project: ProjectRoot): esbuild.Plugin {
  return {
    name: 'cascade-runtime',
    setup(build) {
      build.onResolve({ filter: /^cascade\/(?:io|shell|net|config|stage)$/ }, (args) => ({
        path: args.path,
        namespace: 'cascade-runtime',
      }));
      // Two bare specifiers for the same package, both unresolvable from inside
      // the shipped tree, and both for the same underlying reason: a file in
      // `dist/` referring to its own package by name only resolves when the
      // package sits in somebody's `node_modules` under that name.
      //
      // `@cascade/contracts` is what `runtime/shell.ts` re-exports a *value*
      // from (ShellProcessError). A workspace link resolves it in this repo; an
      // installed copy has no such package at all, only the bundled
      // `dist/contracts`.
      //
      // `cascade/contracts` is the same fault one level deeper, and it broke
      // offline rendering for every sketch using the geometry library:
      // `dist/runtime/builtins/geo/*.js` import it, so once a project node
      // pulled in `cascade/runtime`, esbuild followed into Cascade's own dist
      // where `cascade` is not a resolvable name — and the sketch's own
      // node_modules, which would have resolved it, was no longer on the path.
      // The symptom was three cook failures reading "node module has no
      // execute(node, graph) export", which says nothing about resolution.
      //
      // Both resolve from the install location, exactly as the shims do.
      build.onResolve({ filter: /^(?:@cascade|cascade)\/contracts$/ }, () => {
        // Beside the bundled CLI when installed, in the workspace when running from src.
        const candidates = [
          path.join(__dirname_compile, '..', 'contracts', 'index.js'),
          path.join(__dirname_compile, '..', '..', 'packages', 'contracts', 'dist', 'index.js'),
        ];
        const found = candidates.find((c) => fs.existsSync(c));
        if (!found) {
          return { errors: [{ text: `@cascade/contracts not found (looked in ${candidates.join(', ')})` }] };
        }
        return { path: found };
      });
      build.onLoad({ filter: /.*/, namespace: 'cascade-runtime' }, (args) => {
        if (args.path === 'cascade/config') {
          return { contents: configRuntimeSource(readProjectManifest(project.root).settings), loader: 'ts' as const };
        }
        // Beside this file when running from src (tsx), one level up in dist.
        const candidates = [
          path.join(__dirname_compile, 'runtime', `${args.path.slice('cascade/'.length)}.ts`),
          path.join(__dirname_compile, '..', 'src', 'runtime', `${args.path.slice('cascade/'.length)}.ts`),
        ];
        const found = candidates.find((c) => fs.existsSync(c));
        if (!found) {
          return { errors: [{ text: `${args.path} runtime not found (looked in ${candidates.join(', ')})` }] };
        }
        return { contents: fs.readFileSync(found, 'utf-8'), loader: 'ts' as const, resolveDir: path.dirname(found) };
      });
    },
  };
}

export interface CompileResult {
  ok: boolean;
  code: string;
  errors: string[];
}

function commonOptions(project: ProjectRoot): esbuild.BuildOptions {
  return { bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false,
    logLevel: 'silent', plugins: [cascadeRuntimePlugin(project)] };
}

export async function compileProjectModule(project: ProjectRoot, moduleName: string): Promise<CompileResult> {
  try {
    // Classification is also a preflight: server-only imports such as
    // cascade/shell must not be smuggled into an explicitly browser module.
    await project.moduleRunsOn(moduleName);
    return await compileEntry(project, project.resolve(`nodes/${moduleName}/index.ts`));
  } catch (err) {
    return { ok: false, code: '', errors: [errorMessage(err)] };
  }
}

/** Compile a project panel as browser ESM without importing it on the server. */
export async function compileProjectPanel(project: ProjectRoot, panelName: string): Promise<CompileResult> {
  try {
    return await compileEntry(project, await project.resolvePanelEntry(panelName));
  } catch (err) {
    return { ok: false, code: '', errors: [errorMessage(err)] };
  }
}

export async function compileEmbedded(project: ProjectRoot, code: string): Promise<CompileResult> {
  try {
    const result = await esbuild.build({
      ...commonOptions(project),
      stdin: {
        contents: code,
        loader: 'ts',
        resolveDir: project.root,
        sourcefile: 'embedded.ts',
      },
    });
    return toResult(result);
  } catch (err) {
    return { ok: false, code: '', errors: [errorMessage(err)] };
  }
}

function toResult(result: esbuild.BuildResult): CompileResult {
  const errors = result.errors.map((e) => e.text);
  const code = result.outputFiles?.[0]?.text ?? '';
  return { ok: errors.length === 0, code, errors };
}

async function compileEntry(project: ProjectRoot, entryPath: string): Promise<CompileResult> {
  return toResult(await esbuild.build({ ...commonOptions(project), entryPoints: [entryPath] }));
}

function configRuntimeSource(settings: Readonly<Record<string, unknown>>): string {
  return `function deepFreeze(value) { if (value && typeof value === 'object') { for (const item of Object.values(value)) deepFreeze(item); Object.freeze(value); } return value; }
const values = deepFreeze(${JSON.stringify(settings)});
function value(name) { return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined; }
export const config = Object.freeze({
  get(name, fallback) { return value(name) ?? fallback; },
  string(name, fallback = '') { const item = value(name); return typeof item === 'string' ? item : fallback; },
  number(name, fallback = 0) { const item = value(name); return typeof item === 'number' && Number.isFinite(item) ? item : fallback; },
  boolean(name, fallback = false) { const item = value(name); return typeof item === 'boolean' ? item : fallback; },
  has(name) { return value(name) !== undefined; }
});`;
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'errors' in err) {
    const errors = (err as { errors?: Array<{ text: string }> }).errors;
    if (errors?.length) return errors.map((e) => e.text).join('\n');
  }
  return err instanceof Error ? err.message : String(err);
}
