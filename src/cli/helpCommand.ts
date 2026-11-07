/**
 * `cascade help node [<type>] [--project <dir>] [--json]`: a node's
 * declaration from the installed package, with no repository checkout.
 *
 * The built-in definitions are bundled into the CLI, so what this prints is
 * exactly what this build runs: label, description, where it runs, its
 * capabilities, and each input, prop and output with type, default, range and
 * description. A `project.<Name>` (or a bare `<Name>` with a file under
 * `nodes/`) is read statically from the project, as `cascade check` reads it.
 * Without a type it lists every node it knows.
 *
 * Studio's class-based libraries (`cascade.core.*` routing and friends) have no
 * static definition to print; for those it says so and points at the
 * reference shipped beside the CLI (doc/NODE_REFERENCE.md).
 */
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NodeDefinition } from '../../packages/contracts/src/index.js';
import { headlessBuiltin, headlessBuiltinRegistrations } from './headlessBuiltins.js';

export const HELP_NODE_USAGE = 'cascade help node [<type>] [--project <dir>] [--json]';

interface NodeHelp {
  readonly module: string;
  readonly source: 'builtin' | 'project';
  readonly definition: NodeDefinition;
}

export async function runHelpCommand(args: string[]): Promise<void> {
  const json = args.includes('--json');
  const projectIndex = args.indexOf('--project');
  const project = path.resolve(projectIndex === -1 ? '.' : args[projectIndex + 1] ?? '.');
  const operands: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--project') index += 1;
    else if (!args[index]!.startsWith('-')) operands.push(args[index]!);
  }
  const [, topic, type] = operands;
  if (topic !== 'node') {
    const { mainHelp } = await import('./verbs.js');
    console.log(mainHelp());
    return;
  }

  if (!type) {
    const nodes = await listNodes(project);
    if (json) print({ nodes });
    else console.log(nodes.map((node) => `  ${node.module.padEnd(28)}${node.summary}`).join('\n') + `\n\n${HELP_NODE_USAGE}`);
    return;
  }

  const found = await findNode(type, project);
  if (found) {
    if (json) print(found);
    else console.log(formatNode(found));
    return;
  }
  const studio = studioNode(type);
  if (studio) {
    const message = `${type} is a class-based Studio node (${studio}): it has no static definition to print. Its ports are in Studio's Definition panel; doc/NODE_REFERENCE.md in this package lists it.`;
    if (json) print({ module: type, source: 'studio', message });
    else console.log(message);
    return;
  }
  const near = (await listNodes(project)).map((node) => node.module)
    .filter((id) => id.toLowerCase().includes(type.toLowerCase().replace(/^.*\./, ''))).slice(0, 6);
  throw new Error(`No node type "${type}".${near.length ? ` Did you mean ${near.join(', ')}?` : ''} cascade help node lists them all.`);
}

