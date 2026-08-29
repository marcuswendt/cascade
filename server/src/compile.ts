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

const __dirname_compile = path.dirname(fileURLToPath(import.meta.url));

/**
 * `import { loadImage, saveImage } from 'cascade/io'` — the runtime a
 * browser-side node uses to read and write project files. Provided by Cascade
 * rather than copied into each project, so the interop contract has one
 * definition and every project gets the same one. Resolved from this file's
 * install location, so it works wherever the CLI is run from.
 */
function cascadeRuntimePlugin(): esbuild.Plugin {
  return {
    name: 'cascade-runtime',
    setup(build) {
      build.onResolve({ filter: /^cascade\/io$/ }, () => ({
        path: 'cascade/io',
        namespace: 'cascade-runtime',
      }));
      build.onLoad({ filter: /.*/, namespace: 'cascade-runtime' }, () => {
        // Beside this file when running from src (tsx), one level up in dist.
        const candidates = [
          path.join(__dirname_compile, 'runtime', 'io.ts'),
          path.join(__dirname_compile, '..', 'src', 'runtime', 'io.ts'),
        ];
        const found = candidates.find((c) => fs.existsSync(c));
        if (!found) {
          return { errors: [{ text: `cascade/io runtime not found (looked in ${candidates.join(', ')})` }] };
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

const commonOptions: esbuild.BuildOptions = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
  logLevel: 'silent',
  plugins: [cascadeRuntimePlugin()],
};

export async function compileProjectModule(project: ProjectRoot, moduleName: string): Promise<CompileResult> {
  const entryPath = project.resolve(`nodes/${moduleName}/index.ts`);
  try {
    const result = await esbuild.build({ ...commonOptions, entryPoints: [entryPath] });
    return toResult(result);
  } catch (err) {
    return { ok: false, code: '', errors: [errorMessage(err)] };
  }
}

export async function compileEmbedded(project: ProjectRoot, code: string): Promise<CompileResult> {
  try {
    const result = await esbuild.build({
      ...commonOptions,
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

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'errors' in err) {
    const errors = (err as { errors?: Array<{ text: string }> }).errors;
    if (errors?.length) return errors.map((e) => e.text).join('\n');
  }
  return err instanceof Error ? err.message : String(err);
}
