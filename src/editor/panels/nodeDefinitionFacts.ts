/**
 * Where a node in the graph actually comes from, and what it declares.
 *
 * The Definition panel's data layer. Deliberately separate from the panel so
 * the awkward part — four different kinds of node, each of which knows its own
 * origin in a different place — is testable and stated once.
 *
 * The one rule throughout: a fact that cannot be determined is reported as
 * unknown, with the reason. Nothing here infers. A node classified `browser`
 * because nobody could read its declaration is exactly the fault this panel
 * exists to make visible, so guessing here would hide it.
 */
import type { Node, ParameterDeclaration } from '@/nodes/Node';
import type { NodeDefinition } from '../../../packages/contracts/src/index.js';
import { builtinNodeRegistration } from '../../../packages/runtime/src/builtins/index.js';
import { getNodeMetadata, isStandardLibraryNode, getLibraryIdFromType, typeToPackagePath } from '@/utils/nodeTypeUtils';
import { moduleName, type RunsOn } from '../stores/executionLocus';

export type NodeOrigin = 'core' | 'library' | 'project' | 'embedded' | 'unknown';

/**
 * Which node format supplies `execute`.
 *
 * `core-class` is neither of the two flavours: a Node subclass compiled into
 * Studio itself, with no definition literal and no dynamic module.
 */
export type NodeFlavour = 'definition-v1' | 'legacy-dynamic' | 'core-class' | 'unknown';

export interface DeclaredPort {
  name: string;
  kind: string;
  type: string | null;
  default?: unknown;
  description?: string;
}

export interface DefinitionFacts {
  /** The module id as the document stores it, e.g. `project.brand-orb`. */
  moduleId: string;
  /** The folder name for a project module — the key `/api/nodes` uses. */
  moduleFolder: string | null;
  origin: NodeOrigin;
  originLabel: string;
  libraryId: string | null;
  /** A path a human could open. Null when there is none to resolve. */
  path: string | null;
  pathNote: string | null;
  flavour: NodeFlavour;
  flavourNote: string | null;
  runsOn: RunsOn | null;
  runsOnNote: string | null;
  /** The icon the module declares. Null means it declares none, which leaves
   *  Cascade's own default in place — not the same as unknown. */
  icon: string | null;
  iconNote: string | null;
  definition: NodeDefinition | null;
  inputs: DeclaredPort[];
  outputs: DeclaredPort[];
  props: DeclaredPort[];
  /** Whether the module exports a legacy `execute(node, graph)`. Null = not read. */
  hasLegacyExecute: boolean | null;
  /** Things true of this node that explain confusing behaviour. */
  warnings: string[];
  /** A read that failed, verbatim. Not turned into a guess. */
  error: string | null;
}

const ORIGIN_LABELS: Record<NodeOrigin, string> = {
  core: 'Cascade core',
  library: 'Cascade library',
  project: 'Project module',
  embedded: 'Embedded in the graph',
  unknown: 'Unknown',
};

function emptyFacts(moduleId: string): DefinitionFacts {
  return {
    moduleId,
    moduleFolder: null,
    origin: 'unknown',
    originLabel: ORIGIN_LABELS.unknown,
    libraryId: null,
    path: null,
    pathNote: null,
    flavour: 'unknown',
    flavourNote: null,
    runsOn: null,
    runsOnNote: null,
    icon: null,
    iconNote: null,
    definition: null,
    inputs: [],
    outputs: [],
    props: [],
    hasLegacyExecute: null,
    warnings: [],
    error: null,
  };
}

/** The module id a node carries, or the best available stand-in. */
export function moduleIdOf(node: Node): string {
  const stored = (node as unknown as { modulePath?: unknown }).modulePath;
  if (typeof stored === 'string' && stored) return stored;
  return node.type.includes('.') ? node.type : typeToPackagePath(node.type);
}

/** The `source` the document records, when the node carries one. */
function sourceTypeOf(node: Node): string | null {
  const stored = (node as unknown as { sourceType?: unknown }).sourceType;
  return typeof stored === 'string' && stored ? stored : null;
}

