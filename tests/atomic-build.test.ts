import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .mjs build script, deliberately without declarations
import { atomicBuild, BuildStepError } from '../scripts/atomic-build.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-atomic-build-'));
  roots.push(root);
  const dist = path.join(root, 'dist');
  fs.mkdirSync(path.join(dist, 'cli'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'cli', 'index.js'), 'working cli');
  fs.writeFileSync(path.join(dist, 'index.html'), 'old studio');
  return { root, dist };
}

const quiet = () => {};

describe('atomic build', () => {
  it('replaces dist only after every step succeeded', async () => {
    const { root, dist } = workspace();
    await atomicBuild({
      distDir: dist,
      log: quiet,
      steps: [
        { name: 'studio', run: (staging: string) => fs.writeFileSync(path.join(staging, 'index.html'), 'new studio') },
        { name: 'cli', run: (staging: string) => { fs.mkdirSync(path.join(staging, 'cli')); fs.writeFileSync(path.join(staging, 'cli', 'index.js'), 'new cli'); } },
      ],
    });
    expect(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')).toBe('new studio');
    expect(fs.readFileSync(path.join(dist, 'cli', 'index.js'), 'utf8')).toBe('new cli');
    expect(fs.readdirSync(root).sort()).toEqual(['dist']);
  });

  it('leaves the previous dist intact when a step fails, even after an earlier step emptied its output', async () => {
    const { root, dist } = workspace();
    const failure = atomicBuild({
      distDir: dist,
      log: quiet,
      steps: [
        // What vite does: empty the output directory first.
        { name: 'studio', run: (staging: string) => { fs.rmSync(staging, { recursive: true, force: true }); fs.mkdirSync(staging); } },
        { name: 'cli', run: () => { throw new Error('MISSING_EXPORT SCENE_EMBED_LIMIT'); } },
      ],
    });
    await expect(failure).rejects.toBeInstanceOf(BuildStepError);
    await expect(failure).rejects.toThrow(/"cli" failed: MISSING_EXPORT/);
    expect(fs.readFileSync(path.join(dist, 'cli', 'index.js'), 'utf8')).toBe('working cli');
    expect(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')).toBe('old studio');
    expect(fs.readdirSync(root).sort()).toEqual(['dist']);
  });

  it('can seed staging from the current dist for a partial rebuild', async () => {
    const { dist } = workspace();
    await atomicBuild({
      distDir: dist,
      log: quiet,
      seedFromExisting: true,
      steps: [{ name: 'cli', run: (staging: string) => fs.writeFileSync(path.join(staging, 'cli', 'index.js'), 'new cli') }],
    });
    expect(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')).toBe('old studio');
    expect(fs.readFileSync(path.join(dist, 'cli', 'index.js'), 'utf8')).toBe('new cli');
  });

  it('builds a first dist where none existed', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-atomic-build-'));
    roots.push(root);
    const dist = path.join(root, 'dist');
    await atomicBuild({ distDir: dist, log: quiet, steps: [{ name: 'one', run: (staging: string) => fs.writeFileSync(path.join(staging, 'a'), 'a') }] });
    expect(fs.readFileSync(path.join(dist, 'a'), 'utf8')).toBe('a');
  });
});
