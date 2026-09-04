import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';
import type { NodeDefinition } from '../../packages/contracts/src/index.js';
import { createRuntime } from '../../packages/runtime/src/index.js';
import { builtinNodeRegistration, builtinNodeRegistrations } from '../../packages/runtime/src/builtins/index.js';
import { createNodeRuntimeHost } from '../../packages/runtime/src/node.js';
import { extractNodeDefinition } from '../../packages/runtime/src/definition/extract.js';
import { validateNodeModuleArchitecture } from '../../packages/runtime/src/definition/architecture.js';
import type { DefinitionNodeRegistration } from '../../packages/runtime/src/types.js';
import { ProjectRoot } from '../../server/src/project.js';

interface ProjectNode {
  id: string;
  module?: string;
  type?: string;
  source?: unknown;
  inputs?: unknown;
  outputs?: unknown;
  props?: Record<string, unknown>;
}

interface PreparedGraph {
  registrations: DefinitionNodeRegistration[];
  deterministic: Set<string>;
}

export async function validateProjectGraph(file: string, document: any): Promise<void> {
  const prepared = await prepare(file, document, false);
  const nodes = document.nodes as ProjectNode[];
  if (nodes.some((node) => !prepared.deterministic.has(moduleId(node)))) {
    validateDynamicDocument(document);
    return;
  }
  const runtime = createRuntime({
    host: createNodeRuntimeHost({ modules: resolver(prepared.registrations) }),
    nodes: prepared.registrations,
  });
  const graph = await runtime.load(document);
  await graph.dispose();
  await runtime.dispose();
}

export async function checkProjectGraph(file: string, document: any): Promise<void> {
  const prepared = await prepare(file, document, false);
  const nodes = document.nodes as ProjectNode[];
  const dynamic = [...new Set(nodes
    .map(moduleId)
    .filter((id) => id && !prepared.deterministic.has(id)))];
  if (dynamic.length) {
    throw new Error(`Static check requires definition-v1 modules; dynamic modules: ${dynamic.join(', ')}`);
  }
  const runtime = createRuntime({
    host: createNodeRuntimeHost({ modules: resolver(prepared.registrations) }),
    nodes: prepared.registrations,
  });
  const graph = await runtime.load(document);
  await graph.dispose();
  await runtime.dispose();
}

export async function runDeterministicProjectGraph(
  file: string,
  document: any,
  entryNode?: string,
): Promise<boolean> {
  const prepared = await prepare(file, document, true);
  const nodes = Array.isArray(document?.nodes) ? document.nodes as ProjectNode[] : [];
  const deterministicCount = nodes.filter((node) => prepared.deterministic.has(moduleId(node))).length;
  if (!nodes.length || deterministicCount === 0) return false;
  if (deterministicCount !== nodes.length) {
    throw new Error('Mixed deterministic and dynamic graphs are not executable until the bounded legacy adapter is implemented');
  }

  const project = new ProjectRoot(path.dirname(path.resolve(file)));
  const runtime = createRuntime({
    host: createNodeRuntimeHost({
      modules: resolver(prepared.registrations),
      shell: project.shell as never,
    }),
    nodes: prepared.registrations,
  });
  const graph = await runtime.load(document);
  const result = await graph.run(entryNode ? { target: { kind: 'node', nodeId: entryNode } } : {});
  await graph.dispose();
  await runtime.dispose();
  if (result.status !== 'completed') {
    throw new Error(result.diagnostics.map((item) => item.message).join('\n') || `Graph ${result.status}`);
  }
  return true;
}

export async function inspectProjectGraph(file: string, document: any) {
  const prepared = await prepare(file, document, false);
  const registrations = new Map(
    [...builtinNodeRegistrations, ...prepared.registrations].map((item) => [item.moduleId, item]),
  );
  const nodes = (document.nodes as ProjectNode[]).map((node) => {
    const id = moduleId(node);
    return {
      id: node.id,
      module: id,
      classification: prepared.deterministic.has(id) ? 'definition-v1' : 'dynamic',
      ...(prepared.deterministic.has(id) ? { definition: registrations.get(id)?.definition } : {}),
    };
  });
  return {
    file: path.resolve(file),
    version: document.version ?? null,
    deterministic: nodes.length > 0 && nodes.every((node) => node.classification === 'definition-v1'),
    nodes,
    connections: Array.isArray(document.connections) ? document.connections.length : 0,
  };
}

async function prepare(file: string, document: any, compileExecutors: boolean): Promise<PreparedGraph> {
  if (!document || typeof document !== 'object' || !Array.isArray(document.nodes)) {
    throw new Error('Graph document must contain a nodes array');
  }
  const projectRoot = path.dirname(path.resolve(file));
  const registrations: DefinitionNodeRegistration[] = [];
  const deterministic = new Set<string>();
  const seen = new Set<string>();

  for (const node of document.nodes as ProjectNode[]) {
    const id = moduleId(node);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (builtinNodeRegistration(id)) {
      deterministic.add(id);
      continue;
    }
    const moduleFile = await projectModuleFile(projectRoot, node, id);
    if (!moduleFile) {
      registrations.push(savedRegistration(id, node));
      continue;
    }

    const source = await fs.readFile(moduleFile, 'utf8');
    const mentionsDefinition = /\bexport\s+const\s+definition\b/.test(source);
    const extracted = extractNodeDefinition(source, moduleFile, ts);
    if (!extracted.ok) {
      if (!mentionsDefinition && extracted.diagnostics.every((item) => item.code === 'definition/missing-export')) {
        registrations.push(savedRegistration(id, node));
        continue;
      }
      throw new Error(extracted.diagnostics.map(formatDiagnostic).join('\n'));
    }
    const architectureDiagnostics = validateNodeModuleArchitecture(source, moduleFile, ts);
    if (architectureDiagnostics.length) {
      throw new Error(architectureDiagnostics.map(formatDiagnostic).join('\n'));
    }

    deterministic.add(id);
    registrations.push({
      kind: 'definition-v1',
      moduleId: id,
      definition: extracted.definition,
      loadExecute: compileExecutors
        ? () => compileExecute(projectRoot, moduleFile)
        : async () => { throw new Error('Static validation never loads execute'); },
    });
  }
  return { registrations, deterministic };
}

