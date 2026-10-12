/**
 * Headless frame renders cost the stage time only: one warm Python worker for
 * the whole run (not a fresh interpreter per stage per frame), and a frame
 * re-cooks only the nodes that frame changed (`reuse: "strict"`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntime } from '../packages/runtime/src/runtime';
import { createNodeRuntimeHost } from '../packages/runtime/src/node';
import type { DefinitionNodeRegistration } from '../packages/runtime/src/types';
import { ProjectRoot } from '../server/src/project.js';
import { runStage } from '../server/src/runtime/stage.js';
import { installProjectStages } from '@/cli/projectStages';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function project(worker: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-headless-worker-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'runtime'));
  fs.writeFileSync(path.join(root, 'runtime', 'stages.py'), [
    'import json, os, sys',
    'args = json.loads(sys.stdin.read())',
    'print(json.dumps({"pid": os.getpid(), "value": args["value"] * 2}))',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'runtime', 'worker.py'), [
    'import json, os, sys',
    'for line in sys.stdin:',
    '    req = json.loads(line)',
    '    print(json.dumps({"id": req["id"], "ok": True, "result": {"pid": os.getpid(), "value": req["args"]["value"] * 2}}), flush=True)',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify({
    exec: { stages: { entrypoint: 'runtime/stages.py', ...(worker ? { worker: 'runtime/worker.py' } : {}) } },
  }));
  return new ProjectRoot(root);
}

describe('headless stages', () => {
  it('run every call through one warm worker when the project declares one', async () => {
    const dispose = installProjectStages(project(true));
    try {
      const answers = [];
      for (let frame = 1; frame <= 3; frame++) answers.push(await runStage<{ pid: number; value: number }>('double', { value: frame }));
      expect(answers.map((answer) => answer.value)).toEqual([2, 4, 6]);
      expect(new Set(answers.map((answer) => answer.pid)).size).toBe(1);
      expect(answers[0]!.pid).not.toBe(process.pid);
    } finally {
      dispose();
    }
  });

  it('keep one process per call without a worker, or when asked (parity)', async () => {
    for (const [root, options] of [[project(false), {}], [project(true), { worker: false }]] as const) {
      const dispose = installProjectStages(root, options);
      try {
        const pids = [];
        for (let call = 0; call < 2; call++) pids.push((await runStage<{ pid: number }>('double', { value: 1 })).pid);
        expect(new Set(pids).size).toBe(2);
      } finally {
        dispose();
      }
    }
  });
});

describe('strict reuse across frames', () => {
  /** Source writes a "file" and outputs the same path string every time,
   *  the shape that plain reuse would trust. */
  function graph() {
    const counts = { source: 0, consumer: 0, still: 0 };
    const file = { content: '' };
    const nodes: DefinitionNodeRegistration[] = [
      {
        kind: 'definition-v1', moduleId: 'project.Source',
        definition: { apiVersion: 1, runsOn: 'portable', outputs: { path: { kind: 'data', type: 'string' } }, props: { frame: { type: 'float', default: 1 } } },
        loadExecute: async () => (context: any) => { counts.source++; file.content = `frame ${context.props.frame}`; context.outputs.path.set('out/fixed.png'); },
      },
      {
        kind: 'definition-v1', moduleId: 'project.Consumer',
        definition: { apiVersion: 1, runsOn: 'portable', inputs: { path: { kind: 'data', type: 'string', default: '' } }, outputs: { seen: { kind: 'data', type: 'string' } } },
        loadExecute: async () => (context: any) => { counts.consumer++; context.outputs.seen.set(file.content); },
      },
      {
        kind: 'definition-v1', moduleId: 'project.Still',
        definition: { apiVersion: 1, runsOn: 'portable', outputs: { value: { kind: 'data', type: 'float' } }, props: { k: { type: 'float', default: 3 } } },
        loadExecute: async () => (context: any) => { counts.still++; context.outputs.value.set(context.props.k); },
      },
    ];
    const runtime = createRuntime({ host: createNodeRuntimeHost({ modules: { resolve: async (id) => nodes.find((node) => node.moduleId === id) ?? null } }), nodes });
    const document = {
      nodes: [
        { id: 'source', module: 'project.Source' },
        { id: 'consumer', module: 'project.Consumer' },
        { id: 'still', module: 'project.Still' },
      ],
      connections: [[['source', 0, 'path'], ['consumer', 0, 'path']]],
    };
    return { runtime, document, counts };
  }

  it('re-cooks what a frame changed and everything below it, and nothing else', async () => {
    const { runtime, document, counts } = graph();
    const loaded = await runtime.load(document as never);
    await loaded.run({ reuse: 'strict' });
    await loaded.setProp('source', 'frame', 2);
    await loaded.run({ reuse: 'strict' });
    expect(counts).toEqual({ source: 2, consumer: 2, still: 1 });
    expect(loaded.getOutput('consumer', 'seen')).toBe('frame 2');
    await loaded.run({ reuse: 'strict' });
    expect(counts).toEqual({ source: 2, consumer: 2, still: 1 });
    await runtime.dispose();
  });

  it('where plain reuse would have left the consumer on the old file', async () => {
    const { runtime, document, counts } = graph();
    const loaded = await runtime.load(document as never);
    await loaded.run({ reuse: true });
    await loaded.setProp('source', 'frame', 2);
    await loaded.run({ reuse: true });
    expect(counts.consumer).toBe(1);
    expect(loaded.getOutput('consumer', 'seen')).toBe('frame 1');
    await runtime.dispose();
  });
});
