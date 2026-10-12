/**
 * Editing a `.cascade` file on disk: the host half of the graph editor.
 *
 * `packages/runtime/src/edit` edits a parsed document in memory. This reads
 * the file, gives the editor the node definitions it needs, refuses an edit
 * that `cascade check` would reject, and writes the result back atomically in
 * the file's own formatting — so the diff is the edit and nothing else.
 *
 *     const graph = await openGraph('index.cascade');
 *     await graph.apply({ op: 'node.add', module: 'cascade.geo.Circle', id: 'dot' });
 *     await graph.apply({ op: 'connect', from: 'dot.geometry', to: 'render.scene' });
 *     await graph.save();
 *
 * The CLI's editing commands and the MCP server's tools both go through this,
 * one operation at a time or as a batch, so they behave identically.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { NodeDefinition } from '../../packages/contracts/src/index.js';
import {
  GraphEditor,
  GraphEditError,
  applyOperation,
  type EditableDocument,
  type GraphEditOperation,
} from '../../packages/runtime/src/edit/index.js';
import { formatCompactJSON } from '../../server/src/formatCascadeJson.js';
import { builtinModuleIds, diagnoseGraph, moduleDefinitions } from './projectRuntime.js';
import { mergeLines } from './lineMerge.js';

/**
 * How a file is laid out, detected by re-serialising it and comparing bytes.
 * Studio writes compact arrays (`[x, y]` on one line); a script using
 * `json.dump(indent=2)` writes plain indentation and escapes non-ASCII. The
 * editor writes back in whichever produced the file, because reformatting a
 * whole graph to change one value is exactly the churn this exists to avoid.
 */
interface FileStyle {
  readonly name: 'studio' | 'plain';
  readonly asciiOnly: boolean;
  readonly trailingNewline: boolean;
}

const STYLES: readonly FileStyle[] = [
  { name: 'studio', asciiOnly: false, trailingNewline: false },
  { name: 'studio', asciiOnly: false, trailingNewline: true },
  { name: 'plain', asciiOnly: false, trailingNewline: false },
  { name: 'plain', asciiOnly: false, trailingNewline: true },
  { name: 'plain', asciiOnly: true, trailingNewline: false },
  { name: 'plain', asciiOnly: true, trailingNewline: true },
  { name: 'studio', asciiOnly: true, trailingNewline: false },
  { name: 'studio', asciiOnly: true, trailingNewline: true },
];