function readPorts(
  section: Readonly<Record<string, Record<string, unknown>>> | undefined,
  isProp: boolean,
): DeclaredPort[] {
  if (!section) return [];
  return Object.entries(section).map(([name, raw]) => ({
    name,
    kind: isProp ? 'prop' : (typeof raw?.kind === 'string' ? raw.kind : 'data'),
    type: typeof raw?.type === 'string' ? raw.type : null,
    ...(raw && 'default' in raw ? { default: raw.default } : {}),
    ...(typeof raw?.description === 'string' ? { description: raw.description } : {}),
  }));
}

function applyDefinition(facts: DefinitionFacts, definition: NodeDefinition): void {
  facts.definition = definition;
  facts.flavour = 'definition-v1';
  const shape = definition as unknown as {
    icon?: unknown;
    runsOn?: unknown;
    inputs?: Readonly<Record<string, Record<string, unknown>>>;
    outputs?: Readonly<Record<string, Record<string, unknown>>>;
    props?: Readonly<Record<string, Record<string, unknown>>>;
  };
  facts.inputs = readPorts(shape.inputs, false);
  facts.outputs = readPorts(shape.outputs, false);
  facts.props = readPorts(shape.props, true);
  if (typeof shape.icon === 'string' && shape.icon) {
    facts.icon = shape.icon;
    facts.iconNote = null;
  } else {
    facts.icon = null;
    facts.iconNote = 'The definition declares no icon; Cascade’s default is used.';
  }
  if (shape.runsOn === 'portable' || shape.runsOn === 'server' || shape.runsOn === 'browser') {
    facts.runsOn = shape.runsOn;
    facts.runsOnNote = 'Declared in the definition.';
  }
}

/**
 * Compiled-module cache for the definition read.
 *
 * `loadProjectModule` cannot be reused for this: it throws when a module has no
 * `execute` export, and that is precisely the case being reported. So this
 * fetches and imports the same compiled bundle on its own, once per module.
 */
const compiledCache = new Map<string, Promise<{ definition: NodeDefinition | null; hasExecute: boolean }>>();

async function readCompiledModule(folder: string): Promise<{ definition: NodeDefinition | null; hasExecute: boolean }> {
  let cached = compiledCache.get(folder);
  if (cached) return cached;
  cached = (async () => {
    const response = await fetch(`/api/nodes/${encodeURIComponent(folder)}/compiled`);
    if (!response.ok) throw new Error((await response.text()) || `compile failed (${response.status})`);
    const code = await response.text();
    const inBrowser = typeof document !== 'undefined';
    const url = inBrowser
      ? URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
      : `data:text/javascript;base64,${btoa(code)}`;
    try {
      const mod = await import(/* @vite-ignore */ url);
      const definition = (mod?.definition ?? null) as NodeDefinition | null;
      return { definition, hasExecute: typeof mod?.execute === 'function' };
    } finally {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
  })();
  compiledCache.set(folder, cached);
  return cached;
}

/** Drop a module's cached read, for when the file-watcher says it changed. */
export function invalidateDefinitionFacts(folder: string): void {
  compiledCache.delete(folder);
  sourceCache.delete(folder);
  pathCache.delete(folder);
}

const sourceCache = new Map<string, Promise<string>>();
const pathCache = new Map<string, Promise<string | null>>();

function fetchSource(folder: string): Promise<string> {
  let cached = sourceCache.get(folder);
  if (!cached) {
    cached = fetch(`/api/nodes/${encodeURIComponent(folder)}/index.ts`).then(async (res) => {
      if (!res.ok) throw new Error((await res.text()) || `source unavailable (${res.status})`);
      return res.text();
    });
    sourceCache.set(folder, cached);
  }
  return cached;
}

function fetchPath(folder: string): Promise<string | null> {
  let cached = pathCache.get(folder);
  if (!cached) {
    cached = fetch(`/api/nodes/${encodeURIComponent(folder)}/path`)
      .then(async (res) => (res.ok ? ((await res.json())?.path ?? null) : null))
      .catch(() => null);
    pathCache.set(folder, cached);
  }
  return cached;
}

/**
 * Which flavour a piece of source is, read without running it.
 *
 * A regex over exports rather than an AST walk: `extractNodeDefinition` needs
 * the TypeScript compiler, which is not something to load into the page for a
 * side panel. So this answers only the question it can answer honestly — which
 * export spellings are present — and the declared shape comes from the compiled
 * module, where the values are real rather than parsed.
 */
export function classifySource(source: string): { flavour: NodeFlavour; hasLegacyExecute: boolean } {
  const hasDefinition = /export\s+(?:const|let|var)\s+definition\b/.test(source)
    || /export\s*\{[^}]*\bdefinition\b[^}]*\}/.test(source);
  const hasLegacyExecute = /export\s+(?:async\s+)?function\s+execute\b/.test(source)
    || /export\s+(?:const|let|var)\s+execute\b/.test(source)
    || /export\s*\{[^}]*\bexecute\b[^}]*\}/.test(source);
  if (hasDefinition) return { flavour: 'definition-v1', hasLegacyExecute };
  if (hasLegacyExecute) return { flavour: 'legacy-dynamic', hasLegacyExecute };
  return { flavour: 'unknown', hasLegacyExecute };
}

