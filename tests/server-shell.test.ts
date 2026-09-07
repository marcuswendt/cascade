import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectRoot } from '../server/src/project.js';
import { ShellProcessError } from '../server/src/shell/types.js';
import { compileProjectModule } from '../server/src/compile.js';
import { createDirectShellCapability } from '../server/src/shell/service.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function project(config: Record<string, unknown>): ProjectRoot {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-shell-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify(config));
  return new ProjectRoot(root);
}

describe('ShellService', () => {
  it('treats only a missing cascade.json as an empty shell configuration', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-shell-config-'));
    roots.push(root);
    expect(() => new ProjectRoot(root)).not.toThrow();
    fs.writeFileSync(path.join(root, 'cascade.json'), '{broken');
    expect(() => new ProjectRoot(root)).toThrow();
  });

  it('runs only configured aliases without a shell', async () => {
    const p = project({ commands: { node: process.execPath } });
    const result = await p.shell.run('node', ['-e', 'process.stdout.write(process.argv[1])', '; touch /tmp/not-run']);
    expect(result).toMatchObject({ stdout: '; touch /tmp/not-run', code: 0, timedOut: false });
    await expect(p.shell.run('sh', ['-c', 'true'])).rejects.toMatchObject({ code: 'COMMAND_NOT_ALLOWED' });
  });

  it('preserves nonzero output and gives runJson typed failures', async () => {
    const p = project({ commands: { node: process.execPath } });
    const result = await p.shell.run('node', ['-e', 'process.stderr.write("bad");process.exit(7)']);
    expect(result).toMatchObject({ stderr: 'bad', code: 7 });
    await expect(p.shell.runJson('node', ['-e', 'process.stdout.write("not json")'])).rejects.toMatchObject({
      kind: 'invalid-json', result: { code: 0, stdout: 'not json' },
    });
    await expect(p.shell.runJson('node', ['-e', 'process.exit(3)'])).rejects.toMatchObject({
      kind: 'nonzero', result: { code: 3 },
    });
  });

  it('rejects signal-terminated children with a null exit code', async () => {
    const p = project({ commands: { node: process.execPath } });
    await expect(p.shell.run('node', ['-e', `process.kill(process.pid, ${JSON.stringify(process.platform === 'win32' ? 'SIGINT' : 'SIGTERM')})`]))
      .rejects.toMatchObject({ kind: 'spawn', result: { code: null, timedOut: false, cancelled: false } });
  });

  it('latches spawn failure once and emits one audit record', async () => {
    if (process.platform === 'win32') return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-shell-spawn-'));
    roots.push(root);
    const executable = path.join(root, 'temporary-command');
    fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify({ commands: { temporary: executable } }));
    const p = new ProjectRoot(root);
    const audit = vi.fn();
    p.shell.setAuditSink(audit);
    fs.unlinkSync(executable);
    await expect(p.shell.run('temporary')).rejects.toMatchObject({ kind: 'spawn', result: { code: null } });
    expect(audit).toHaveBeenCalledOnce();
  });

  it('rejects traversal, unsafe request environment, and times out process trees', async () => {
    const p = project({ commands: { node: process.execPath }, shell: { env: { PATH: '/unsafe-static-path' }, allowedRequestEnv: ['SAFE', 'PATH'] } });
    await expect(p.shell.run('node', [], { cwd: '..' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(p.shell.run('node', [], { env: { PATH: '/tmp' } })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(p.shell.run('node', ['-e', 'setInterval(()=>{},1000)'], { timeout: 20 })).rejects.toMatchObject({
      kind: 'timeout', result: { timedOut: true, code: null },
    });
    const env = await p.shell.run('node', ['-e', 'process.stdout.write(process.env.PATH ?? "")']);
    expect(env.stdout).not.toBe('/unsafe-static-path');
  });

  it('rejects a project-relative cwd that escapes through a symlink', async () => {
    if (process.platform === 'win32') return;
    const p = project({ commands: { node: process.execPath } });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-shell-outside-'));
    roots.push(outside);
    fs.symlinkSync(outside, path.join(p.root, 'outside'));

    await expect(p.shell.run('node', ['--version'], { cwd: 'outside' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('kills descendant processes before a timed-out run settles', async () => {
    if (process.platform === 'win32') return;
    const p = project({ commands: { node: process.execPath } });
    const pidFile = path.join(p.root, 'descendant.pid');
    const source = `const{spawn}=require('node:child_process'),fs=require('node:fs');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000)`;
    // 100ms was tight enough to race the child's own spawn: under a loaded
    // parallel suite the grandchild was sometimes created around the moment the
    // tree was killed, and outlived it, failing here rather than in the product.
    // A longer timeout keeps the assertion — a timed-out run kills descendants —
    // and removes the race, since the run is expected to time out either way.
    await expect(p.shell.run('node', ['-e', source], { timeout: 1500 })).rejects.toMatchObject({ kind: 'timeout' });
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('cancels and emits one redacted audit record', async () => {
    const audit = vi.fn();
    const p = project({ commands: { node: process.execPath } });
    p.shell.setAuditSink(audit);
    const controller = new AbortController();
    const pending = p.shell.run('node', ['-e', 'setInterval(()=>{},1000)', 'secret-arg'], { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ShellProcessError);
    expect(audit).toHaveBeenCalledOnce();
    expect(JSON.stringify(audit.mock.calls[0][0])).not.toContain('secret-arg');
    expect(audit.mock.calls[0][0]).toMatchObject({ command: 'node', cancelled: true });
  });

  it('binds the project shell to a headless runtime cancellation signal', async () => {
    const p = project({ commands: { node: process.execPath } });
    const controller = new AbortController();
    const shell = createDirectShellCapability(p.shell, controller.signal);
    const pending = shell.run('node', ['-e', 'setInterval(()=>{},1000)']);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled', result: { cancelled: true } });
  });

  it('classifies and compiles cascade/shell as a browser-safe server module', async () => {
    const p = project({ commands: { node: process.execPath } });
    const dir = path.join(p.root, 'nodes', 'uses-shell');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.ts'), `import { run } from 'cascade/shell';\nexport async function execute(){ return run('node', ['--version']); }`);
    await expect(p.moduleRunsOn('uses-shell')).resolves.toBe('server');
    const compiled = await compileProjectModule(p, 'uses-shell');
    expect(compiled.ok).toBe(true);
    expect(compiled.code).not.toMatch(/node:child_process|node:fs/);
  });

  // The test above passes in this repo whether or not the resolver exists: a
  // workspace link makes '@cascade/contracts' resolvable from anywhere under
  // the root. An installed copy of Cascade has no such package on disk — only
  // the bundled dist/contracts — so the specifier has to be gone from the
  // output, not merely resolvable here.
  it('inlines the contracts package rather than leaving a bare specifier', async () => {
    const p = project({ commands: { node: process.execPath } });
    const dir = path.join(p.root, 'nodes', 'shell-errors');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.ts'), `import { run, ShellProcessError } from 'cascade/shell';\nexport async function execute(){ try { return await run('node', ['--version']); } catch (e) { return e instanceof ShellProcessError; } }`);
    const compiled = await compileProjectModule(p, 'shell-errors');
    expect(compiled.ok).toBe(true);
    expect(compiled.code).not.toContain('@cascade/contracts');
    expect(compiled.code).toContain('ShellProcessError');
  });

  it('rejects an explicit browser classification that imports cascade/shell', async () => {
    const p = project({ commands: { node: process.execPath } });
    const dir = path.join(p.root, 'nodes', 'invalid-browser-shell');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.ts'), `import { run } from 'cascade/shell';\nexport const runsOn = 'browser';\nexport async function execute(){ return run('node'); }`);
    await expect(p.moduleRunsOn('invalid-browser-shell')).rejects.toThrow(/cascade\/shell.*runsOn.*browser/i);
    await expect(compileProjectModule(p, 'invalid-browser-shell')).resolves.toMatchObject({ ok: false });
  });

  it('preserves an explicit portable execution classification', async () => {
    const p = project({});
    const dir = path.join(p.root, 'nodes', 'portable-crop');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.ts'), `export const runsOn = 'portable';\nexport function execute() {}`);
    await expect(p.moduleRunsOn('portable-crop')).resolves.toBe('portable');
  });
});
