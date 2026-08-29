<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import * as monaco from 'monaco-editor';
  import ts from 'typescript';
  import type { Node } from '@/nodes/Node';
  import type { Graph } from '@/nodes/Graph';
  import PackageSearch from './PackageSearch.svelte';
  import type { PackageManager } from '@/engine/PackageManager';
  import Icon from './Icon.svelte';
  import { Clock, Check, XCircle, Copy, FileOutput, History, Lock, FolderOpen, Sparkles, Loader2 } from '@lucide/svelte';
  import { isStandardLibraryNode, typeToPackagePath, getNodeClass, getNodeSource } from '@/utils/nodeTypeUtils';
  import type { NodeSource, FileStatus } from '@/types/node.types';
  import { getAICodeGenerator, AICodeGenerator } from './ai/AICodeGenerator';
  import type { AIProvider } from './ai/types';
  import { settingsStore } from './stores/settingsStore';

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
    setVariadic(defaultValue?: any): void;
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
  export let onDuplicate: ((modulePath: string) => void) | undefined = undefined;
  export let onExtract: ((modulePath: string) => void) | undefined = undefined;
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

  // AI prompt state
  let aiPrompt = '';
  let aiModel: AIProvider = 'claude';
  let isGenerating = false;
  let aiError = '';
  let streamedCode = '';

  // Computed
  $: isReadOnly = sourceType === 'stdlib';
  $: canDuplicate = sourceType === 'stdlib';
  $: canExtract = sourceType === 'embedded';
  $: canShowHistory = sourceType === 'embedded' && historyCount > 0;

  // Update editor font size when settings change
  $: if (editor && $settingsStore.editor.fontSize) {
    editor.updateOptions({ fontSize: $settingsStore.editor.fontSize });
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
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2020,
        allowNonTsExtensions: true,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        noEmit: true,
        esModuleInterop: true,
        jsx: monaco.languages.typescript.JsxEmit.None,
        reactNamespace: "React",
        allowJs: true,
        typeRoots: ["node_modules/@types"]
      });

      // Add node type definitions to Monaco
      monaco.languages.typescript.typescriptDefaults.setExtraLibs([
        {
          content: NODE_TYPES_DEFINITION,
          filePath: 'file:///node-context.d.ts'
        }
      ]);

      editor = monaco.editor.create(container, {
        value: node.code || getDefaultNodeCode(node.type),
        language: 'typescript',
        theme: 'vs-dark',
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

  function handleDuplicate() {
    onDuplicate?.(modulePath);
  }

  function handleExtract() {
    onExtract?.(modulePath);
  }

  function handleShowHistory() {
    onShowHistory?.();
  }

  async function handleAIGenerate() {
    if (!aiPrompt.trim() || isGenerating || isReadOnly || !editor) return;

    const generator = getAICodeGenerator();

    // Check if provider is available (API key or CLI fallback for Claude)
    const available = await generator.isAvailable(aiModel);
    if (!available) {
      if (aiModel === 'claude') {
        aiError = 'Claude API key not configured and CLI not available. Add API key in Settings or install claude CLI.';
      } else {
        aiError = `${aiModel} is not configured. Add your API key in Settings.`;
      }
      return;
    }

    isGenerating = true;
    aiError = '';
    streamedCode = '';

    // Build context from current node
    const context = AICodeGenerator.buildContext(node, modulePath);

    // Record history before AI changes
    onRecordHistory?.();

    try {
      // Use streaming for better UX
      await generator.generateStream(
        {
          prompt: aiPrompt,
          context,
          provider: aiModel,
          stream: true
        },
        {
          onToken: (token) => {
            streamedCode += token;
            // Update editor with streamed code
            if (editor && !isDestroyed) {
              editor.setValue(streamedCode);
            }
          },
          onComplete: (result) => {
            isGenerating = false;
            if (editor && !isDestroyed) {
              editor.setValue(result.code);
              // Auto-compile after successful generation
              compileNode();
            }
            aiPrompt = '';
          },
          onError: (error) => {
            isGenerating = false;
            aiError = error.message;
            // Restore original code on error
            if (editor && !isDestroyed && node.code) {
              editor.setValue(node.code);
            }
          }
        }
      );
    } catch (error: any) {
      isGenerating = false;
      aiError = error.message || 'Failed to generate code';
      // Restore original code on error
      if (editor && !isDestroyed && node.code) {
        editor.setValue(node.code);
      }
    }
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
      <button class="action-button" title="Open in external editor">
        <FolderOpen size={14} />
        Open in VSCode
      </button>
    {/if}
  </div>

  <!-- AI Prompt Panel -->
  {#if !isReadOnly}
    <div class="ai-panel">
      <div class="ai-input-row">
        {#if isGenerating}
          <div class="ai-spinner">
            <Loader2 size={16} class="spinning" />
          </div>
        {:else}
          <Sparkles size={16} class="ai-icon" />
        {/if}
        <textarea
          class="ai-prompt-input"
          placeholder="Describe what you want the node to do..."
          bind:value={aiPrompt}
          on:keydown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleAIGenerate();
            }
          }}
          disabled={isGenerating}
          rows="3"
        ></textarea>
      </div>
      {#if aiError}
        <div class="ai-error">
          <XCircle size={14} />
          {aiError}
        </div>
      {/if}
      <div class="ai-controls">
        <span class="ai-hint">⌘/Ctrl+Enter to generate</span>
        <select class="model-select" bind:value={aiModel} disabled={isGenerating}>
          <option value="claude">Claude</option>
          <option value="openai">OpenAI</option>
          <option value="gemini">Gemini</option>
        </select>
        <button
          class="ai-generate-button"
          on:click={handleAIGenerate}
          disabled={!aiPrompt.trim() || isGenerating}
        >
          {#if isGenerating}
            <Loader2 size={14} class="spinning" />
            Generating...
          {:else}
            ⚡ Generate
          {/if}
        </button>
      </div>
    </div>
  {/if}

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
    background: #1e1e1e;
    overflow: hidden;
  }

  /* Header Bar */
  .header-bar {
    padding: 8px 12px;
    background: #252526;
    border-bottom: 1px solid #333;
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
    color: #ccc;
  }

  .source-path {
    font-size: 12px;
  }

  .path-text {
    font-family: 'SF Mono', Monaco, monospace;
  }

  .path-text.secondary {
    color: #888;
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
    background: rgba(255, 193, 7, 0.2);
    color: #ffc107;
  }

  .badge-embedded {
    background: rgba(76, 175, 80, 0.2);
    color: #4caf50;
  }

  .badge-project {
    background: rgba(33, 150, 243, 0.2);
    color: #2196f3;
  }

  .history-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    background: rgba(156, 39, 176, 0.2);
    color: #9c27b0;
    border-radius: 10px;
    font-size: 11px;
  }

  /* Status Bar */
  .status-bar {
    padding: 8px 12px;
    border-bottom: 1px solid #333;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #888;
  }

  .status-error {
    color: #ff4444;
  }

  .status-success {
    color: #44ff44;
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
    background: #252526;
    border-top: 1px solid #333;
    flex-wrap: wrap;
  }

  .action-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.05);
    color: #aaa;
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s ease;
  }

  .action-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    border-color: #555;
  }

  /* AI Panel */
  .ai-panel {
    padding: 12px;
    background: #1a1a2e;
    border-top: 1px solid #333;
  }

  .ai-input-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 8px;
  }

  .ai-input-row :global(.ai-icon) {
    color: #9c27b0;
    flex-shrink: 0;
    margin-top: 10px;
  }

  .ai-spinner {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #9c27b0;
    flex-shrink: 0;
    margin-top: 10px;
  }

  .ai-spinner :global(.spinning),
  .ai-generate-button :global(.spinning) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .ai-error {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: rgba(255, 68, 68, 0.1);
    border: 1px solid rgba(255, 68, 68, 0.3);
    border-radius: 4px;
    color: #ff6666;
    font-size: 12px;
    margin-bottom: 8px;
  }

  .ai-prompt-input {
    flex: 1;
    padding: 8px 12px;
    background: #252536;
    border: 1px solid #444;
    border-radius: 4px;
    color: #fff;
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
    min-height: 60px;
    max-height: 150px;
    line-height: 1.4;
  }

  .ai-prompt-input:focus {
    outline: none;
    border-color: #9c27b0;
  }

  .ai-prompt-input::placeholder {
    color: #666;
  }

  .ai-prompt-input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .ai-controls {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
  }

  .ai-hint {
    color: #666;
    font-size: 11px;
    margin-right: auto;
  }

  .model-select {
    padding: 6px 12px;
    background: #252536;
    border: 1px solid #444;
    border-radius: 4px;
    color: #fff;
    font-size: 12px;
    cursor: pointer;
  }

  .ai-generate-button {
    padding: 6px 16px;
    background: linear-gradient(135deg, #9c27b0, #673ab7);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: opacity 0.15s ease;
  }

  .ai-generate-button:hover:not(:disabled) {
    opacity: 0.9;
  }

  .ai-generate-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Footer */
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px;
    border-top: 1px solid #333;
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
    background: rgba(74, 158, 255, 0.2);
    color: #4a9eff;
    border: 1px solid rgba(74, 158, 255, 0.3);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.15s ease;
  }

  .package-button:hover:not(:disabled) {
    background: rgba(74, 158, 255, 0.3);
    border-color: #4a9eff;
  }

  .package-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button {
    padding: 8px 16px;
    background: #4a9eff;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }

  button:hover:not(:disabled) {
    background: #357abd;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
