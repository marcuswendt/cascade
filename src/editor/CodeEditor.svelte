<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { moduleDirectory, rewriteRelativeImports } from './moduleImports';
  import { monaco } from './monaco';
  import { compileAndExecute } from './utils/compileNodeCode';
  import type { Node } from '@/nodes/Node';
  import type { Graph } from '@/nodes/Graph';
  import PackageSearch from './PackageSearch.svelte';
  import type { PackageManager } from '@/engine/PackageManager';
  import Icon from './Icon.svelte';
  import { Clock, Check, XCircle, Copy, FileOutput, History, Lock, FolderOpen } from '@lucide/svelte';
  import { isStandardLibraryNode, typeToPackagePath, getNodeClass, getNodeSource } from '@/utils/nodeTypeUtils';
  import type { NodeSource, FileStatus } from '@/types/node.types';
  import { settingsStore } from './stores/settingsStore';
  import { monacoThemeFor } from './theme';
  import { resolvedTheme } from './themeController';

  // Node runtime type definitions for Monaco
  // These provide autocomplete for custom node code
  const NODE_TYPES_DEFINITION = `
declare namespace Cascade {
  type PortType = 'trigger' | 'param';
  type DataType = 'number' | 'string' | 'boolean' | 'color' | 'asset' | 'array' | 'object' | 'any';
  type PropControlType = 'number' | 'int' | 'slider' | 'text' | 'textarea' | 'color' | 'image' | 'boolean' | 'select' | 'vector' | 'vec2' | 'vec3' | 'vec2i' | 'vec3i' | 'range' | 'button' | 'folder' | 'group';

  interface PortOptions {
    type?: DataType;
    min?: number;
    max?: number;
    step?: number;
    values?: any[];
    accept?: string[];
    description?: string;
    hidden?: boolean;
    published?: boolean;
    multiline?: boolean;
  }

  interface InputPort<T = any> {
    id: string;
    name: string;
    portType: PortType;
    dataType: DataType;
    value: T;
    defaultValue: T;
    options: PortOptions;
    connections: Connection[];
    onChange?: (value: T) => void;
    onTrigger?: (props?: any) => void;
  }

  interface OutputPort<T = any> {
    id: string;
    name: string;
    portType: PortType;
    dataType: DataType;
    value: T;
    connections: Connection[];
    setValue: (value: T) => void;
    trigger: (props?: any) => void;
  }

  interface Connection {
    id: string;
    from: { nodeId: string; portId: string };
    to: { nodeId: string; portId: string };
    type: PortType;
  }

  interface Prop<T = any> {
    value: T;
    params?: {
      min?: number | number[];
      max?: number | number[];
      step?: number;
      options?: Array<T | { value: T; label: string }>;
      accept?: string;
      locked?: boolean;
      integer?: boolean;
    };
    onChange?: (prop: Prop<T>, context: Node) => void | Promise<void>;
    displayName?: string | null;
    type?: PropControlType;
    disabled?: boolean | (() => boolean);
    hidden?: boolean | (() => boolean);
    folder?: string;
    group?: string;
  }

  /** Base class for all graph elements */
  interface Node {
    id: string;
    type: string;
    position: { x: number; y: number };
    preview: HTMLCanvasElement | HTMLImageElement | null;
    comment: string;
    error: Error | null;
    warning: string | null;
    isDirty: boolean;
    inputs: InputPort[];
    outputs: OutputPort[];
    props: Record<string, Prop>;

    // Port creation
    in<T>(name: string, defaultValue?: T, options?: PortOptions): InputPort<T>;
    out<T>(name: string, portType?: PortType): OutputPort<T>;

    // Props system
    defineProp<T>(name: string, config: Prop<T>): void;
    updateProp(name: string, value: any): void;
    watchProp(name: string, callback: Function): void;

    // Variadic inputs
    setVariadic(defaultValue?: any, options?: PortOptions): void;
    getVariadicInputs(): InputPort[];

    // Lifecycle hooks
    onSetup?: () => void | Promise<void>;
    onUpdate?: () => void | Promise<void>;
    onRender?: () => void | Promise<void>;
    onReady?: () => void;
    onDestroy?: () => void;

    // Utilities
    log(...args: any[]): void;
    markDirty(): void;

    // Computation-specific (available on computation nodes)
    code?: string;
    bypassed?: boolean;
    cooking?: boolean;
    setBypass?(value: boolean): void;
    setCook?(value: boolean): void;
    require?(packageName: string): Promise<any>;
  }
}

// Global variable available in node code execution context
declare const node: Cascade.Node;
declare const graph: any;
`.trim();

  // Props
  export let node: Node;
  export let graph: Graph | null = null;
  export let packageManager: PackageManager | null = null;
  export let onClose: () => void;
  export let showCloseButton: boolean = true;
  export let onRecordHistory: (() => void) | undefined = undefined;
  export let onShowHistory: (() => void) | undefined = undefined;

  // State
  let container: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | null = null;
  let status: 'idle' | 'editing' | 'compiling' | 'success' | 'error' = 'idle';
  let errorMessage = '';
  let isDestroyed = false;
  let packageSearchOpen = false;

  // Source information
  let sourceType: 'stdlib' | 'embedded' | 'project' = 'embedded';
  /** Real source for a project module, read from the server rather than the node. */
  let projectSource: string | null = null;
  let modulePath = '';
  let displayPath = '';
  let fileStatus: FileStatus = 'synced';
  let historyCount = 0;

  // WindowManager mounts this without a graph prop, and every action below
  // needs one, so fall back to the node's own graph reference.
  $: activeGraph = (graph ?? (node as any)?.graph ?? null) as Graph | null;

  // Computed
  $: isReadOnly = sourceType === 'stdlib';
  // Two independent axes, and conflating them is what made the old labels
  // confusing. **Where the code lives**: embedded in the .cascade document, or
  // external in nodes/<Name>/index.ts. **How it declares itself**: dynamic, with
  // ports appearing only once it has cooked, or definition-v1, a static literal
  // the toolchain can read without running anything.
  //
  // Marcus's standing preference, 2026-09-07: the system should prefer and
  // subtly work towards external files that compile as ordinary ES modules and
  // can be inspected statically — while keeping it possible to edit a whole
  // project as dynamic code nodes. So both directions stay available and the
  // labels say plainly which way is which.
  $: canDuplicate = sourceType === 'stdlib';
  $: canExtract = sourceType === 'embedded';
  $: canEmbed = sourceType === 'project';
  $: canShowHistory = sourceType === 'embedded' && historyCount > 0;

  $: if (editor) {
    editor.updateOptions({ fontSize: $settingsStore.editor.fontSize });
  }

  // Monaco's theme is global rather than per-instance, so this also covers the
  // diff editor in the history panel.
  $: if (editor) {
    monaco.editor.setTheme(monacoThemeFor($resolvedTheme));
  }

  /** The folder name under `nodes/` for a project module, or null. */
  function projectModuleName(): string | null {
    const path = (node as any).modulePath as string | undefined;
    if (!path?.startsWith('project.')) return null;
    return path.slice('project.'.length);
  }

  /**
   * A project node's code lives in `nodes/<Name>/index.ts`, not on the node, so
   * `node.code` is empty for one and the editor fell through to the blank-node
   * template — showing generic boilerplate under a real node's name. Which would
   * be merely confusing if Compile were not sitting beside it: compileNode()
   * takes whatever is in the editor and replaces the live node's behaviour, and
   * `isReadOnly` only covers stdlib. So the editor offered to overwrite a working
   * node with a template of a node, and the graph was already dirty.
   *
   * The source was always fetchable; nothing was reading it. This path went
   * unexercised because ENABLE_CODE_EDITOR was false until 2026-09-07.
   */
  async function loadProjectSource(): Promise<void> {
    const name = projectModuleName();
    if (!name) return;
    try {
      const response = await fetch(`/api/nodes/${encodeURIComponent(name)}/index.ts`);
      if (response.ok) projectSource = await response.text();
    } catch {
      // Leave projectSource null: the editor then shows whatever the node
      // carries, and Compile is blocked for project modules regardless.
    }
    try {
      const resolved = await fetch(`/api/nodes/${encodeURIComponent(name)}/path`);
      if (resolved.ok) displayPath = (await resolved.json()).path ?? displayPath;
    } catch {
      // A missing path is cosmetic.
    }
  }

  // Determine source info from node
  function updateSourceInfo() {
    const fullType = node.type.includes('.') ? node.type : typeToPackagePath(node.type);
    modulePath = (node as any).modulePath || fullType;

    // Determine source type
    if (isStandardLibraryNode(modulePath)) {
      sourceType = 'stdlib';
      const parts = modulePath.split('.');
      displayPath = `<cascade>/${parts.slice(1).join('/')}.ts`;
    } else if (modulePath.startsWith('local.')) {
      sourceType = 'embedded';
      displayPath = '<embedded>';
    } else {
      sourceType = (node as any).sourceType || 'embedded';
      displayPath = (node as any).filePath || '<embedded>';
    }

    // Get history count from module resolver if available
    if (graph?.moduleResolver && sourceType === 'embedded') {
      const config = graph.moduleResolver.exportConfig();
      const embedded = config.embeddedModules[modulePath];
      historyCount = embedded?.history?.length || 0;
    }
  }

  onMount(async () => {
    if (!container || isDestroyed) return;

    updateSourceInfo();
    await loadProjectSource();

    await tick();

    if (!container || isDestroyed) return;

    try {
      // Configure Monaco TypeScript environment with node types
      monaco.typescript.typescriptDefaults.setCompilerOptions({
        target: monaco.typescript.ScriptTarget.ES2020,
        allowNonTsExtensions: true,
        moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
        module: monaco.typescript.ModuleKind.ESNext,
        noEmit: true,
        esModuleInterop: true,
        jsx: monaco.typescript.JsxEmit.None,
        reactNamespace: "React",
        allowJs: true,
        typeRoots: ["node_modules/@types"]
      });

      // Add node type definitions to Monaco
      monaco.typescript.typescriptDefaults.setExtraLibs([
        {
          content: NODE_TYPES_DEFINITION,
          filePath: 'file:///node-context.d.ts'
        }
      ]);

      editor = monaco.editor.create(container, {
        value: projectSource ?? node.code ?? getDefaultNodeCode(node.type),
        language: 'typescript',
        theme: monacoThemeFor($resolvedTheme),
        minimap: { enabled: false },
        fontSize: $settingsStore.editor.fontSize,
        automaticLayout: true,
        readOnly: isReadOnly
      });

      // Shift+Enter to compile (only if not read-only)
      editor.addCommand(
        monaco.KeyMod.Shift | monaco.KeyCode.Enter,
        () => {
          if (!isDestroyed && editor && !isReadOnly) {
            compileNode();
          }
        }
      );

      // Escape to close
      editor.addCommand(
        monaco.KeyCode.Escape,
        () => {
          if (!isDestroyed) {
            if (packageSearchOpen) {
              packageSearchOpen = false;
            } else {
              onClose();
            }
          }
        }
      );

      // ⌘K / Ctrl+K to open package search
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
        () => {
          if (!isDestroyed && !isReadOnly) {
            packageSearchOpen = true;
          }
        }
      );

      editor.onDidChangeModelContent(() => {
        if (!isDestroyed && !isReadOnly) {
          status = 'editing';
        }
      });
    } catch (error) {
      console.error('Error creating Monaco editor:', error);
      errorMessage = 'Failed to initialize editor';
      status = 'error';
    }
  });

  onDestroy(() => {
    isDestroyed = true;
    if (editor) {
      try {
        editor.dispose();
      } catch (error) {
        console.warn('Error disposing Monaco editor:', error);
      }
      editor = null;
    }
  });

  /** Write a project module back to its file and let the watcher reload it. */
  async function saveProjectSource(): Promise<void> {
    const name = projectModuleName();
    if (!name || !editor) return;
    status = 'compiling';
    try {
      const response = await fetch(`/api/nodes/${encodeURIComponent(name)}/index.ts`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editor.getValue() }),
      });
      if (!response.ok) throw new Error(await response.text());
      status = 'success';
      // No local recook here: the server's node watcher fires, invalidates the
      // bundle and marks every instance dirty. One reload path, not two.
    } catch (error) {
      status = 'error';
      reportActionError('could not write the file: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  async function compileNode() {
    if (!editor || isDestroyed || isReadOnly) return;

    // A project module is a file on disk and the server watches it: writing it
    // is the whole edit, and `nodeWatch` invalidates the compiled bundle and
    // recooks every instance. Transpiling it into this one node instead would
    // fork the graph's copy away from the file silently, and leave the other
    // instances of the same module running the old code.
    if (projectModuleName()) {
      await saveProjectSource();
      return;
    }

    onRecordHistory?.();

    let code: string;
    try {
      code = editor.getValue();
    } catch (error) {
      console.error('Error getting editor value:', error);
      return;
    }

    status = 'compiling';

    try {
      if (!graph) throw new Error('Cannot compile a node without its graph');
      const result = await compileAndExecute(node, graph, code);
      if (!result.success) {
        throw node.error ?? new Error(result.error ?? 'Compilation failed');
      }

      if (isDestroyed) return;

      status = 'success';
      errorMessage = '';

    } catch (error: any) {
      if (isDestroyed) return;

      status = 'error';
      errorMessage = error.message || 'Unknown error';
      node.error = error;
      console.error('Error compiling node:', error);
    }
  }

  function getDefaultNodeCode(type: string): string {
    // Check if this is a class-based stdlib node
    const packagePath = typeToPackagePath(type);
    const NodeClass = getNodeClass(packagePath);
    if (NodeClass) {
      // Try to get the source code from the registry
      const source = getNodeSource(type);
      if (source) {
        return source;
      }
      // Fallback if source not registered
      return `// Standard Library Node: ${type}
//
// This node is implemented as a class (${NodeClass.name}).
// Source code not available.
//
// To customize: click "Duplicate as Custom" to create an editable copy.
`;
    }

    // Default template for custom nodes.
    //
    // `export function execute(node, graph)`, not top-level statements. The
    // previous template declared its ports at module top level, which is the
    // pre-ESM shape: the loader imports a real module now and requires that
    // export, so `node` was genuinely undefined and a brand-new custom node
    // failed with "node is not defined" the moment it was created.
    return `// ${type} - Custom Node
//
// Ports and parameters are declared inside execute(); it runs once to discover
// them and again whenever the node cooks.
export function execute(node, graph) {
  const input = node.in('input', null).value;

  const value = node.param('value', 1.0, { min: 0, max: 10, step: 0.1, type: 'float' }).value;

  const output = node.out('output');
  output.setValue(input ?? value);
}
`;
  }

  function handlePackageSelect(e: CustomEvent<{ packageName: string }>) {
    if (!editor || isReadOnly) return;

    const packageName = e.detail.packageName;
    const model = editor.getModel();
    if (!model) return;

    const selection = editor.getSelection();
    if (!selection) return;

    const requireCode = `const ${packageName.replace(/[^a-zA-Z0-9]/g, '_')} = await node.require('${packageName}');\n`;

    if (selection.isEmpty()) {
      editor.executeEdits('insert-package', [{
        range: new monaco.Range(selection.startLineNumber, selection.startColumn, selection.startLineNumber, selection.startColumn),
        text: requireCode
      }]);
    } else {
      editor.executeEdits('insert-package', [{
        range: selection,
        text: requireCode
      }]);
    }

    const newPosition = {
      lineNumber: selection.startLineNumber,
      column: selection.startColumn + requireCode.length
    };
    editor.setPosition(newPosition);
    editor.focus();
  }

  /** A built-in is read-only, so editing one starts by taking a copy. The copy
   *  is embedded in the document; promoting it to a file is the next button. */
  async function handleDuplicate() {
    const resolver = activeGraph?.moduleResolver;
    if (!resolver) { reportActionError('no module resolver on this graph'); return; }

    const created = resolver.duplicateToEmbedded(modulePath);
    if (!created) { reportActionError('could not read the built-in source'); return; }

    if (!activeGraph!.retargetModule(node.id, created.modulePath, 'embedded', created.module.code)) {
      reportActionError('could not point the node at the copy');
      return;
    }
    updateSourceInfo();
    showCode(created.module.code);
  }

  /**
   * Embed an external project module back into this graph, for a local edit.
   *
   * The reverse of Extract, and the missing half of the pair: embedding existed
   * only for stdlib nodes, so a project module — the thing you are most likely
   * to want to fork for one graph — had no way back in. Marcus asked for both
   * directions on 2026-09-07.
   *
   * It copies the file's current contents into the document under a `local.*`
   * name and repoints this node at the copy. The file is left alone, and the
   * other instances of the module keep using it, which is the point: this graph
   * diverges and nothing else notices.
   */
  async function handleEmbed() {
    const name = projectModuleName();
    if (!name || !activeGraph) return;
    const resolver = activeGraph.moduleResolver;
    if (!resolver) { reportActionError('no module resolver on this graph'); return; }

    let code = projectSource;
    if (code === null) {
      try {
        const response = await fetch(`/api/nodes/${encodeURIComponent(name)}/index.ts`);
        if (!response.ok) throw new Error(await response.text());
        code = await response.text();
      } catch (error) {
        reportActionError('could not read the module source: ' + (error instanceof Error ? error.message : String(error)));
        return;
      }
    }

    // Same uniqueness walk duplicateToEmbedded does, so two embeds of one
    // module do not collide on the second.
    const base = `local.${name}`;
    let modulePath = base;
    let counter = 1;
    while (resolver.exportConfig().embeddedModules[modulePath]) {
      modulePath = `${base}${counter}`;
      counter += 1;
    }

    // The code is about to be compiled from the project root instead of from
    // nodes/<name>/, so its relative imports have to move with it or the very
    // next cook fails to resolve them.
    const embeddedCode = rewriteRelativeImports(code, moduleDirectory(name), '');

    const created = resolver.createEmbeddedModule(modulePath, embeddedCode, 'user');
    if (!activeGraph.retargetModule(node.id, created.modulePath, 'embedded', embeddedCode)) {
      reportActionError('could not point the node at the embedded copy');
      return;
    }
    projectSource = null;
    updateSourceInfo();
    showCode(embeddedCode);
  }

  /** Embedded code lives inside the .cascade document, which makes it
   *  invisible to git, to an external editor and to the other graphs in the
   *  project. Extracting writes it to nodes/<Name>/index.ts and repoints the
   *  node, after which the file watcher keeps the two in step. */
  async function handleExtract() {
    const name = modulePath.replace(/^local\./, '').replace(/[^A-Za-z0-9_-]/g, '');
    if (!name) { reportActionError('cannot derive a folder name from ' + modulePath); return; }

    const editorCode = editor?.getValue() ?? node.code ?? '';
    // Mirror of the embed case, and wrong for longer: embedded code is compiled
    // from the project root, and it is about to live in nodes/<name>/ where a
    // root-relative specifier points at nothing.
    const code = rewriteRelativeImports(editorCode, '', moduleDirectory(name));
    try {
      const scaffold = await fetch('/api/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!scaffold.ok) throw new Error(await scaffold.text());

      const write = await fetch(`/api/nodes/${encodeURIComponent(name)}/index.ts`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: code }),
      });
      if (!write.ok) throw new Error(await write.text());
    } catch (error) {
      reportActionError('could not write the file: ' + (error instanceof Error ? error.message : String(error)));
      return;
    }

    if (!activeGraph?.retargetModule(node.id, `project.${name}`, 'project')) {
      reportActionError('file written, but the node still points at the embedded copy');
      return;
    }
    updateSourceInfo();
    showCode(code);
  }

  /** The buffer is now a different module's, so the editor has to be told;
   *  updateSourceInfo only refreshes the badge and the path. */
  function showCode(code: string): void {
    if (editor && editor.getValue() !== code) editor.setValue(code);
    status = 'idle';
    errorMessage = '';
  }

  function reportActionError(detail: string): void {
    status = 'error';
    errorMessage = detail;
  }

  function handleShowHistory() {
    onShowHistory?.();
  }

  function getSourceBadgeClass(): string {
    switch (sourceType) {
      case 'stdlib': return 'badge-stdlib';
      case 'embedded': return 'badge-embedded';
      case 'project': return 'badge-project';
      default: return '';
    }
  }

  function getSourceBadgeText(): string {
    switch (sourceType) {
      case 'stdlib': return 'cascade';
      case 'embedded': return 'external';
      case 'project': return fileStatus === 'synced' ? 'project' : fileStatus;
      default: return '';
    }
  }
