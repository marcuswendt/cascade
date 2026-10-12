/**
 * A headless run leaves a trace: each node's time and every stage call's
 * cache key and state, in `.cascade/runs/` and in `run --json`. A cache hit is
 * reported on success, not only discovered on failure.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGraph } from '@/cli/runner';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

// The node imports Cascade's own `cascade/stage` source by path: a temporary
// project has no installed `cascade` package to import it by name from.
const stageModule = path.resolve('server/src/runtime/stage.ts');
const doubler = `
import { runStage } from ${JSON.stringify(stageModule)};
export const definition = {
  apiVersion: 1,
  runsOn: 'portable',
  props: { value: { type: 'float', default: 21 } },
  outputs: { result: { kind: 'data', type: 'float' } },
} as const;
export async function execute(context) {
  const answer = await runStage('double', { value: context.props.value, seed: context.seed });
  context.outputs.result.set(answer.value);
}
`;

const dispatcher = `
import json, sys
args = json.loads(sys.stdin.read())
print(json.dumps({"value": args["value"] * 2}))
`;

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-run-trace-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'nodes', 'Doubler'), { recursive: true });
  fs.mkdirSync(path.join(root, 'runtime'));
  fs.writeFileSync(path.join(root, 'nodes', 'Doubler', 'index.ts'), doubler);
  fs.writeFileSync(path.join(root, 'runtime', 'stages.py'), dispatcher);
  fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify({
    exec: { stages: { entrypoint: 'runtime/stages.py', cache: true } },
  }));
  const file = path.join(root, 'index.cascade');
  fs.writeFileSync(file, JSON.stringify({
    version: '0.2', seed: 5, nodes: [{ id: 'twice', module: 'project.Doubler', source: 'project' }], connections: [],
  }));
  return { root, file };
}

async function runJson(file: string): Promise<any> {
  let written = '';
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    written += String(chunk);
    return true;
  });
  try {
    await runGraph({ file, json: true });
  } finally {
    write.mockRestore();
  }
  return JSON.parse(written.trim().split('\n').pop()!);
}

describe('the run trace', () => {
  it('reports a miss, then a hit, with the key, in --json and on disk', async () => {
    const { root, file } = project();
    const first = await runJson(file);
    expect(first).toMatchObject({ status: 'completed', seed: 5 });
    expect(first.stages).toHaveLength(1);
    expect(first.stages[0]).toMatchObject({ node: 'twice', stage: 'double', cache: 'miss' });
    expect(first.stages[0].key).toMatch(/^[0-9a-f]{32}$/);

    const second = await runJson(file);
    expect(second.stages[0]).toMatchObject({ node: 'twice', cache: 'hit', key: first.stages[0].key });

    const trace = JSON.parse(fs.readFileSync(path.join(root, second.trace), 'utf8'));
    expect(trace.runs[0].nodes[0]).toMatchObject({ id: 'twice', module: 'project.Doubler' });
    expect(trace.runs[0].nodes[0].stages[0]).toMatchObject({ stage: 'double', cache: 'hit' });
    expect(trace.seed).toBe(5);
  });

  it('misses after the stage code changes', async () => {
    const { root, file } = project();
    const first = await runJson(file);
    fs.appendFileSync(path.join(root, 'runtime', 'stages.py'), '# edited\n');
    const second = await runJson(file);
    expect(second.stages[0].cache).toBe('miss');
    expect(second.stages[0].code).not.toBe(first.stages[0].code);
  });

  it('takes --seed over the document', async () => {
    const { file } = project();
    let written = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => { written += String(chunk); return true; });
    await runGraph({ file, json: true, seed: 11 });
    expect(JSON.parse(written.trim()).seed).toBe(11);
  });
});
