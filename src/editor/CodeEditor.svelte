<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { monaco } from './monaco';
  import ts from 'typescript';
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

  /**
   * Transpile TypeScript code to JavaScript
   * Strips type annotations, generics, interfaces, etc.
   */
  function transpileTypeScript(code: string): string {
    const result = ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        removeComments: false,
        // Don't emit helpers - we want simple output
        noEmitHelpers: true,
        // Allow JS features
        allowJs: true,
      }
    });
    return result.outputText;
  }

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
  let modulePath = '';
  let displayPath = '';
  let fileStatus: FileStatus = 'synced';
  let historyCount = 0;

  // WindowManager mounts this without a graph prop, and every action below
  // needs one, so fall back to the node's own graph reference.
  $: activeGraph = (graph ?? (node as any)?.graph ?? null) as Graph | null;

  // Computed
  $: isReadOnly = sourceType === 'stdlib';
  $: canDuplicate = sourceType === 'stdlib';
  $: canExtract = sourceType === 'embedded';
  $: canShowHistory = sourceType === 'embedded' && historyCount > 0;

  $: if (editor) {
    editor.updateOptions({ fontSize: $settingsStore.editor.fontSize });
  }

  // Monaco's theme is global rather than per-instance, so this also covers the
  // diff editor in the history panel.
  $: if (editor) {
    monaco.editor.setTheme(monacoThemeFor($resolvedTheme));
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
        value: node.code || getDefaultNodeCode(node.type),
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

  async function compileNode() {
    if (!editor || isDestroyed || isReadOnly) return;

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
      const oldState = node.preserveState();

      if (node.onDestroy) {
        try {
          node.onDestroy();
        } catch (err) {
          console.warn('Error in node.onDestroy:', err);
        }
      }

      node.resetPortTracking();

      // Transpile TypeScript to JavaScript (strips type annotations, generics, etc.)
      const jsCode = transpileTypeScript(code);

      const wrappedCode = `return (async function(node, graph) {\n${jsCode}\n})(node, graph);`;
      const nodeFunction = new Function('node', 'graph', wrappedCode) as (node: any, graph: any) => Promise<any>;

      // Store original TypeScript code (for editing), but run the transpiled JS
      node.code = code;
      node.setFunction(nodeFunction);

      // Temporarily disable bypass so the code actually runs during compilation
      // This ensures ports get registered in the tracking set
      const wasBypassed = node.bypass;
      if (wasBypassed) {
        node.setBypass(false);
      }

      // Mark dirty to force execution even if node was already executed
      node.markDirty();

      if (!graph) throw new Error('Cannot compile a node without its graph');
      await graph.execute(node);

      // Restore bypass state
      if (wasBypassed) {
        node.setBypass(true);
      }

      node.cleanupUnusedPorts();

      node.restoreState(oldState);

      if (node.onReady) {
        try {
          node.onReady();
        } catch (err) {
          console.warn('Error in node.onReady:', err);
        }
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

    // Default template for custom nodes
    return `// ${type} - Custom Node
//
// Define inputs
const input = node.in('input', null);

// Define properties (shown in inspector)
node.defineProp('value', {
  value: 1.0,
  params: { min: 0, max: 10, step: 0.1 },
  displayName: 'Value'
});

// Define outputs
const output = node.out('output');

// React to input changes
input.onChange = (value) => {
  // Process input and set output
  output.setValue(value);
};

// React to property changes
node.watchProp('value', (newValue) => {
  output.setValue(newValue);
});

// Called once when node is ready
node.onReady = () => {
  output.setValue(node.props.value.value);
};
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

  /** Embedded code lives inside the .cascade document, which makes it
   *  invisible to git, to an external editor and to the other graphs in the
   *  project. Extracting writes it to nodes/<Name>/index.ts and repoints the
   *  node, after which the file watcher keeps the two in step. */
  async function handleExtract() {
    const name = modulePath.replace(/^local\./, '').replace(/[^A-Za-z0-9_-]/g, '');
    if (!name) { reportActionError('cannot derive a folder name from ' + modulePath); return; }

    const code = editor?.getValue() ?? node.code ?? '';
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

  /** Hands the path to the OS rather than opening anything itself: the file is
   *  on the server's disk, and the browser cannot reach it. */
  async function handleOpenExternally() {
    const name = modulePath.replace(/^project\./, '');
    try {
      const response = await fetch(`/api/nodes/${encodeURIComponent(name)}/path`);
      if (!response.ok) throw new Error(await response.text());
      const { path } = await response.json();
      window.open(`vscode://file${path}:1`, '_blank');
    } catch (error) {
      reportActionError('could not resolve the file path: ' + (error instanceof Error ? error.message : String(error)));
    }
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
    {#if sourceType === 'project'}
      <button class="action-button" on:click={handleOpenExternally} title="Open in external editor">
        <FolderOpen size={14} />
        Open in VSCode
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
