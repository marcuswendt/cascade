import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FFMPEG_CANDIDATES, framesToMp4, framesToMp4Args, runFfmpeg } from '../dist/video.js';
import { definitionStatement, STUB_MARKER, stubSource, syncNodeStubs } from '../dist/nodes.js';
import { main } from '../dist/cli.js';

const ffmpeg = FFMPEG_CANDIDATES.find((bin) => { try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } });

test('ffmpeg arguments are the commons frames-to-video ones', () => {
  assert.deepEqual(framesToMp4Args({ frames: 'r/f.%04d.png', out: 'r/o.mp4', fps: 30, startNumber: 1, crf: 16, root: '/p' }), [
    '-y', '-v', 'error', '-framerate', '30', '-start_number', '1', '-i', '/p/r/f.%04d.png',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'slow', '-movflags', '+faststart', '/p/r/o.mp4']);
  assert.ok(framesToMp4Args({ frames: 'f%d.png', out: 'o.mp4', scale: 0.5 }).includes('scale=trunc(iw*0.5/2)*2:trunc(ih*0.5/2)*2'));
});

test('frames to MP4 end to end', { skip: !ffmpeg && 'no ffmpeg on this machine' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kit-video-'));
  runFfmpeg(['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x48:d=0.1', '-frames:v', '3', '-start_number', '1', join(dir, 'f.%04d.png')]);
  const out = framesToMp4({ frames: 'f.%04d.png', out: 'out/v.mp4', root: dir, fps: 24, preset: 'ultrafast' });
  assert.ok(existsSync(out) && statSync(out).size > 100);
  assert.throws(() => runFfmpeg(['-v', 'error', '-i', join(dir, 'missing.png'), join(dir, 'x.mp4')]), /ffmpeg failed/);
});

const providerNode = (label) => `import type { NodeDefinition, NodeExecutionContext } from 'cascade/contracts';
import { helper } from '../../lib/helper';

export const definition = {
  apiVersion: 1,
  label: '${label}',
  runsOn: 'portable',
  // a brace in a comment: {
  outputs: { value: { kind: 'data', type: 'string', description: 'braces } in a string; and a semicolon' } },
} as const satisfies NodeDefinition;

export function execute(context: NodeExecutionContext<typeof definition>) {
  context.outputs.value.set(helper());
}
`;

test('definitionStatement finds the whole literal past braces in strings and comments', () => {
  const s = definitionStatement(providerNode('X'));
  assert.ok(s.startsWith('export const definition = {'));
  assert.ok(s.endsWith('} as const satisfies NodeDefinition;'));
  assert.match(s, /braces \} in a string; and a semicolon/);
  assert.equal(definitionStatement('export function execute() {}'), null);
});

test('nodes: generate stubs from a provider dependency, leave local nodes alone, detect drift', async () => {
  const project = await mkdtemp(join(tmpdir(), 'kit-nodes-'));
  const provider = join(project, 'node_modules', 'cloud-shared');
  for (const name of ['moment', 'envelope']) {
    await mkdir(join(provider, 'nodes', name), { recursive: true });
    await writeFile(join(provider, 'nodes', name, 'index.ts'), providerNode(name));
  }
  await mkdir(join(project, 'nodes', 'envelope'), { recursive: true });
  await writeFile(join(project, 'nodes', 'envelope', 'index.ts'), '// my own envelope\n');

  const first = await syncNodeStubs({ project, provider: 'cloud-shared' });
  assert.deepEqual(first, { written: ['moment'], unchanged: [], drift: [], skipped: ['envelope'] });
  const stub = await readFile(join(project, 'nodes', 'moment', 'index.ts'), 'utf8');
  assert.equal(stub, stubSource('cloud-shared', 'moment', definitionStatement(providerNode('moment'))));
  assert.ok(stub.startsWith(STUB_MARKER));
  assert.match(stub, /export \{ execute \} from '\.\.\/\.\.\/node_modules\/cloud-shared\/nodes\/moment\/index';/);
  assert.match(stub, /import type \{ NodeDefinition \} from 'cascade\/contracts';/);

  assert.deepEqual((await syncNodeStubs({ project, provider: 'cloud-shared', check: true })).drift, []);
  await writeFile(join(provider, 'nodes', 'moment', 'index.ts'), providerNode('Moment, renamed'));
  const drift = await syncNodeStubs({ project, provider: 'cloud-shared', check: true });
  assert.deepEqual(drift.drift, ['moment']);
  assert.equal(await main(['nodes', 'cloud-shared', '--check', '--project', project]), 1);
  assert.equal(await main(['nodes', 'cloud-shared', 'moment', '--project', project]), 0);
  assert.match(await readFile(join(project, 'nodes', 'moment', 'index.ts'), 'utf8'), /Moment, renamed/);
  assert.equal(await main(['nodes', 'cloud-shared', '--check', '--project', project]), 0);
  assert.equal(await main(['bogus']), 2);
});
