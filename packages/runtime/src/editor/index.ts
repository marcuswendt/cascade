/**
 * Published parameters, export subgraphs and scene files.
 *
 * Pure functions over a `CascadeDocument`, shared by `cascade export`, the
 * exported editor and Studio, so the three agree on what a scene means. Nothing
 * here touches a filesystem, a DOM or a network; hosts supply files.
 */
import {
  SCENE_EMBED_LIMIT,
  type CascadeDocument,
  type CascadeDocumentConnection,
  type CascadeDocumentNode,
  type CascadeScene,
  type EditorDeclaration,
  type JsonValue,
  type PublishedParameter,
  type SceneFile,
  type VisibleWhen,
} from "@cascade/contracts";

export interface EditorDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
}

export const SCENE_FORMAT = "cascade.scene";

/** Web platform globals present in browsers and Node 22, typed here because the runtime builds without DOM types. */
const platform = globalThis as unknown as {
  btoa(text: string): string;
  atob(text: string): string;
  crypto: { subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
};

/** Node ids at both ends of a connection, in either document spelling. */
export function connectionEnds(connection: CascadeDocumentConnection): {
  source: string;
  sourcePort?: string;
  target: string;
  targetPort?: string;
} {
  if (Array.isArray(connection)) {
    const [source, target] = connection as readonly [readonly [string, number, string?], readonly [string, number, string?]];
    return { source: source[0], sourcePort: source[2], target: target[0], targetPort: target[2] };
  }
  const object = connection as Exclude<CascadeDocumentConnection, readonly unknown[]>;
  return {
    source: object.source.nodeId,
    sourcePort: object.source.outputName,
    target: object.target.nodeId,
    targetPort: object.target.inputName,
  };
}

/** The editor declaration, or an error saying the graph has none. */
export function requireEditor(document: CascadeDocument): EditorDeclaration {
  const editor = document.editor;
  if (!editor || typeof editor !== "object" || typeof editor.id !== "string" || !editor.id)
    throw new Error('This graph declares no editor. Add an "editor" section with an id (see doc/EDITOR_EXPORT.md).');
  return editor;
}

/** Static checks of the declaration against the document's own nodes. */
export function validateEditor(document: CascadeDocument): EditorDiagnostic[] {
  const out: EditorDiagnostic[] = [];
  const error = (code: string, message: string) => out.push({ severity: "error", code, message });
  const warn = (code: string, message: string) => out.push({ severity: "warning", code, message });
  const editor = document.editor;
  if (!editor) return [{ severity: "error", code: "editor/missing", message: "The graph has no editor section" }];
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(editor.id ?? ""))
    error("editor/id", `editor.id must be a plain identifier, got ${JSON.stringify(editor.id)}`);
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const ids = new Set<string>();
  for (const parameter of editor.parameters ?? []) {
    if (ids.has(parameter.id)) error("editor/duplicate-parameter", `Parameter id ${parameter.id} is used twice`);
    ids.add(parameter.id);
    if (!nodes.has(parameter.node))
      error("editor/parameter-node", `Parameter ${parameter.id} targets missing node ${parameter.node}`);
  }
  for (const parameter of editor.parameters ?? [])
    for (const condition of conditionsOf(parameter))
      if (!ids.has(condition.param))
        warn("editor/visible-when", `Parameter ${parameter.id} is shown when unknown parameter ${condition.param} matches`);
  const outputIds = new Set<string>();
  let views = 0;
  for (const output of editor.outputs ?? []) {
    if (outputIds.has(output.id)) error("editor/duplicate-output", `Output id ${output.id} is used twice`);
    outputIds.add(output.id);
    if (!nodes.has(output.node)) error("editor/output-node", `Output ${output.id} reads missing node ${output.node}`);
    if (output.view) views++;
    for (const id of output.parameters ?? [])
      if (!ids.has(id)) error("editor/output-parameter", `Output ${output.id} shows unknown parameter ${id}`);
  }
  if (!(editor.outputs ?? []).length) error("editor/no-outputs", "The editor declares no outputs");
  if (views > 1) warn("editor/views", "More than one output sets view; the first is shown");
  for (const preset of editor.presets ?? [])
    for (const key of Object.keys(preset.values ?? {}))
      if (!ids.has(key)) warn("editor/preset-parameter", `Preset ${preset.id} sets unknown parameter ${key}`);
  for (const id of editor.peek ?? [])
    if (!ids.has(id)) warn("editor/peek-parameter", `peek names unknown parameter ${id}`);
  for (const id of Object.keys(editor.draft ?? {}))
    if (!ids.has(id)) warn("editor/draft-parameter", `draft sets unknown parameter ${id}`);
  for (const frozen of editor.freeze ?? [])
    if (!nodes.has(frozen.node)) error("editor/freeze-node", `Frozen source ${frozen.node} is not in the graph`);
  return out;
}

