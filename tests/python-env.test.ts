/**
 * A declared, provisioned Python environment for stages: cascade.json
 * `python`, a venv in `.cascade-cache/python/venv`, `cascade doctor [--fix]`.
 * The venv here is built with no requirements (`--without-pip`), so the test
 * needs no network.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureEnvelope } from '@/cli/jsonEnvelope';
import { runGraph } from '@/cli/runner';
import { doctor } from '@/cli/doctorCommand';
import { provisionPythonEnv, pythonEnvStatus, readPythonEnv } from '../server/src/pythonEnv';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const stageModule = path.resolve('server/src/runtime/stage.ts');
const whichPython = `
import { runStage } from ${JSON.stringify(stageModule)};
export const definition = {
  apiVersion: 1, runsOn: 'portable', props: {},
  outputs: { result: { kind: 'data', type: 'string' } },
} as const;
export async function execute(context) {
  const answer = await runStage('which', {});
  console.log(answer.value);
  context.outputs.result.set(answer.value);
}
`;
const dispatcher = `
import json, sys
sys.stdin.read()
print(json.dumps({"value": sys.prefix}))
`;

function project(python: unknown) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-python-env-')));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'nodes', 'Which'), { recursive: true });
  fs.mkdirSync(path.join(root, 'runtime'));
  fs.writeFileSync(path.join(root, 'nodes', 'Which', 'index.ts'), whichPython);
  fs.writeFileSync(path.join(root, 'runtime', 'stages.py'), dispatcher);
  fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify({
    exec: { stages: { entrypoint: 'runtime/stages.py', python: 'python3', cache: false } },
    ...(python === undefined ? {} : { python }),
  }));
  const file = path.join(root, 'index.cascade');
  fs.writeFileSync(file, JSON.stringify({ version: '0.2', nodes: [{ id: 'which', module: 'project.Which' }], connections: [] }));
  return { root, file };
}

describe('cascade.json python', () => {
  it('reads and refuses malformed declarations', () => {
    expect(readPythonEnv(project(undefined).root)).toBeNull();
    expect(readPythonEnv(project({ requirements: ['numpy'] }).root)).toEqual({ requirements: ['numpy'], interpreter: 'python3' });
    expect(() => readPythonEnv(project({ requirements: 7 }).root)).toThrow(/python.requirements/);
    expect(() => readPythonEnv(project({ requirements: '../outside.txt' }).root)).toThrow(/project-relative/);
  });

  it('is missing, then built by doctor --fix, then current; stages run under it; stale when cascade.json changes', async () => {
    const { root, file } = project({ requirements: [] });
    expect(pythonEnvStatus(root).state).toBe('missing');

    const refused = await captureEnvelope(() => runGraph({ file, json: true }));
    expect(refused.ok).toBe(false);
    expect(refused.error!.message).toMatch(/cascade doctor --fix/);

    const before = await doctor(root);
    expect(before.find((check) => check.name === 'python environment')).toMatchObject({ ok: false });

    const fixed = await doctor(root, { fix: true });
    expect(fixed.find((check) => check.name === 'python environment')).toMatchObject({ ok: true });
    expect(fixed.find((check) => check.name === 'stage interpreter')!.detail).toContain(path.join('.cascade-cache', 'python', 'venv'));
    expect(pythonEnvStatus(root).state).toBe('current');

    const ran = await captureEnvelope(() => runGraph({ file, json: true }));
    expect(ran.ok, JSON.stringify(ran)).toBe(true);
    expect((ran.data as any).logs[0].text).toBe(path.join(root, '.cascade-cache', 'python', 'venv'));

    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'cascade.json'), 'utf8'));
    manifest.python.requirements = ['six'];
    fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify(manifest));
    expect(pythonEnvStatus(root)).toMatchObject({ state: 'stale' });
  }, 120_000);

  it('keeps the old environment in _archive when it rebuilds', async () => {
    const { root } = project({ requirements: [] });
    await provisionPythonEnv(root);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'cascade.json'), 'utf8'));
    manifest.python.interpreter = 'python3';
    manifest.python.requirements = [];
    fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify({ ...manifest, python: { requirements: 'requirements.txt' } }));
    fs.writeFileSync(path.join(root, 'requirements.txt'), '');
    expect(pythonEnvStatus(root).state).toBe('stale');
    await provisionPythonEnv(root);
    expect(pythonEnvStatus(root).state).toBe('current');
    expect(fs.readdirSync(path.join(root, '.cascade-cache', 'python', '_archive'))).toHaveLength(1);
  }, 120_000);
});
