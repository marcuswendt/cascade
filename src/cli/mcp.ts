/**
 * `cascade mcp`: the CLI as an MCP server over stdio, for agents that should
 * call `set` rather than shell out and parse text.
 *
 * No second implementation. Every tool is a CLI command with `--json`:
 *
 * - graph reads and edits run in this process through `runGraphCommand` and
 *   `applyEdits`, the functions `cascade graph|node|connect|set|subnet|edit`
 *   call, inside the same envelope capture `--json` uses;
 * - cooking, rendering, checking and exporting run `cascade <command> --json`
 *   as a child process, so a long render cannot leave state behind in the
 *   server and the result is byte for byte what the CLI prints.
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
import { applyEdits, runGraphCommand } from './graphCommands.js';
import type { GraphEditOperation } from '../../packages/runtime/src/edit/index.js';

const PROTOCOL_VERSION = '2025-06-18';

interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly run: (args: Record<string, any>, server: McpContext) => Promise<JsonEnvelope>;
}

export interface McpContext {
  readonly root: string;
  /** A project-relative or absolute path, checked to be inside the project. */
  resolve(file: string): string;
  cli(args: readonly string[], timeoutMs?: number): Promise<JsonEnvelope>;
}

const graph = { type: 'string', description: 'Path to the .cascade file, relative to the project directory' };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

/** One edit operation, the same JSON `cascade edit` takes. */
const edit = (operation: (args: Record<string, any>) => GraphEditOperation) =>
  async (args: Record<string, any>, server: McpContext) =>
    captureEnvelope(() => applyEdits(server.resolve(args.graph), [operation(args)], { json: true, dryRun: args.dryRun === true }));

const dryRun = { type: 'boolean', description: 'Validate without writing' };

