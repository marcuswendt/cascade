import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectRoot } from '../server/src/project.js';
import { createGraphWatcher, graphFileFor } from '../server/src/graphWatch.js';
import { agentAvailability, agentExtraArgs, allowlistHint, resolveExecutable } from '../server/src/agent/allowlist.js';
import type { Server } from 'node:http';
import { argsFor, childEnvironment, claudeArgs, codexArgs, reapAgentChildren, sessionIdFrom, type AgentEvent } from '../server/src/agent/session.js';
import { AgentEventBuffer } from '../server/src/agent/eventBuffer.js';
import { startServer } from '../server/src/index.js';
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
    // The principle is unchanged and is the point of the test: nothing the
    // stream emits disappears. What changed on 2026-09-07 is where it goes.
    //
    // Text that did not parse stays `raw` and visible, because that is where a
    // real error message arrives. Parsed JSON carrying a type we do not render
    // — rate_limit_event, and whatever the format grows next — becomes
    // `detail`: still returned, still in the transcript, but behind a toggle,
    // because a wall of bookkeeping between the parts that are a conversation
    // is what made Marcus ask for it to be hidden.
    expect(describeStreamLine('warning: something happened')).toEqual({ kind: 'raw', text: 'warning: something happened' });
    expect(describeStreamLine('{"type":"unheard-of"}')?.kind).toBe('detail');
    expect(describeStreamLine('{"type":"rate_limit_event","rate_limit_info":{}}')?.kind).toBe('detail');
    // Not swallowed: the text survives in full for whoever opens the toggle.
    expect(describeStreamLine('{"type":"rate_limit_event"}')?.text).toBe('{"type":"rate_limit_event"}');
    // A JSON object with no type at all is not bookkeeping, so it stays visible.
    expect(describeStreamLine('{"unexpected":true}')?.kind).toBe('raw');
    expect(describeStreamLine('   ')).toBeNull();
  });
});

describe('agent event buffer', () => {
  it('keeps the newest events and reports what it evicted', () => {
    const buffer = new AgentEventBuffer<AgentEvent>(3, 1_000_000);
    for (let i = 0; i < 10; i += 1) buffer.push({ type: 'stdout', text: `line ${i}` });

    expect(buffer.size).toBe(3);
    expect(buffer.droppedTotal).toBe(7);
    const replay = buffer.replay(0);
    expect(replay.events.map((event) => (event as { text: string }).text)).toEqual(['line 7', 'line 8', 'line 9']);
    // A reader asking from the top is told the seven lines it can never have.
    expect(replay.dropped).toBe(7);
    expect(replay.nextSeq).toBe(10);
  });

  it('bounds on bytes as well as on count, so one huge line cannot outgrow the cap', () => {
    const buffer = new AgentEventBuffer<AgentEvent>(1_000, 4_000);
    for (let i = 0; i < 20; i += 1) buffer.push({ type: 'stdout', text: 'x'.repeat(1_000) });

    expect(buffer.size).toBeLessThanOrEqual(4);
    expect(buffer.droppedTotal).toBeGreaterThan(15);
  });

  it('replays only what a reconnecting reader has not seen', () => {
    const buffer = new AgentEventBuffer<AgentEvent>();
    for (let i = 0; i < 5; i += 1) buffer.push({ type: 'stdout', text: `line ${i}` });

    const replay = buffer.replay(3);
    expect(replay.events.map((event) => (event as { text: string }).text)).toEqual(['line 3', 'line 4']);
    expect(replay.dropped).toBe(0);
  });

  it('never evicts its only event', () => {
    const buffer = new AgentEventBuffer<AgentEvent>(1, 1);
    buffer.push({ type: 'stdout', text: 'x'.repeat(10_000) });
    expect(buffer.size).toBe(1);
  });
});

/**
 * The reconnect, end to end against a fake agent rather than the real `claude`.
 *
 * `fake-agent.sh` emits stream-json lines a few hundred milliseconds apart, so
 * the test can hang up in the middle of a run the way a browser reload does and
 * then prove three separate things: the process was not killed, the lines it
 * produced while nobody was listening were kept, and attaching to it is not
 * refused as BUSY.
 */
