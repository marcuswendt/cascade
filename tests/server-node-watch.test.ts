import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectRoot } from '../server/src/project.js';
import { PathSafetyError } from '../server/src/pathSafety.js';
import { createNodeWatcher, ALL_MODULES, NODE_WATCH_DEBOUNCE_MS } from '../server/src/nodeWatch.js';
import { FakeClock, FakeWatch } from './mocks/fakeWatch.js';

const roots: string[] = [];
const watchers: Array<{ close(): void }> = [];

afterEach(() => {
  for (const watcher of watchers.splice(0)) watcher.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function project(): ProjectRoot {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-node-watch-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'index.cascade'), '{}');
  fs.mkdirSync(path.join(root, 'nodes', 'Blur'), { recursive: true });
  fs.writeFileSync(path.join(root, 'nodes', 'Blur', 'index.ts'), 'export function execute() {}\n');
  return new ProjectRoot(root);
}

/**
 * The watcher with its events and its clock in the test's hands. These tests
 * used real `fs.watch` and fixed sleeps, and under load FSEvents delivered
 * late, coalesced, or replayed the fixture's setup writes: they failed in every
 * full run of the 6 Nov 2026 review. What they pin is the watcher's own logic
 * (attribution, debounce, close), which needs neither.
 */
function harness(root = project()) {
  const clock = new FakeClock();
  const fake = new FakeWatch();
  const watcher = createNodeWatcher(root, { clock, watch: fake.watch });
  watchers.push(watcher);
  const reported: string[] = [];
  watcher.subscribe((moduleName) => reported.push(moduleName));
  const nodes = root.resolve('nodes');
  return { root, clock, fake, watcher, reported, nodes };
}

describe('node source watcher', () => {
  it('reports the module folder when one of its files changes', () => {
    const { clock, fake, reported, nodes } = harness();

    fake.change(nodes, path.join('Blur', 'index.ts'));
    expect(reported).toEqual([]); // not before the debounce
    clock.advance(NODE_WATCH_DEBOUNCE_MS);

    expect(reported).toEqual(['Blur']);
  });

  it('collapses a burst of writes into one report', () => {
    const { clock, fake, reported, nodes } = harness();

    for (let i = 0; i < 5; i++) {
      fake.change(nodes, path.join('Blur', 'index.ts'));
      clock.advance(NODE_WATCH_DEBOUNCE_MS - 1); // each write lands inside the last one's window
    }
    expect(reported).toEqual([]);
    clock.advance(1);

    expect(reported).toEqual(['Blur']);
  });

  it('reports separate modules separately, and the same module again after the window', () => {
    const { clock, fake, reported, nodes } = harness();

    fake.change(nodes, path.join('Blur', 'index.ts'));
    fake.change(nodes, path.join('Crop', 'shader.wgsl'));
    clock.advance(NODE_WATCH_DEBOUNCE_MS);
    fake.change(nodes, path.join('Blur', 'index.ts'));
    clock.advance(NODE_WATCH_DEBOUNCE_MS);

    expect(reported).toEqual(['Blur', 'Crop', 'Blur']);
  });

  it('reports every module when a shared library file changes, since the re-exporting module cannot be derived', () => {
    const root = project();
    const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-node-watch-shared-'));
    roots.push(shared);
    fs.mkdirSync(path.join(shared, 'nodes', 'Crop'), { recursive: true });
    fs.symlinkSync(shared, path.join(root.root, 'shared'));
    const { clock, fake, reported } = harness(root);

    const sharedNodes = path.join(fs.realpathSync(shared), 'nodes');
    expect(fake.directories).toContain(sharedNodes);
    fake.change(sharedNodes, path.join('Crop', 'index.ts'));
    clock.advance(NODE_WATCH_DEBOUNCE_MS);

    expect(reported).toEqual([ALL_MODULES]);
  });

  it('ignores a loose file directly under nodes/, a dot folder, and an event with no name', () => {
    const { clock, fake, reported, nodes } = harness();

    fake.change(nodes, 'README.md');
    fake.change(nodes, path.join('.DS_Store'));
    fake.change(nodes, path.join('.cache', 'x.js'));
    fake.change(nodes, null);
    clock.advance(NODE_WATCH_DEBOUNCE_MS * 4);

    expect(reported).toEqual([]);
  });

  it('stops reporting once closed, including a change still inside its debounce', () => {
    const { clock, fake, watcher, reported, nodes } = harness();

    fake.change(nodes, path.join('Blur', 'index.ts'));
    watcher.close();
    fake.change(nodes, path.join('Blur', 'index.ts'));
    clock.advance(NODE_WATCH_DEBOUNCE_MS * 4);

    expect(reported).toEqual([]);
    expect(clock.pending).toBe(0);
    expect(fake.directories).toEqual([]);
  });

  /** Without seams it is real `fs.watch`, recursive, on the project's nodes
   *  folder, and real timers. The event is delivered by hand through the
   *  listener fs.watch was given: waiting on FSEvents is what made this file
   *  flaky (a loaded full run stalled it past 20 s). */
  it('defaults to a recursive fs.watch on nodes/ and real timers', async () => {
    const watchSpy = vi.spyOn(fs, 'watch');
    try {
      const root = project();
      const watcher = createNodeWatcher(root);
      watchers.push(watcher);
      const call = watchSpy.mock.calls.find(([directory]) => directory === root.resolve('nodes'));
      expect(call?.[1]).toEqual({ recursive: true });
      const report = call![2] as unknown as (event: string, filename: string) => void;
      const change = new Promise<string>((resolve) => watcher.subscribe(resolve));

      report('change', path.join('Blur', 'index.ts'));

      expect(await change).toBe('Blur');
    } finally {
      watchSpy.mockRestore();
    }
  });
});

describe('node source paths', () => {
  it('resolves a module to an absolute path an editor can open', () => {
    const root = project();
    expect(root.resolve('nodes/Blur/index.ts')).toBe(path.join(root.root, 'nodes', 'Blur', 'index.ts'));
  });

  it('refuses a module name that climbs out of the project', () => {
    const root = project();
    expect(() => root.resolve('nodes/../../secrets/index.ts')).toThrow(PathSafetyError);
  });
});