/**
 * The nodes an export ships: everything the published outputs and parameters
 * depend on, and nothing else. Frozen sources are kept as leaves, so nothing
 * upstream of one is reached. A node inside a subnet brings its ancestors; a
 * subnet brings its contents, which define what its ports carry.
 */
export function selectEditorSubgraph(document: CascadeDocument): Set<string> {
  const editor = requireEditor(document);
  const frozen = new Set((editor.freeze ?? []).map((item) => item.node));
  const children = new Map<string, string[]>();
  const parents = new Map<string, string>();
  for (const node of document.nodes) {
    if (!node.parent) continue;
    parents.set(node.id, node.parent);
    children.set(node.parent, [...(children.get(node.parent) ?? []), node.id]);
  }
  const upstream = new Map<string, string[]>();
  for (const connection of document.connections ?? []) {
    const { source, target } = connectionEnds(connection);
    upstream.set(target, [...(upstream.get(target) ?? []), source]);
  }
  const known = new Set(document.nodes.map((node) => node.id));
  const selected = new Set<string>();
  const queue = [
    ...(editor.outputs ?? []).map((output) => output.node),
    ...(editor.parameters ?? []).map((parameter) => parameter.node),
  ].filter((id) => known.has(id));
  while (queue.length) {
    const id = queue.pop()!;
    if (selected.has(id)) continue;
    selected.add(id);
    const parent = parents.get(id);
    if (parent) queue.push(parent);
    if (frozen.has(id)) continue;
    queue.push(...(children.get(id) ?? []), ...(upstream.get(id) ?? []));
  }
  return selected;
}

/**
 * The compatibility version a scene records: the editor's id, its parameter
 * interface and the structure of the exported subgraph. Values are left out,
 * so tuning a prop in Studio does not orphan the scenes made against it, while
 * rewiring or renaming a published parameter does.
 */
export function editorGraphVersion(document: CascadeDocument): string {
  const editor = requireEditor(document);
  const selected = selectEditorSubgraph(document);
  const frozen = new Set((editor.freeze ?? []).map((item) => item.node));
  const nodes = document.nodes
    .filter((node) => selected.has(node.id))
    .map((node) => [node.id, frozen.has(node.id) ? "frozen" : moduleOf(node), node.parent ?? ""])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const connections = (document.connections ?? [])
    .map(connectionEnds)
    .filter((end) => selected.has(end.source) && selected.has(end.target) && !frozen.has(end.target))
    // A frozen source's port is renamed when it is replaced, so it does not count.
    .map((end) => `${end.source}.${frozen.has(end.source) ? "" : end.sourcePort ?? ""}>${end.target}.${end.targetPort ?? ""}`)
    .sort();
  const parameters = (editor.parameters ?? [])
    .map((parameter) => [parameter.id, parameter.node, parameter.prop, controlOf(parameter)])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return `h${hash(JSON.stringify([editor.id, parameters, nodes, connections]))}`;
}

/** The value a published parameter currently holds in the document. */
export function publishedValues(document: CascadeDocument): Record<string, JsonValue | undefined> {
  const editor = requireEditor(document);
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const values: Record<string, JsonValue | undefined> = {};
  for (const parameter of editor.parameters ?? []) {
    const stored = propsOf(nodes.get(parameter.node))[parameter.prop];
    values[parameter.id] = (isBinding(stored) ? stored.value : stored) as JsonValue | undefined;
  }
  return values;
}

