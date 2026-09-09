import type { CascadeAbortSignal, ShellCapability, ShellRunOptions, ShellRunResult } from '@cascade/contracts';

/**
 * `cascade/shell`, for a node running in Studio.
 *
 * The gap this closes, reported by Marcus on 2026-09-09 as
 * *"project.series-source requires the Studio shell capability"*: the server
 * has had an allowlist-gated `/api/shell` for a while, and Studio never wired
 * it as a node capability. So a definition declaring `capabilities: ['shell']`
 * ran headlessly through `cascade run` and threw in Studio — which makes a node
 * marked `runsOn: 'portable'` not portable, and the failure is at cook time
 * rather than at authoring time.
 *
 * **Absent rather than stubbed when the route is not there**, the same rule the
 * gpu capability follows. The route 404s on a non-loopback server without an
 * explicit trusted host, and on that server a shell node genuinely cannot run;
 * saying so through the adapter's own "requires the Studio shell capability"
 * sentence is better than a stub that throws on first use and names nothing.
 * Which is why this is installed by a probe rather than unconditionally.
 *
 * The command allowlist is the server's and stays the server's. A 403 here is
 * `COMMAND_NOT_ALLOWED`, and the fix is the Allowed Commands editor in Project
 * Settings — so the error carries that sentence rather than a status code.
 */

let capability: string | null = null;

/**
 * Drop the issued capability.
 *
 * Called when the probe finds the route gone, which is the case that made this
 * worth having: a token issued before a server restart is not just stale, it is
 * a claim about a route that may no longer exist, and holding it means the next
 * `run` fails at the POST instead of at the gate.
 */
export function forgetShellCapability(): void {
  capability = null;
}

async function token(): Promise<string> {
  if (capability) return capability;
  const response = await fetch('/api/shell/capability', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? 'The shell capability is disabled on this server. It is available on a loopback server, or one started with an explicit trusted host.'
        : `Could not obtain the shell capability (${response.status})`,
    );
  }
  const { capability: issued } = await response.json();
  if (typeof issued !== 'string' || !issued) {
    throw new Error('Server issued no shell capability');
  }
  capability = issued;
  return issued;
}

/**
 * A `CascadeAbortSignal` is not a DOM `AbortSignal` — it carries `aborted` and
 * the two listener methods and nothing else, deliberately, so the contract does
 * not depend on a browser global. `fetch` needs the real thing, so bridge one
 * rather than widening the contract or dropping cancellation on the floor.
 */
function domSignal(signal: CascadeAbortSignal | undefined): AbortSignal | undefined {
  if (!signal) return undefined;
  const controller = new AbortController();
  if (signal.aborted) controller.abort(signal.reason);
  else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  return controller.signal;
}

async function post(body: unknown, signal?: CascadeAbortSignal): Promise<Response> {
  const bridged = domSignal(signal);
  const send = async (issued: string) => fetch('/api/shell', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Cascade-Shell-Capability': issued,
    },
    body: JSON.stringify(body),
    ...(bridged ? { signal: bridged } : {}),
  });

  let response = await send(await token());
  // A server restart issues a new capability, so one retry is the difference
  // between healing and a node that stays broken until the page is reloaded —
  // the agent console learned this the same way. Exactly one: a 403 that
  // survives a fresh capability is the allowlist refusing the command, and
  // retrying that forever would turn a clear error into a hang.
  if (response.status === 403) {
    capability = null;
    response = await send(await token());
  }
  return response;
}

function requestBody(
  command: string,
  args: readonly string[] | undefined,
  options: ShellRunOptions | undefined,
) {
  // `signal` is an AbortSignal and does not survive JSON; it is honoured on
  // this side of the fetch instead, and the route aborts the child when the
  // request closes.
  const { signal: _signal, ...rest } = options ?? {};
  return {
    command,
    ...(args ? { args } : {}),
    ...(Object.keys(rest).length > 0 ? { options: rest } : {}),
  };
}

async function fail(response: Response): Promise<never> {
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    // A non-JSON body from a proxy or a crash. The status is all there is.
  }
  const message = typeof payload?.error === 'string' ? payload.error : `Shell request failed (${response.status})`;
  if (payload?.code === 'COMMAND_NOT_ALLOWED') {
    throw new Error(`${message}. Add it under Allowed Commands in Project Settings.`);
  }
  throw new Error(message);
}

export const browserShellCapability: ShellCapability = {
  async run(command, args, options): Promise<ShellRunResult> {
    const response = await post(requestBody(command, args, options), options?.signal);
    if (!response.ok) await fail(response);
    const { ok: _ok, ...result } = await response.json();
    return result as ShellRunResult;
  },

  async runJson<T = unknown>(
    command: string,
    args?: readonly string[],
    options?: ShellRunOptions,
  ): Promise<T> {
    const result = await this.run(command, args, options);
    try {
      return JSON.parse(result.stdout) as T;
    } catch {
      // The command succeeded and its output is not JSON, which is a different
      // fault from the command failing and worth saying so — a node asking for
      // JSON and getting a log line should not read as a shell error.
      throw new Error(`${command} did not print JSON`);
    }
  },
};

/**
 * Whether this page can reach the shell route at all.
 *
 * The route 404s on a server that is neither loopback nor started with an
 * explicit trusted host, and on such a server a shell node genuinely cannot
 * run. The answer is used to withdraw the capability from Studio's map, so
 * that the preflight reports `runtime/missing-capability` and the adapter
 * throws its own "requires the Studio shell capability" sentence — the same
 * shape gpu already has.
 *
 * A successful probe keeps the issued capability, so the first `run` does not
 * pay for a second handshake.
 */
export async function shellRouteAvailable(): Promise<boolean> {
  const forget = () => {
    forgetShellCapability();
    return false;
  };
  if (typeof fetch !== 'function') return forget();
  try {
    const response = await fetch('/api/shell/capability', { cache: 'no-store' });
    if (!response.ok) return forget();
    const { capability: issued } = await response.json();
    if (typeof issued !== 'string' || !issued) return forget();
    capability = issued;
    return true;
  } catch {
    // No server, or offline. Treated as absent rather than as an error: a
    // Studio with no server behind it is a legitimate state.
    return forget();
  }
}
