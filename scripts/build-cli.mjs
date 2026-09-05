import { build } from 'esbuild';
import { chmodSync, cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outputDirectory = resolve('dist', 'cli');
rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(resolve(outputDirectory, 'runtime'), { recursive: true });
mkdirSync(resolve('dist', 'studio'), { recursive: true });

await build({
  entryPoints: ['src/cli/index.ts'],
  outfile: resolve(outputDirectory, 'index.js'),
  bundle: true,
  packages: 'external',
  alias: { '@cascade/contracts': resolve('packages', 'contracts', 'src', 'index.ts') },
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  tsconfig: 'tsconfig.json'
});

writeFileSync(resolve('dist', 'shell.d.ts'), `export {
  ShellProcessError,
  type ShellProcessErrorKind,
  type ShellRunOptions,
  type ShellRunResult,
} from 'cascade/contracts';
export declare function run(command: string, args?: readonly string[], options?: import('cascade/contracts').ShellRunOptions): Promise<import('cascade/contracts').ShellRunResult>;
export declare function runJson<T = unknown>(command: string, args?: readonly string[], options?: import('cascade/contracts').ShellRunOptions): Promise<T>;
`);
writeFileSync(resolve('dist', 'stage.d.ts'), `export interface StageBridge {
  (stage: string, args: Record<string, unknown>): Promise<unknown>;
}
export declare function installStageBridge(bridge: StageBridge | null): () => void;
export declare function stageAvailable(): Promise<boolean>;
export declare function runStage<T = unknown>(stage: string, args?: Record<string, unknown>): Promise<T>;
export declare function cachePath(nodeId: string, suffix: string): string;
`);

cpSync(resolve('src', 'studio', 'panel.ts'), resolve('dist', 'studio', 'panel.d.ts'));

await build({
  entryPoints: ['server/src/runtime/stage.ts'],
  outfile: resolve('dist', 'stage.js'),
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  packages: 'external',
  sourcemap: true
});

await build({
  entryPoints: ['server/src/runtime/shell.ts'],
  outfile: resolve('dist', 'shell.js'),
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  packages: 'external',
  alias: { '@cascade/contracts': resolve('packages', 'contracts', 'src', 'index.ts') },
  sourcemap: true
});

// Every runtime module the server ships, read from the directory rather than
// listed here: a module missing from the CLI's copy fails as "cascade/<name>
// runtime not found", which reads like a broken node rather than a short build.
for (const name of readdirSync(resolve('server', 'src', 'runtime'))
  .filter((file) => file.endsWith('.ts'))
  .map((file) => file.replace(/\.ts$/, ''))) {
  cpSync(resolve('server', 'src', 'runtime', `${name}.ts`), resolve(outputDirectory, 'runtime', `${name}.ts`));
}

chmodSync(resolve(outputDirectory, 'index.js'), 0o755);