export interface CreateSceneOptions {
  readonly name?: string;
  /** Values to record; parameters not given take the document's current value. */
  readonly values?: Readonly<Record<string, JsonValue | undefined>>;
  readonly files?: Readonly<Record<string, SceneFile>>;
  readonly savedAt?: string;
}

/** A scene holding published values only: no props, nodes or project data. */
export function createScene(document: CascadeDocument, options: CreateSceneOptions = {}): CascadeScene {
  const editor = requireEditor(document);
  const current = publishedValues(document);
  const values: Record<string, JsonValue> = {};
  const files: Record<string, SceneFile> = {};
  for (const parameter of editor.parameters ?? []) {
    if (controlOf(parameter) === "file") {
      const file = options.files?.[parameter.id];
      if (file) files[parameter.id] = parameter.embed === "never" ? withoutData(file) : file;
      continue;
    }
    const value = options.values && parameter.id in options.values ? options.values[parameter.id] : current[parameter.id];
    if (value !== undefined) values[parameter.id] = value;
  }
  return {
    format: SCENE_FORMAT,
    version: 1,
    graph: { id: editor.id, version: editorGraphVersion(document) },
    ...(options.name ? { name: options.name } : {}),
    values,
    ...(Object.keys(files).length ? { files } : {}),
    ...(options.savedAt ? { savedAt: options.savedAt } : {}),
  };
}

/** Parse and shape-check a scene file. Throws on anything that is not one. */
export function parseScene(input: unknown): CascadeScene {
  const value = typeof input === "string" ? JSON.parse(input) : input;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A scene must be a JSON object");
  const scene = value as Partial<CascadeScene>;
  if (scene.format !== SCENE_FORMAT) throw new Error(`Not a Cascade scene (format ${JSON.stringify(scene.format)})`);
  if (scene.version !== 1) throw new Error(`Unsupported scene version ${JSON.stringify(scene.version)}`);
  if (!scene.graph || typeof scene.graph.id !== "string") throw new Error("A scene must name its graph");
  if (!scene.values || typeof scene.values !== "object" || Array.isArray(scene.values))
    throw new Error("A scene must carry a values object");
  for (const [id, file] of Object.entries(scene.files ?? {})) {
    if (!file || typeof file.name !== "string" || typeof file.sha256 !== "string" || typeof file.size !== "number")
      throw new Error(`Scene file ${id} needs a name, a size and a sha256`);
    if (file.data !== undefined && typeof file.data !== "string") throw new Error(`Scene file ${id} data must be base64`);
  }
  return scene as CascadeScene;
}

export interface ApplySceneOptions {
  /**
   * Turn a scene file into the prop value the host can read (an asset ref).
   * Undefined keeps the document's value and reports why.
   */
  readonly resolveFile?: (parameter: PublishedParameter, file: SceneFile) => JsonValue | undefined;
}

export interface AppliedScene {
  readonly document: CascadeDocument;
  /** Published id to the value now in the document, after coercion. */
  readonly values: Readonly<Record<string, JsonValue | undefined>>;
  readonly warnings: readonly string[];
}

export interface ResolvedScene {
  /** Coerced values for the parameters the scene sets, file parameters excluded. */
  readonly values: Readonly<Record<string, JsonValue>>;
  /** Files the scene carries for known file parameters. */
  readonly files: Readonly<Record<string, SceneFile>>;
  readonly warnings: readonly string[];
}

/**
 * What a scene means for this document, before anything is written.
 *
 * Degrades rather than refuses: another graph id or version is a warning,
 * unknown parameters are ignored with a warning, a value of the wrong kind is
 * skipped with a warning, and parameters the scene does not mention are left
 * out, so they keep the graph's default.
 */
