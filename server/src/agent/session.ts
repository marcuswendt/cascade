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
 */
import { spawn } from 'node:child_process';
import type { ProjectRoot } from './../project.js';
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

interface SessionState {
  sessionId: string | null;
  busy: boolean;
}

export class AgentSessions {
  private readonly states = new Map<string, SessionState>();

  constructor(private readonly project: ProjectRoot) {}

  availability(agent: string): AgentAvailability {
    return agentAvailability(this.project.root, agent);
  }

  /** What the panel shows before anything is typed: which agents this sketch
   *  may launch, and for the ones it may not, exactly what to add. */
  status(agents: readonly string[] = ['claude', 'codex']): {
    root: string;
    agents: AgentAvailability[];
  } {
    return { root: this.project.root, agents: agents.map((agent) => this.availability(agent)) };
  }

  sessionId(agent: string, sketch: string): string | null {
    return this.states.get(key(agent, sketch))?.sessionId ?? null;
  }

  /** Drop the conversation for one sketch without touching anything on disk. */
  reset(agent: string, sketch: string): void {
    const state = this.states.get(key(agent, sketch));
    if (state) state.sessionId = null;
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
    const state = this.states.get(id) ?? { sessionId: null, busy: false };
    this.states.set(id, state);
    if (state.busy) throw new AgentRequestError('BUSY', `The ${request.agent} session for ${request.sketch} is still working`);

    state.busy = true;
    try {
      await this.run(executable, request, state);
    } finally {
      state.busy = false;
    }
  }

  private run(executable: string, request: AgentPromptRequest, state: SessionState): Promise<void> {
    const { sink } = request;
    const resumed = Boolean(state.sessionId);
    const args = argsFor(request.agent, request.prompt, state.sessionId, agentExtraArgs(this.project.root, request.agent));

    return new Promise((resolve) => {
      sink({ type: 'started', agent: request.agent, sketch: request.sketch, resumed });
      const child = spawn(executable, args, {
        cwd: this.project.root,
        env: childEnvironment(),
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let timedOut = false;
      let cancelled = false;
      let settled = false;
      let carry = '';

      const stop = () => {
        if (!child.pid) return;
        try {
          if (process.platform === 'win32') child.kill('SIGTERM');
          else process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
      };

      const timer = setTimeout(() => { timedOut = true; stop(); }, request.timeout ?? DEFAULT_TIMEOUT_MS);
      const abort = () => { cancelled = true; stop(); };
      request.signal?.addEventListener('abort', abort, { once: true });

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        carry += chunk;
        const lines = carry.split('\n');
        carry = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const found = sessionIdFrom(line);
          if (found && found !== state.sessionId) {
            state.sessionId = found;
            sink({ type: 'session', sessionId: found });
          }
          sink({ type: 'stdout', text: line });
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => sink({ type: 'stderr', text: String(chunk) }));

      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', abort);
        sink({ type: 'error', message: `Unable to spawn ${request.agent}: ${error.message}`, code: 'SPAWN_FAILED' });
        resolve();
      });

      child.once('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', abort);
        if (carry.trim()) {
          const found = sessionIdFrom(carry);
          if (found && found !== state.sessionId) {
            state.sessionId = found;
            sink({ type: 'session', sessionId: found });
          }
          sink({ type: 'stdout', text: carry });
        }
        sink({ type: 'exit', code, timedOut, cancelled });
        resolve();
      });

      // Claude in print mode reads its prompt from argv; closing stdin stops it
      // waiting on a terminal that is not there.
      child.stdin.end();
      if (request.signal?.aborted) abort();
    });
  }
}

function key(agent: string, sketch: string): string {
  return `${agent} ${sketch}`;
}
