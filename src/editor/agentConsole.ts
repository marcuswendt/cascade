/**
 * Client half of the per-sketch agent console.
 *
 * The capability handshake is the shell route's: ask /capability once from the
 * same origin, then send the token on every call. Streaming is a POST reading
 * NDJSON off the response body rather than an EventSource, because EventSource
 * cannot set that header and the endpoint must not be reachable without it.
 *
 * Two calls stream: `sendAgentPrompt` starts a run, `attachAgentSession` joins
 * one already going. They read the identical event shape, which is what lets a
 * reloaded panel resume a transcript without a second code path.
 */

export type AgentEvent =
  | { type: 'attached'; agent: string; sketch: string; running: boolean; sessionId: string | null; dropped: number; replayed: number; since: number }
  | { type: 'started'; agent: string; sketch: string; resumed: boolean }
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'session'; sessionId: string }
  | { type: 'exit'; code: number | null; timedOut: boolean; cancelled: boolean }
  | { type: 'error'; message: string; code?: string };

export interface AgentAvailability {
  alias: string;
  configured: boolean;
  resolved: boolean;
  hint: string | null;
}

export interface AgentSessionSummary {
  agent: string;
  sketch: string;
  running: boolean;
  sessionId: string | null;
  startedAt: number;
  endedAt: number | null;
  buffered: number;
  dropped: number;
  nextSeq: number;
}

export interface AgentStatus {
  root: string;
  agents: AgentAvailability[];
  sessions: AgentSessionSummary[];
}

export class AgentUnavailableError extends Error {
  constructor(message: string, readonly hint: string | null = null, readonly code: string | null = null) {
    super(message);
    this.name = 'AgentUnavailableError';
  }
}

let capability: string | null = null;

async function token(): Promise<string> {
  if (capability) return capability;
  const response = await fetch('/api/agent/capability');
  if (response.status === 404) {
    throw new AgentUnavailableError(
      'The agent console is disabled on this server. It is available only on a loopback server or one started with an explicit trusted host.',
    );
  }
  if (!response.ok) throw new AgentUnavailableError(`Could not start an agent session (${response.status})`);
  const { capability: issued } = await response.json();
  if (typeof issued !== 'string' || !issued) throw new AgentUnavailableError('Server issued no agent capability');
  capability = issued;
  return issued;
}

/** A server restart issues a new capability, so one retry on a 403 is the
 *  difference between healing and a console that is dead until reload. */
async function call(path: string, init: RequestInit): Promise<Response> {
  const headers = (value: string) => ({ ...(init.headers ?? {}), 'X-Cascade-Agent-Capability': value });
  let response = await fetch(path, { ...init, headers: headers(await token()) });
  if (response.status === 403) {
    capability = null;
    response = await fetch(path, { ...init, headers: headers(await token()) });
  }
  return response;
}

export async function agentStatus(sketch?: string): Promise<AgentStatus> {
  const query = sketch ? `?sketch=${encodeURIComponent(sketch)}` : '';
  const response = await call(`/api/agent/status${query}`, { method: 'GET' });
  if (!response.ok) throw new AgentUnavailableError(`Could not read agent status (${response.status})`);
  const body = await response.json();
  return {
    root: String(body?.root ?? ''),
    agents: Array.isArray(body?.agents) ? body.agents : [],
    sessions: Array.isArray(body?.sessions) ? body.sessions : [],
  };
}

/** Stop a run. Since a closing socket no longer kills the agent, this is the
 *  only thing that does. */
export async function cancelAgentSession(agent: string, sketch: string): Promise<boolean> {
  const response = await call('/api/agent/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent, sketch }),
  });
  if (!response.ok) return false;
  const body = await response.json().catch(() => null);
  return body?.cancelled === true;
}

export async function resetAgentSession(agent: string, sketch: string): Promise<void> {
  await call('/api/agent/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent, sketch }),
  });
}

export interface AttachOptions {
  agent: string;
  sketch: string;
  onEvent: (event: AgentEvent) => void;
  signal?: AbortSignal;
  /** Resume point. 0 — the default — replays everything the server still holds. */
  since?: number;
}

