/**
 * The graph editing commands: `graph`, `node add|rm`, `connect`, `disconnect`,
 * `set`, `subnet` and `edit`.
 *
 * Each command's options and operation are its row in verbs.ts. A command
 * parses its arguments into one edit operation and hands it to
 * `GraphFile` — the same path the MCP server's tools take — then reports the
 * change in one line, or returns it as data for `--json`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { GraphEditOperation, GraphRead } from '../../packages/runtime/src/edit/index.js';
import { VERBS, graphOptions, type ParsedArguments } from './verbs.js';

/**
 * `GraphFile` checks edits with the project's node definitions, which loads
 * the engine; `graph list` needs none of it, so it is loaded on use.
 */
const loadGraphFile = async () => (await import('./graphFile.js')).GraphFile;

/** Run one graph command. Returns its data, which `--json` prints; text mode prints as it goes. */
export async function runGraphCommand(args: readonly string[], options: { json: boolean }): Promise<unknown> {
  const parsed = parseArguments(args);
  const [command, ...rest] = parsed.positional;
  const say = options.json ? () => {} : (line: string) => console.log(line);

  if (command === 'graph') {
    const [sub, file] = rest;
    if (sub === 'create') {
      const created = await (await loadGraphFile()).create(required(file, 'cascade graph create <graph>'), optional(parsed.values.name));
      say(`created ${created}`);
      return { file: created };
    }
    if (sub === 'read') {
      const graph = await (await loadGraphFile()).open(required(file, 'cascade graph read <graph>'));
      const { readGraph } = await import('../../packages/runtime/src/edit/index.js');
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

  const twoWords = command === 'node' || command === 'subnet';
  const [file, ...operands] = twoWords ? rest.slice(1) : rest;
  const graphFile = required(file, `cascade ${command} <graph> ...`);
  const operations = command === 'edit'
    ? await readOperations(required(operands[0], 'cascade edit <graph> <operations.json | ->'))
    : [operationFor(twoWords ? `${command} ${rest[0]}` : command!, operands, parsed)];

  return applyEdits(graphFile, operations, { dryRun: parsed.flags.has('dry-run'), json: options.json });
}

/** One command line to one operation, by the verb's row in verbs.ts. */
function operationFor(name: string, operands: readonly string[], parsed: ParsedArguments): GraphEditOperation {
  const verb = VERBS.find((candidate) => candidate.handler === 'graph' && (candidate.name === name || candidate.aliases?.includes(name)));
  if (!verb?.operation) throw new Error(`Unknown graph command: cascade ${name}. Run "cascade --help".`);
  return verb.operation(operands, parsed);
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
  const graph = await (await loadGraphFile()).open(file);
  const outcome = await graph.applyAll(operations, { dryRun: options.dryRun === true });
  if (!options.json) for (const result of outcome.results) console.log(describe(result));
  for (const warning of outcome.warnings) console.warn(options.json ? warning : `warning: ${warning}`);
  if (options.dryRun && !options.json) console.log('dry run: nothing written');
  return { file: graph.file, changed: outcome.changed, dryRun: options.dryRun === true, results: outcome.results };
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
  // `renders/` and `out/` hold frame trees (thousands of files, no graphs):
  // walking them made a listing of commons take seconds. A directory named
  // on the command line is still listed.
  const skip = new Set(['node_modules', '.git', 'dist', '.cascade-cache', '.cascade', 'renders', 'out']);
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

const OPTIONS = graphOptions();

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
    if (OPTIONS.flag.has(name)) {
      flags.add(name);
      continue;
    }
    if (!OPTIONS.value.has(name) && !OPTIONS.list.has(name)) throw new Error(`Unknown option --${name}`);
    const value = inline ?? args[++index];
    if (value === undefined) throw new Error(`--${name} needs a value`);
    if (OPTIONS.list.has(name)) (lists[name] ??= []).push(value);
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