async function projectModuleFile(root: string, node: ProjectNode, id: string): Promise<string | null> {
  const source = node.source;
  if (source && typeof source === 'object' && (source as any).type === 'project' && typeof (source as any).file === 'string') {
    const candidate = path.resolve(root, (source as any).file);
    if (within(root, candidate) && await exists(candidate)) return candidate;
  }
  if (!id.startsWith('project.')) return null;
  const name = id.slice('project.'.length);
  const candidate = path.resolve(root, 'nodes', name, 'index.ts');
  return within(root, candidate) && await exists(candidate) ? candidate : null;
}

async function compileExecute(projectRoot: string, moduleFile: string) {
  const cache = path.join(projectRoot, '.cascade-cache', 'nodes');
  await fs.mkdir(cache, { recursive: true });
  const output = path.join(cache, `${path.basename(path.dirname(moduleFile))}.mjs`);
  await build({
    entryPoints: [moduleFile],
    outfile: output,
    bundle: true,
    packages: 'external',
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: 'inline',
  });
  const loaded = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);
  if (typeof loaded.execute !== 'function') throw new Error(`${moduleFile} does not export execute`);
  return loaded.execute;
}

function savedRegistration(moduleId: string, node: ProjectNode): DefinitionNodeRegistration {
  return {
    kind: 'definition-v1',
    moduleId,
    definition: savedDefinition(node),
    loadExecute: async () => { throw new Error(`Legacy module ${moduleId} cannot run through the deterministic runtime`); },
  };
}

function savedDefinition(node: ProjectNode): NodeDefinition {
  const inputs = portDefinitions(node.inputs, 'input');
  const outputs = portDefinitions(node.outputs, 'output');
  const used = new Set([...Object.keys(inputs), ...Object.keys(outputs)]);
  const props = Object.fromEntries(Object.entries(node.props ?? {}).filter(([name]) => !used.has(name)).map(([name, value]) => [name, {
    type: 'any',
    default: jsonValue(value && typeof value === 'object' && 'value' in value ? (value as any).value : value),
  }]));
  return {
    apiVersion: 1,
    runsOn: 'portable',
    inputs,
    outputs,
    props,
  } as NodeDefinition;
}

function validateDynamicDocument(document: any): void {
  if (!Array.isArray(document.nodes)) throw new Error('Graph document must contain a nodes array');
  const ids = new Set<string>();
  for (const node of document.nodes as ProjectNode[]) {
    if (!node || typeof node.id !== 'string' || !node.id || !moduleId(node)) {
      throw new Error('Every graph node must have a non-empty id and module');
    }
    if (ids.has(node.id)) throw new Error(`Duplicate node id: ${node.id}`);
    ids.add(node.id);
  }
  if (document.connections !== undefined && !Array.isArray(document.connections)) {
    throw new Error('Graph connections must be an array');
  }
  for (const [index, connection] of (document.connections ?? []).entries()) {
    const endpoints = Array.isArray(connection)
      ? connection
      : [connection?.source, connection?.target];
    if (endpoints.length !== 2) throw new Error(`Connection ${index} must have two endpoints`);
    for (const endpoint of endpoints) {
      const nodeId = Array.isArray(endpoint) ? endpoint[0] : endpoint?.nodeId;
      if (typeof nodeId !== 'string' || !ids.has(nodeId)) {
        throw new Error(`Connection ${index} references an unknown node`);
      }
    }
  }
}

function portDefinitions(value: unknown, direction: 'input' | 'output'): Record<string, any> {
  if (!Array.isArray(value)) return {};
  return Object.fromEntries(value.flatMap((port: any, index) => {
    const name = typeof port?.name === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(port.name) ? port.name : `${direction}_${index}`;
    if (port?.portType === 'trigger' || port?.dataType === 'trigger') return [[name, { kind: 'trigger' }]];
    const definition: Record<string, unknown> = { kind: 'data', type: cascadeType(port?.dataType) };
    if (direction === 'input' && ('defaultValue' in (port ?? {}) || 'value' in (port ?? {}))) {
      definition.default = jsonValue('defaultValue' in port ? port.defaultValue : port.value);
    }
    return [[name, definition]];
  }));
}

function moduleId(node: ProjectNode): string {
  return typeof node?.module === 'string' ? node.module : typeof node?.type === 'string' ? node.type : '';
}

function cascadeType(value: unknown): string {
  if (value === 'number') return 'float';
  if (value === 'boolean') return 'bool';
  return typeof value === 'string' && value !== 'trigger' ? value : 'any';
}

function jsonValue(value: unknown): any {
  try { return value === undefined ? null : JSON.parse(JSON.stringify(value)); }
  catch { return null; }
}

function resolver(registrations: DefinitionNodeRegistration[]) {
  const modules = new Map(registrations.map((registration) => [registration.moduleId, registration]));
  return { resolve: async (id: string) => modules.get(id) ?? null };
}

function formatDiagnostic(diagnostic: any): string {
  const location = diagnostic.file ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}:${diagnostic.column}` : ''}: ` : '';
  return `${location}${diagnostic.code}: ${diagnostic.message}`;
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true; } catch { return false; }
}
