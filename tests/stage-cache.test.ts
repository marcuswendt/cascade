/**
 * The core stage cache key: stage code, parameters, input file contents and
 * the Cascade version — and a cache that can never serve what the code no
 * longer produces (doc/PRODUCTION_READINESS.md, item 2).
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectRoot } from '../server/src/project.js';
import { callStage, cascadeVersion, stageCacheKey, type StageEnvelope } from '../server/src/stageCache.js';
import { readStageConfig, type StageConfig } from '../server/src/stageRunner.js';
import { StageSources } from '../server/src/stageSources.js';

const roots: string[] = [];
afterEach(() => {
  delete process.env.CASCADE_STAGE_CACHE;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** `cache` is the declared `exec.stages.cache`; null leaves it out. */
function fixture(cache: unknown = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-stage-cache-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'runtime'));
  fs.mkdirSync(path.join(root, 'src', 'look'), { recursive: true });
  fs.writeFileSync(path.join(root, 'runtime', 'node_cli.py'), 'print("{}")\n');
  fs.writeFileSync(path.join(root, 'src', 'look', 'ink.py'), 'WEIGHT = 1\n');
  fs.writeFileSync(path.join(root, 'photo.png'), 'pixels-1');
  fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify({
    exec: { stages: { entrypoint: 'runtime/node_cli.py', ...(cache === null ? {} : { cache }) } },
  }));
  const project = new ProjectRoot(root);
  return { root, project, config: readStageConfig(project) };
}

/** An invoker that counts calls and writes its result file, like a stage. */
function stage(root: string, output = 'out/ink.png') {
  const calls: StageEnvelope[] = [];
  const invoke = async (envelope: StageEnvelope) => {
    calls.push(envelope);
    fs.mkdirSync(path.join(root, path.dirname(output)), { recursive: true });
    fs.writeFileSync(path.join(root, output), `drawn-${calls.length}`);
    return { result: { image: output, n: calls.length } };
  };
  return { calls, invoke };
}

describe('the core stage cache key', () => {
  it('changes with the stage code, the params and the bytes of an input file', () => {
    const { root, project, config } = fixture();
    const code = () => new StageSources(project, StageSources.defaultRoots(project, config.entrypoint)).codeHash();
    const base = stageCacheKey(project, 'ink', { photo: 'photo.png', weight: 1 }, code());

    expect(base.cascade).toBe(cascadeVersion());
    expect(base.inputs).toHaveProperty('photo');
    expect(stageCacheKey(project, 'ink', { photo: 'photo.png', weight: 2 }, code()).key).not.toBe(base.key);

    fs.writeFileSync(path.join(root, 'photo.png'), 'pixels-2'); // same path, new content
    const newPhoto = stageCacheKey(project, 'ink', { photo: 'photo.png', weight: 1 }, code());
    expect(newPhoto.key).not.toBe(base.key);

    fs.writeFileSync(path.join(root, 'src', 'look', 'ink.py'), 'WEIGHT = 2\n'); // an imported module, same length
    expect(stageCacheKey(project, 'ink', { photo: 'photo.png', weight: 1 }, code()).key).not.toBe(newPhoto.key);
  });

  it('defaults its sources to the entrypoint folder and src/', () => {
    const { project, config } = fixture();
    const sources = new StageSources(project, StageSources.defaultRoots(project, config.entrypoint));
    expect(sources.files()).toEqual(['runtime/node_cli.py', 'src/look/ink.py']);
  });
});

describe('callStage', () => {
  it('reports the key on every call and is off unless the project enables it', async () => {
    const { root, project, config } = fixture(null);
    const { calls, invoke } = stage(root);
    const first = await callStage(project, config, 'ink', { photo: 'photo.png' }, invoke);
    const second = await callStage(project, config, 'ink', { photo: 'photo.png' }, invoke);
    expect(calls).toHaveLength(2);
    expect(first.trace).toMatchObject({ cache: 'off', why: 'not enabled' });
    expect(second.trace.key).toBe(first.trace.key);
    expect(calls[0]!.key).toBe(first.trace.key);
  });

  it('serves a hit without calling the stage, and says so', async () => {
    const { root, project, config } = fixture();
    const { calls, invoke } = stage(root);
    const traces: string[] = [];
    const first = await callStage(project, config, 'ink', { photo: 'photo.png' }, invoke, { onTrace: (t) => traces.push(t.cache) });
    const second = await callStage(project, config, 'ink', { photo: 'photo.png' }, invoke, { onTrace: (t) => traces.push(t.cache) });
    expect(calls).toHaveLength(1);
    expect(second.result).toEqual(first.result);
    expect(traces).toEqual(['miss', 'hit']);
  });

  it('misses after a stage source edit — the fault that served old results', async () => {
    const { root, project, config } = fixture();
    const { calls, invoke } = stage(root);
    await callStage(project, config, 'ink', { photo: 'photo.png' }, invoke);
    fs.writeFileSync(path.join(root, 'src', 'look', 'ink.py'), 'WEIGHT = 9\n');
    const after = await callStage(project, config, 'ink', { photo: 'photo.png' }, invoke);
    expect(calls).toHaveLength(2);
    expect(after.trace).toMatchObject({ cache: 'miss', why: 'no entry' });
  });

  it('misses when a file the result names was overwritten since', async () => {
    const { root, project, config } = fixture();
    const { invoke } = stage(root);
    await callStage(project, config, 'ink', { photo: 'photo.png' }, invoke);
    fs.writeFileSync(path.join(root, 'out', 'ink.png'), 'another cook wrote here');
    const after = await callStage(project, config, 'ink', { photo: 'photo.png' }, invoke);
    expect(after.trace).toMatchObject({ cache: 'miss', why: 'output changed: out/ink.png' });
  });

  it('stands aside for CASCADE_STAGE_CACHE=off and tells the stage', async () => {
    const { root, project, config } = fixture();
    const { calls, invoke } = stage(root);
    await callStage(project, config, 'ink', { photo: 'photo.png' }, invoke);
    process.env.CASCADE_STAGE_CACHE = 'off';
    const after = await callStage(project, config, 'ink', { photo: 'photo.png' }, invoke);
    expect(after.trace).toMatchObject({ cache: 'off', why: 'CASCADE_STAGE_CACHE=off' });
    expect(calls.map((call) => call.cache)).toEqual(['use', 'off']);
  });

  it('never caches an excluded stage, and keeps output args out of the inputs', async () => {
    const { root, project } = fixture({ exclude: ['plot-status'], outputs: ['out'] });
    const config: StageConfig = readStageConfig(project);
    const { calls, invoke } = stage(root);
    await callStage(project, config, 'plot-status', {}, invoke);
    const again = await callStage(project, config, 'plot-status', {}, invoke);
    expect(calls).toHaveLength(2);
    expect(again.trace).toMatchObject({ cache: 'off', why: 'excluded' });

    fs.writeFileSync(path.join(root, 'previous.png'), 'x');
    const keyed = stageCacheKey(project, 'ink', { out: 'previous.png' }, 'code', config.cache.outputs);
    expect(keyed.inputs).toEqual({});
  });

  it('rejects a malformed cache declaration by name', () => {
    const { project, root } = fixture();
    fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify({ exec: { stages: { entrypoint: 'runtime/node_cli.py', cache: 'yes' } } }));
    expect(() => readStageConfig(project)).toThrow(/exec\.stages\.cache/);
  });
});
