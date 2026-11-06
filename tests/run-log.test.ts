/**
 * Debug output in the run log: what a node and its Python stages print while
 * it cooks lands in `.cascade/runs/…json` against that node (and in
 * `run --json` as `logs`), a failed run still writes its trace, and `--env`
 * reaches the stage process without a shell prefix.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureEnvelope } from '@/cli/jsonEnvelope';
import { runGraph } from '@/cli/runner';
import { parseEnvArgs } from '@/cli/runEnv';
import { parseRenderArgs } from '@/cli/render';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const stageModule = path.resolve('server/src/runtime/stage.ts');
const talker = (fail: boolean) => `
import { runStage } from ${JSON.stringify(stageModule)};
export const definition = {
  apiVersion: 1,
  runsOn: 'portable',
  props: {},
  outputs: { result: { kind: 'data', type: 'string' } },
} as const;
export async function execute(context) {
  console.log('cooking with', { size: 3 });
  const answer = await runStage('flag', {});
  console.warn('flag is', answer.value);
  ${fail ? "throw new Error('ran out of ink');" : ''}
  context.outputs.result.set(answer.value);
}
`;

const dispatcher = `
import json, os, sys
sys.stdin.read()
print("python was here", file=sys.stderr)
print(json.dumps({"value": os.environ.get("CASCADE_TEST_FLAG", "unset")}))
`;

function project(fail = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-run-log-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'nodes', 'Talker'), { recursive: true });
  fs.mkdirSync(path.join(root, 'runtime'));
  fs.writeFileSync(path.join(root, 'nodes', 'Talker', 'index.ts'), talker(fail));
  fs.writeFileSync(path.join(root, 'runtime', 'stages.py'), dispatcher);
  fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify({ exec: { stages: { entrypoint: 'runtime/stages.py', cache: false } } }));
  const file = path.join(root, 'index.cascade');
  fs.writeFileSync(file, JSON.stringify({ version: '0.2', nodes: [{ id: 'talk', module: 'project.Talker' }], connections: [] }));
  return { root, file };
}

describe('the run log', () => {
  it('puts node console and stage stderr in the trace, and --env reaches the stage', async () => {
    const { root, file } = project();
    const envelope = await captureEnvelope(() => runGraph({ file, json: true, env: { CASCADE_TEST_FLAG: 'on' } }));
    expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
    const data = envelope.data as any;
    expect(data.logs).toEqual([
      { node: 'talk', level: 'log', text: 'cooking with {"size":3}' },
      { node: 'talk', level: 'stderr', text: '[flag] python was here' },
      { node: 'talk', level: 'warn', text: 'flag is on' },
    ]);
    const trace = JSON.parse(fs.readFileSync(path.join(root, data.trace), 'utf8'));
    expect(trace.env).toEqual(['CASCADE_TEST_FLAG']);
    expect(JSON.stringify(trace)).not.toContain('"on"');
    expect(trace.runs[0].nodes[0].logs).toHaveLength(3);
    expect(process.env.CASCADE_TEST_FLAG).toBeUndefined();
  }, 60_000);

  it('writes the trace of a failed run and names it in the error', async () => {
    const { root, file } = project(true);
    const envelope = await captureEnvelope(() => runGraph({ file, json: true }));
    expect(envelope.ok).toBe(false);
    const named = /Run trace: (\S+)/.exec(envelope.error!.message)?.[1];
    expect(envelope.error!.message).toContain('ran out of ink');
    expect(named).toBeDefined();
    const trace = JSON.parse(fs.readFileSync(path.join(root, named!), 'utf8'));
    expect(trace.runs[0].nodes[0].logs.map((line: any) => line.text)).toContain('flag is unset');
  }, 60_000);

  it('parses --env for run and render', () => {
    expect(parseEnvArgs(['run', 'g', '--env', 'A=1', '--env', 'B=x=y'])).toEqual({ A: '1', B: 'x=y' });
    expect(() => parseEnvArgs(['--env', '=1'])).toThrow(/NAME=value/);
    expect(parseRenderArgs(['g.cascade', '--env', 'A=1', '--env', 'B=2']).env).toEqual({ A: '1', B: '2' });
  });
});