export function resolveScene(document: CascadeDocument, sceneInput: CascadeScene | unknown): ResolvedScene {
  const scene = parseScene(sceneInput);
  const editor = requireEditor(document);
  const warnings: string[] = [];
  if (scene.graph.id !== editor.id)
    warnings.push(`Scene was made for "${scene.graph.id}", not "${editor.id}"; matching parameters are applied`);
  else if (scene.graph.version && scene.graph.version !== editorGraphVersion(document))
    warnings.push("Scene was saved against another version of this graph; matching parameters are applied");
  const parameters = new Map((editor.parameters ?? []).map((parameter) => [parameter.id, parameter]));
  for (const id of Object.keys(scene.values))
    if (!parameters.has(id)) warnings.push(`Unknown parameter "${id}" ignored`);
  for (const id of Object.keys(scene.files ?? {}))
    if (!parameters.has(id)) warnings.push(`Unknown file parameter "${id}" ignored`);
  const current = publishedValues(document);
  const values: Record<string, JsonValue> = {};
  const files: Record<string, SceneFile> = {};
  for (const parameter of parameters.values()) {
    if (controlOf(parameter, current[parameter.id]) === "file") {
      const file = scene.files?.[parameter.id];
      if (file) files[parameter.id] = file;
      continue;
    }
    if (!(parameter.id in scene.values)) continue;
    const coerced = coerceValue(parameter, scene.values[parameter.id], current[parameter.id]);
    if (coerced.warning) warnings.push(coerced.warning);
    if (coerced.value !== undefined) values[parameter.id] = coerced.value;
  }
  return { values, files, warnings };
}

/** Write a scene into a copy of the document, by the rules of `resolveScene`. */
export function applyScene(
  document: CascadeDocument,
  sceneInput: CascadeScene | unknown,
  options: ApplySceneOptions = {},
): AppliedScene {
  const editor = requireEditor(document);
  const resolved = resolveScene(document, sceneInput);
  const warnings = [...resolved.warnings];
  const updates: Record<string, JsonValue> = { ...resolved.values };
  for (const parameter of editor.parameters ?? []) {
    const file = resolved.files[parameter.id];
    if (!file) continue;
    const value = options.resolveFile?.(parameter, file);
    if (value === undefined) warnings.push(`${labelOf(parameter)}: "${file.name}" is not available here; the graph's file is kept`);
    else updates[parameter.id] = value;
  }
  const result = setPublishedValues(document, updates);
  return { document: result, values: publishedValues(result), warnings };
}

/** A copy of the document with published parameters set by id. Unknown ids are ignored. */
export function setPublishedValues(
  document: CascadeDocument,
  updates: Readonly<Record<string, JsonValue | undefined>>,
): CascadeDocument {
  const editor = requireEditor(document);
  const writes = new Map<string, Record<string, unknown>>();
  for (const parameter of editor.parameters ?? []) {
    if (!(parameter.id in updates) || updates[parameter.id] === undefined) continue;
    const props = writes.get(parameter.node) ?? {};
    props[parameter.prop] = updates[parameter.id];
    writes.set(parameter.node, props);
  }
  const nodes = document.nodes.map((node) => {
    const props = writes.get(node.id);
    if (!props) return node;
    const merged: Record<string, unknown> = { ...propsOf(node) };
    for (const [name, value] of Object.entries(props)) {
      const stored = merged[name];
      merged[name] = isBinding(stored) ? { ...stored, value } : value;
    }
    return { ...node, props: merged } as CascadeDocumentNode;
  });
  return { ...document, nodes };
}

/** A parameter's visibility conditions as a list. */
export function conditionsOf(parameter: PublishedParameter): readonly VisibleWhen[] {
  const condition = parameter.visibleWhen;
  if (!condition) return [];
  return Array.isArray(condition) ? condition : [condition as VisibleWhen];
}

/** Whether a parameter is shown, given every parameter's current value. */
export function isVisible(parameter: PublishedParameter, values: Readonly<Record<string, unknown>>): boolean {
  return conditionsOf(parameter).every((condition) => {
    const value = values[condition.param];
    if (condition.in && !condition.in.some((item) => Object.is(item, value))) return false;
    if (condition.not && condition.not.some((item) => Object.is(item, value))) return false;
    if ("equals" in condition && !Object.is(condition.equals, value)) return false;
    return true;
  });
}

