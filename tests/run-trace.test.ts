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
import { RunTrace } from '@/cli/runTrace';

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

describe('frame and save time', () => {
  /** Round 2 needed a profiler to see that a PNG encode was half of every frame. */
  it('records each run\'s cook, its whole frame and the save between them', () => {
    let listener: (event: any) => void = () => {};
    let frame = 1;
    const graph = {
      inspect: () => ({ nodes: [{ id: 'a', moduleId: 'project.A' }] }),
      subscribe: (fn: (event: any) => void) => { listener = fn; return () => {}; },
      getFrame: () => frame,
    };
    const now = vi.spyOn(performance, 'now');
    const trace = new RunTrace('/tmp/g.cascade', '0.0.0', 1);
    trace.attach(graph as never);
    for (const [start, end, wall] of [[0, 40, 55], [100, 130, 150]] as const) {
      now.mockReturnValue(start);
      listener({ type: 'run:start', runId: `r${frame}` });
      listener({ type: 'node:start', nodeId: 'a' });
      now.mockReturnValue(end);
      listener({ type: 'node:complete', nodeId: 'a' });
      listener({ type: 'run:complete', result: {} });
      trace.recordSaved(wall);
      frame += 1;
    }
    const runs = trace.toJSON().runs;
    expect(runs.map((run) => [run.frame, run.ms, run.frameMs, run.saveMs])).toEqual([[1, 40, 55, 15], [2, 30, 150, 120]]);
    expect(runs[0]!.nodes[0]!.ms).toBe(40);
  });

  it('lands in a real run --frames trace', async () => {
    const { root, file } = project();
    const result = await runJsonFrames(file, root);
    const trace = JSON.parse(fs.readFileSync(path.join(root, result.trace), 'utf8'));
    expect(trace.runs).toHaveLength(2);
    for (const run of trace.runs) {
      expect(run.ms).toBeGreaterThanOrEqual(0);
      expect(run.frameMs).toBeGreaterThanOrEqual(run.ms);
      expect(run.saveMs).toBe(run.frameMs - run.ms);
    }
  });
});

/** `run --frames 1-2 --json` on a graph with one image output. */
async function runJsonFrames(file: string, root: string): Promise<any> {
  fs.mkdirSync(path.join(root, 'nodes', 'Swatch'), { recursive: true });
  fs.writeFileSync(path.join(root, 'nodes', 'Swatch', 'index.ts'), `
export const definition = {
  apiVersion: 1, runsOn: 'portable', capabilities: ['assets'], props: {},
  outputs: { image: { kind: 'data', type: 'image' } },
} as const;
export async function execute(context) {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const stored = await context.capabilities.assets.write(png, { suggestedName: 'swatch.png', mediaType: 'image/png' }, { signal: context.signal });
  context.outputs.image.set({ path: stored.path, size: [1, 1], channels: 'rgba', depth: 'u8', space: 'srgb' });
}
`);
  fs.writeFileSync(file, JSON.stringify({ version: '0.2', nodes: [{ id: 'swatch', module: 'project.Swatch', source: 'project' }], connections: [] }));
  let written = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => { written += String(chunk); return true; });
  await runGraph({ file, frames: '1-2', out: 'frames', json: true });
  vi.restoreAllMocks();
  return JSON.parse(written.trim());
}
