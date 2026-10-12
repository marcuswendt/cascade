/**
 * The graph editing commands: `graph`, `node add|rm`, `connect`, `disconnect`,
 * `set`, `subnet` and `edit`.
 *
 * Each command parses its arguments into one edit operation and hands it to
 * `GraphFile` — the same path the MCP server's tools take — then reports the
 * change in one line, or returns it as data for `--json`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { readGraph, type GraphEditOperation, type GraphRead } from '../../packages/runtime/src/edit/index.js';
import { GraphFile } from './graphFile.js';

export const GRAPH_COMMANDS = ['graph', 'connect', 'disconnect', 'set', 'subnet', 'edit'] as const;

/** True when `args` is a graph editing command. `node <Name>` (scaffold a node module) is not. */
export function isGraphCommand(args: readonly string[]): boolean {
  const [command, sub] = args;
  if (command === 'node') return sub === 'add' || sub === 'rm' || sub === 'remove';
  return (GRAPH_COMMANDS as readonly string[]).includes(command ?? '');
}

export const GRAPH_COMMANDS_HELP = `
Graph editing (every command takes --json; edits take --dry-run):
  cascade graph create <graph> [--name <title>]
  cascade graph read <graph> [--in <subnet>]
  cascade graph list [directory]
  cascade node add <graph> <type> [--name <id>] [--in <subnet>] [--set k=v]... [--at x,y]
  cascade node rm <graph> <node> [--recursive]
  cascade connect <graph> <node.output> <node.input> [--no-layout]
  cascade disconnect <graph> <node.output> <node.input> | <node.input>
  cascade set <graph> <node.param> [<value>] [--expr <e> | --clear-expr]
              [--key <frame>=<value>]... [--remove-key <frame>]... [--interp constant|linear|smooth] [--unset]
  cascade subnet create <graph> <node>... [--name <id>] [--label <text>]
  cascade subnet move <graph> <node>... --to <subnet|root>
  cascade subnet dissolve <graph> <subnet>
  cascade edit <graph> <operations.json | ->      apply a batch, all or nothing
`;

/** Run one graph command. Returns its data, which `--json` prints; text mode prints as it goes. */
export async function runGraphCommand(args: readonly string[], options: { json: boolean }): Promise<unknown> {
  const parsed = parseArguments(args);
  const [command, ...rest] = parsed.positional;
  const say = options.json ? () => {} : (line: string) => console.log(line);

  if (command === 'graph') {
    const [sub, file] = rest;
    if (sub === 'create') {
      const created = await GraphFile.create(required(file, 'cascade graph create <graph>'), optional(parsed.values.name));
      say(`created ${created}`);
      return { file: created };
    }
    if (sub === 'read') {
      const graph = await GraphFile.open(required(file, 'cascade graph read <graph>'));
      const read = readGraph(graph.document, optional(parsed.values.in, 'in'));
      if (!options.json) printGraph(read);
      return { file: graph.file, ...read };
    }
    if (sub === 'list') {
      const listed = await listGraphs(file ?? '.');
      for (const entry of listed) say(`${entry.file}  ${entry.name ?? ''}  (${entry.nodes} nodes, ${entry.wires} wires)`);
      return { graphs: listed };
    }
    throw new Error('usage: cascade graph create|read|list ...');
  }

  const [file, ...operands] = command === 'node' || command === 'subnet' ? rest.slice(1) : rest;
  const graphFile = required(file, `cascade ${command} <graph> ...`);
  const operations = command === 'edit'
    ? await readOperations(required(operands[0], 'cascade edit <graph> <operations.json | ->'))
    : [operationFor(command === 'node' || command === 'subnet' ? `${command} ${rest[0]}` : command!, operands, parsed)];

  return applyEdits(graphFile, operations, { dryRun: parsed.flags.has('dry-run'), json: options.json });
}

/**
 * Apply operations to a graph file and save: the one path every edit takes,
 * from a CLI command, `cascade edit`, or an MCP tool call. Warnings go to
 * `console.warn`, which `--json` collects into the envelope.
 */
