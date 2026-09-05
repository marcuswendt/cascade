import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'cascade-package-smoke-'));

try {
  execFileSync('npm', ['run', 'prepack'], { cwd: root, stdio: 'inherit' });
  const packed = JSON.parse(execFileSync('npm', [
    'pack', '--json', '--ignore-scripts', '--pack-destination', temporary,
  ], { cwd: root, encoding: 'utf8' }));
  const tarball = join(temporary, packed[0].filename);
  const consumerRoot = join(temporary, 'consumer');
  writeFileSync(join(temporary, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', consumerRoot, tarball], {
    cwd: temporary,
    stdio: 'inherit',
  });
  const packageRoot = join(temporary, 'consumer', 'node_modules', 'cascade');

  if (readdirSync(join(packageRoot, 'dist', 'runtime')).includes('legacy')) {
    throw new Error('Packed runtime contains the private legacy adapter');
  }

  writeFileSync(join(consumerRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(consumerRoot, 'imports.mjs'), `
    import * as contracts from 'cascade/contracts';
    import * as schema from 'cascade/contracts/schema';
    import * as runtime from 'cascade/runtime';
    import * as nodeHost from 'cascade/runtime/node';
    import * as browserHost from 'cascade/runtime/browser';
    import * as extract from 'cascade/runtime/definition/extract';
    import * as shell from 'cascade/shell';
    import * as stage from 'cascade/stage';
    for (const [name, value] of Object.entries({ contracts, schema, runtime, nodeHost, browserHost, extract, shell, stage })) {
      if (!Object.keys(value).length) throw new Error(name + ' has no exports');
    }
  `);
  writeFileSync(join(consumerRoot, 'types.ts'), `
    import type { NodeDefinition } from 'cascade/contracts';
    import type { ProjectPanelApi, ProjectPanelModule } from 'cascade/studio/panel';
    import { createRuntime } from 'cascade/runtime';
    import { runStage, stageAvailable } from 'cascade/stage';
    declare const definition: NodeDefinition;
    declare const api: ProjectPanelApi;
    declare const panel: ProjectPanelModule;
    void definition; void api; void panel; void createRuntime; void runStage; void stageAvailable;
  `);

  execFileSync(process.execPath, ['imports.mjs'], { cwd: consumerRoot, stdio: 'inherit' });
  execFileSync(process.execPath, [join(packageRoot, 'dist', 'cli', 'index.js'), '--version'], {
    cwd: consumerRoot,
    stdio: 'inherit',
  });
  execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext', join(consumerRoot, 'types.ts'),
  ], { cwd: consumerRoot, stdio: 'inherit' });

  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  console.log(`Packed ${manifest.name}@${manifest.version}: imports, CLI, and public types passed`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
