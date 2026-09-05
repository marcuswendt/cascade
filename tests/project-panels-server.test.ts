import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import type { Server } from 'node:http';
import { ProjectRoot, PathSafetyError } from '../server/src/project.js';
import { compileProjectPanel } from '../server/src/compile.js';
import { startServer } from '../server/src/index.js';

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(): ProjectRoot {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-project-panels-'));
  roots.push(root);
  return new ProjectRoot(root);
}

function writePanel(project: ProjectRoot, location: 'panels' | 'shared/panels', name: string, source: string): void {
  const directory = path.join(project.root, location, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'index.ts'), source);
}

async function serve(project: ProjectRoot): Promise<string> {
  const port = await freePort();
  const server = startServer(project, { port });
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing server address');
  return `http://127.0.0.1:${address.port}`;
}

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('missing probe address');
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return address.port;
}

// These compile panels with esbuild, and under a full parallel suite one of
// them intermittently HANGS rather than running slowly: it passed at 5s, timed
// out at 20s, and timed out again at 60s, while passing every time the file is
// run alone. So the timeout is not the fault and raising it further is not the
// fix — it reads as contention in esbuild's shared service process. 20s is kept
// as a bound on the hang, not as a deadline for the work.
describe('project panel server extension', { timeout: 20_000 }, () => {
  it('returns an empty list for projects without panels', async () => {
    const base = await serve(fixture());
    const response = await fetch(`${base}/api/panels`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ panels: [] });
  });

  it('discovers local and shared panels and reads metadata without executing modules', async () => {
    const project = fixture();
    writePanel(project, 'shared/panels', 'moments', `
      export const title: string = 'Shared Moments';
      export const icon = 'Aperture';
      export const rendererTypes: readonly string[] = ['archive.item.id', 'archive.metadata'];
      throw new Error('metadata discovery must not execute this module');
      export function mount() {}
    `);
    writePanel(project, 'panels', 'local-only', `export function mount() {}`);

    await expect(project.listPanels()).resolves.toEqual(['local-only', 'moments']);
    await expect(project.panelMeta('moments')).resolves.toEqual({
      name: 'moments',
      title: 'Shared Moments',
      icon: 'Aperture',
      rendererTypes: ['archive.item.id', 'archive.metadata'],
    });
    await expect(project.panelMeta('local-only')).resolves.toEqual({
      name: 'local-only',
      title: 'local-only',
      icon: null,
    });
  });

  it('discovers and compiles panels through a project shared-directory symlink', async () => {
    if (process.platform === 'win32') return;
    const project = fixture();
    const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-shared-panels-'));
    roots.push(shared);
    fs.mkdirSync(path.join(shared, 'panels', 'moments'), { recursive: true });
    fs.writeFileSync(path.join(shared, 'panels', 'moments', 'index.ts'), `
      export const title = 'Linked Moments';
      export function mount(element: HTMLElement) { element.dataset.panel = 'linked'; }
    `);
    fs.symlinkSync(shared, path.join(project.root, 'shared'));

    await expect(project.listPanels()).resolves.toEqual(['moments']);
    await expect(project.panelMeta('moments')).resolves.toMatchObject({ title: 'Linked Moments' });
    const compiled = await compileProjectPanel(project, 'moments');
    expect(compiled.ok).toBe(true);
    expect(compiled.code).toContain('linked');

    const base = await serve(project);
    const response = await fetch(`${base}/api/panels`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      panels: [{ name: 'moments', title: 'Linked Moments', icon: null }],
    });
  });

  it('prefers a project-local panel for metadata and compilation', async () => {
    const project = fixture();
    writePanel(project, 'shared/panels', 'moments', `
      export const title = 'Shared Moments';
      export const icon = 'Cloud';
      export const source = 'shared';
      export function mount(element: HTMLElement) { element.dataset.source = source; }
    `);
    writePanel(project, 'panels', 'moments', `
      export const title = 'Project Moments';
      export const icon = 'Aperture';
      export const source = 'project-local';
      export function mount(element: HTMLElement) { element.dataset.source = source; }
    `);

    await expect(project.panelMeta('moments')).resolves.toMatchObject({ title: 'Project Moments', icon: 'Aperture' });
    const compiled = await compileProjectPanel(project, 'moments');
    expect(compiled.ok).toBe(true);
    expect(compiled.code).toContain('project-local');
    expect(compiled.code).not.toContain('Shared Moments');

    const base = await serve(project);
    const listed = await fetch(`${base}/api/panels`);
    await expect(listed.json()).resolves.toEqual({
      panels: [{ name: 'moments', title: 'Project Moments', icon: 'Aperture' }],
    });
    const response = await fetch(`${base}/api/panels/moments/compiled`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/javascript');
    expect(await response.text()).toContain('project-local');
  });

  it('rejects panel names that are not a single confined path segment', async () => {
    const project = fixture();
    await expect(project.panelMeta('../outside')).rejects.toBeInstanceOf(PathSafetyError);

    const base = await serve(project);
    const response = await fetch(`${base}/api/panels/${encodeURIComponent('../outside')}/compiled`);
    expect(response.status).toBe(400);
  });
});