export async function applyEdits(
  file: string,
  operations: readonly GraphEditOperation[],
  options: { dryRun?: boolean; json?: boolean } = {},
): Promise<{ file: string; changed: boolean; dryRun: boolean; results: Record<string, unknown>[] }> {
  const graph = await GraphFile.open(file);
  const outcome = await graph.applyAll(operations, { dryRun: options.dryRun === true });
  if (!options.json) for (const result of outcome.results) console.log(describe(result));
  for (const warning of outcome.warnings) console.warn(options.json ? warning : `warning: ${warning}`);
  if (options.dryRun && !options.json) console.log('dry run: nothing written');
  return { file: graph.file, changed: outcome.changed, dryRun: options.dryRun === true, results: outcome.results };
}

/** One command line to one operation. */
function operationFor(command: string, operands: readonly string[], parsed: ParsedArguments): GraphEditOperation {
  const { values, lists, flags } = parsed;
  switch (command) {
    case 'node add': {
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
    }
    case 'node rm':
    case 'node remove':
      return { op: 'node.remove', id: required(operands[0], 'cascade node rm <graph> <node>'), recursive: flags.has('recursive') };
    case 'connect':
      return {
        op: 'connect',
        from: required(operands[0], 'cascade connect <graph> <node.output> <node.input>'),
        to: required(operands[1], 'cascade connect <graph> <node.output> <node.input>'),
        ...(flags.has('no-layout') ? { layout: false } : {}),
      };
    case 'disconnect':
      return operands[1]
        ? { op: 'disconnect', from: operands[0]!, to: operands[1] }
        : { op: 'disconnect', to: required(operands[0], 'cascade disconnect <graph> <node.output> <node.input>') };
    case 'set': {
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
    }
    case 'subnet create':
      return {
        op: 'subnet.create',
        nodes: nonEmpty(operands, 'cascade subnet create <graph> <node>...'),
        ...(values.name ? { id: values.name } : {}),
        ...(values.label ? { label: values.label } : {}),
      };
    case 'subnet move':
      return { op: 'subnet.move', nodes: nonEmpty(operands, 'cascade subnet move <graph> <node>... --to <subnet|root>'), to: required(values.to, '--to <subnet|root>') };
    case 'subnet dissolve':
      return { op: 'subnet.dissolve', id: required(operands[0], 'cascade subnet dissolve <graph> <subnet>') };
    default:
      throw new Error(`Unknown graph command: cascade ${command}. Run "cascade --help".`);
  }
}

/** One line per change, in the vocabulary of the command that made it. */
function describe(result: Record<string, unknown>): string {
  const node = result.node as { id: string; module: string; parent: string | null; position: { x: number; y: number } } | undefined;
  const at = (summary: { position: { x: number; y: number } }) => `${summary.position.x},${summary.position.y}`;
  switch (result.op) {
    case 'node.add':
      return `added ${node!.id} (${node!.module})${node!.parent ? ` in ${node!.parent}` : ''} at ${at(node!)}`;
    case 'node.remove': {
      const wires = result.wires as string[];
      return `removed ${(result.removed as string[]).join(', ')}${wires.length ? `; unwired ${wires.join(', ')}` : ''}`;
    }
    case 'connect': {
      const moved = result.moved as { id: string; position: { x: number; y: number } } | undefined;
      return `connected ${result.wire}${result.replaced ? ` (replaced ${result.replaced})` : ''}${moved ? `; placed ${moved.id} at ${at(moved)}` : ''}`;
    }
    case 'disconnect':
      return `disconnected ${(result.removed as string[]).join(', ')}`;
    case 'set':
      return `set ${result.node}.${result.param}: ${show(result.before)} -> ${show(result.after)}`;
    case 'subnet.create': {
      const subnet = result.subnet as { id: string };
      const inputs = result.inputs as string[];
      const outputs = result.outputs as string[];
      return `created subnet ${subnet.id}${inputs.length ? `; inputs ${inputs.join(', ')}` : ''}${outputs.length ? `; outputs ${outputs.join(', ')}` : ''}`;
    }
    case 'subnet.move':
      return `moved ${(result.moved as string[]).join(', ')} to ${result.to ?? 'the top level'}`;
    case 'subnet.dissolve':
      return `dissolved; lifted ${(result.lifted as string[]).join(', ') || 'nothing'}`;
    default:
      return JSON.stringify(result);
  }
}

function show(value: unknown): string {
  return value === undefined || value === null ? '(default)' : JSON.stringify(value);
}

