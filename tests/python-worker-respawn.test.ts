import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectRoot } from '../server/src/project.js';
import { PythonWorker } from '../server/src/pythonWorker.js';
import { StageSources } from '../server/src/stageSources.js';

/**
 * A warm worker keeps the modules it imported until it dies, so an edited
 * stage went on running its old code in a live Studio (12 Oct). The worker now
 * fingerprints the project's stage sources and restarts itself when they
 * change, before the next request is sent.
 */

const roots: string[] = [];
const workers: PythonWorker[] = [];

afterEach(() => {
  for (const worker of workers.splice(0)) worker.shutdown();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-worker-respawn-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'runtime'));
  fs.writeFileSync(path.join(root, 'runtime', 'look.py'), 'VALUE = 1\n');
  fs.writeFileSync(path.join(root, 'runtime', 'worker.py'), [
    'import json, os, sys',
    'sys.path.insert(0, os.path.dirname(__file__))',
    'import look',
    'for line in sys.stdin:',
    '    req = json.loads(line)',
    "    print(json.dumps({'id': req['id'], 'ok': True, 'result': {'value': look.VALUE, 'pid': os.getpid(), 'cascade': req.get('cascade')}}), flush=True)",
  ].join('\n'));
  const project = new ProjectRoot(root);
  const sources = new StageSources(project, ['runtime']);
  return { root, project, sources };
}

describe('the Python worker follows its stage code', () => {
  it('serves old code after an edit when nothing watches the sources (the fault)', async () => {
    const { root, project } = fixture();
    const worker = new PythonWorker(project, 'runtime/worker.py', 'python3');
    workers.push(worker);
    expect(await worker.call('look', {})).toMatchObject({ value: 1 });
    fs.writeFileSync(path.join(root, 'runtime', 'look.py'), 'VALUE = 2\n');
    expect(await worker.call('look', {})).toMatchObject({ value: 1 });
  });

  it('restarts before the next request once a source file changes', async () => {
    const { root, project, sources } = fixture();
    const worker = new PythonWorker(project, 'runtime/worker.py', 'python3', process.env, { sources });
    workers.push(worker);
    const first = await worker.call('look', {}) as { value: number; pid: number };
    expect(first.value).toBe(1);
    const unchanged = await worker.call('look', {}) as { value: number; pid: number };
    expect(unchanged.pid).toBe(first.pid);
    expect(worker.restarts).toBe(0);

    fs.writeFileSync(path.join(root, 'runtime', 'look.py'), 'VALUE = 2\n');
    const edited = await worker.call('look', {}) as { value: number; pid: number };
    expect(edited.value).toBe(2);
    expect(edited.pid).not.toBe(first.pid);
    expect(worker.restarts).toBe(1);
    expect(worker.codeHash).toBe(sources.codeHash());
  });

  it('notices a new module, not only an edited one', async () => {
    const { root, project, sources } = fixture();
    const worker = new PythonWorker(project, 'runtime/worker.py', 'python3', process.env, { sources });
    workers.push(worker);
    await worker.call('look', {});
    fs.writeFileSync(path.join(root, 'runtime', 'extra.py'), 'X = 1\n');
    await worker.call('look', {});
    expect(worker.restarts).toBe(1);
  });

  it('passes the Cascade envelope beside the args', async () => {
    const { project, sources } = fixture();
    const worker = new PythonWorker(project, 'runtime/worker.py', 'python3', process.env, { sources });
    workers.push(worker);
    const answer = await worker.callWithMeta('look', {}, { cascade: { key: 'abc' } });
    expect(answer.result).toMatchObject({ cascade: { key: 'abc' } });
    expect(answer.codeHash).toBe(sources.codeHash());
  });
});
