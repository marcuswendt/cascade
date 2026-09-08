import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';
import { CAPABILITIES_BY_ENVIRONMENT, type Diagnostic, type NodeDefinition } from '../../packages/contracts/src/index.js';
import { createRuntime, PREFLIGHT_WARNING_CODES } from '../../packages/runtime/src/index.js';
import { builtinNodeRegistration, builtinNodeRegistrations } from '../../packages/runtime/src/builtins/index.js';
import { createNodeRuntimeHost } from '../../packages/runtime/src/node.js';
import { extractNodeDefinition } from '../../packages/runtime/src/definition/extract.js';
import { validateNodeModuleArchitecture } from '../../packages/runtime/src/definition/architecture.js';
import { frameRange } from '../../packages/runtime/src/animation/index.js';
import type { DefinitionNodeRegistration, LoadedCascadeGraph, RuntimeHost } from '../../packages/runtime/src/types.js';
import { ProjectRoot } from '../../server/src/project.js';
import { createNodeAssetCapability } from './nodeAssets.js';
import { imagePath, sequenceFileName, sequenceWidth } from './sequence.js';

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
  /**
   * Modules named by the document with no file behind them, and the paths
   * looked for. See `unresolvedModule`.
   */
  unresolved: Diagnostic[];
}

/**
 * The one place the CLI's host is built, used by `run`, `validate` and
 * `check` alike.
 *
 * It exists because they used to differ. `run` passed `shell` and `assets`;
 * the two static commands passed nothing and never asked a host anything —
 * so a graph whose node declared a capability could pass both and fail on
 * the first run. A validator that constructs a different host from the runner
 * is not validating the run.
 */
function createProjectHost(file: string, registrations: DefinitionNodeRegistration[]): RuntimeHost {
  const project = new ProjectRoot(path.dirname(path.resolve(file)));
  return createNodeRuntimeHost({
    modules: resolver(registrations),
    shell: project.shell as never,
    // `assets` is the browser's alone until it is given here, and
    // `cascade.geo.SvgExport` declares it — so an export graph passed both
    // `validate` and `check` and then refused to run. See ./nodeAssets.ts
    // for where the file lands and why.
    assets: createNodeAssetCapability(project),
  });
}

/**
 * Loads the graph against the host that would run it and reports what the host
 * cannot supply. The rules are the runtime's own preflight — the same code
 * `run` throws from — so the two cannot drift.
 */
async function preflightAgainstRunHost(
  file: string,
  registrations: DefinitionNodeRegistration[],
  document: any,
): Promise<void> {
  // A graph with no project directory around it cannot be checked against the
  // host that would run it, because that host is built out of the project. Say
  // so and fall back to the structural load. Skipping the check silently is
  // how a checker gets trusted while blind, which is the whole subject here.
  let host: RuntimeHost;
  let checkable = true;
  try {
    host = createProjectHost(file, registrations);
  } catch (error) {
    console.warn(`Capability check skipped: ${error instanceof Error ? error.message : error}`);
    host = createNodeRuntimeHost({ modules: resolver(registrations) });
    checkable = false;
  }
  const runtime = createRuntime({ host, nodes: registrations });
  let diagnostics: readonly Diagnostic[] = [];
  try {
    const graph = await runtime.load(document);
    if (checkable) diagnostics = graph.preflight();
    await graph.dispose();
  } finally {
    await runtime.dispose();
  }
  if (!diagnostics.length) return;
  const { errors, warnings } = classifyPreflight(diagnostics);
  reportPreflightWarnings(host, warnings);
  if (!errors.length) return;
  throw new Error([
    `This graph cannot run on the ${host.environment} host that "cascade run" uses:`,
    ...errors.map(line),
    ...capabilityAdvice(host, errors),
  ].join('\n'));
}

function reportPreflightWarnings(
  host: RuntimeHost,
  warnings: readonly Diagnostic[],
): void {
  // Two warnings with opposite meanings, so they cannot share a heading. An
  // environment mismatch says the checker cannot see this graph; a stray
  // `params` array says the graph loaded wrong and will run anyway.
  const elsewhere = warnings.filter((item) => item.code === 'runtime/preflight-environment');
  const lossy = warnings.filter((item) => item.code === 'runtime/stray-params');
  if (elsewhere.length) {
    console.warn([
      `Not checkable here — ${elsewhere.length === 1 ? 'one node' : `${elsewhere.length} nodes`} in this graph target${elsewhere.length === 1 ? 's' : ''} another host:`,
      ...elsewhere.map(line),
      `  The CLI runs the ${host.environment} host, so "cascade run" cannot run this graph. Nothing above says the graph is wrong.`,
    ].join('\n'));
  }
  if (lossy.length) {
    console.warn([
      `Stored values were dropped on load — ${lossy.length === 1 ? 'one node' : `${lossy.length} nodes`} still keep${lossy.length === 1 ? 's' : ''} values under "params":`,
      ...lossy.map(line),
      `  This graph will run, on the defaults, and look like it worked.`,
    ].join('\n'));
  }
}