function print(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data)}\n`);
}

/** A module id, a short name (`Circle`, `NotBlank`), or a project node name. */
export async function findNode(type: string, project: string): Promise<NodeHelp | undefined> {
  const exact = headlessBuiltin(type);
  if (exact) return { module: exact.moduleId, source: 'builtin', definition: exact.definition };
  const name = type.slice(type.lastIndexOf('.') + 1);
  if (!type.includes('.') || type.startsWith('project.')) {
    const local = await projectDefinition(project, name);
    if (local) return { module: `project.${name}`, source: 'project', definition: local };
  }
  if (type.includes('.')) return undefined;
  const short = headlessBuiltinRegistrations.filter((registration) => registration.moduleId.slice(registration.moduleId.lastIndexOf('.') + 1).toLowerCase() === name.toLowerCase());
  return short.length === 1 ? { module: short[0]!.moduleId, source: 'builtin', definition: short[0]!.definition } : undefined;
}

async function projectDefinition(project: string, name: string): Promise<NodeDefinition | undefined> {
  if (!existsSync(path.join(project, 'nodes', name, 'index.ts'))) return undefined;
  const { moduleDefinitions } = await import('./projectRuntime.js');
  const definitions = await moduleDefinitions(path.join(project, 'index.cascade'), [`project.${name}`]);
  return definitions.get(`project.${name}`);
}

async function listNodes(project: string): Promise<{ module: string; summary: string }[]> {
  const summary = (definition: NodeDefinition) => [definition.label, definition.description].filter(Boolean).join(' — ');
  const builtins = headlessBuiltinRegistrations.map((registration) => ({ module: registration.moduleId, summary: summary(registration.definition) }));
  let names: string[] = [];
  try {
    names = (await fs.readdir(path.join(project, 'nodes'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch { /* not a project */ }
  const local: { module: string; summary: string }[] = [];
  for (const name of names) {
    const definition = await projectDefinition(project, name).catch(() => undefined);
    local.push({ module: `project.${name}`, summary: definition ? summary(definition) : '(dynamic or unreadable definition)' });
  }
  return [...builtins.sort((a, b) => a.module.localeCompare(b.module)), ...local];
}

export function formatNode({ module, source, definition }: NodeHelp): string {
  const lines = [`${module}${definition.label ? ` — ${definition.label}` : ''}${source === 'project' ? ' (project node)' : ''}`];
  if (definition.description) lines.push(definition.description);
  lines.push('', `Runs on ${definition.runsOn}.${definition.capabilities?.length ? ` Capabilities: ${definition.capabilities.join(', ')}.` : ''}`);
  for (const [heading, group] of [['Inputs', definition.inputs], ['Props', definition.props], ['Outputs', definition.outputs]] as const) {
    const entries = Object.entries(group ?? {});
    if (!entries.length) continue;
    lines.push('', `${heading}:`);
    for (const [name, port] of entries) lines.push(`  ${describePort(name, port as Record<string, unknown>)}`);
  }
  const firstInput = Object.keys(definition.inputs ?? {})[0];
  const firstOutput = Object.keys(definition.outputs ?? {})[0];
  const firstProp = Object.keys(definition.props ?? {})[0];
  lines.push('', 'Use:', `  cascade node add <graph> ${module}`);
  if (firstOutput) lines.push(`  cascade connect <graph> <node>.${firstOutput} <other>.<input>`);
  if (firstInput) lines.push(`  cascade connect <graph> <other>.<output> <node>.${firstInput}`);
  if (firstProp) lines.push(`  cascade set <graph> <node>.${firstProp} <value>`);
  return lines.join('\n');
}

function describePort(name: string, port: Record<string, unknown>): string {
  if (port.kind === 'trigger') return `${name}  trigger`;
  const parts = [`${name}  ${String(port.type)}`];
  if ('default' in port) parts.push(`default ${JSON.stringify(port.default)}`);
  if (port.min !== undefined || port.max !== undefined) parts.push(`range ${port.min ?? ''}…${port.max ?? ''}`);
  if (Array.isArray(port.options)) parts.push(`options ${(port.options as { value: unknown }[]).map((option) => JSON.stringify(option?.value ?? option)).join(' | ')}`);
  if (port.expression) parts.push(`expression ${String(port.expression)}`);
  const line = parts.join(', ');
  return port.description ? `${line}  — ${String(port.description)}` : line;
}

/** The Studio library a class-based node is listed under in the shipped reference, if any. */
function studioNode(type: string): string | undefined {
  const reference = referenceFile();
  if (!reference) return undefined;
  const text = readFileSync(reference, 'utf8');
  const studio = text.slice(text.indexOf('## Studio node libraries'));
  const name = type.slice(type.lastIndexOf('.') + 1);
  const library = /^### (.+?) — `(cascade\.[a-z]+)\.\*`/gm;
  let match: RegExpExecArray | null;
  const sections: { label: string; namespace: string; at: number }[] = [];
  while ((match = library.exec(studio))) sections.push({ label: match[1]!, namespace: match[2]!, at: match.index });
  for (const [index, section] of sections.entries()) {
    const body = studio.slice(section.at, sections[index + 1]?.at ?? studio.length);
    if (type.includes('.') && !type.startsWith(`${section.namespace}.`)) continue;
    if (body.includes(`\`${name}\``)) return `${section.namespace}.${name}, ${section.label} library`;
  }
  return undefined;
}

/** doc/NODE_REFERENCE.md beside the CLI: `dist/cli/index.js` and `src/cli/helpCommand.ts` are both two levels down. */
function referenceFile(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.resolve(here, '..', '..', 'doc', 'NODE_REFERENCE.md'), path.resolve(here, '..', 'doc', 'NODE_REFERENCE.md')]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