describe('/api/agent reconnect', () => {
  const servers: Server[] = [];
  let nextPort = 34_000 + (process.pid % 6_000);

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    reapAgentChildren();
  });

  async function fixture(lines = 6, gapSeconds = '0.25') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-agent-attach-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'index.cascade'), '{"nodes":[]}');
    const script = path.join(root, 'fake-agent.sh');
    fs.writeFileSync(script, [
      '#!/bin/sh',
      'echo \'{"type":"system","subtype":"init","session_id":"fake-session-1"}\'',
      `i=1; while [ $i -le ${lines} ]; do`,
      `  sleep ${gapSeconds}`,
      '  echo "{\\"type\\":\\"assistant\\",\\"message\\":{\\"content\\":[{\\"type\\":\\"text\\",\\"text\\":\\"step $i\\"}]}}"',
      '  i=$((i+1))',
      'done',
      'echo \'{"type":"result","session_id":"fake-session-1","result":"done"}\'',
      '',
    ].join('\n'));
    fs.chmodSync(script, 0o755);
    fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify({ commands: { claude: script }, agent: { claude: { args: [] } } }));

    const project = new ProjectRoot(root);
    const port = nextPort++;
    const server = startServer(project, { port });
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { Origin: base, Host: `127.0.0.1:${address.port}` };
    const { capability } = await (await fetch(`${base}/api/agent/capability`, { headers })).json() as { capability: string };
    const post = (route: string, body: unknown, signal?: AbortSignal) => fetch(`${base}/api/agent/${route}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'X-Cascade-Agent-Capability': capability },
      body: JSON.stringify(body),
      signal,
    });
    const status = async (sketch?: string) => (await fetch(
      `${base}/api/agent/status${sketch ? `?sketch=${encodeURIComponent(sketch)}` : ''}`,
      { headers: { ...headers, 'X-Cascade-Agent-Capability': capability } },
    )).json() as Promise<{ sessions: Array<{ sketch: string; running: boolean; buffered: number }> }>;
    return { base, post, status, project };
  }

  /** Reads NDJSON, handing each event to `onEvent`; stops early when it says so. */
  async function readEvents(response: Response, onEvent: (event: any) => boolean | void): Promise<any[]> {
    const seen: any[] = [];
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let carry = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      const parts = carry.split('\n');
      carry = parts.pop() ?? '';
      for (const part of parts) {
        if (!part.trim()) continue;
        const event = JSON.parse(part);
        seen.push(event);
        if (onEvent(event) === false) {
          await reader.cancel().catch(() => {});
          return seen;
        }
      }
    }
    return seen;
  }

  const text = (events: any[]) => events
    .filter((event) => event.type === 'stdout')
    .map((event) => { try { return JSON.parse(event.text); } catch { return null; } })
    .map((value) => value?.message?.content?.[0]?.text ?? value?.result)
    .filter(Boolean);

  it('survives the reader hanging up, keeps the output, and hands it to the next attach', async () => {
    const { post, status } = await fixture();

    // A browser that starts a prompt and then reloads: read two events, hang up.
    const promptResponse = await post('prompt', { agent: 'claude', sketch: 'index.cascade', prompt: 'make it blue' });
    expect(promptResponse.status).toBe(200);
    const before = await readEvents(promptResponse, (event) => !(event.type === 'stdout' && text([event]).length > 0));
    expect(before.some((event) => event.type === 'started')).toBe(true);

    // The agent is still running, because nothing killed it.
    const live = await status('index.cascade');
    expect(live.sessions.find((entry) => entry.sketch === 'index.cascade')?.running).toBe(true);

    // The reloaded panel attaches. Not refused, and it gets the whole run.
    const attachResponse = await post('attach', { agent: 'claude', sketch: 'index.cascade', since: 0 });
    expect(attachResponse.status).toBe(200);
    const after = await readEvents(attachResponse, () => undefined);

    const attached = after[0];
    expect(attached.type).toBe('attached');
    expect(attached.running).toBe(true);
    expect(attached.dropped).toBe(0);
    expect(attached.sessionId).toBe('fake-session-1');
    // Every step, including the ones produced while no reader was attached.
    expect(text(after)).toEqual(['step 1', 'step 2', 'step 3', 'step 4', 'step 5', 'step 6', 'done']);
    expect(after.at(-1).type).toBe('exit');
  }, 20_000);

  it('refuses a second concurrent prompt with BUSY but never refuses an attach', async () => {
    const { post } = await fixture();

    const first = await post('prompt', { agent: 'claude', sketch: 'index.cascade', prompt: 'one' });
    expect(first.status).toBe(200);
    await readEvents(first, (event) => event.type !== 'started');

    const second = await post('prompt', { agent: 'claude', sketch: 'index.cascade', prompt: 'two' });
    expect(second.status).toBe(409);
    expect((await second.json() as { code: string }).code).toBe('BUSY');

    // Two viewers, one session: both attach streams see the same run.
    const viewers = await Promise.all([
      post('attach', { agent: 'claude', sketch: 'index.cascade', since: 0 }),
      post('attach', { agent: 'claude', sketch: 'index.cascade', since: 0 }),
    ]);
    const [a, b] = await Promise.all(viewers.map((response) => readEvents(response, () => undefined)));
    expect(a[0].running).toBe(true);
    expect(b[0].running).toBe(true);
    expect(text(a)).toEqual(text(b));
    expect(text(a).at(-1)).toBe('done');
  }, 20_000);

  it('says plainly that nothing is running, and starts nothing to find out', async () => {
    const { post, status } = await fixture();

    const response = await post('attach', { agent: 'claude', sketch: 'index.cascade', since: 0 });
    const events = await readEvents(response, () => undefined);
    expect(events).toEqual([
      { type: 'attached', agent: 'claude', sketch: 'index.cascade', running: false, sessionId: null, dropped: 0, replayed: 0, since: 0 },
    ]);
    expect((await status('index.cascade')).sessions).toEqual([]);
  }, 20_000);

  it('replays a finished run, so a reload does not lose the transcript', async () => {
    const { post } = await fixture(2, '0.05');

    const promptResponse = await post('prompt', { agent: 'claude', sketch: 'index.cascade', prompt: 'one' });
    await readEvents(promptResponse, () => undefined);

    const attachResponse = await post('attach', { agent: 'claude', sketch: 'index.cascade', since: 0 });
    const events = await readEvents(attachResponse, () => undefined);
    expect(events[0].running).toBe(false);
    expect(events[0].replayed).toBeGreaterThan(0);
    expect(text(events)).toEqual(['step 1', 'step 2', 'done']);
  }, 20_000);

  it('cancel is what stops an agent now, and a reset is refused while one runs', async () => {
    const { post, status } = await fixture(40, '0.25');

    const promptResponse = await post('prompt', { agent: 'claude', sketch: 'index.cascade', prompt: 'one' });
    await readEvents(promptResponse, (event) => event.type !== 'started');

    const reset = await post('reset', { agent: 'claude', sketch: 'index.cascade' });
    expect(reset.status).toBe(409);

    const cancelled = await post('cancel', { agent: 'claude', sketch: 'index.cascade' });
    expect((await cancelled.json() as { cancelled: boolean }).cancelled).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await status('index.cascade')).sessions[0]?.running).toBe(false);
  }, 20_000);
});