/**
 * Reconnect to whatever is running for this sketch.
 *
 * Always resolves, never throws for "nothing is running": the stream's first
 * event is `attached` and its `running` flag is the answer. Resolves when the
 * run ends or the caller aborts.
 */
export async function attachAgentSession(options: AttachOptions): Promise<void> {
  const response = await call('/api/agent/attach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent: options.agent, sketch: options.sketch, since: options.since ?? 0 }),
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new AgentUnavailableError(String(body?.error ?? `Could not reconnect to the agent (${response.status})`));
  }
  await readNdjson(response, options.onEvent);
}

export interface SendPromptOptions {
  agent: string;
  sketch: string;
  prompt: string;
  onEvent: (event: AgentEvent) => void;
  signal?: AbortSignal;
}

/** Resolves when the agent's process has exited and every line has been
 *  delivered. Throws only for failures that happen before the stream starts —
 *  a missing allowlist entry, a busy session — because after the first byte the
 *  server can only report through the stream itself. */
export async function sendAgentPrompt(options: SendPromptOptions): Promise<void> {
  const response = await call('/api/agent/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent: options.agent, sketch: options.sketch, prompt: options.prompt }),
    signal: options.signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new AgentUnavailableError(
      String(body?.error ?? `Agent request failed (${response.status})`),
      body?.hint ?? null,
      body?.code ?? null,
    );
  }
  await readNdjson(response, options.onEvent);
}

async function readNdjson(response: Response, onEvent: (event: AgentEvent) => void): Promise<void> {
  if (!response.body) throw new AgentUnavailableError('Agent produced no stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let carry = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    const lines = carry.split('\n');
    carry = lines.pop() ?? '';
    for (const line of lines) emit(line, onEvent);
  }
  emit(carry, onEvent);
}

function emit(line: string, onEvent: (event: AgentEvent) => void): void {
  if (!line.trim()) return;
  try {
    onEvent(JSON.parse(line) as AgentEvent);
  } catch {
    onEvent({ type: 'stderr', text: line });
  }
}

/**
 * What one stream-json line should read as in the transcript.
 *
 * Claude's headless stream is machine-shaped — assistant messages carry content
 * blocks, tool calls carry inputs — and printing the raw JSON makes a console
 * nobody reads. Anything unrecognised falls through as its own text rather than
 * being dropped, because a silently swallowed line is how you end up trusting
 * an empty transcript.
 */
export function describeStreamLine(line: string): { kind: 'text' | 'tool' | 'result' | 'raw' | 'detail'; text: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('{')) return { kind: 'raw', text: trimmed };
  let value: any;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { kind: 'raw', text: trimmed };
  }

  if (value?.type === 'system') return null;

  if (value?.type === 'assistant' && Array.isArray(value?.message?.content)) {
    const parts: string[] = [];
    for (const block of value.message.content) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) parts.push(block.text.trim());
      else if (block?.type === 'tool_use') parts.push(`· ${block.name ?? 'tool'}${toolTarget(block.input)}`);
    }
    const text = parts.join('\n');
    return text ? { kind: parts.every((part) => part.startsWith('· ')) ? 'tool' : 'text', text } : null;
  }

  if (value?.type === 'user') return null;

  if (value?.type === 'result') {
    const text = typeof value.result === 'string' && value.result.trim() ? value.result.trim() : null;
    return text ? { kind: 'result', text } : null;
  }

  // Parsed JSON carrying a type we do not render — rate_limit_event and
  // whatever the stream format grows next. Not swallowed, because a line the
  // console silently drops is one nobody can debug; classified as detail so the
  // panel can keep it behind a toggle. Anything that did *not* parse stays
  // `raw` and visible, since that is where a real error message would arrive.
  if (typeof value?.type === 'string') return { kind: 'detail', text: trimmed };

  return { kind: 'raw', text: trimmed };
}

/** The file a tool call is about, when it names one — the useful half of a
 *  tool line while the agent is editing the project. */
function toolTarget(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;
  const target = record.file_path ?? record.path ?? record.pattern ?? record.command;
  return typeof target === 'string' && target ? ` ${target}` : '';
}
