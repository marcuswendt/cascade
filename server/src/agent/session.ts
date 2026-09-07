/**
 * One coding-agent session per sketch, launched in headless streaming mode.
 *
 * Two decisions that are settled rather than open, and both are why this file
 * is small: **the agent edits files, it does not call a graph API** — the change
 * is then a git-visible diff and the document watcher is what makes Studio
 * notice it — and **Claude runs in its own headless streaming mode** rather than
 * being reimplemented against a completion API. So the whole job here is
 * spawning an allowlisted binary in the project directory, keeping the session
 * id it hands back, and forwarding its lines as they arrive.
 *
 * "One session per sketch" is the `.cascade` file, not the browser tab: two
 * panels open on the same document continue the same conversation, which is the
 * point of it being the sketch's console.
 *
 * Which is also why **a run outlives the request that started it.** The child is
 * detached, so a browser reload never killed it — it only ever orphaned it, and
 * an orphan whose stdout nobody reads is a Claude burning tokens into a pipe
 * that will eventually block. So the run is owned here: the server reads the
 * child continuously into a bounded buffer whether or not anyone is listening,
 * a reloaded panel calls `attach` to get the buffered output and then the live
 * stream, and killing the process is now an explicit `cancel` rather than a
 * side effect of a socket closing.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { ProjectRoot } from './../project.js';
import { AgentEventBuffer } from './eventBuffer.js';
import { AgentRequestError, agentAvailability, agentExtraArgs, requireExecutable, type AgentAvailability } from './allowlist.js';

/** Long: an agent that is writing several node files legitimately takes minutes.
 *  Still bounded, because an unattended runaway costs the same as a working one. */
const DEFAULT_TIMEOUT_MS = 900_000;
const MAX_PROMPT_BYTES = 64 * 1024;

/**
 * The child's environment, with this process's channel bindings removed.
 *
 * Handing over `process.env` wholesale took down Marcus's Telegram bot on
 * 2026-09-07, and the mechanism is worth writing down because it is invisible
 * from either end. A Studio server launched from a bot session inherits that
 * bot's `TELEGRAM_STATE_DIR`. Spawning `claude` with that env starts a *second*
 * process bound to the same channel state and the same bot token — and
 * Telegram's Bot API allows exactly one `getUpdates` long-poll per token, so one
 * of the two consumers is dropped. His diagnosis, and he was right: starting a
 * Claude from the console broke the plugin that started it.
 *
 * A console-launched agent has no business joining a chat, so the binding is
 * stripped rather than negotiated. Everything else is inherited, because PATH,
 * HOME and the credential locations are exactly what the agent needs.
 */
export function childEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('TELEGRAM_') || key === 'CLAUDE_CHANNELS') delete env[key];
  }
  return env;
}

export type AgentEvent =
  /** First line of an attach stream, before any replay. `running` is the whole
   *  answer to "is there a live agent for this sketch"; `dropped` is how much of
   *  the transcript the buffer had already evicted. */
  | { type: 'attached'; agent: string; sketch: string; running: boolean; sessionId: string | null; dropped: number; replayed: number; since: number }
  | { type: 'started'; agent: string; sketch: string; resumed: boolean }
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'session'; sessionId: string }
  | { type: 'exit'; code: number | null; timedOut: boolean; cancelled: boolean }
  | { type: 'error'; message: string; code?: string };

export type AgentEventSink = (event: AgentEvent) => void;

export interface AgentPromptRequest {
  readonly agent: string;
  readonly sketch: string;
  readonly prompt: string;
  readonly sink: AgentEventSink;
  readonly signal?: AbortSignal;
  readonly timeout?: number;
}

/**
 * Claude's own headless streaming flags. `--output-format stream-json` needs
 * `--verbose` in print mode or Claude refuses, and `--resume` is what makes the
 * session per-sketch rather than per-prompt.
 */
export function claudeArgs(prompt: string, sessionId: string | null): string[] {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
  if (sessionId) args.push('--resume', sessionId);
  return args;
}

/** Codex's non-interactive form. It has no resume flag of this shape, so a
 *  Codex console is one-shot per prompt and says so in the panel. */
export function codexArgs(prompt: string): string[] {
  return ['exec', '--json', prompt];
}

export function argsFor(agent: string, prompt: string, sessionId: string | null, extra: readonly string[] = []): string[] {
  const base = agent === 'codex' ? codexArgs(prompt) : claudeArgs(prompt, sessionId);
  // Project-declared flags go last so they can override a default, and after
  // the prompt because both CLIs take the prompt positionally or via -p.
  return [...base, ...extra];
}

/**
 * The session id inside one stream-json line, if it carries one.
 *
 * Claude reports it on the `init` system event and repeats it on the result
 * event; either will do, and anything unparseable is just output.
 */