export const TOOLS: readonly Tool[] = [
  {
    name: 'graph_list',
    description: 'List the .cascade graphs in the project (or a subdirectory), with node and wire counts.',
    inputSchema: object({ directory: { type: 'string' } }),
    run: (args, server) => captureEnvelope(() => runGraphCommand(['graph', 'list', server.resolve(args.directory ?? '.')], { json: true })),
  },
  {
    name: 'graph_read',
    description: 'Read a graph: nodes with their stored parameters, subnets with their ports, and wires as "a.out -> b.in". Pass `in` to read one subnet.',
    inputSchema: object({ graph, in: { type: 'string', description: 'A subnet id' } }, ['graph']),
    run: (args, server) => captureEnvelope(() => runGraphCommand(['graph', 'read', server.resolve(args.graph), ...(args.in ? ['--in', args.in] : [])], { json: true })),
  },
  {
    name: 'graph_create',
    description: 'Create a new, empty .cascade graph file. Refuses to overwrite.',
    inputSchema: object({ graph, name: { type: 'string' } }, ['graph']),
    run: (args, server) => captureEnvelope(() => runGraphCommand(['graph', 'create', server.resolve(args.graph), ...(args.name ? ['--name', args.name] : [])], { json: true })),
  },
  {
    name: 'node_add',
    description: 'Add a node. `type` is a module id (cascade.geo.Circle, project.InkVocabulary) or a short name (Circle, InkVocabulary). The node gets a stable kebab-case id unless `id` is given, and is placed next to what it is later wired to.',
    inputSchema: object({
      graph,
      type: { type: 'string' },
      id: { type: 'string' },
      in: { type: 'string', description: 'Subnet to create the node in' },
      set: { type: 'object', description: 'Parameter values by name, as JSON values' },
      position: object({ x: { type: 'number' }, y: { type: 'number' } }, ['x', 'y']),
      comment: { type: 'string' },
      dryRun,
    }, ['graph', 'type']),
    run: edit((args) => ({
      op: 'node.add', module: args.type,
      ...(args.id ? { id: args.id } : {}), ...(args.in ? { in: args.in } : {}),
      ...(args.set ? { set: args.set } : {}), ...(args.position ? { position: args.position } : {}),
      ...(args.comment ? { comment: args.comment } : {}),
    })),
  },
  {
    name: 'node_remove',
    description: 'Remove a node and the wires touching it. A subnet with children needs `recursive`.',
    inputSchema: object({ graph, id: { type: 'string' }, recursive: { type: 'boolean' }, dryRun }, ['graph', 'id']),
    run: edit((args) => ({ op: 'node.remove', id: args.id, recursive: args.recursive === true })),
  },
  {
    name: 'connect',
    description: 'Wire node.output to node.input. A port name may be omitted when the node has only one on that side. An input already fed is rewired. A node wired for the first time is moved next to its neighbour unless `layout` is false.',
    inputSchema: object({ graph, from: { type: 'string' }, to: { type: 'string' }, layout: { type: 'boolean' }, dryRun }, ['graph', 'from', 'to']),
    run: edit((args) => ({ op: 'connect', from: args.from, to: args.to, ...(args.layout === false ? { layout: false } : {}) })),
  },
  {
    name: 'disconnect',
    description: 'Remove the wire from `from` to `to`, or with only `to`, whatever feeds that input.',
    inputSchema: object({ graph, from: { type: 'string' }, to: { type: 'string' }, dryRun }, ['graph', 'to']),
    run: edit((args) => (args.from ? { op: 'disconnect', from: args.from, to: args.to } : { op: 'disconnect', to: args.to })),
  },
  {
    name: 'set',
    description: 'Set node.param: a value (JSON, checked against the declared type), an expression (null removes it), keyframes, or `unset` to return to the default. A value equal to the default is not stored.',
    inputSchema: object({
      graph,
      target: { type: 'string', description: 'node.param' },
      value: {},
      expression: { type: ['string', 'null'] },
      keys: { type: 'array', items: object({ frame: { type: 'number' }, value: { type: 'number' } }, ['frame', 'value']) },
      removeKeys: { type: 'array', items: { type: 'number' } },
      interpolation: { enum: ['constant', 'linear', 'smooth'] },
      unset: { type: 'boolean' },
      dryRun,
    }, ['graph', 'target']),
    run: edit((args) => {
      const { graph: _graph, dryRun: _dryRun, ...change } = args;
      return { op: 'set', ...change } as GraphEditOperation;
    }),
  },
  {
    name: 'subnet_create',
    description: 'Group sibling nodes into a new subnet; wires crossing its boundary go through new Input/Output nodes named after the port they carry.',
    inputSchema: object({ graph, nodes: { type: 'array', items: { type: 'string' } }, id: { type: 'string' }, label: { type: 'string' }, dryRun }, ['graph', 'nodes']),
    run: edit((args) => ({ op: 'subnet.create', nodes: args.nodes, ...(args.id ? { id: args.id } : {}), ...(args.label ? { label: args.label } : {}) })),
  },
  {
    name: 'subnet_move',
    description: 'Move sibling nodes into another subnet, or to "root", rewiring through the subnet boundaries on the way.',
    inputSchema: object({ graph, nodes: { type: 'array', items: { type: 'string' } }, to: { type: 'string' }, dryRun }, ['graph', 'nodes', 'to']),
    run: edit((args) => ({ op: 'subnet.move', nodes: args.nodes, to: args.to })),
  },
  {
    name: 'subnet_dissolve',
    description: 'Lift a subnet\'s nodes back into its parent and remove the subnet.',
    inputSchema: object({ graph, id: { type: 'string' }, dryRun }, ['graph', 'id']),
    run: edit((args) => ({ op: 'subnet.dissolve', id: args.id })),
  },
  {
    name: 'edit',
    description: 'Apply several operations at once, all or nothing. Each is { "op": "node.add" | "node.remove" | "connect" | "disconnect" | "set" | "subnet.create" | "subnet.move" | "subnet.dissolve", ... } with the fields of the matching tool (node.add takes `module` and `in`).',
    inputSchema: object({ graph, operations: { type: 'array', items: { type: 'object' } }, dryRun }, ['graph', 'operations']),
    run: (args, server) => captureEnvelope(() => applyEdits(server.resolve(args.graph), args.operations, { json: true, dryRun: args.dryRun === true })),
  },
  {
    name: 'check',
    description: 'Statically check a graph: node definitions, port types and the host capabilities a run needs (cascade check).',
    inputSchema: object({ graph, strict: { type: 'boolean' } }, ['graph']),
    run: (args, server) => server.cli(['check', server.resolve(args.graph), ...(args.strict ? ['--strict'] : [])]),
  },
  {
    name: 'inspect',
    description: 'Every node with its classification and full definition (cascade inspect).',
    inputSchema: object({ graph }, ['graph']),
    run: (args, server) => server.cli(['inspect', server.resolve(args.graph)]),
  },
  {
    name: 'cook',
    description: 'Run a graph headlessly, optionally only the given node (cascade run).',
    inputSchema: object({ graph, node: { type: 'string' }, timeoutMs: { type: 'number' } }, ['graph']),
    run: (args, server) => server.cli(['run', server.resolve(args.graph), ...(args.node ? ['--node', args.node] : [])], args.timeoutMs),
  },
  {
    name: 'render',
    description: 'Render frames to image files and return the manifest (cascade run --frames). `frames` is 1-100, 1-100x2 or 42.',
    inputSchema: object({
      graph,
      frames: { type: 'string' },
      fps: { type: 'number' },
      out: { type: 'string', description: 'Output directory, project-relative (default renders)' },
      nodes: { type: 'array', items: { type: 'string' } },
      scene: { type: 'string', description: 'A scene file to apply first' },
      timeoutMs: { type: 'number' },
    }, ['graph', 'frames']),
    run: (args, server) => server.cli([
      'run', server.resolve(args.graph), '--frames', String(args.frames),
      ...(args.fps ? ['--fps', String(args.fps)] : []),
      ...(args.out ? ['--out', args.out] : []),
      ...(args.scene ? ['--scene', server.resolve(args.scene)] : []),
      ...(args.nodes ?? []).flatMap((node: string) => ['--node', node]),
    ], args.timeoutMs ?? 30 * 60_000),
  },
  {
    name: 'export',
    description: 'Export the graph\'s shareable editor (cascade export): `plan` lists what would ship, `out` writes it.',
    inputSchema: object({ graph, plan: { type: 'boolean' }, out: { type: 'string' } }, ['graph']),
    run: (args, server) => server.cli(['export', server.resolve(args.graph), ...(args.out ? ['--out', server.resolve(args.out)] : ['--plan'])]),
  },
  {
    name: 'lock',
    description: 'Record an approved render as a lock file (cascade lock). Available once the CLI has the lock command.',
    inputSchema: object({ graph, name: { type: 'string' }, scene: { type: 'string' }, preview: { type: 'string' } }, ['graph', 'name']),
    run: (args, server) => withCommand(server, 'lock', [
      'lock', server.resolve(args.graph), '--name', args.name,
      ...(args.scene ? ['--scene', server.resolve(args.scene)] : []),
      ...(args.preview ? ['--preview', server.resolve(args.preview)] : []),
    ]),
  },
  {
    name: 'replay',
    description: 'Rebuild a locked render from its lock file and optionally verify it (cascade replay). Available once the CLI has the replay command.',
    inputSchema: object({ lock: { type: 'string' }, out: { type: 'string' }, verify: { type: 'boolean' } }, ['lock']),
    run: (args, server) => withCommand(server, 'replay', [
      'replay', server.resolve(args.lock),
      ...(args.out ? ['--out', server.resolve(args.out)] : []),
      ...(args.verify ? ['--verify'] : []),
    ], 60 * 60_000),
  },
];

/** Run a CLI command only if this build has it, rather than letting an unknown word reach Studio's launcher. */
async function withCommand(server: McpContext, command: string, args: readonly string[], timeoutMs?: number): Promise<JsonEnvelope> {
  const help = await server.cli(['--help']);
  const text = JSON.stringify(help.data ?? '');
  if (!text.includes(`cascade ${command} `)) {
    return { ok: false, error: { message: `This Cascade build has no "${command}" command yet; it lands with locks and replay (doc/PRODUCTION_READINESS.md, item 1).` }, warnings: [] };
  }
  return server.cli(args, timeoutMs);
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
