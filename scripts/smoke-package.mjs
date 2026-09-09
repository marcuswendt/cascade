import { execFileSync, spawnSync } from 'node:child_process';
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
  if (!readFileSync(join(packageRoot, 'doc', 'HEADLESS_GPU.md'), 'utf8').includes('--timeout')) {
    throw new Error('Packed package is missing the headless GPU guide');
  }

  if (readdirSync(join(packageRoot, 'dist', 'runtime')).includes('legacy')) {
    throw new Error('Packed runtime contains the private legacy adapter');
  }

  const consumerManifest = JSON.parse(readFileSync(join(consumerRoot, 'package.json'), 'utf8'));
  writeFileSync(join(consumerRoot, 'package.json'), JSON.stringify({ ...consumerManifest, type: 'module' }));
  writeFileSync(join(consumerRoot, 'imports.mjs'), `
    import * as contracts from 'cascade/contracts';
    import * as schema from 'cascade/contracts/schema';
    import * as runtime from 'cascade/runtime';
    import * as nodeHost from 'cascade/runtime/node';
    import * as browserHost from 'cascade/runtime/browser';
    import * as extract from 'cascade/runtime/definition/extract';
    import * as camera from 'cascade/runtime/camera';
    import * as scene from 'cascade/runtime/scene';
    import * as shell from 'cascade/shell';
    import * as stage from 'cascade/stage';
    import * as io from 'cascade/io';
    import * as net from 'cascade/net';
    import * as gpu from 'cascade/gpu';
    for (const [name, value] of Object.entries({ contracts, schema, runtime, nodeHost, browserHost, extract, camera, scene, shell, stage, io, net, gpu })) {
      if (!Object.keys(value).length) throw new Error(name + ' has no exports');
    }
  `);
  writeFileSync(join(consumerRoot, 'types.ts'), `
    import type { NodeDefinition } from 'cascade/contracts';
    import type { ProjectPanelApi, ProjectPanelModule } from 'cascade/studio/panel';
    import { createRuntime } from 'cascade/runtime';
    import { createGpuHost } from 'cascade/runtime';
    import { readTexture } from 'cascade/gpu';
    import { run } from 'cascade/shell';
    import { runStage, stageAvailable } from 'cascade/stage';
    import { cameraBasis, horizontalFov, verticalFov, frameAspect, viewMatrix, projectionMatrix, lookAtRotation } from 'cascade/runtime/camera';
    import { sceneBounds, sceneDimensionality } from 'cascade/runtime/scene';
    import { asScene, isScene, sceneFromGeometry, EMPTY_SCENE, LIGHT_DEFAULTS } from 'cascade/contracts';
    declare const definition: NodeDefinition;
    declare const api: ProjectPanelApi;
    declare const panel: ProjectPanelModule;
    void definition; void api; void panel; void createRuntime; void createGpuHost; void readTexture; void run; void runStage; void stageAvailable;
    // Named one by one rather than as a namespace: the failure this catches is
    // a helper that exists in the source and never reaches the package, and a
    // namespace import passes whether or not any given name is in it.
    void cameraBasis; void horizontalFov; void verticalFov; void frameAspect;
    void viewMatrix; void projectionMatrix; void lookAtRotation;
    void sceneBounds; void sceneDimensionality;
    void asScene; void isScene; void sceneFromGeometry; void EMPTY_SCENE; void LIGHT_DEFAULTS;
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
  if (process.env.CASCADE_TEST_DAWN === '1') {
    mkdirSync(join(consumerRoot, 'nodes', 'GpuImage'), { recursive: true });
    writeFileSync(join(consumerRoot, 'cascade.json'), JSON.stringify({ name: 'dawn-package-smoke' }));
    writeFileSync(join(consumerRoot, 'nodes', 'GpuImage', 'index.ts'), readFileSync(join(root, 'tests/fixtures/dawn-image-node.ts.txt')));
    writeFileSync(join(consumerRoot, 'index.cascade'), JSON.stringify({ version: '0.2',
      nodes: [{ id: 'image', module: 'project.GpuImage', source: 'project', position: [0, 0] }], connections: [] }));
    const result = JSON.parse(execFileSync(process.execPath, [join(packageRoot, 'dist/cli/index.js'),
      'run', 'index.cascade', '--frames', '1-2', '--json', '--timeout', '30000'],
    { cwd: consumerRoot, encoding: 'utf8', timeout: 35_000 }));
    if (result.files.length !== 2 || result.gpu?.renderer !== 'dawn') throw new Error('Missing Dawn image manifest');
    const { default: sharp } = await import('sharp');
    for (const [index, file] of result.files.entries()) {
      const { data, info } = await sharp(join(consumerRoot, file)).raw().toBuffer({ resolveWithObject: true });
      if (info.width !== 65 || info.height !== 3 || Math.abs(data[0] - (index + 1) * 255 / 4) > 1 || data[1] !== 128) {
        throw new Error('Packed Dawn renderer produced incorrect pixels');
      }
    }
    console.log('Packed Dawn: animated PNGs, JSON manifest, supervised process and natural exit passed');
  }

  // Remove exactly the optional native renderer. `--omit=optional` would also
  // remove esbuild's platform binary, causing the project node to fail during
  // compilation before it could exercise Cascade's Dawn diagnostic.
  rmSync(join(consumerRoot, 'node_modules', 'webgpu'), { recursive: true, force: true });
  writeFileSync(join(consumerRoot, 'cpu.cascade'), JSON.stringify({ version: '0.2',
    nodes: [{ id: 'pass', module: 'cascade.core.Null', inputs: { input: 1 } }], connections: [] }));
  execFileSync(process.execPath, [join(packageRoot, 'dist/cli/index.js'), 'run', 'cpu.cascade'], {
    cwd: consumerRoot,
    stdio: 'inherit',
  });
  mkdirSync(join(consumerRoot, 'nodes', 'GpuImage'), { recursive: true });
  writeFileSync(join(consumerRoot, 'cascade.json'), JSON.stringify({ name: 'dawn-absent-smoke' }));
  writeFileSync(join(consumerRoot, 'nodes', 'GpuImage', 'index.ts'), readFileSync(join(root, 'tests/fixtures/dawn-image-node.ts.txt')));
  writeFileSync(join(consumerRoot, 'gpu.cascade'), JSON.stringify({ version: '0.2',
    nodes: [{ id: 'image', module: 'project.GpuImage', source: 'project', position: [0, 0] }], connections: [] }));
  const missingGpu = spawnSync(process.execPath, [join(packageRoot, 'dist/cli/index.js'),
    'run', 'gpu.cascade', '--frames', '1', '--json'], {
    cwd: consumerRoot,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (missingGpu.status === 0 || !missingGpu.stderr.includes('Cascade cannot load the optional Dawn WebGPU renderer')) {
    throw new Error(`Packed GPU run without optional dependencies returned the wrong diagnostic:\n${missingGpu.stderr}`);
  }
  console.log('Packed optional-absent: CPU run passed and GPU run returned the Dawn install diagnostic');
  console.log(`Packed ${manifest.name}@${manifest.version}: imports, CLI, installed types, and linked types passed`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