function printGraph(read: GraphRead): void {
  console.log(`${read.name ?? '(untitled)'}: ${read.nodes.length} nodes, ${read.wires.length} wires`);
  const byParent = new Map<string | null, typeof read.nodes[number][]>();
  for (const node of read.nodes) byParent.set(node.parent, [...(byParent.get(node.parent) ?? []), node]);
  const print = (parent: string | null, depth: number) => {
    for (const node of byParent.get(parent) ?? []) {
      const ports = node.ports ? `  in: ${node.ports.inputs.join(', ') || '-'}  out: ${node.ports.outputs.join(', ') || '-'}` : '';
      const props = node.props ? `  ${JSON.stringify(node.props)}` : '';
      console.log(`${'  '.repeat(depth)}${node.id}  ${node.module}${ports}${props}`);
      print(node.id, depth + 1);
    }
  };
  print(read.nodes.some((node) => node.parent === null) ? null : read.nodes[0]?.parent ?? null, 1);
  if (read.wires.length) console.log('wires:');
  for (const wire of read.wires) console.log(`  ${wire}`);
}

async function listGraphs(directory: string): Promise<{ file: string; name: string | null; nodes: number; wires: number }[]> {
  const skip = new Set(['node_modules', '.git', 'dist', '.cascade-cache', '.cascade']);
  const found: string[] = [];
  const walk = async (dir: string, depth: number) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && depth < 3 && !skip.has(entry.name) && !entry.name.startsWith('.')) await walk(path.join(dir, entry.name), depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.cascade')) found.push(path.join(dir, entry.name));
    }
  };
  await walk(path.resolve(directory), 0);
  return Promise.all(found.map(async (file) => {
    try {
      const document = JSON.parse(await fs.readFile(file, 'utf8'));
      return {
        file: path.relative(process.cwd(), file) || file,
        name: typeof document.metadata?.name === 'string' ? document.metadata.name : null,
        nodes: Array.isArray(document.nodes) ? document.nodes.length : 0,
        wires: Array.isArray(document.connections) ? document.connections.length : 0,
      };
    } catch {
      return { file: path.relative(process.cwd(), file) || file, name: null, nodes: 0, wires: 0 };
    }
  }));
}

async function readOperations(source: string): Promise<GraphEditOperation[]> {
  const text = source === '-' ? await readStdin() : await fs.readFile(source, 'utf8');
  const parsed = JSON.parse(text);
  const operations = Array.isArray(parsed) ? parsed : parsed?.operations;
  if (!Array.isArray(operations)) throw new Error('cascade edit expects a JSON array of operations, or { "operations": [...] }');
  return operations;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

// ---------------------------------------------------------------------------
// Arguments

interface ParsedArguments {
  readonly positional: string[];
  readonly values: Record<string, string | undefined>;
  readonly lists: Record<string, string[] | undefined>;
  readonly flags: Set<string>;
}

const VALUE_OPTIONS = new Set(['name', 'in', 'at', 'comment', 'expr', 'interp', 'to', 'label']);
const LIST_OPTIONS = new Set(['set', 'key', 'remove-key']);
const FLAG_OPTIONS = new Set(['recursive', 'no-layout', 'clear-expr', 'unset', 'dry-run', 'json']);

/**
 * Known options only, so a value that starts with a dash (`set g n.offset -1`)
 * is a value and not a typo'd flag, while a real typo (`--recusive`) fails.
 */
function parseArguments(args: readonly string[]): ParsedArguments {
  const positional: string[] = [];
  const values: Record<string, string | undefined> = {};
  const lists: Record<string, string[] | undefined> = {};
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }
    const [name, inline] = argument.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (FLAG_OPTIONS.has(name)) {
      flags.add(name);
      continue;
    }
    if (!VALUE_OPTIONS.has(name) && !LIST_OPTIONS.has(name)) throw new Error(`Unknown option --${name}`);
    const value = inline ?? args[++index];
    if (value === undefined) throw new Error(`--${name} needs a value`);
    if (LIST_OPTIONS.has(name)) (lists[name] ??= []).push(value);
    else values[name] = value;
  }
  return { positional, values, lists, flags };
}

function required(value: string | undefined, usage: string): string {
  if (!value) throw new Error(`usage: ${usage}`);
  return value;
}

function optional<K extends string>(value: string | undefined, key: K = 'name' as K): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
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
