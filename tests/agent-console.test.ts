import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectRoot } from '../server/src/project.js';
import { createGraphWatcher, graphFileFor } from '../server/src/graphWatch.js';
import { agentAvailability, agentExtraArgs, allowlistHint, resolveExecutable } from '../server/src/agent/allowlist.js';
import { argsFor, childEnvironment, claudeArgs, codexArgs, sessionIdFrom } from '../server/src/agent/session.js';
import { documentFingerprint } from '../src/editor/graphDocumentWatch.js';
import { describeStreamLine } from '../src/editor/agentConsole.js';

const roots: string[] = [];
const watchers: Array<{ close(): void }> = [];

afterEach(() => {
  for (const watcher of watchers.splice(0)) watcher.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function projectRoot(cascadeJson?: unknown): ProjectRoot {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-agent-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'index.cascade'), '{"nodes":[]}');
  if (cascadeJson !== undefined) fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify(cascadeJson));
  return new ProjectRoot(root);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** FSEvents delivers with a lag and can hand over events that predate the
 *  watch, so the fixture's own setup writes arrive after the watcher is made. */
const settle = () => pause(400);

function nextChange(watcher: ReturnType<typeof createGraphWatcher>, timeout = 4000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('no change reported')); }, timeout);
    const unsubscribe = watcher.subscribe((file) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(file);
    });
  });
}

describe('graph document watcher', () => {
  it('names the document that changed', async () => {
    const project = projectRoot();
    const watcher = createGraphWatcher(project);
    watchers.push(watcher);
    await settle();
    const change = nextChange(watcher);

    fs.writeFileSync(path.join(project.root, 'index.cascade'), '{"nodes":[{"id":"a"}]}');

    expect(await change).toBe('index.cascade');
  });

  it('collapses a burst of writes into one report', async () => {
    const project = projectRoot();
    const watcher = createGraphWatcher(project);
    watchers.push(watcher);
    await settle();
    let reports = 0;
    watcher.subscribe(() => { reports += 1; });

    const file = path.join(project.root, 'index.cascade');
    for (let i = 0; i < 5; i += 1) fs.writeFileSync(file, `{"nodes":[],"i":${i}}`);
    await pause(600);

    expect(reports).toBe(1);
  });

  it('ignores writes that are not documents', async () => {
    const project = projectRoot();
    const watcher = createGraphWatcher(project);
    watchers.push(watcher);
    await settle();
    let reports = 0;
    watcher.subscribe(() => { reports += 1; });

    fs.mkdirSync(path.join(project.root, 'nodes', 'Blur'), { recursive: true });
    fs.writeFileSync(path.join(project.root, 'nodes', 'Blur', 'index.ts'), 'export function execute() {}\n');
    fs.writeFileSync(path.join(project.root, 'notes.md'), 'hello');
    await pause(600);

    expect(reports).toBe(0);
  });
});

describe('graphFileFor', () => {
  it('accepts a document at the project root', () => {
    expect(graphFileFor('index.cascade')).toBe('index.cascade');
    expect(graphFileFor('my scene.cascade')).toBe('my scene.cascade');
  });

  it('rejects anything that is not one', () => {
    expect(graphFileFor('nodes/Blur/index.ts')).toBeNull();
    expect(graphFileFor('scenes/a.cascade')).toBeNull();
    expect(graphFileFor('notes.md')).toBeNull();
    // An editor's swap file is a write in progress, not a change to publish.
    expect(graphFileFor('.index.cascade.swp')).toBeNull();
    expect(graphFileFor('.#index.cascade')).toBeNull();
  });
});