</script>

<div class="editor-container-wrapper">
  <!-- Header: Module Path & Source Info -->
  <div class="header-bar">
    <div class="header-info">
      <div class="module-path">
        <Icon name="Package" size={14} />
        <span class="path-text">{modulePath}</span>
      </div>
      <div class="source-path">
        <Icon name="FileCode" size={14} />
        <span class="path-text secondary">{displayPath}</span>
        <span class="source-badge {getSourceBadgeClass()}">
          {#if sourceType === 'stdlib'}
            <Lock size={10} />
          {/if}
          {getSourceBadgeText()}
        </span>
        {#if historyCount > 0}
          <span class="history-badge" title="{historyCount} versions">
            <History size={10} />
            {historyCount}
          </span>
        {/if}
      </div>
    </div>
  </div>

  <!-- Status Bar -->
  <div class="status-bar">
    <div class="status status-{status}">
      {#if status === 'editing'}
        Editing... (Shift+Enter to compile)
      {:else if status === 'compiling'}
        <Clock size={14} />
        Compiling...
      {:else if status === 'success'}
        <Check size={14} />
        Success!
      {:else if status === 'error'}
        <XCircle size={14} />
        {errorMessage}
      {:else if isReadOnly}
        <Lock size={14} />
        Read-only (standard library)
      {/if}
    </div>
  </div>

  <!-- Monaco Editor -->
  <div class="editor-container" bind:this={container}></div>

  <!-- Action Bar -->
  <div class="action-bar">
    {#if canDuplicate}
      <button class="action-button" on:click={handleDuplicate} title="Duplicate to local.*">
        <Copy size={14} />
        Duplicate to local
      </button>
    {/if}
    {#if canEmbed}
      <button class="action-button" on:click={handleEmbed} title="Copy this module into the graph for a local edit">
        <Copy size={14} />
        Embed in Graph
      </button>
    {/if}
    {#if canExtract}
      <button class="action-button" on:click={handleExtract} title="Extract to external file">
        <FileOutput size={14} />
        Extract to File
      </button>
    {/if}
    {#if canShowHistory}
      <button class="action-button" on:click={handleShowHistory} title="View version history">
        <History size={14} />
        History ({historyCount})
      </button>
    {/if}
  </div>

  <!-- Footer -->
  <div class="footer">
    <button class="package-button" on:click={() => packageSearchOpen = true} title="Search NPM packages (⌘K)" disabled={isReadOnly}>
      <Icon name="Package" size={14} />
      Packages
    </button>
    <div class="footer-right">
      {#if !isReadOnly}
        <button on:click={compileNode} disabled={!editor || isDestroyed}>
          Compile (Shift+Enter)
        </button>
      {/if}
      {#if showCloseButton}
        <button on:click={onClose}>
          Close (Esc)
        </button>
      {/if}
    </div>
  </div>
</div>

{#if packageManager}
  <PackageSearch
    bind:open={packageSearchOpen}
    {packageManager}
    on:select={handlePackageSelect}
    on:close={() => packageSearchOpen = false}
  />
{/if}

<style>
  .editor-container-wrapper {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--surface-panel-alt);
    overflow: hidden;
  }

  /* Header Bar */
  .header-bar {
    padding: 8px 12px;
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border-subtle);
  }

  .header-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .module-path, .source-path {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .source-path {
    font-size: 12px;
  }

  .path-text {
    font-family: 'SF Mono', Monaco, monospace;
  }

  .path-text.secondary {
    color: var(--text-subtle);
  }

  .source-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
  }

  .badge-stdlib {
    background: var(--status-warn-tint);
    color: var(--status-warn-alt);
  }

  .badge-embedded {
    background: var(--status-ok-tint);
    color: var(--status-ok);
  }

  .badge-project {
    background: var(--status-info-tint);
    color: var(--status-info);
  }

  .history-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    background: var(--status-special-tint);
    color: var(--status-special);
    border-radius: 10px;
    font-size: 11px;
  }

  /* Status Bar */
  .status-bar {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-subtle);
  }

  .status-error {
    color: var(--status-error-strong);
  }

  .status-success {
    color: var(--status-ok-bright);
  }

  /* Editor */
  .editor-container {
    flex: 1;
    min-height: 0;
  }

  /* Action Bar */
  .action-bar {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    background: var(--surface-raised);
    border-top: 1px solid var(--border-subtle);
    flex-wrap: wrap;
  }

  .action-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--tint-weak);
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s ease;
  }

  .action-button:hover {
    background: var(--tint);
    color: var(--text-bright);
    border-color: var(--border-strong);
  }

  /* Footer */
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px;
    border-top: 1px solid var(--border-subtle);
  }

  .footer-right {
    display: flex;
    gap: 8px;
  }

  .package-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    background: var(--accent-tint-medium);
    color: var(--accent);
    border: 1px solid var(--accent-tint-strong);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.15s ease;
  }

  .package-button:hover:not(:disabled) {
    background: var(--accent-tint-strong);
    border-color: var(--accent);
  }

  .package-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button {
    padding: 8px 16px;
    background: var(--accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }

  button:hover:not(:disabled) {
    background: var(--accent-strong);
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
