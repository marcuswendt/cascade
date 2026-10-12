/**
 * `--json` for every command: one envelope on stdout, nothing else.
 *
 *     { "ok": true,  "data": { ... }, "warnings": ["..."] }
 *     { "ok": false, "error": { "message": "..." }, "warnings": ["..."] }
 *
 * Commands written before this print text as they go. Rather than give each a
 * second, JSON-shaped code path, the command runs with the console captured:
 * what it warns becomes `warnings`, what it prints becomes `data` (parsed when
 * it printed JSON, as `inspect` and `run --frames --json` do; as `output`
 * lines otherwise), and a thrown error or a non-zero exit becomes `ok: false`.
 * A command that returns a value — the graph editing commands do — supplies
 * `data` directly.
 *
 * The exit code still carries the outcome: 0 for ok, 1 otherwise.
 */

export interface JsonEnvelope {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: { readonly message: string };
  readonly warnings: readonly string[];
}

class ExitRequested extends Error {
  constructor(readonly code: number) {
    super('');
  }
}

/** Run `command` with its console captured and return the envelope, without printing it. */
export async function captureEnvelope(command: () => Promise<unknown>): Promise<JsonEnvelope> {
  const logged: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    write: process.stdout.write,
    exit: process.exit,
  };
  const text = (args: unknown[]) => args.map((arg) => (typeof arg === 'string' ? arg : arg instanceof Error ? arg.message : JSON.stringify(arg))).join(' ');
  console.log = (...args: unknown[]) => { logged.push(text(args)); };
  console.info = console.log;
  console.warn = (...args: unknown[]) => { warnings.push(text(args)); };
  console.error = (...args: unknown[]) => { errors.push(text(args)); };
  process.stdout.write = ((chunk: unknown) => {
    logged.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.exit = ((code?: number) => {
    throw new ExitRequested(typeof code === 'number' ? code : 0);
  }) as typeof process.exit;

  let result: unknown;
  let failure: string | null = null;
  try {
    result = await command();
    if (process.exitCode && process.exitCode !== 0) failure = errors.join('\n') || `exited with code ${process.exitCode}`;
  } catch (error) {
    if (error instanceof ExitRequested) {
      if (error.code !== 0) failure = errors.join('\n') || `exited with code ${error.code}`;
    } else {
      failure = error instanceof Error ? error.message : String(error);
    }
  } finally {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
    process.stdout.write = original.write;
    process.exit = original.exit;
  }

  const allWarnings = [...warnings, ...(failure ? [] : errors)].flatMap(splitLines);
  if (failure) return { ok: false, error: { message: failure.replace(/^Error: /, '') }, warnings: allWarnings };
  return { ok: true, data: result !== undefined ? result : dataFromOutput(logged), warnings: allWarnings };
}

/** Run a command in `--json` mode: print its envelope and set the exit code. */
export async function runWithJsonEnvelope(command: () => Promise<unknown>): Promise<void> {
  const envelope = await captureEnvelope(command);
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
  process.exitCode = envelope.ok ? 0 : 1;
}

function dataFromOutput(chunks: readonly string[]): unknown {
  const output = chunks.join('\n').trim();
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch {
    // A manifest is printed as one line after any progress lines.
    const lines = output.split('\n').filter(Boolean);
    try {
      return JSON.parse(lines[lines.length - 1]!);
    } catch {
      return { output: lines };
    }
  }
}

function splitLines(text: string): string[] {
  return text.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim());
}