export function sessionIdFrom(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const value = JSON.parse(trimmed);
    const id = value?.session_id ?? value?.sessionId;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * One launched agent process, alive independently of any HTTP request.
 *
 * Readers come and go; the run does not. Every event is appended to the bounded
 * buffer *and* fanned out to whoever is currently listening, so two panels on
 * the same sketch both see the stream rather than one stealing it, and a panel
 * that arrives late replays what it missed.
 */
class LiveRun {
  readonly buffer = new AgentEventBuffer<AgentEvent>();
  readonly listeners = new Set<AgentEventSink>();
  readonly startedAt = Date.now();
  child: ChildProcess | null = null;
  running = true;
  endedAt: number | null = null;

  constructor(readonly agent: string, readonly sketch: string) {}

  emit(event: AgentEvent): void {
    this.buffer.push(event);
    for (const listener of [...this.listeners]) {
      // One broken reader must not take down the run or the other readers.
      try { listener(event); } catch { this.listeners.delete(listener); }
    }
  }

  /** SIGTERM the whole process group — the agent spawns children of its own,
   *  and killing only the parent leaves those behind. */
  stop(): void {
    const child = this.child;
    if (!child?.pid) return;
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

/**
 * Server shutdown reaps its children rather than leaving them.
 *
 * The decision, stated because the alternative is defensible: a detached agent
 * that survives the Studio server is unreachable — nothing can attach to it,
 * nothing can show its output, nothing can stop it — so surviving buys nothing
 * and costs an invisible process rewriting the project. It is killed.
 *
 * The handlers are installed lazily, on the first spawn, and only for signals
 * nothing else in the process has claimed; a Studio server that never launches
 * an agent installs nothing. `exit` does the reaping synchronously, which is
 * all `process.kill` needs.
 */
const liveRuns = new Set<LiveRun>();
let reaperInstalled = false;

function reapAll(): void {
  for (const run of [...liveRuns]) run.stop();
}

function ensureReaper(): void {
  if (reaperInstalled) return;
  reaperInstalled = true;
  process.on('exit', reapAll);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    if (process.listenerCount(signal) > 0) continue;
    process.on(signal, () => {
      reapAll();
      // Restore the default disposition rather than guessing an exit code for
      // somebody else's process.
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    });
  }
}

/** Test seam: the suite starts and stops many servers in one process. */
export function reapAgentChildren(): void {
  reapAll();
}

interface SessionState {
  sessionId: string | null;
  /** The current run, or the most recent finished one. A finished run is kept
   *  so that a panel reopened after the agent stopped still sees the
   *  transcript — the console has no other persistence. */
  run: LiveRun | null;
}

export interface AgentAttachRequest {
  readonly agent: string;
  readonly sketch: string;
  readonly sink: AgentEventSink;
  readonly signal?: AbortSignal;
  /** The sequence number to resume from. 0 replays everything still buffered. */
  readonly since?: number;
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

export class AgentSessions {
  private readonly states = new Map<string, SessionState>();

  constructor(private readonly project: ProjectRoot) {}

  availability(agent: string): AgentAvailability {
    return agentAvailability(this.project.root, agent);
  }

  /** What the panel shows before anything is typed: which agents this sketch
   *  may launch, for the ones it may not exactly what to add, and — the reason
   *  a reloaded panel does not strand anything — whether a run is still live. */
  status(agents: readonly string[] = ['claude', 'codex'], sketch?: string): {
    root: string;
    agents: AgentAvailability[];
    sessions: AgentSessionSummary[];
  } {
    const sessions: AgentSessionSummary[] = [];
    for (const [id, state] of this.states) {
      const run = state.run;
      if (!run) continue;
      if (sketch && run.sketch !== sketch) continue;
      void id;
      sessions.push({
        agent: run.agent,
        sketch: run.sketch,
        running: run.running,
        sessionId: state.sessionId,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        buffered: run.buffer.size,
        dropped: run.buffer.droppedTotal,
        nextSeq: run.buffer.nextSeq,
      });
    }
    return { root: this.project.root, agents: agents.map((agent) => this.availability(agent)), sessions };
  }

  sessionId(agent: string, sketch: string): string | null {
    return this.states.get(key(agent, sketch))?.sessionId ?? null;
  }

  isRunning(agent: string, sketch: string): boolean {
    return this.states.get(key(agent, sketch))?.run?.running === true;
  }

  /** Drop the conversation for one sketch without touching anything on disk.
   *  Refuses while a run is live, because forgetting the session id mid-run
   *  would silently start the next prompt as a fresh conversation. */
  reset(agent: string, sketch: string): void {
    const state = this.states.get(key(agent, sketch));
    if (!state) return;
    if (state.run?.running) throw new AgentRequestError('BUSY', `The ${agent} session for ${sketch} is still working`);
    state.sessionId = null;
    state.run = null;
  }

  /** Stop a live run. This is the only thing that kills an agent now: a reader
   *  going away no longer does, which is the whole point of the change. */
  cancel(agent: string, sketch: string): boolean {
    const run = this.states.get(key(agent, sketch))?.run;
    if (!run?.running) return false;
    run.stop();
    return true;
  }

  /**
   * Join whatever is happening for this sketch — running, finished, or nothing.
   *
   * Never refuses with BUSY. BUSY exists to stop two prompts colliding on one
   * conversation; a second *reader* is the opposite of a collision, so attach is
   * always allowed and any number of panels may hold one open.
   *
   * Resolves when the run ends or when the caller detaches, whichever comes
   * first. Detaching does not touch the child.
   */
  attach(request: AgentAttachRequest): Promise<void> {
    const { agent, sketch, sink } = request;
    const state = this.states.get(key(agent, sketch));
    const run = state?.run ?? null;
    const since = Math.max(0, Math.floor(request.since ?? 0));

    if (!run) {
      sink({ type: 'attached', agent, sketch, running: false, sessionId: state?.sessionId ?? null, dropped: 0, replayed: 0, since });
      return Promise.resolve();
    }

    // Replay and subscribe with nothing awaited in between, so an event emitted
    // during the attach cannot fall into the gap between the two.
    const replay = run.buffer.replay(since);
    sink({
      type: 'attached',
      agent,
      sketch,
      running: run.running,
      sessionId: state?.sessionId ?? null,
      dropped: replay.dropped,
      replayed: replay.events.length,
      since,
    });
    for (const event of replay.events) sink(event);
    if (!run.running) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const detach = () => {
        run.listeners.delete(listener);
        request.signal?.removeEventListener('abort', detach);
        resolve();
      };
      const listener: AgentEventSink = (event) => {
        sink(event);
        if (event.type === 'exit' || event.type === 'error') detach();
      };
      run.listeners.add(listener);
      request.signal?.addEventListener('abort', detach, { once: true });
      if (request.signal?.aborted) detach();
    });
  }

  async prompt(request: AgentPromptRequest): Promise<void> {
    const prompt = request.prompt;
    if (typeof prompt !== 'string' || !prompt.trim()) throw new AgentRequestError('INVALID_REQUEST', 'prompt must be a non-empty string');
    if (Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) throw new AgentRequestError('INVALID_REQUEST', 'prompt exceeds 64 KiB');
    if (typeof request.sketch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,127}\.cascade$/.test(request.sketch)) {
      throw new AgentRequestError('INVALID_REQUEST', 'sketch must be a .cascade filename in this project');
    }

    const executable = requireExecutable(this.project.root, request.agent);
    const id = key(request.agent, request.sketch);
    const state = this.states.get(id) ?? { sessionId: null, run: null };
    this.states.set(id, state);
    if (state.run?.running) throw new AgentRequestError('BUSY', `The ${request.agent} session for ${request.sketch} is still working`);

    const run = new LiveRun(request.agent, request.sketch);
    state.run = run;
    liveRuns.add(run);
    ensureReaper();

    // The prompt's own caller is just the first reader. It gets the stream from
    // the top, and if it goes away the run carries on without it.
    const reading = this.attach({
      agent: request.agent,
      sketch: request.sketch,
      sink: request.sink,
      signal: request.signal,
      since: 0,
    });

    this.launch(executable, request, state, run);
    await reading;
  }

  private launch(executable: string, request: AgentPromptRequest, state: SessionState, run: LiveRun): void {
    const resumed = Boolean(state.sessionId);
    const args = argsFor(request.agent, request.prompt, state.sessionId, agentExtraArgs(this.project.root, request.agent));

    run.emit({ type: 'started', agent: request.agent, sketch: request.sketch, resumed });
    const child = spawn(executable, args, {
      cwd: this.project.root,
      env: childEnvironment(),
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    run.child = child;

    let timedOut = false;
    let settled = false;
    let carry = '';

    const timer = setTimeout(() => { timedOut = true; run.stop(); }, request.timeout ?? DEFAULT_TIMEOUT_MS);

    const finish = (event: AgentEvent) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run.running = false;
      run.endedAt = Date.now();
      liveRuns.delete(run);
      run.emit(event);
      run.listeners.clear();
    };

    const takeLine = (line: string) => {
      if (!line.trim()) return;
      const found = sessionIdFrom(line);
      if (found && found !== state.sessionId) {
        state.sessionId = found;
        run.emit({ type: 'session', sessionId: found });
      }
      run.emit({ type: 'stdout', text: line });
    };

    // Read continuously, attached or not. An unread pipe is what strands an
    // agent: the kernel buffer fills and the child blocks on its own stdout.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      carry += chunk;
      const lines = carry.split('\n');
      carry = lines.pop() ?? '';
      for (const line of lines) takeLine(line);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => run.emit({ type: 'stderr', text: String(chunk) }));

    child.once('error', (error) => {
      finish({ type: 'error', message: `Unable to spawn ${request.agent}: ${error.message}`, code: 'SPAWN_FAILED' });
    });

    child.once('close', (code) => {
      if (carry.trim()) takeLine(carry);
      carry = '';
      finish({ type: 'exit', code, timedOut, cancelled: !timedOut && code !== 0 && wasSignalled(child) });
    });

    // Claude in print mode reads its prompt from argv; closing stdin stops it
    // waiting on a terminal that is not there.
    child.stdin.end();
  }
}

/** A run stopped by `cancel` or by shutdown exits on a signal rather than with
 *  a code, and the panel says "Stopped." rather than reporting a failure. */
function wasSignalled(child: ChildProcess): boolean {
  return child.signalCode !== null;
}

function key(agent: string, sketch: string): string {
  return `${agent} ${sketch}`;
}