function line(item: Diagnostic): string {
  return `  ${item.code}${item.path ? ` [${item.path}]` : ''}: ${item.message}`;
}

/**
 * Which preflight diagnostics stop a run and which only need saying.
 *
 * The static warning codes live in the runtime beside the diagnostics they
 * classify. Execution is stricter: a server run still rejects a browser node,
 * while a static server-side check reports that host mismatch as a limit of
 * the checker rather than a malformed graph.
 *
 * A node saying `runsOn: 'portable'` or `'server'` claims this host can run
 * it. If it then needs a capability the host has not installed, the node has
 * contradicted itself and that is an error.
 */
export function classifyPreflight(diagnostics: readonly Diagnostic[]): {
  readonly errors: readonly Diagnostic[];
  readonly warnings: readonly Diagnostic[];
} {
  return {
    errors: diagnostics.filter((item) => !PREFLIGHT_WARNING_CODES.has(item.code)),
    warnings: diagnostics.filter((item) => PREFLIGHT_WARNING_CODES.has(item.code)),
  };
}

/**
 * One line per capability the host is missing, saying where it would come
 * from. Which host owns a capability is read from the contract; whether this
 * host installed it is read from the host. Neither half is written down here,
 * because a hardcoded availability list is what produced the bug.
 */
function capabilityAdvice(host: RuntimeHost, diagnostics: readonly Diagnostic[]): string[] {
  const missing = [...new Set(diagnostics
    .filter((item) => item.code === 'runtime/missing-capability')
    .map((item) => /Missing capability (\w+)/.exec(item.message)?.[1] ?? '')
    .filter(Boolean))];
  if (!missing.length) return [];
  const hostCapabilities = CAPABILITIES_BY_ENVIRONMENT[host.environment] ?? [];
  return missing.map((name) => hostCapabilities.includes(name as never)
    ? `  ${name}: declared in @cascade/contracts but not installed by the host — drop it from the definition, or install it where the host is built (createProjectHost, src/cli/projectRuntime.ts).`
    : `  ${name}: a ${environmentOwning(name)} capability. The CLI runs the ${host.environment} host, so no CLI run can supply it.`);
}

function environmentOwning(capability: string): string {
  const owners = Object.entries(CAPABILITIES_BY_ENVIRONMENT)
    .filter(([, names]) => (names as readonly string[]).includes(capability))
    .map(([environment]) => environment);
  return owners.length ? owners.join('/') : 'unknown';
}

/**
 * Print the modules with no file behind them, before any command's own
 * branching swallows the question.
 *
 * It has to be here rather than beside the preflight warnings, because those
 * are never reached on the graphs that need this most: `check` throws on a
 * dynamic module and `validate` hands a dynamic document to a different
 * validator, so an unconverted sketch leaves by a door that never printed
 * anything.
 */
function reportUnresolved(prepared: PreparedGraph): void {
  if (!prepared.unresolved.length) return;
  const count = prepared.unresolved.length;
  console.warn([
    `${count === 1 ? 'One node names a module' : `${count} nodes name modules`} with no file:`,
    ...prepared.unresolved.map(line),
  ].join('\n'));
}

export async function validateProjectGraph(file: string, document: any): Promise<void> {
  const prepared = await prepare(file, document, false);
  reportUnresolved(prepared);
  const nodes = document.nodes as ProjectNode[];
  if (nodes.some((node) => !prepared.deterministic.has(moduleId(node)))) {
    validateDynamicDocument(document);
    return;
  }
  await preflightAgainstRunHost(file, prepared.registrations, document);
}