export function serializeGraph(document: unknown, style: FileStyle): string {
  let text = JSON.stringify(document, null, 2);
  if (style.name === 'studio') text = formatCompactJSON(text, 2);
  if (style.asciiOnly) text = text.replace(/[\u007f-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return style.trailingNewline ? `${text}\n` : text;
}

export function detectStyle(text: string, document: unknown): FileStyle | null {
  return STYLES.find((style) => serializeGraph(document, style) === text) ?? null;
}

/**
 * How an edited document is written back over `original`.
 *
 * `exact`: a style reproduces the file byte for byte, so the edit is written
 * in it. `aligned`: none does, but one matches line for line (the usual case:
 * Python's `1.0` against JavaScript's `1`), so untouched lines are carried
 * over from the original text (`lineMerge.ts`). `rewrite`: the file is laid
 * out some other way and is rewritten in Studio's format, with a warning.
 */
type WriteMode =
  | { readonly kind: 'exact' | 'aligned'; readonly style: FileStyle }
  | { readonly kind: 'rewrite'; readonly style: FileStyle };

function writeModeFor(text: string, document: unknown): WriteMode {
  const exact = detectStyle(text, document);
  if (exact) return { kind: 'exact', style: exact };
  const lines = text.split('\n');
  let best: { style: FileStyle; differing: number } | null = null;
  for (const style of STYLES) {
    const candidate = serializeGraph(document, style).split('\n');
    if (candidate.length !== lines.length) continue;
    const differing = candidate.filter((line, index) => line !== lines[index]).length;
    if (!best || differing < best.differing) best = { style, differing };
  }
  return best ? { kind: 'aligned', style: best.style } : { kind: 'rewrite', style: STYLES[1]! };
}

export interface EditOutcome {
  readonly results: Record<string, unknown>[];
  readonly warnings: string[];
  readonly changed: boolean;
}

export class GraphFile {
  private readonly definitions = new Map<string, NodeDefinition | undefined>();
  private readonly results: Record<string, unknown>[] = [];
  readonly warnings: string[] = [];
  readonly editor: GraphEditor;

  private constructor(
    readonly file: string,
    private readonly original: string,
    readonly document: EditableDocument,
    private readonly mode: WriteMode,
  ) {
    this.editor = new GraphEditor(document, { definitionOf: (id) => this.definitions.get(id) });
  }

  static async open(file: string): Promise<GraphFile> {
    const resolved = path.resolve(file);
    let text: string;
    try {
      text = await fs.readFile(resolved, 'utf8');
    } catch {
      throw new GraphEditError(`No graph at ${resolved}; create one with "cascade graph create ${file}"`);
    }
    let document: EditableDocument;
    try {
      document = JSON.parse(text);
    } catch (error) {
      throw new GraphEditError(`${resolved} is not valid JSON: ${error instanceof Error ? error.message : error}`);
    }
    const mode = writeModeFor(text, document);
    const graph = new GraphFile(resolved, text, document, mode);
    if (mode.kind === 'rewrite') {
      graph.warnings.push(`${path.basename(resolved)} is not in a formatting the editor reproduces exactly; it will be rewritten in Studio's format on save`);
    }
    await graph.loadDefinitions(document.nodes.map((node) => String(node.module ?? node.type ?? '')));
    return graph;
  }

  /** A new, empty graph file. Refuses to overwrite one that exists. */
  static async create(file: string, options: { name?: string } = {}): Promise<string> {
    const resolved = path.resolve(file);
    if (!resolved.endsWith('.cascade')) throw new GraphEditError(`A graph file ends in .cascade: ${file}`);
    const document = {
      version: '0.2',
      metadata: { name: options.name ?? path.basename(resolved, '.cascade') },
      nodes: [],
    };
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    try {
      await fs.writeFile(resolved, serializeGraph(document, STYLES[1]!), { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new GraphEditError(`${resolved} already exists`);
      throw error;
    }
    return resolved;
  }

  /** Apply one operation. Nothing is written until `save`. */
  async apply(operation: GraphEditOperation): Promise<Record<string, unknown>> {
    if (operation.op === 'node.add') {
      const module = await this.resolveModule(operation.module);
      operation = { ...operation, module };
    }
    const before = this.editor.warnings.length;
    const result = { op: operation.op, ...applyOperation(this.editor, operation) };
    this.warnings.push(...this.editor.warnings.slice(before));
    this.results.push(result);
    return result;
  }

  /** Apply a batch. All or nothing: a failing operation leaves the file untouched. */
  async applyAll(operations: readonly GraphEditOperation[], options: { dryRun?: boolean } = {}): Promise<EditOutcome> {
    for (const [index, operation] of operations.entries()) {
      try {
        await this.apply(operation);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new GraphEditError(operations.length > 1 ? `Operation ${index + 1} (${operation.op}): ${message}` : message);
      }
    }
    return this.save(options);
  }

  /**
   * Validate and write. The edited graph is checked with the same code as
   * `cascade check`, and refused if that finds a problem the original did not
   * have — a graph that was already failing can still be repaired one edit at
   * a time. The write is atomic, and refused if the file changed on disk since
   * it was read (Studio saving, or another agent). `dryRun` validates and
   * writes nothing.
   */
  async save(options: { dryRun?: boolean } = {}): Promise<EditOutcome> {
    const text = this.serialize();
    const changed = text !== this.original;
    if (changed) {
      const [before, after] = await Promise.all([
        diagnoseGraph(this.file, JSON.parse(this.original)),
        diagnoseGraph(this.file, this.document),
      ]);
      const introduced = after.errors.filter((error) => !before.errors.includes(error));
      if (introduced.length) {
        throw new GraphEditError(`The edit was not saved; the graph would fail "cascade check":\n${introduced.map((error) => `  ${error}`).join('\n')}`);
      }
      this.warnings.push(...after.warnings.filter((warning) => !before.warnings.includes(warning)));
      if (!options.dryRun) await this.writeAtomically(text);
    }
    return { results: this.results, warnings: [...new Set(this.warnings)], changed };
  }

  private serialize(): string {
    const text = serializeGraph(this.document, this.mode.style);
    if (this.mode.kind !== 'aligned') return text;
    const before = serializeGraph(JSON.parse(this.original), this.mode.style).split('\n');
    const merged = mergeLines(this.original.split('\n'), before, text.split('\n'));
    return merged ? merged.join('\n') : text;
  }

  private async writeAtomically(text: string): Promise<void> {
    const current = await fs.readFile(this.file, 'utf8');
    if (current !== this.original) {
      throw new GraphEditError(`${this.file} changed on disk while it was being edited; nothing was written. Run the command again.`);
    }
    const temporary = `${this.file}.${process.pid}.tmp`;
    const { mode } = await fs.stat(this.file);
    await fs.writeFile(temporary, text, { mode });
    await fs.rename(temporary, this.file);
  }

  private async loadDefinitions(ids: readonly string[]): Promise<void> {
    const missing = ids.filter((id) => id && !this.definitions.has(id));
    if (!missing.length) return;
    for (const [id, definition] of await moduleDefinitions(this.file, missing)) this.definitions.set(id, definition);
  }

  /**
   * The module a `node add` names. A full id is used as given; a short name is
   * looked up as a project node (`nodes/<Name>/`) first, then as a built-in
   * (`Circle` is `cascade.geo.Circle`). A module with no static definition is
   * refused, because the editor could not check a single port or parameter on it.
   */
  private async resolveModule(name: string): Promise<string> {
    const candidates = name.includes('.')
      ? [name]
      : [`project.${name}`, ...builtinModuleIds().filter((id) => id.slice(id.lastIndexOf('.') + 1).toLowerCase() === name.toLowerCase())];
    await this.loadDefinitions(candidates);
    const found = candidates.filter((id) => this.definitions.get(id));
    if (found.length > 1 && !name.includes('.')) {
      throw new GraphEditError(`"${name}" is ambiguous: ${found.join(', ')}`);
    }
    if (found[0]) return found[0];
    const near = builtinModuleIds().filter((id) => id.toLowerCase().includes(name.toLowerCase().replace(/^.*\./, ''))).slice(0, 6);
    throw new GraphEditError(
      `No node type "${name}" with a static definition: not a built-in, and no nodes/${name.replace(/^project\./, '')}/index.ts exporting \`definition\` in ${path.dirname(this.file)}` +
      (near.length ? `. Similar: ${near.join(', ')}` : '. "cascade inspect" lists what a graph uses; doc/NODE_REFERENCE.md lists the built-ins'),
    );
  }
}

export const openGraph = (file: string) => GraphFile.open(file);
