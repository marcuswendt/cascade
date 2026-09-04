import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildId } from '../server/src/build.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function dist(html: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-build-id-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  return dir;
}

const page = (bundle: string) => `<!doctype html><script src="/assets/${bundle}"></script>`;

describe('buildId', () => {
  it('is stable for the same build', () => {
    const dir = dist(page('index-AAAA.js'));
    expect(buildId(dir)).toBe(buildId(dir));
  });

  it('changes when a rebuild renames the bundle', () => {
    const before = buildId(dist(page('index-AAAA.js')));
    const after = buildId(dist(page('index-BBBB.js')));
    expect(before).not.toBe(after);
  });

  it('changes when index.html is rewritten in place', () => {
    const dir = dist(page('index-AAAA.js'));
    const before = buildId(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), page('index-CCCC.js'));
    expect(buildId(dir)).not.toBe(before);
  });

  it('reports nothing rather than a fabricated id when there is no build', () => {
    // A made-up id would make a stale tab believe it was current, which is the
    // exact failure this exists to catch.
    expect(buildId(path.join(os.tmpdir(), 'cascade-build-id-absent'))).toBeNull();
  });
});