/** Coerce a scene value to what the parameter's control accepts. */
export function coerceValue(
  parameter: PublishedParameter,
  value: unknown,
  current?: unknown,
): { value?: JsonValue; warning?: string } {
  const label = labelOf(parameter);
  const reject = (what: string) => ({ warning: `${label}: ${what}; kept the graph's value` });
  if (value === undefined) return {};
  const control = controlOf(parameter, current);
  switch (control) {
    case "number":
    case "slider":
      return typeof value === "number" && Number.isFinite(value) ? { value } : reject("expected a number");
    case "int":
    case "seed":
      return typeof value === "number" && Number.isFinite(value) ? { value: Math.round(value) } : reject("expected a whole number");
    case "bool":
      return typeof value === "boolean" ? { value } : reject("expected true or false");
    case "text":
    case "textarea":
      return typeof value === "string" ? { value } : reject("expected text");
    case "select": {
      const options = (parameter.options ?? []).map((option) =>
        option !== null && typeof option === "object" && "value" in option ? option.value : option,
      );
      return options.some((option) => Object.is(option, value))
        ? { value: value as JsonValue }
        : reject(`${JSON.stringify(value)} is not one of its options`);
    }
    case "color":
      return typeof value === "string" || (Array.isArray(value) && value.every((part) => typeof part === "number"))
        ? { value: value as JsonValue }
        : reject("expected a colour");
    case "vec2":
      return Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === "number" && Number.isFinite(part))
        ? { value: value as JsonValue }
        : reject("expected two numbers");
    default:
      return { value: value as JsonValue };
  }
}

/**
 * The control a parameter shows: its declaration, else the prop's type when
 * the host knows it, else the shape of its current value.
 */
export function controlOf(parameter: PublishedParameter, current?: unknown, type?: string): string {
  if (parameter.control) return parameter.control;
  if (parameter.options?.length) return "select";
  const byType: Record<string, string> = {
    float: parameter.min !== undefined && parameter.max !== undefined ? "slider" : "number",
    int: "int", bool: "bool", string: "text", color: "color", vec2: "vec2", vec2i: "vec2", image: "file", asset: "file",
  };
  if (type && byType[type]) return byType[type];
  if (typeof current === "boolean") return "bool";
  if (typeof current === "string") return "text";
  if (Array.isArray(current) && current.length === 2) return "vec2";
  if (current && typeof current === "object" && "path" in current) return "file";
  return typeof current === "number" ? "number" : "any";
}

/** Build a scene file record; embeds bytes only when the parameter allows it. */
export async function sceneFile(
  parameter: PublishedParameter,
  bytes: Uint8Array,
  name: string,
  mediaType?: string,
): Promise<SceneFile> {
  const digest = await platform.crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const embed = parameter.embed !== "never" && bytes.byteLength <= SCENE_EMBED_LIMIT;
  return {
    name,
    ...(mediaType ? { mediaType } : {}),
    size: bytes.byteLength,
    sha256,
    ...(embed ? { data: toBase64(bytes) } : {}),
  };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return platform.btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = platform.atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function withoutData(file: SceneFile): SceneFile {
  const { data: _data, ...rest } = file;
  return rest;
}

function labelOf(parameter: PublishedParameter): string {
  return parameter.label ?? parameter.id;
}

function moduleOf(node: CascadeDocumentNode): string {
  return node.module ?? node.type ?? "";
}

function propsOf(node: CascadeDocumentNode | undefined): Record<string, unknown> {
  const props = node?.props;
  return props && typeof props === "object" ? (props as Record<string, unknown>) : {};
}

function isBinding(value: unknown): value is { value: unknown; expression?: string; channel?: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("value" in value)) return false;
  return Object.keys(value).every((key) => key === "value" || key === "expression" || key === "channel");
}

/** 64-bit FNV-1a, as 16 hex digits. A compatibility tag, not a security hash. */
function hash(text: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < text.length; index++) {
    h ^= BigInt(text.charCodeAt(index));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}
