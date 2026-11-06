/**
 * Every `cascade` verb, once.
 *
 * One row per command line (`run`, `graph read`, `node add`, `lock verify`)
 * holds what the CLI needs to know about it: its usage and summary for
 * `--help`, the handler that runs it, how it treats `--json` and `--help`, the
 * command-line options of the graph editing verbs, and the MCP tools that
 * call it. `index.ts` dispatches from this table, `graphCommands.ts` parses
 * from it and `mcp.ts` builds its tool list from it, so a new verb is one row
 * here plus its handler and its line in doc/CLI_REFERENCE.md
 * (`tests/cli-verbs.test.ts` checks the docs).
 *
 * This file is on every command's start-up path: it must not import anything
 * heavier than a type. Handlers are loaded when their verb runs.
 */

import type { GraphEditOperation } from '../../packages/runtime/src/edit/index.js';

/** Which module runs a verb. Each is loaded only when one of its verbs runs. */
export type Handler =
  | 'studio' // server/src/cliCommands.ts: Studio, `new`, `node <Name>`, `projects`, `serve`
  | 'run' // runCommand.ts: run, validate, check, inspect
  | 'render'
  | 'renderWorker'
  | 'build'
  | 'editor' // editorCommands.ts: export, publish, freeze, scene
  | 'parity'
  | 'graph' // graphCommands.ts
  | 'lock' // locks/commands.ts
  | 'mcp';

/**
 * `--json`:
 * - `envelope`: the flag is removed and the command runs with its console captured into `{ ok, data, warnings }`;
 * - `keep`: the command keeps the flag and prints its own JSON, which becomes `data`;
 * - `studio`: the command opens Studio, which has no JSON output, so `--json` is an error.
 */
export type JsonMode = 'envelope' | 'keep' | 'studio';

export type OptionKind = 'value' | 'list' | 'flag';

/** Parsed graph-command arguments (see `parseArguments` in graphCommands.ts). */
export interface ParsedArguments {
  readonly positional: string[];
  readonly values: Record<string, string | undefined>;
  readonly lists: Record<string, string[] | undefined>;
  readonly flags: Set<string>;
}

/** What an MCP tool does when called. Every kind ends in the CLI's own code path. */
export type McpCall =
  /** Apply edit operations in the server process, as `cascade edit` does. */
  | { readonly kind: 'edit'; readonly operations: (args: Record<string, any>) => GraphEditOperation[] }
  /** Run a graph command in the server process; `argv` is its command line, paths already resolved. */
  | { readonly kind: 'graph'; readonly argv: (args: Record<string, any>, resolve: (file: string) => string) => string[] }
  /** Run `cascade <argv> --json` as a child process. */
  | { readonly kind: 'cli'; readonly argv: (args: Record<string, any>, resolve: (file: string) => string) => string[]; readonly timeoutMs?: (args: Record<string, any>) => number | undefined };

export interface McpToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly call: McpCall;
}

export interface Verb {
  /** The words that select it: `run`, `graph read`, `lock verify`. */
  readonly name: string;
  readonly aliases?: readonly string[];
  /** What follows the name in `--help`. */
  readonly usage: string;
  readonly summary: string;
  readonly section: 'studio' | 'run' | 'share' | 'agents' | 'graph' | 'locks' | 'internal';
  readonly handler: Handler;
  readonly json: JsonMode;
  /** `--help`: `own` passes it to the handler, `main` prints the CLI's help. */
  readonly help: 'own' | 'main';
  /** `--version`: `main` prints the CLI's version, `handler` passes it on. */
  readonly version: 'main' | 'handler';
  /** Command-line options, without `--` (graph editing verbs; the others parse their own). */
  readonly options?: Readonly<Record<string, OptionKind>>;
  /** Graph editing verbs: the command line as one edit operation. */
  readonly operation?: (operands: readonly string[], parsed: ParsedArguments) => GraphEditOperation;
  readonly mcp?: readonly McpToolSpec[];
}

// ---------------------------------------------------------------------------
// MCP schema helpers

const graph = { type: 'string', description: 'Path to the .cascade file, relative to the project directory' };
const dryRun = { type: 'boolean', description: 'Validate without writing' };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

const edit = (operation: (args: Record<string, any>) => GraphEditOperation): McpCall => ({ kind: 'edit', operations: (args) => [operation(args)] });

