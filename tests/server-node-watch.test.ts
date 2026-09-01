import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectRoot } from '../server/src/project.js';
import { createNodeWatcher, ALL_MODULES } from '../server/src/nodeWatch.js';

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

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** FSEvents delivers with a lag and can hand over events that predate the
 *  watch, so the fixture's own setup writes arrive after createNodeWatcher
 *  returns. Every test settles before it acts, otherwise it is asserting on
 *  its own scaffolding. */
const settle = () => pause(400);

/** fs.watch is asynchronous and the watcher debounces, so wait for the report
 *  rather than for a fixed delay. */
function nextChange(watcher: ReturnType<typeof createNodeWatcher>, timeout = 4000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('no change reported')); }, timeout);
    const unsubscribe = watcher.subscribe((moduleName) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(moduleName);
    });
  });
}

describe('node source watcher', () => {
  it('reports the module folder when one of its files changes', async () => {
    const root = project();
    const watcher = createNodeWatcher(root);
    watchers.push(watcher);
    await settle();
    const change = nextChange(watcher);

    fs.writeFileSync(path.join(root.root, 'nodes', 'Blur', 'index.ts'), 'export function execute() { /* edited */ }\n');

    expect(await change).toBe('Blur');
  });

  it('collapses a burst of writes into one report', async () => {
    const root = project();
    const watcher = createNodeWatcher(root);
    watchers.push(watcher);

    await settle();
    const reported: string[] = [];
    watcher.subscribe((moduleName) => reported.push(moduleName));

    const file = path.join(root.root, 'nodes', 'Blur', 'index.ts');
    for (let i = 0; i < 5; i++) fs.writeFileSync(file, `export function execute() { /* ${i} */ }\n`);

    await pause(600);
    expect(reported).toEqual(['Blur']);
  });

  it('reports every module when a shared library file changes, since the re-exporting module cannot be derived', async () => {
    const root = project();
    const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-node-watch-shared-'));
    roots.push(shared);
    fs.mkdirSync(path.join(shared, 'nodes', 'Crop'), { recursive: true });
    fs.writeFileSync(path.join(shared, 'nodes', 'Crop', 'index.ts'), 'export function execute() {}\n');
    fs.symlinkSync(shared, path.join(root.root, 'shared'));

    const watcher = createNodeWatcher(root);
    watchers.push(watcher);
    await settle();
    const change = nextChange(watcher);

    fs.writeFileSync(path.join(shared, 'nodes', 'Crop', 'index.ts'), 'export function execute() { /* edited */ }\n');

    expect(await change).toBe(ALL_MODULES);
  });

  it('ignores a loose file directly under nodes/, which belongs to no module', async () => {
    const root = project();
    const watcher = createNodeWatcher(root);
    watchers.push(watcher);

    await settle();
    const reported: string[] = [];
    watcher.subscribe((moduleName) => reported.push(moduleName));

    fs.writeFileSync(path.join(root.root, 'nodes', 'README.md'), 'notes\n');

    await pause(600);
    expect(reported).toEqual([]);
  });

  it('stops reporting once closed', async () => {
    const root = project();
    const watcher = createNodeWatcher(root);
    await settle();
    const reported: string[] = [];
    watcher.subscribe((moduleName) => reported.push(moduleName));
    watcher.close();

    fs.writeFileSync(path.join(root.root, 'nodes', 'Blur', 'index.ts'), 'export function execute() { /* after close */ }\n');

    await pause(600);
    expect(reported).toEqual([]);
  });
});