describe('document fingerprint', () => {
  it('ignores the timestamp every save rewrites', () => {
    const a = { nodes: [{ id: 'a' }], metadata: { modified: '2026-09-07T10:00:00.000Z', author: 'mw' } };
    const b = { nodes: [{ id: 'a' }], metadata: { modified: '2026-09-07T12:34:56.000Z', author: 'mw' } };
    expect(documentFingerprint(a)).toBe(documentFingerprint(b));
  });

  it('ignores key order but not content', () => {
    expect(documentFingerprint({ a: 1, b: 2 })).toBe(documentFingerprint({ b: 2, a: 1 }));
    expect(documentFingerprint({ nodes: [{ id: 'a' }] })).not.toBe(documentFingerprint({ nodes: [{ id: 'b' }] }));
  });

  it('survives a document with no metadata at all', () => {
    expect(documentFingerprint({ nodes: [] })).toBe('{"nodes":[]}');
  });
});

describe('agent allowlist', () => {
  it('names the exact line to add when the alias is missing', () => {
    const project = projectRoot({});
    const status = agentAvailability(project.root, 'claude');
    expect(status.configured).toBe(false);
    expect(status.hint).toBe(allowlistHint(project.root, 'claude'));
    expect(status.hint).toContain('cascade.json');
    expect(status.hint).toContain('"claude"');
  });

  it('reports a declared alias whose target cannot be run', () => {
    const project = projectRoot({ commands: { claude: '/nowhere/claude' } });
    const status = agentAvailability(project.root, 'claude');
    expect(status.configured).toBe(true);
    expect(status.resolved).toBe(false);
    expect(status.hint).toContain('is not available');
  });

  it('resolves an executable declared by absolute path', () => {
    const project = projectRoot();
    const script = path.join(project.root, 'fake-claude');
    fs.writeFileSync(script, '#!/bin/sh\necho hi\n');
    fs.chmodSync(script, 0o755);
    fs.writeFileSync(path.join(project.root, 'cascade.json'), JSON.stringify({ commands: { claude: script } }));

    const status = agentAvailability(project.root, 'claude');
    expect(status).toMatchObject({ configured: true, resolved: true, hint: null });
  });

  it('refuses a project-relative target', () => {
    // A relative path would make the allowlist depend on the cwd of whoever
    // launched the server, which is not something a reader of cascade.json can
    // check. Absolute, `~`-relative, or a bare name on PATH.
    expect(resolveExecutable('./bin/claude')).toBeNull();
    expect(resolveExecutable('')).toBeNull();
    expect(resolveExecutable(42)).toBeNull();
  });

  it('rejects an alias that is not one', () => {
    const project = projectRoot({ commands: { claude: '/bin/sh' } });
    expect(agentAvailability(project.root, '../../bin/sh').configured).toBe(false);
  });
});