// ---------------------------------------------------------------------------
// The table

const studio = { handler: 'studio', help: 'main', version: 'main', section: 'studio' } as const;
const graphVerb = { handler: 'graph', json: 'envelope', help: 'main', version: 'handler', section: 'graph' } as const;
const lockVerb = { handler: 'lock', json: 'keep', help: 'own', version: 'handler', section: 'locks' } as const;
const runVerb = { handler: 'run', help: 'main', version: 'main', section: 'run' } as const;
const editorVerb = { handler: 'editor', json: 'envelope', help: 'main', version: 'handler', section: 'share' } as const;

export const VERBS: readonly Verb[] = [
  // Projects and Studio
  { ...studio, name: 'new', usage: '<name>', summary: 'Create a Cascade project', json: 'studio' },
  { ...studio, name: 'node', usage: '<Name> [project-directory]', summary: 'Create a deterministic custom node', json: 'envelope' },
  { ...studio, name: 'projects', usage: '[directory]', summary: 'Show or set the default projects directory', json: 'envelope' },
  { ...studio, name: 'serve', usage: 'start|stop|restart|status|logs|install [project] [options]', summary: 'Run Studio as a managed background service (cascade serve help)', json: 'keep', help: 'own', version: 'handler' },

  // Running
  {
    ...runVerb, name: 'run', usage: '<graph-file> [options]', summary: 'Execute a graph file', json: 'keep',
    mcp: [
      {
        name: 'cook',
        description: 'Run a graph headlessly, optionally only the given node (cascade run).',
        inputSchema: object({ graph, node: { type: 'string' }, timeoutMs: { type: 'number' } }, ['graph']),
        call: { kind: 'cli', argv: (args, resolve) => ['run', resolve(args.graph), ...(args.node ? ['--node', args.node] : [])], timeoutMs: (args) => args.timeoutMs },
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
        call: {
          kind: 'cli',
          argv: (args, resolve) => [
            'run', resolve(args.graph), '--frames', String(args.frames),
            ...(args.fps ? ['--fps', String(args.fps)] : []),
            ...(args.out ? ['--out', args.out] : []),
            ...(args.scene ? ['--scene', resolve(args.scene)] : []),
            ...(args.nodes ?? []).flatMap((node: string) => ['--node', node]),
          ],
          timeoutMs: (args) => args.timeoutMs ?? 30 * 60_000,
        },
      },
    ],
  },
  { name: 'render', usage: '<graph-file> [--frames <range>] [--node <id>] [--workers N] [--final] [--prores]', summary: 'Render an animation across worker processes, then a preview video (cascade render --help)', section: 'run', handler: 'render', json: 'keep', help: 'own', version: 'handler' },
  { ...runVerb, name: 'validate', usage: '<graph-file> [options]', summary: 'Validate a graph file without executing', json: 'envelope' },
  {
    ...runVerb, name: 'check', usage: '<graph-file> [options]', summary: 'Statically check node definitions, types, and graph structure', json: 'envelope',
    mcp: [{
      name: 'check',
      description: 'Statically check a graph: node definitions, port types and the host capabilities a run needs (cascade check).',
      inputSchema: object({ graph, strict: { type: 'boolean' } }, ['graph']),
      call: { kind: 'cli', argv: (args, resolve) => ['check', resolve(args.graph), ...(args.strict ? ['--strict'] : [])] },
    }],
  },
  {
    ...runVerb, name: 'inspect', usage: '<graph-file>', summary: 'Print a machine-readable graph and node-definition summary', json: 'envelope',
    mcp: [{
      name: 'inspect',
      description: 'Every node with its classification and full definition (cascade inspect).',
      inputSchema: object({ graph }, ['graph']),
      call: { kind: 'cli', argv: (args, resolve) => ['inspect', resolve(args.graph)] },
    }],
  },
  { name: 'parity', usage: '<graph-file> [--node <id>] [--seed N] [--tolerance N] [--no-studio]', summary: 'Cook headless twice and through Studio\'s path; report per-node differences', section: 'run', handler: 'parity', json: 'keep', help: 'main', version: 'handler' },

  // Sharing
  { name: 'build', usage: '<graph-file> --out <new-directory> [--asset <file>]...', summary: 'Export a standalone browser player for static hosting or embedding', section: 'share', handler: 'build', json: 'envelope', help: 'main', version: 'handler' },
  {
    ...editorVerb, name: 'export', usage: '<graph-file> (--plan | --out <dir>) [--deploy vercel]', summary: 'Export the graph\'s published editor as a static site (doc/EDITOR_EXPORT.md)',
    mcp: [{
      name: 'export',
      description: 'Export the graph\'s shareable editor (cascade export): `plan` lists what would ship, `out` writes it.',
      inputSchema: object({ graph, plan: { type: 'boolean' }, out: { type: 'string' } }, ['graph']),
      call: { kind: 'cli', argv: (args, resolve) => ['export', resolve(args.graph), ...(args.out ? ['--out', resolve(args.out)] : ['--plan'])] },
    }],
  },
  { ...editorVerb, name: 'publish', usage: '<graph-file> <node>.<prop> [--label ...]', summary: 'Publish a node prop as an editor parameter' },
  { ...editorVerb, name: 'freeze', usage: '<graph-file> <node> --fields <a,b>', summary: 'Snapshot chosen fields of a live data source for export' },
  { ...editorVerb, name: 'scene', usage: '<graph-file> <scene.json> --out <new-graph-file>', summary: 'Apply a scene file to a copy of the graph' },

  // Agents
  { name: 'mcp', usage: '[project-directory]', summary: 'Serve these commands as MCP tools over stdio (doc/MCP.md)', section: 'agents', handler: 'mcp', json: 'envelope', help: 'main', version: 'handler' },

  // Graph editing
  {
    ...graphVerb, name: 'graph create', usage: '<graph> [--name <title>]', summary: 'Create a new, empty graph file; never overwrites',
    options: { name: 'value' },
    mcp: [{
      name: 'graph_create',
      description: 'Create a new, empty .cascade graph file. Refuses to overwrite.',
      inputSchema: object({ graph, name: { type: 'string' } }, ['graph']),
      call: { kind: 'graph', argv: (args, resolve) => ['graph', 'create', resolve(args.graph), ...(args.name ? ['--name', args.name] : [])] },
    }],
  },
  {
    ...graphVerb, name: 'graph read', usage: '<graph> [--in <subnet>]', summary: 'Nodes with stored parameters, subnets with their ports, and wires',
    options: { in: 'value' },
    mcp: [{
      name: 'graph_read',
      description: 'Read a graph: nodes with their stored parameters, subnets with their ports, and wires as "a.out -> b.in". Pass `in` to read one subnet.',
      inputSchema: object({ graph, in: { type: 'string', description: 'A subnet id' } }, ['graph']),
      call: { kind: 'graph', argv: (args, resolve) => ['graph', 'read', resolve(args.graph), ...(args.in ? ['--in', args.in] : [])] },
    }],
  },
  {
    ...graphVerb, name: 'graph list', usage: '[directory]', summary: 'Every .cascade under a directory, with node and wire counts',
    mcp: [{
      name: 'graph_list',
      description: 'List the .cascade graphs in the project (or a subdirectory), with node and wire counts.',
      inputSchema: object({ directory: { type: 'string' } }),
      call: { kind: 'graph', argv: (args, resolve) => ['graph', 'list', resolve(args.directory ?? '.')] },
    }],
  },
  {
    ...graphVerb, name: 'node add', usage: '<graph> <type> [--name <id>] [--in <subnet>] [--set k=v]... [--at x,y] [--comment <text>]', summary: 'Add a node by module id or short name',
    options: { name: 'value', in: 'value', set: 'list', at: 'value', comment: 'value' },
    operation: (operands, { values, lists }) => {
      const module = required(operands[0], 'cascade node add <graph> <type>');
      const set = Object.fromEntries((lists.set ?? []).map((pair) => splitPair(pair, '--set', '=')));
      return {
        op: 'node.add',
        module,
        ...(values.name ? { id: values.name } : {}),
        ...(values.in ? { in: values.in } : {}),
        ...(values.at ? { position: point(values.at) } : {}),
        ...(values.comment ? { comment: values.comment } : {}),
        ...(Object.keys(set).length ? { set, fromText: true } : {}),
      };
    },
    mcp: [{
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
      call: edit((args) => ({
        op: 'node.add', module: args.type,
        ...(args.id ? { id: args.id } : {}), ...(args.in ? { in: args.in } : {}),
        ...(args.set ? { set: args.set } : {}), ...(args.position ? { position: args.position } : {}),
        ...(args.comment ? { comment: args.comment } : {}),
      })),
    }],
  },
  {
    ...graphVerb, name: 'node rm', aliases: ['node remove'], usage: '<graph> <node> [--recursive]', summary: 'Remove a node and its wires',
    options: { recursive: 'flag' },
    operation: (operands, { flags }) => ({ op: 'node.remove', id: required(operands[0], 'cascade node rm <graph> <node>'), recursive: flags.has('recursive') }),
    mcp: [{
      name: 'node_remove',
      description: 'Remove a node and the wires touching it. A subnet with children needs `recursive`.',
      inputSchema: object({ graph, id: { type: 'string' }, recursive: { type: 'boolean' }, dryRun }, ['graph', 'id']),
      call: edit((args) => ({ op: 'node.remove', id: args.id, recursive: args.recursive === true })),
    }],
  },
  {
    ...graphVerb, name: 'connect', usage: '<graph> <node.output> <node.input> [--no-layout]', summary: 'Wire two ports',
    options: { 'no-layout': 'flag' },
    operation: (operands, { flags }) => ({
      op: 'connect',
      from: required(operands[0], 'cascade connect <graph> <node.output> <node.input>'),
      to: required(operands[1], 'cascade connect <graph> <node.output> <node.input>'),
      ...(flags.has('no-layout') ? { layout: false } : {}),
    }),
    mcp: [{
      name: 'connect',
      description: 'Wire node.output to node.input. A port name may be omitted when the node has only one on that side. An input already fed is rewired. A node wired for the first time is moved next to its neighbour unless `layout` is false.',
      inputSchema: object({ graph, from: { type: 'string' }, to: { type: 'string' }, layout: { type: 'boolean' }, dryRun }, ['graph', 'from', 'to']),
      call: edit((args) => ({ op: 'connect', from: args.from, to: args.to, ...(args.layout === false ? { layout: false } : {}) })),
    }],
  },
  {
    ...graphVerb, name: 'disconnect', usage: '<graph> <node.output> <node.input> | <node.input>', summary: 'Remove a wire',
    operation: (operands) => operands[1]
      ? { op: 'disconnect', from: operands[0]!, to: operands[1] }
      : { op: 'disconnect', to: required(operands[0], 'cascade disconnect <graph> <node.output> <node.input>') },
    mcp: [{
      name: 'disconnect',
      description: 'Remove the wire from `from` to `to`, or with only `to`, whatever feeds that input.',
      inputSchema: object({ graph, from: { type: 'string' }, to: { type: 'string' }, dryRun }, ['graph', 'to']),
      call: edit((args) => (args.from ? { op: 'disconnect', from: args.from, to: args.to } : { op: 'disconnect', to: args.to })),
    }],
  },
  {
    ...graphVerb, name: 'set',
    usage: '<graph> <node.param> [<value>] [--expr <e> | --clear-expr]\n              [--key <frame>=<value>]... [--remove-key <frame>]... [--interp constant|linear|smooth] [--unset]',
    summary: 'Set a parameter value, expression or keyframes',
    options: { expr: 'value', 'clear-expr': 'flag', key: 'list', 'remove-key': 'list', interp: 'value', unset: 'flag' },
    operation: (operands, { values, lists, flags }) => {
      const target = required(operands[0], 'cascade set <graph> <node.param> <value>');
      const keys = (lists.key ?? []).map((pair) => {
        const [frame, value] = splitPair(pair, '--key', '=');
        return { frame: Number(frame), value: Number(value) };
      });
      const operation: GraphEditOperation = {
        op: 'set',
        target,
        ...(operands[1] !== undefined ? { value: operands[1], fromText: true } : {}),
        ...(values.expr !== undefined ? { expression: values.expr } : {}),
        ...(flags.has('clear-expr') ? { expression: null } : {}),
        ...(keys.length ? { keys } : {}),
        ...(lists['remove-key']?.length ? { removeKeys: lists['remove-key'].map(Number) } : {}),
        ...(values.interp ? { interpolation: interpolation(values.interp) } : {}),
        ...(flags.has('unset') ? { unset: true } : {}),
      };
      if (Object.keys(operation).length === 2) throw new Error('cascade set needs a value, --expr, --clear-expr, --key, --remove-key or --unset');
      return operation;
    },
    mcp: [{
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
      call: edit((args) => {
        const { graph: _graph, dryRun: _dryRun, ...change } = args;
        return { op: 'set', ...change } as GraphEditOperation;
      }),
    }],
  },
  {
    ...graphVerb, name: 'subnet create', usage: '<graph> <node>... [--name <id>] [--label <text>]', summary: 'Group sibling nodes into a subnet',
    options: { name: 'value', label: 'value' },
    operation: (operands, { values }) => ({
      op: 'subnet.create',
      nodes: nonEmpty(operands, 'cascade subnet create <graph> <node>...'),
      ...(values.name ? { id: values.name } : {}),
      ...(values.label ? { label: values.label } : {}),
    }),
    mcp: [{
      name: 'subnet_create',
      description: 'Group sibling nodes into a new subnet; wires crossing its boundary go through new Input/Output nodes named after the port they carry.',
      inputSchema: object({ graph, nodes: { type: 'array', items: { type: 'string' } }, id: { type: 'string' }, label: { type: 'string' }, dryRun }, ['graph', 'nodes']),
      call: edit((args) => ({ op: 'subnet.create', nodes: args.nodes, ...(args.id ? { id: args.id } : {}), ...(args.label ? { label: args.label } : {}) })),
    }],
  },
  {
    ...graphVerb, name: 'subnet move', usage: '<graph> <node>... --to <subnet|root>', summary: 'Move sibling nodes into a subnet or to the top level',
    options: { to: 'value' },
    operation: (operands, { values }) => ({ op: 'subnet.move', nodes: nonEmpty(operands, 'cascade subnet move <graph> <node>... --to <subnet|root>'), to: required(values.to, '--to <subnet|root>') }),
    mcp: [{
      name: 'subnet_move',
      description: 'Move sibling nodes into another subnet, or to "root", rewiring through the subnet boundaries on the way.',
      inputSchema: object({ graph, nodes: { type: 'array', items: { type: 'string' } }, to: { type: 'string' }, dryRun }, ['graph', 'nodes', 'to']),
      call: edit((args) => ({ op: 'subnet.move', nodes: args.nodes, to: args.to })),
    }],
  },
  {
    ...graphVerb, name: 'subnet dissolve', usage: '<graph> <subnet>', summary: 'Lift a subnet\'s nodes back out and remove it',
    operation: (operands) => ({ op: 'subnet.dissolve', id: required(operands[0], 'cascade subnet dissolve <graph> <subnet>') }),
    mcp: [{
      name: 'subnet_dissolve',
      description: 'Lift a subnet\'s nodes back into its parent and remove the subnet.',
      inputSchema: object({ graph, id: { type: 'string' }, dryRun }, ['graph', 'id']),
      call: edit((args) => ({ op: 'subnet.dissolve', id: args.id })),
    }],
  },
  {
    ...graphVerb, name: 'edit', usage: '<graph> <operations.json | ->      apply a batch, all or nothing', summary: 'Apply a batch of operations, all or nothing',
    mcp: [{
      name: 'edit',
      description: 'Apply several operations at once, all or nothing. Each is { "op": "node.add" | "node.remove" | "connect" | "disconnect" | "set" | "subnet.create" | "subnet.move" | "subnet.dissolve", ... } with the fields of the matching tool (node.add takes `module` and `in`).',
      inputSchema: object({ graph, operations: { type: 'array', items: { type: 'object' } }, dryRun }, ['graph', 'operations']),
      call: { kind: 'edit', operations: (args) => args.operations },
    }],
  },

  // Locks
  {
    ...lockVerb, name: 'lock', usage: '<graph-file> <node> --name <name> [--note ...]', summary: 'Record a render (graph, params, seeds, inputs, code) in locks/<id>.json',
    mcp: [{
      name: 'lock',
      description: 'Record a render as a lock (cascade lock): cooks `node`, writes locks/<id>.json with the graph, params, seeds, input hashes, stored code and output fingerprints.',
      inputSchema: object({
        graph,
        node: { type: 'string' },
        name: { type: 'string' },
        note: { type: 'string' },
        scene: { type: 'string' },
        seed: { type: 'integer' },
        supersedes: { type: 'string' },
        preview: { type: 'string' },
        live: { type: 'boolean' },
      }, ['graph', 'node', 'name']),
      call: {
        kind: 'cli',
        argv: (args, resolve) => [
          'lock', resolve(args.graph), args.node, '--name', args.name,
          ...(args.note ? ['--note', args.note] : []),
          ...(args.scene ? ['--scene', resolve(args.scene)] : []),
          ...(args.seed !== undefined ? ['--seed', String(args.seed)] : []),
          ...(args.supersedes ? ['--supersedes', args.supersedes] : []),
          ...(args.preview ? ['--preview', resolve(args.preview)] : []),
          ...(args.live ? ['--live'] : []),
        ],
        timeoutMs: () => 60 * 60_000,
      },
    }],
  },
  {
    ...lockVerb, name: 'replay', usage: '<lock-id> [--out <dir>]', summary: 'Re-render a lock from its stored code and compare fingerprints',
    mcp: [{
      name: 'replay',
      description: 'Re-render a lock from its stored code and compare fingerprints (cascade replay). `data.status` is match or mismatch; `live` uses the current code.',
      inputSchema: object({ lock: { type: 'string' }, out: { type: 'string' }, live: { type: 'boolean' } }, ['lock']),
      call: {
        kind: 'cli',
        argv: (args, resolve) => [
          'replay', String(args.lock).endsWith('.json') ? resolve(args.lock) : args.lock, '--project', resolve('.'),
          ...(args.out ? ['--out', resolve(args.out)] : []),
          ...(args.live ? ['--live'] : []),
        ],
        timeoutMs: () => 60 * 60_000,
      },
    }],
  },
  { ...lockVerb, name: 'lock verify', usage: '[<lock-id>...]', summary: 'Replay locks and report which still match' },
  {
    ...lockVerb, name: 'locks', usage: '', summary: 'List the project\'s locks (cascade lock --help for all options)',
    mcp: [{
      name: 'locks',
      description: "List the project's locks (cascade locks).",
      inputSchema: object({}, []),
      call: { kind: 'cli', argv: (_args, resolve) => ['locks', resolve('.')] },
    }],
  },

  // One of `cascade render --workers`' processes, forked by it with its spec.
  { name: '__render-worker', usage: '<spec>', summary: 'internal', section: 'internal', handler: 'renderWorker', json: 'studio', help: 'own', version: 'handler' },
];

