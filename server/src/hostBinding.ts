/**
 * Bind Studio to its preferred host, and survive that host being missing.
 *
 * On 12 Oct two Studios crashed on start: one with `getaddrinfo ENOTFOUND
 * KURO` (a Tailscale MagicDNS name while Tailscale was stopped), the other with
 * `EADDRNOTAVAIL 100.127.126.86:3030` (the tailnet address, not yet on any
 * interface). Neither is a reason for a local tool to stop working. So:
 *
 * 1. Try the preferred host. If the name does not resolve or the address is
 *    not on this machine, log why and try each fallback in turn (by default
 *    `127.0.0.1`).
 * 2. While on a fallback, probe the preferred host every `retryMs`. When it can
 *    be bound again, move the listener back to it and log the move.
 *
 * Any other listen error (a port already in use, a permission error) is not a
 * host problem and is reported as before: falling back would hide it.
 */
import net from 'node:net';
import type { Server } from 'node:http';

/** Errors that mean "this host is not available here right now". */
const HOST_UNAVAILABLE = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'EAI_FAIL', 'EADDRNOTAVAIL']);

export const DEFAULT_FALLBACK_HOSTS: readonly string[] = Object.freeze(['127.0.0.1']);
export const DEFAULT_HOST_RETRY_MS = 10_000;

export function isHostUnavailable(error: unknown): boolean {
  return HOST_UNAVAILABLE.has((error as NodeJS.ErrnoException | undefined)?.code ?? '');
}

export interface BindingState {
  /** The address the server is listening on now, or null before it binds. */
  readonly host: string | null;
  readonly port: number;
  /** The host Studio was asked to bind. */
  readonly preferredHost: string;
  /** True while bound to a fallback because the preferred host was unavailable. */
  readonly fallback: boolean;
  /** Why the preferred host was skipped, e.g. `getaddrinfo ENOTFOUND KURO`. */
  readonly reason: string | null;
  /** ISO time the current binding was made. */
  readonly since: string | null;
}

export interface BindingOptions {
  readonly port: number;
  readonly preferredHost: string;
  readonly fallbackHosts?: readonly string[];
  readonly retryMs?: number;
  readonly log?: (message: string) => void;
  readonly onChange?: (state: BindingState) => void;
  /**
   * Map a host to the address handed to listen(). Default: identity, letting
   * listen() do its own DNS lookup. Tests use it to make a name disappear and
   * come back, which a real resolver cannot be told to do.
   */
  readonly resolveHost?: (host: string) => string;
}

export interface BindingController {
  /** Resolves once bound to some host; rejects with the listen error otherwise. */
  readonly ready: Promise<BindingState>;
  state(): BindingState;
  /** Stop probing for the preferred host. Does not close the server. */
  stop(): void;
}

export function bindWithFallback(server: Server, options: BindingOptions): BindingController {
  const { port, preferredHost } = options;
  const retryMs = options.retryMs ?? DEFAULT_HOST_RETRY_MS;
  const log = options.log ?? ((message: string) => console.warn(message));
  const resolveHost = options.resolveHost ?? ((host: string) => host);
  const fallbacks = (options.fallbackHosts ?? DEFAULT_FALLBACK_HOSTS)
    .filter((host) => host && host !== preferredHost);

  let state: BindingState = { host: null, port, preferredHost, fallback: false, reason: null, since: null };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const update = (next: Partial<BindingState>) => {
    state = { ...state, ...next };
    options.onChange?.(state);
  };

  const bound = (host: string, reason: string | null) => {
    update({ host, fallback: host !== preferredHost, reason, since: new Date().toISOString() });
    if (state.fallback) schedule();
  };

  async function bindFirstAvailable(): Promise<BindingState> {
    let reason: string | null = null;
    for (const host of [preferredHost, ...fallbacks]) {
      try {
        await listen(server, port, resolveHost(host));
        if (host !== preferredHost) log(`[cascade] bound ${host}:${port} instead (fallback); will retry ${preferredHost} every ${Math.round(retryMs / 1000)}s`);
        bound(host, reason);
        return state;
      } catch (error) {
        if (!isHostUnavailable(error)) throw error;
        const message = describe(error, host, port);
        reason ??= message;
        log(`[cascade] host ${host} is unavailable (${message})`);
      }
    }
    throw new Error(`no bindable host: tried ${[preferredHost, ...fallbacks].join(', ')} (${reason})`);
  }

  function schedule(): void {
    if (stopped || timer) return;
    timer = setTimeout(() => { timer = null; void retryPreferred(); }, retryMs);
    timer.unref?.();
  }

  async function retryPreferred(): Promise<void> {
    if (stopped || !state.fallback) return;
    // Closed by its owner: nothing left to rebind.
    if (state.host !== null && !server.listening) { stopped = true; return; }
    try {
      await probe(resolveHost(preferredHost), port);
    } catch {
      schedule();
      return;
    }
    const previous = state.host ?? fallbacks[0] ?? preferredHost;
    // Stop accepting on the fallback, then bind the preferred host. Open
    // connections finish on their own; idle keep-alives are dropped so the old
    // address really goes away.
    if (server.listening) server.close();
    server.closeIdleConnections?.();
    try {
      await listen(server, port, resolveHost(preferredHost));
      log(`[cascade] ${preferredHost} is back — moved from ${previous}:${port} to ${preferredHost}:${port}`);
      bound(preferredHost, null);
    } catch (error) {
      log(`[cascade] rebinding ${preferredHost} failed (${describe(error, preferredHost, port)}); staying on ${previous}`);
      try {
        await listen(server, port, resolveHost(previous));
        bound(previous, state.reason);
      } catch (fallbackError) {
        log(`[cascade] could not rebind ${previous}:${port} either (${describe(fallbackError, previous, port)}); Studio is not listening — retrying`);
        update({ host: null, since: null });
        schedule();
      }
    }
  }

  const ready = bindFirstAvailable();
  // The caller handles rejection; this only keeps an unobserved promise quiet.
  ready.catch(() => {});

  return {
    ready,
    state: () => state,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/** Bind and release a throwaway socket, to learn whether `host:port` is usable. */
function probe(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(port, host, () => socket.close(() => resolve()));
  });
}

function describe(error: unknown, host: string, port: number): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EADDRNOTAVAIL') return `EADDRNOTAVAIL ${host}:${port}`;
  if (code && code.startsWith('E')) return `getaddrinfo ${code} ${host}`;
  return error instanceof Error ? error.message : String(error);
}
