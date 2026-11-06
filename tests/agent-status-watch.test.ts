/**
 * `/api/agent/watch`: the pushed agent status that replaced the panel's
 * once-a-second `/api/agent/status` poll.
 *
 * One held stream: the sessions now, then a line each time a run starts or
 * ends. The test runs a real fake agent through the real server and reads the
 * stream the way the panel does.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { ProjectRoot } from '../server/src/project.js';
import { startServer } from '../server/src/index.js';
import { reapAgentChildren } from '../server/src/agent/session.js';

const roots: string[] = [];
const servers: Server[] = [];
let nextPort = 44_000 + (process.pid % 2_000);

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  reapAgentChildren();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-agent-watch-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'index.cascade'), '{"nodes":[]}');
  const script = path.join(root, 'fake-agent.sh');
  fs.writeFileSync(script, [
    '#!/bin/sh',
    'sleep 0.3',
    'echo \'{"type":"result","session_id":"fake-session-1","result":"done"}\'',
    '',
  ].join('\n'));
  fs.chmodSync(script, 0o755);
  fs.writeFileSync(path.join(root, 'cascade.json'), JSON.stringify({ commands: { claude: script }, agent: { claude: { args: [] } } }));

  const server = startServer(new ProjectRoot(root), { port: nextPort++ });
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Origin: base, Host: `127.0.0.1:${address.port}` };
  const { capability } = await (await fetch(`${base}/api/agent/capability`, { headers })).json() as { capability: string };
  return { base, headers: { ...headers, 'X-Cascade-Agent-Capability': capability }, plainHeaders: headers };
}

type StatusLine = { type: string; sessions: Array<{ agent: string; sketch: string; running: boolean }> };

/** Yields each status line as it arrives. */
async function* statusLines(response: Response): AsyncGenerator<StatusLine> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let carry = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      carry += decoder.decode(value, { stream: true });
      const parts = carry.split('\n');
      carry = parts.pop() ?? '';
      for (const part of parts) if (part.trim()) yield JSON.parse(part);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

describe('/api/agent/watch', () => {
  it('needs the capability', async () => {
    const { base, plainHeaders } = await fixture();
    expect((await fetch(`${base}/api/agent/watch`, { headers: plainHeaders })).status).toBe(403);
  });

  it('sends the sessions now, then a line when a run starts and when it ends', async () => {
    const { base, headers } = await fixture();
    const watch = await fetch(`${base}/api/agent/watch`, { headers });
    expect(watch.status).toBe(200);
    const lines = statusLines(watch);

    const first = (await lines.next()).value as StatusLine;
    expect(first).toEqual({ type: 'status', sessions: [] });

    const prompt = await fetch(`${base}/api/agent/prompt`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'claude', sketch: 'index.cascade', prompt: 'make it blue' }),
    });
    expect(prompt.status).toBe(200);

    const started = (await lines.next()).value as StatusLine;
    expect(started.sessions).toMatchObject([{ agent: 'claude', sketch: 'index.cascade', running: true }]);
    const ended = (await lines.next()).value as StatusLine;
    expect(ended.sessions).toMatchObject([{ agent: 'claude', sketch: 'index.cascade', running: false }]);

    await prompt.text();
    await lines.return(undefined);
  }, 15_000);
});