// ---------------------------------------------------------------------------
// Lookups

/**
 * The verb a command line names, or undefined for a project or graph to open
 * in Studio. Two words win over one (`node add` over `node`); a first word
 * that only starts two-word verbs (`graph`, `subnet`) still selects their
 * handler, which reports the usage.
 */
export function verbFor(args: readonly string[]): Verb | undefined {
  const [first, second] = args;
  if (!first) return undefined;
  const two = `${first} ${second ?? ''}`;
  return VERBS.find((verb) => verb.name === two || verb.aliases?.includes(two))
    ?? VERBS.find((verb) => verb.name === first)
    ?? VERBS.find((verb) => verb.name.split(' ')[0] === first);
}

/** True when `args` is a graph editing command. `node <Name>` (scaffold a node module) is not. */
export function isGraphCommand(args: readonly string[]): boolean {
  return verbFor(args)?.handler === 'graph';
}

/** Every option a graph editing verb takes, by kind. `--dry-run` and `--json` go with every one. */
export function graphOptions(): Record<OptionKind, Set<string>> {
  const sets: Record<OptionKind, Set<string>> = { value: new Set(), list: new Set(), flag: new Set(['dry-run', 'json']) };
  for (const verb of VERBS) {
    if (verb.handler !== 'graph') continue;
    for (const [name, kind] of Object.entries(verb.options ?? {})) sets[kind].add(name);
  }
  return sets;
}