describe('headless launch arguments', () => {
  it('runs Claude in streaming print mode', () => {
    expect(claudeArgs('add an oscillator', null)).toEqual([
      '-p', 'add an oscillator', '--output-format', 'stream-json', '--verbose',
    ]);
  });

  it('resumes the sketch session on a later prompt', () => {
    expect(claudeArgs('and connect it to ORB', 'abc-123')).toContain('--resume');
    expect(claudeArgs('and connect it to ORB', 'abc-123').at(-1)).toBe('abc-123');
  });

  it('uses codex exec for the other agent', () => {
    expect(codexArgs('do the thing')).toEqual(['exec', '--json', 'do the thing']);
    expect(argsFor('codex', 'do the thing', 'ignored')).toEqual(['exec', '--json', 'do the thing']);
    expect(argsFor('claude', 'do the thing', null)[0]).toBe('-p');
  });

  it('permits headless edits by default, because the allowlist is the real consent', () => {
    // No `agent` block at all. Adding claude under "commands" already
    // authorises launching a coding agent in this project; making it then
    // refuse to edit is friction rather than a second safeguard, and its
    // failure mode is the confusing one — the console launches and silently
    // changes nothing.
    const project = projectRoot({ commands: { claude: '/bin/sh' } });
    expect(agentExtraArgs(project.root, 'claude')).toEqual(['--permission-mode', 'acceptEdits']);
    // No default for an agent Cascade knows nothing about.
    expect(agentExtraArgs(project.root, 'codex')).toEqual([]);
  });

  it('lets a project add nothing at all with an explicit empty array', () => {
    // Distinguishable from an absent block on purpose: this is a project saying
    // "launch it bare", not "I forgot to configure it".
    const project = projectRoot({
      commands: { claude: '/bin/sh' },
      agent: { claude: { args: [] } },
    });
    expect(agentExtraArgs(project.root, 'claude')).toEqual([]);
  });

  it('appends the flags a project declares, which is how headless edits are permitted', () => {
    const project = projectRoot({
      commands: { claude: '/bin/sh' },
      agent: { claude: { args: ['--permission-mode', 'acceptEdits'] } },
    });
    expect(agentExtraArgs(project.root, 'claude')).toEqual(['--permission-mode', 'acceptEdits']);
    expect(agentExtraArgs(project.root, 'codex')).toEqual([]);
    expect(argsFor('claude', 'go', null, agentExtraArgs(project.root, 'claude')).slice(-2)).toEqual(['--permission-mode', 'acceptEdits']);
  });

  it('does not hand the child this process\'s channel bindings', () => {
    // Spawning with process.env intact took down the Telegram bot that had
    // launched the Studio server: the child inherited TELEGRAM_STATE_DIR, bound
    // itself to the same bot token, and the Bot API allows exactly one
    // getUpdates long-poll per token — so one of the two was dropped. A
    // console-launched agent has no business joining a chat.
    const before = process.env.TELEGRAM_STATE_DIR;
    process.env.TELEGRAM_STATE_DIR = '/tmp/some-bot';
    process.env.TELEGRAM_BOT_TOKEN = 'secret';
    try {
      const env = childEnvironment();
      expect(env.TELEGRAM_STATE_DIR).toBeUndefined();
      expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
      // Everything the agent actually needs is still inherited.
      expect(env.PATH).toBe(process.env.PATH);
      expect(env.HOME).toBe(process.env.HOME);
    } finally {
      delete process.env.TELEGRAM_BOT_TOKEN;
      if (before === undefined) delete process.env.TELEGRAM_STATE_DIR;
      else process.env.TELEGRAM_STATE_DIR = before;
    }
  });

  it('reads the session id out of a stream line', () => {
    expect(sessionIdFrom('{"type":"system","subtype":"init","session_id":"s-1"}')).toBe('s-1');
    expect(sessionIdFrom('{"type":"result","session_id":"s-1"}')).toBe('s-1');
    expect(sessionIdFrom('not json')).toBeNull();
    expect(sessionIdFrom('{"type":"assistant"}')).toBeNull();
  });
});

describe('transcript rendering', () => {
  it('shows assistant text as text', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Added OSC1.' }] } });
    expect(describeStreamLine(line)).toEqual({ kind: 'text', text: 'Added OSC1.' });
  });

  it('shows a tool call as the tool and the file it touched', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'index.cascade' } }] },
    });
    expect(describeStreamLine(line)).toEqual({ kind: 'tool', text: '· Edit index.cascade' });
  });

  it('drops the bookkeeping events and keeps the result', () => {
    expect(describeStreamLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-1' }))).toBeNull();
    expect(describeStreamLine(JSON.stringify({ type: 'user', message: {} }))).toBeNull();
    expect(describeStreamLine(JSON.stringify({ type: 'result', result: 'Done.' }))).toEqual({ kind: 'result', text: 'Done.' });
  });

  it('never silently swallows a line it does not recognise', () => {
    expect(describeStreamLine('warning: something happened')).toEqual({ kind: 'raw', text: 'warning: something happened' });
    expect(describeStreamLine('{"type":"unheard-of"}')?.kind).toBe('raw');
    expect(describeStreamLine('   ')).toBeNull();
  });
});