export async function checkProjectGraph(file: string, document: any): Promise<void> {
  const prepared = await prepare(file, document, false);
  reportUnresolved(prepared);
  const nodes = document.nodes as ProjectNode[];
  const dynamic = [...new Set(nodes
    .map(moduleId)
    .filter((id) => id && !prepared.deterministic.has(id)))];
  if (dynamic.length) {
    throw new Error(`Static check requires definition-v1 modules; dynamic modules: ${dynamic.join(', ')}`);
  }
  await preflightAgainstRunHost(file, prepared.registrations, document);
}

export async function runDeterministicProjectGraph(
  file: string,
  document: any,
  entryNode?: string,
): Promise<boolean> {
  const prepared = await prepare(file, document, true);
  reportUnresolved(prepared);
  const nodes = Array.isArray(document?.nodes) ? document.nodes as ProjectNode[] : [];
  const deterministicCount = nodes.filter((node) => prepared.deterministic.has(moduleId(node))).length;
  if (!nodes.length || deterministicCount === 0) return false;
  if (deterministicCount !== nodes.length) {
    throw new Error('Mixed deterministic and dynamic graphs are not executable until the bounded legacy adapter is implemented');
  }

  const host = createProjectHost(file, prepared.registrations);
  const runtime = createRuntime({
    host,
    nodes: prepared.registrations,
  });
  let graph: LoadedCascadeGraph | undefined;
  try {
    graph = await runtime.load(document);
    // The run path warns too, and it has to: `assertPreflight` throws only on
    // what stops a run, so a stray-`params` graph cooks on its defaults, and a
    // warning printed by `check` and not by `run` is a warning nobody reads.
    //
    // But only the document-level one. An environment mismatch is a warning to
    // a *checker*, whose reach is the thing in question, and an error to a
    // *run*, which is about to refuse — printing "nothing above says the graph
    // is wrong" here would be a lie told a line before the exception that
    // contradicts it.
    reportPreflightWarnings(
      host,
      classifyPreflight(graph.preflight()).warnings
        .filter((item) => item.code === 'runtime/stray-params'),
    );
    const result = await graph.run(entryNode ? { target: { kind: 'node', nodeId: entryNode } } : {});
    if (result.status !== 'completed') {
      throw new Error(result.diagnostics.map((item) => item.message).join('\n') || `Graph ${result.status}`);
    }
    return true;
  } finally {
    await graph?.dispose();
    await runtime.dispose();
  }
}

export interface DeterministicFrameRenderOptions {
  start: number;
  end: number;
  step?: number;
  /** Frame rate to evaluate at, for `$FPS` and `$T`. */
  fps?: number;
  /** Sequence directory, project-relative. */
  out: string;
  entryNode?: string;
  verbose?: boolean;
  signal?: { readonly aborted: boolean };
}

export interface DeterministicFrameRenderResult {
  frames: number[];
  /** Written files, project-relative, in the order they were written. */
  files: string[];
  aborted: boolean;
}

/**
 * Render a frame sequence from a definition-v1 graph.
 *
 * `--frames` used to refuse this outright — *"this graph is definition-v1 and
 * runs through the deterministic runtime"* — which was true and was also the
 * whole problem: the preferred node style was the one that could not be
 * animated offline. It could not because the runtime had no clock and no
 * answer for a bound parameter, both of which it now has, so the frame is
 * simply a value each run states.
 *
 * Returns null when the graph is not fully deterministic, so the caller falls
 * through to the dynamic path rather than this deciding for it.
 *
 * There is no fixpoint pass here, and there should not be. The deterministic
 * runtime executes the whole graph on every run in dependency order — it has
 * no dirty state to be one frame behind with, which is the fault
 * `cookUntilSettled` exists to prevent on the other host.
 */