/** Every MCP tool with the verb it calls. */
export function mcpTools(): { verb: Verb; tool: McpToolSpec }[] {
  return VERBS.flatMap((verb) => (verb.mcp ?? []).map((tool) => ({ verb, tool })));
}

// ---------------------------------------------------------------------------
// Help

const usageLine = (verb: Verb) => `  cascade ${verb.name}${verb.usage ? ` ${verb.usage}` : ''}`;

export function graphCommandsHelp(): string {
  return `
Graph editing (every command takes --json; edits take --dry-run):
${VERBS.filter((verb) => verb.section === 'graph').map(usageLine).join('\n')}
`;
}

export function mainHelp(): string {
  const listed = VERBS.filter((verb) => verb.section !== 'internal');
  const before = listed.filter((verb) => verb.section !== 'graph' && verb.section !== 'locks' && verb.name !== 'parity');
  const after = listed.filter((verb) => verb.section === 'locks' || verb.name === 'parity');
  const summaries = listed.filter((verb) => verb.section !== 'graph');
  const width = Math.max(...summaries.map((verb) => verb.name.length)) + 2;
  return `
Cascade Graph Execution CLI

Usage:
  cascade [project-directory | graph-file] [Studio options]
${before.map(usageLine).join('\n')}
${graphCommandsHelp()}
${after.map(usageLine).join('\n')}

Commands:
${summaries.map((verb) => `  ${verb.name.padEnd(width)}${verb.summary}`).join('\n')}

Options:
  --host <address>         Bind Studio to an address or hostname
  --port <number>          Bind Studio HTTP to an explicit port
  --trusted-host <name>    Allow an exact remote browser hostname (repeatable)
  --fallback-host <addr>   Bind this instead when --host does not resolve or is
                           not on this machine (repeatable; default 127.0.0.1).
                           The preferred host is retried and rebound when it returns
  --no-open                Do not open Studio in a browser
  --node <id>        Render only this node's output. Repeatable.
  --entry-node <id>  Older spelling of --node, single valued
  --frames <range>   Render a frame sequence: 1-100, 1-100x2 (step), 42, or
                     timeline (the range saved with the graph)
  --fps <number>     Frame rate to evaluate the range at (default: the graph's timeline fps)
  --mp4 <file>       After --frames, encode the sequence as H.264 yuv420p (needs ffmpeg)
  --crf <n>          Quality for --mp4, 0-51, lower is better (default 18)
  --out <dir>        Sequence directory, project-relative (default: renders)
  --json             Print one { ok, data, warnings } envelope (any command)
  --seed <n>         Cook with this graph seed instead of the document's
  --fresh            With --frames, cook every node on every frame (default: only what the frame changed)
  --timeout <ms>     Bound a run in a supervised child process (exit 124 on timeout)
  --validate-only   Validate only (same as 'validate' command)
  --strict          Fail when a node names a module with no file (default: warn)
  --verbose, -v      Show verbose output
  --version          Show version
  --help, -h         Show this help message

Examples:
  cascade .
  cascade . --host KURO --port 3030
  cascade new my-artwork
  cascade node Multiply ./my-artwork
  cascade run graph.cascade
  cascade run graph.cascade --entry-node node_123
  cascade validate graph.cascade
  cascade run graph.cascade --frames 1-100
  cascade run graph.cascade --frames 1-100x2 --fps 25 --out frames
  cascade run graph.cascade --verbose

A frame sequence is written as <out>/<node id>.<frame>.<ext> — one file per
image output nothing downstream consumes, or per output of --entry-node.

Every run writes a trace to .cascade/runs/: each node's time and every Python
stage call with its cache key and state (hit, miss, off). --verbose prints the
stage lines as they happen.
`;
}

// ---------------------------------------------------------------------------
// Argument helpers for the operations above

function required(value: string | undefined, usage: string): string {
  if (!value) throw new Error(`usage: ${usage}`);
  return value;
}

function nonEmpty(values: readonly string[], usage: string): string[] {
  if (!values.length) throw new Error(`usage: ${usage}`);
  return [...values];
}

function splitPair(pair: string, flag: string, separator: string): [string, string] {
  const at = pair.indexOf(separator);
  if (at <= 0) throw new Error(`${flag} takes name${separator}value (got "${pair}")`);
  return [pair.slice(0, at), pair.slice(at + 1)];
}

function point(text: string): { x: number; y: number } {
  const [x, y] = text.split(',').map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`--at takes x,y (got "${text}")`);
  return { x: x!, y: y! };
}

function interpolation(text: string): 'constant' | 'linear' | 'smooth' {
  if (text === 'constant' || text === 'linear' || text === 'smooth') return text;
  throw new Error(`--interp is constant, linear or smooth (got "${text}")`);
}
