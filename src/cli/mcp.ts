/**
 * `cascade mcp`: the CLI as an MCP server over stdio, for agents that should
 * call `set` rather than shell out and parse text.
 *
 * No second implementation. Every tool is a CLI command with `--json`, and
 * every tool is an `mcp` entry on its verb's row in verbs.ts (name,
 * description, input schema, and how it calls the command):
 *
 * - graph reads and edits run in this process through `runGraphCommand` and
 *   `applyEdits`, the functions `cascade graph|node|connect|set|subnet|edit`
 *   call, inside the same envelope capture `--json` uses;
 * - cooking, rendering, checking, exporting and locks run
 *   `cascade <command> --json` as a child process, so a long render cannot
 *   leave state behind in the server and the result is byte for byte what
 *   the CLI prints.
 *
 * Every result is the `--json` envelope, `{ ok, data, warnings }` or
 * `{ ok: false, error, warnings }`, as the tool's text content, with
 * `isError` set when `ok` is false. Tool names are the CLI's own words.
 *
 * Paths are resolved against the project directory the server was started in
 * and may not leave it.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { captureEnvelope, type JsonEnvelope } from './jsonEnvelope.js';
import { mcpTools, type McpCall } from './verbs.js';

const PROTOCOL_VERSION = '2025-06-18';

interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  /** The verb-table row (verbs.ts) the tool calls. */
  readonly verb: string;
  readonly run: (args: Record<string, any>, server: McpContext) => Promise<JsonEnvelope>;
}

export interface McpContext {
  readonly root: string;
  /** A project-relative or absolute path, checked to be inside the project. */
  resolve(file: string): string;
  cli(args: readonly string[], timeoutMs?: number): Promise<JsonEnvelope>;
}

/** The MCP tools, one per `mcp` entry in the verb table. */
export const TOOLS: readonly Tool[] = mcpTools().map(({ verb, tool }) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
  verb: verb.name,
  run: toolRunner(tool.call),
}));

function toolRunner(call: McpCall): Tool['run'] {
  switch (call.kind) {
    case 'edit':
      return async (args, server) => {
        const { applyEdits } = await import('./graphCommands.js');
        return captureEnvelope(() => applyEdits(server.resolve(args.graph), call.operations(args), { json: true, dryRun: args.dryRun === true }));
      };
    case 'graph':
      return async (args, server) => {
        const { runGraphCommand } = await import('./graphCommands.js');
        return captureEnvelope(() => runGraphCommand(call.argv(args, (file) => server.resolve(file)), { json: true }));
      };
    case 'cli':
      // The command is in this build's verb table, so it exists: no probe first.
      return (args, server) => server.cli(call.argv(args, (file) => server.resolve(file)), call.timeoutMs?.(args));
  }
}

export async function runMcpServer(args: readonly string[], version: string): Promise<void> {
  const root = path.resolve(args.find((arg) => !arg.startsWith('-')) ?? '.');
  // stdout is the protocol channel. Anything a command logs goes to stderr.
  console.log = console.error;
  console.info = console.error;

  const context = createMcpContext(root);

  let queue: Promise<unknown> = Promise.resolve();
  const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const lines = readline.createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let message: { id?: number | string; method?: string; params?: any };
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    // One call at a time: two edits to the same file must not interleave.
    queue = queue.then(() => handle(message, context, version)).then((response) => {
      if (response !== undefined && message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, ...response });
    });
  });
  await new Promise<void>((resolve) => lines.on('close', resolve));
  await queue;
}

/** The tools' view of one project directory: path containment and the CLI child. */
export function createMcpContext(root: string): McpContext {
  return {
    root,
    resolve(file) {
      const resolved = path.resolve(root, file);
      const relative = path.relative(root, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${file} is outside the project directory ${root}`);
      return resolved;
    },
    cli: (cliArgs, timeoutMs) => runCliChild(root, cliArgs, timeoutMs ?? 10 * 60_000),
  };
}

/** One JSON-RPC request to its response body (`result` or `error`); `undefined` for a notification. */
export async function handle(message: { method?: string; params?: any }, context: McpContext, version: string): Promise<Record<string, unknown> | undefined> {
  switch (message.method) {
    case 'initialize':
      return {
        result: {
          protocolVersion: typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'cascade', version },
          instructions: 'Cascade graph tools. Graph paths are relative to the project directory. Read a graph with graph_read before editing it; every result is { ok, data, warnings }.',
        },
      };
    case 'ping':
      return { result: {} };
    case 'tools/list':
      return { result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } };
    case 'tools/call': {
      const tool = TOOLS.find((candidate) => candidate.name === message.params?.name);
      if (!tool) return { error: { code: -32602, message: `Unknown tool: ${message.params?.name}` } };
      let envelope: JsonEnvelope;
      try {
        envelope = await tool.run(message.params?.arguments ?? {}, context);
      } catch (error) {
        envelope = { ok: false, error: { message: error instanceof Error ? error.message : String(error) }, warnings: [] };
      }
      return {
        result: {
          content: [{ type: 'text', text: JSON.stringify(envelope) }],
          structuredContent: envelope,
          isError: !envelope.ok,
        },
      };
    }
    default:
      if (message.method?.startsWith('notifications/')) return undefined;
      return { error: { code: -32601, message: `Method not found: ${message.method}` } };
  }
}

/** `cascade <args> --json` as a child process, in the project directory. */
function runCliChild(root: string, args: readonly string[], timeoutMs: number): Promise<JsonEnvelope> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...process.execArgv, process.argv[1]!, ...args, '--json'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const last = stdout.trim().split('\n').pop() ?? '';
      try {
        resolve(JSON.parse(last) as JsonEnvelope);
      } catch {
        const reason = signal ? `stopped by ${signal}${signal === 'SIGTERM' ? ` after ${timeoutMs} ms` : ''}` : `exited with code ${code}`;
        resolve({ ok: false, error: { message: `cascade ${args[0]} ${reason}: ${(stderr || stdout).trim().slice(-2000)}` }, warnings: [] });
      }
    });
  });
}