export async function renderDeterministicProjectFrames(
  file: string,
  document: any,
  options: DeterministicFrameRenderOptions,
): Promise<DeterministicFrameRenderResult | null> {
  const prepared = await prepare(file, document, true);
  reportUnresolved(prepared);
  const nodes = Array.isArray(document?.nodes) ? document.nodes as ProjectNode[] : [];
  const deterministicCount = nodes.filter((node) => prepared.deterministic.has(moduleId(node))).length;
  if (!nodes.length || deterministicCount === 0) return null;
  if (deterministicCount !== nodes.length) {
    throw new Error('Mixed deterministic and dynamic graphs are not executable until the bounded legacy adapter is implemented');
  }

  const project = new ProjectRoot(path.dirname(path.resolve(file)));
  const host = createProjectHost(file, prepared.registrations);
  const runtime = createRuntime({
    host,
    nodes: prepared.registrations,
  });
  const graph = await runtime.load(document);
  reportPreflightWarnings(host, classifyPreflight(graph.preflight()).warnings);

  const outDirectory = project.resolve(options.out);
  await fs.mkdir(outDirectory, { recursive: true });

  const width = sequenceWidth(options.end);
  const frames: number[] = [];
  const files: string[] = [];
  let aborted = false;

  try {
    for (const frame of frameRange(options.start, options.end, options.step ?? 1)) {
      if (options.signal?.aborted) {
        aborted = true;
        break;
      }
      const result = await graph.run({
        frame,
        ...(options.fps === undefined ? {} : { fps: options.fps }),
        ...(options.entryNode ? { target: { kind: 'node' as const, nodeId: options.entryNode } } : {}),
      });
      if (result.status !== 'completed') {
        throw new Error(
          `frame ${frame} ${result.status} — ${result.diagnostics.map((item) => item.message).join('; ') || 'no diagnostics'}`,
        );
      }

      const outputs = imageOutputs(graph, options.entryNode);
      if (!outputs.length) {
        throw new Error(
          'No image output to save: the graph has no unconsumed image port. ' +
          'Name the node to render with --entry-node.',
        );
      }
      for (const { nodeId, value } of outputs) {
        const source = imagePath(value);
        if (!source) continue;
        const name = sequenceFileName(nodeId, frame, source, width);
        await fs.copyFile(project.resolveMedia(source.replace(/^\.?\//, '')), path.join(outDirectory, name));
        files.push(path.posix.join(options.out, name));
      }
      frames.push(frame);
      if (options.verbose) console.log(`  frame ${frame}`);
    }
  } finally {
    await graph.dispose();
    await runtime.dispose();
  }

  return { frames, files, aborted };
}

/** The image outputs a frame should be saved from: an explicit entry node's, or
 *  every image output nothing downstream consumes. The same rule the dynamic
 *  path uses, read off the runtime's inspection rather than off port objects. */
function imageOutputs(
  graph: LoadedCascadeGraph,
  entryNode?: string,
): { nodeId: string; value: unknown }[] {
  const found: { nodeId: string; value: unknown }[] = [];
  for (const node of graph.inspect().nodes) {
    if (entryNode && node.id !== entryNode) continue;
    for (const port of Object.values(node.outputs)) {
      if (port.type !== 'image') continue;
      if (!entryNode && port.connected) continue;
      if (port.value === undefined) continue;
      found.push({ nodeId: node.id, value: port.value });
    }
  }
  return found;
}

export async function inspectProjectGraph(file: string, document: any) {
  const prepared = await prepare(file, document, false);
  reportUnresolved(prepared);
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
  const unresolved: Diagnostic[] = [];

  for (const node of document.nodes as ProjectNode[]) {
    const id = moduleId(node);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (builtinNodeRegistration(id)) {
      deterministic.add(id);
      continue;
    }
    const resolved = await projectModuleFile(projectRoot, node, id);
    const moduleFile = resolved.file;
    if (!moduleFile) {
      unresolved.push(unresolvedModule(id, node, resolved.tried, projectRoot));
      registrations.push(savedRegistration(id, node));
      continue;
    }

    const source = await fs.readFile(moduleFile, 'utf8');
    const mentionsDefinition = /\bexport\s+const\s+definition\b/.test(source);
    const extracted = extractNodeDefinition(source, moduleFile, ts);
    if (!extracted.ok) {
      const reExport = reExportedDefinition(source);
      if (reExport) throw new Error(formatDiagnostic(reExport(moduleFile)));
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
  return { registrations, deterministic, unresolved };
}

/**
 * Where a project module lives, and — when it does not — every path that was
 * looked for.
 *
 * The paths are returned rather than discarded because `project.Multply` is
 * only obviously a typo once you can see it went looking for
 * `nodes/Multply/index.ts`. Reported by `unresolvedModule`; requested by the
 * session converting the sketches, which is the one that reads these.
 */
async function projectModuleFile(
  root: string,
  node: ProjectNode,
  id: string,
): Promise<{ file: string | null; tried: string[] }> {
  const tried: string[] = [];
  const source = node.source;
  if (source && typeof source === 'object' && (source as any).type === 'project' && typeof (source as any).file === 'string') {
    const candidate = path.resolve(root, (source as any).file);
    if (within(root, candidate)) {
      tried.push(candidate);
      if (await exists(candidate)) return { file: candidate, tried };
    }
  }
  if (!id.startsWith('project.')) return { file: null, tried };
  const name = id.slice('project.'.length);
  const candidate = path.resolve(root, 'nodes', name, 'index.ts');
  if (!within(root, candidate)) return { file: null, tried };
  tried.push(candidate);
  return { file: (await exists(candidate)) ? candidate : null, tried };
}

/**
 * A module trying to get its definition from somewhere else, which cannot work.
 *
 * **A re-export cannot carry a `definition`.** Measured, not assumed:
 * `export { definition } from`, `export * from` and an import-then-export all
 * give `definition/missing-export`, and aliasing an imported literal gives
 * `definition/non-literal`. Only a literal in the file itself extracts,
 * because the shape is read statically from this one source — which is the
 * whole point of definition-v1 and the reason `cascade check` can say anything
 * about a node without cooking it.
 *
 * The reason this needs its own diagnostic is that the failure was **silent
 * and total**. A converted node reached through a stub fell into the legacy
 * fallback below, and then: `inspect` reported `classification: "dynamic"` for
 * a definition-v1 node, `validate` passed without a word, and `run` returned
 * `false` and did nothing at all. Every command reported success while the
 * node quietly was not the thing it had just been converted into.
 *
 * A stub re-exporting only `execute` is left alone, because that is the
 * legitimate shape in use today — `cloud-plots` reaches shared nodes that way
 * (a stub rather than a symlink, because `readdir` does not report a symlinked
 * directory as one) and it restates `icon` and `runsOn` locally for exactly
 * this reason. Its own comment states the rule this diagnostic enforces:
 * anything read by a static pass over the file cannot be re-exported. A
 * `definition` is now the third such thing, and the loudest.
 */
function reExportedDefinition(source: string): ((file: string) => Diagnostic) | null {
  const named = /\bexport\s*\{[^}]*\bdefinition\b[^}]*\}\s*from\s*['"]/.test(source);
  const star = /\bexport\s*\*\s*from\s*['"]/.test(source);
  if (!named && !star) return null;
  const what = named
    ? 'this module re-exports `definition` from another file'
    : 'this module has a star re-export and no `definition` of its own';
  return (file) => ({
    phase: 'prepare',
    code: 'definition/re-exported',
    file,
    message: `${what}, and a definition cannot arrive that way — it is read statically from this file. Write the literal here, or keep the stub for \`execute\` only and leave this module dynamic. Without this the node loads as dynamic and every command reports success.`,
  });
}

/**
 * A node naming a module with no file, reported rather than swallowed.
 *
 * `prepare` falls back to a definition synthesised from the ports the document
 * itself saved, which is what keeps a legacy node loadable — and it is also
 * what let `cascade.geo.Circel` validate clean. The fallback stays; the silence
 * does not.
 *
 * It is a warning and not an error, on the ground that decides it: a node with
 * no module file can never run through the deterministic runtime anyway. Its
 * `loadExecute` throws by design and a mixed graph is refused outright, so
 * saying so is never a false alarm — it is only sometimes unwelcome.
 *
 * It was briefly fatal, gated by an allowlist of known legacy module names, and
 * Marcus reverted that on 2026-09-08. The evidence: converting sixty-two nodes
 * across four sketches means working in mixed graphs all day, and as an error
 * an unconverted sketch stops validating at all — which is the one thing you
 * need while converting it. An allowlist of retired module names is also the
 * "configuration that exists only until the cutover finishes" cost, paid as a
 * hardcoded set in core. Both go; the whole warning goes when the dynamic path
 * does.
 */
function unresolvedModule(id: string, node: ProjectNode, tried: readonly string[], root: string): Diagnostic {
  const relative = tried.map((candidate) => path.relative(root, candidate) || candidate);
  const where = relative.length
    ? `looked for ${relative.join(' and ')}`
    : `no project file is possible for this module id — a project module is named "project.<dir>" or carries a source file`;
  return {
    phase: 'prepare',
    code: 'project/module-not-found',
    path: node.id,
    message: `${id} has no module file — ${where}. Only known legacy modules can use saved-port compatibility, for inspection only; unknown and explicit project modules are rejected`,
  };
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
  // Only the input names, because outputs have their own namespace now: a prop
  // and an output may share a name and dropping the prop for that would be
  // silent data loss. Inputs and props still share one, so a prop colliding
  // there is the one that has to go.
  const used = new Set(Object.keys(inputs));
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