/**
 * Everything the Definition panel shows, for one node.
 *
 * Four paths, because a node's origin is recorded in four different places:
 * a built-in definition registry, the class/metadata registries, the project
 * server, or the document itself.
 */
export async function readDefinitionFacts(
  node: Node,
  runsOnByModule: Record<string, RunsOn> = {},
  iconByModule: Record<string, string> = {},
): Promise<DefinitionFacts> {
  const moduleId = moduleIdOf(node);
  const facts = emptyFacts(moduleId);
  const source = sourceTypeOf(node);

  // ---- Cascade's own built-ins -------------------------------------------
  if (isStandardLibraryNode(moduleId) || source === 'stdlib') {
    const libraryId = getLibraryIdFromType(moduleId);
    facts.libraryId = libraryId;
    // `cascade.core.*` is the structure of a graph; every other reserved
    // namespace is a library shipped with Cascade (see the geo namespace note).
    facts.origin = libraryId === 'core' ? 'core' : 'library';
    facts.originLabel = ORIGIN_LABELS[facts.origin];
    facts.path = null;
    facts.pathNote = 'Compiled into Studio. No project path to resolve.';
    facts.runsOnNote = 'The server reports runsOn for project modules only.';

    const registration = builtinNodeRegistration(moduleId);
    if (registration) {
      applyDefinition(facts, registration.definition);
      facts.hasLegacyExecute = false;
      facts.flavourNote = 'Registered through the definition-v1 adapter (registerDefinitionNodes).';
    } else {
      facts.flavour = 'core-class';
      facts.flavourNote = 'A Node subclass compiled into Studio — neither definition-v1 nor a legacy dynamic module.';
      const metadata = getNodeMetadata(moduleId);
      facts.icon = metadata?.icon ?? null;
      facts.iconNote = metadata?.icon ? null : 'No icon in the node metadata registry.';
    }
    return facts;
  }

  // ---- Embedded in the .cascade document ---------------------------------
  if (moduleId.startsWith('local.') || source === 'embedded') {
    facts.origin = 'embedded';
    facts.originLabel = ORIGIN_LABELS.embedded;
    facts.path = null;
    facts.pathNote = 'The code lives in the graph document, not in a file.';
    facts.runsOnNote = 'Not reported: runsOn comes from the project server, which does not see embedded code.';
    facts.iconNote = 'Embedded code declares no icon.';
    if (node.code) {
      const classified = classifySource(node.code);
      facts.flavour = classified.flavour;
      facts.hasLegacyExecute = classified.hasLegacyExecute;
      if (classified.flavour === 'definition-v1' && !classified.hasLegacyExecute) {
        facts.warnings.push('Definition-v1 with no execute(node, graph) export. Studio cooks embedded code through the compatibility engine, which needs that export, so this node will not cook here.');
      }
      if (classified.flavour === 'unknown') {
        facts.flavourNote = 'Neither a definition nor an execute export was found in the embedded code.';
      }
    } else {
      facts.flavourNote = 'The node carries no code, so its flavour cannot be read.';
    }
    return facts;
  }

  // ---- A project module served by the Cascade server ---------------------
  if (moduleId.startsWith('project.') || source === 'project') {
    const folder = moduleName(moduleId);
    facts.origin = 'project';
    facts.originLabel = ORIGIN_LABELS.project;
    facts.moduleFolder = folder;
    if (!folder) {
      facts.error = 'The module id carries no folder name.';
      return facts;
    }

    const declaredRunsOn = runsOnByModule[folder];
    if (declaredRunsOn) {
      facts.runsOn = declaredRunsOn;
      facts.runsOnNote = 'From GET /api/nodes — declared, or inferred by the server when not declared.';
    } else {
      facts.runsOnNote = 'GET /api/nodes did not list this module. Either no server is serving this project, or it serves a different one.';
    }
    const declaredIcon = iconByModule[folder];
    if (declaredIcon) facts.icon = declaredIcon;

    facts.path = await fetchPath(folder);
    if (!facts.path) facts.pathNote = 'GET /api/nodes/<module>/path did not answer.';

    try {
      const text = await fetchSource(folder);
      const classified = classifySource(text);
      facts.flavour = classified.flavour;
      facts.hasLegacyExecute = classified.hasLegacyExecute;
      if (classified.flavour === 'unknown') {
        facts.flavourNote = 'Neither a definition nor an execute export was found in index.ts.';
      }
    } catch (err) {
      facts.error = String(err instanceof Error ? err.message : err);
      return facts;
    }

    if (facts.flavour === 'definition-v1') {
      try {
        const compiled = await readCompiledModule(folder);
        facts.hasLegacyExecute = compiled.hasExecute;
        if (compiled.definition) {
          applyDefinition(facts, compiled.definition);
          if (declaredRunsOn && facts.runsOn !== declaredRunsOn) {
            facts.warnings.push(`The definition declares runsOn "${facts.runsOn}" but the server reports "${declaredRunsOn}".`);
          }
          if (declaredIcon) facts.icon = declaredIcon;
        } else {
          facts.flavourNote = 'index.ts exports a definition, but the compiled module has no definition export to read.';
        }
      } catch (err) {
        facts.error = String(err instanceof Error ? err.message : err);
      }
      if (facts.hasLegacyExecute === false) {
        facts.warnings.push('Definition-v1 with no execute(node, graph) export. Studio cooks project nodes through the compatibility engine, which requires that export, so this node does not run in Studio — it runs under `cascade run`.');
      }
    }
    return facts;
  }

  facts.error = `Unrecognised module id "${moduleId}" — no origin could be determined from the document.`;
  return facts;
}

/**
 * The declared parameter set, in the shape `Graph.retargetDefinition` wants.
 *
 * Its `options.parameters` note says the synchronous path is available when the
 * incoming definition's declarations are known and that "a Definition panel has
 * them" — this is that hand-off. Inputs and props share one namespace on a
 * compatibility-engine node, so both are emitted; a trigger input carries no
 * value and is skipped.
 *
 * Returns an empty array for a legacy dynamic module, which declares nothing
 * until it cooks. That is the `deferred: true` case on the other side, and an
 * empty list is the honest input to it rather than a fabricated one.
 */
export function parameterDeclarations(facts: DefinitionFacts): ParameterDeclaration[] {
  const fromPorts = (ports: DeclaredPort[], kind: 'parameter' | 'prop'): ParameterDeclaration[] =>
    ports
      .filter((port) => port.kind !== 'trigger')
      .map((port) => ({
        name: port.name,
        ...(port.type ? { type: port.type } : {}),
        ...('default' in port ? { defaultValue: port.default } : {}),
        kind,
      }));
  return [...fromPorts(facts.inputs, 'parameter'), ...fromPorts(facts.props, 'prop')];
}
