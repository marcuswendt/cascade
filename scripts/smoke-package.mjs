import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', consumerRoot, `cascade@${tarball}`], {
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
    import * as camera from 'cascade/runtime/camera';
    import * as shell from 'cascade/shell';
    import * as stage from 'cascade/stage';
    import * as io from 'cascade/io';
    import * as net from 'cascade/net';
    for (const [name, value] of Object.entries({ contracts, schema, runtime, nodeHost, browserHost, extract, camera, shell, stage, io, net })) {
      if (!Object.keys(value).length) throw new Error(name + ' has no exports');
    }
  `);
  writeFileSync(join(consumerRoot, 'types.ts'), `
    import type { NodeDefinition } from 'cascade/contracts';
    import type { ProjectPanelApi, ProjectPanelModule } from 'cascade/studio/panel';
    import { createRuntime } from 'cascade/runtime';
    import { run } from 'cascade/shell';
    import { runStage, stageAvailable } from 'cascade/stage';
    import { cameraBasis, horizontalFov, verticalFov, frameAspect, viewMatrix, projectionMatrix, lookAtRotation } from 'cascade/runtime/camera';
    declare const definition: NodeDefinition;
    declare const api: ProjectPanelApi;
    declare const panel: ProjectPanelModule;
    void definition; void api; void panel; void createRuntime; void run; void runStage; void stageAvailable;
    // Named one by one rather than as a namespace: the failure this catches is
    // a helper that exists in the source and never reaches the package, and a
    // namespace import passes whether or not any given name is in it.
    void cameraBasis; void horizontalFov; void verticalFov; void frameAspect;
    void viewMatrix; void projectionMatrix; void lookAtRotation;
  `);

  execFileSync(process.execPath, ['imports.mjs'], { cwd: consumerRoot, stdio: 'inherit' });
  execFileSync(process.execPath, [join(packageRoot, 'dist', 'cli', 'index.js'), '--version'], {
    cwd: consumerRoot,
    stdio: 'inherit',
  });
  execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext', join(consumerRoot, 'types.ts'),
  ], { cwd: consumerRoot, stdio: 'inherit' });

  const linkedConsumerRoot = join(temporary, 'linked-consumer');
  mkdirSync(join(linkedConsumerRoot, 'node_modules'), { recursive: true });
  symlinkSync(root, join(linkedConsumerRoot, 'node_modules', 'cascade'), 'dir');
  writeFileSync(join(linkedConsumerRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(linkedConsumerRoot, 'types.ts'), `
    import type { NodeDefinition } from 'cascade/contracts';
    import { createRuntime } from 'cascade/runtime';
    import { run } from 'cascade/shell';
    declare const definition: NodeDefinition;
    void definition; void createRuntime; void run;
  `);
  execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit', '--strict', '--target', 'ES2022', '--module', 'ESNext',
    '--moduleResolution', 'Bundler', join(linkedConsumerRoot, 'types.ts'),
  ], { cwd: linkedConsumerRoot, stdio: 'inherit' });

  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  console.log(`Packed ${manifest.name}@${manifest.version}: imports, CLI, installed types, and linked types passed`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
