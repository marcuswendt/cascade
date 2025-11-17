# Cascade Framework - Claude Code Implementation Spec
## Agentic Coding Instructions for Building Cascade

**Project**: Cascade - Visual Programming Framework for Creative Coders  
**Target**: Production-ready v1.0 implementation  
**Timeline**: 8-10 weeks, phased approach  
**Tech Stack**: TypeScript, Svelte, Vite, Monaco Editor  

---

## 🎯 Project Overview

Build a **visual programming framework** where:
- Every node is a TypeScript/JavaScript function
- Live code editing with Shift+Enter (no state loss)
- Self-contained projects with asset management
- Export to standalone HTML
- NPM packages load dynamically
- FigJam-style modern UI

**Philosophy**: Programmer-first visual coding (inspired by Nodes.io, TouchDesigner, Houdini)

---

## 📁 Project Structure to Create

```
cascade/
├── package.json                 # Dependencies and scripts
├── tsconfig.json               # TypeScript config
├── vite.config.ts              # Vite bundler config
├── index.html                  # Entry HTML
├── src/
│   ├── main.ts                 # App entry point
│   ├── App.svelte              # Root component
│   ├── core/
│   │   ├── Node.ts             # Base node class
│   │   ├── Port.ts             # InputPort & OutputPort classes
│   │   ├── Connection.ts       # Connection between ports
│   │   ├── Graph.ts            # Graph execution engine
│   │   ├── Executor.ts         # Execution scheduler
│   │   ├── AssetManager.ts     # Asset loading & caching
│   │   └── PackageManager.ts   # NPM package loader
│   ├── editor/
│   │   ├── Canvas.svelte       # Main graph canvas
│   │   ├── NodeUI.svelte       # Node visual representation
│   │   ├── Connection.svelte   # SVG connection lines
│   │   ├── Inspector.svelte    # Parameter panel
│   │   ├── CodeEditor.svelte   # Monaco code editor
│   │   ├── BottomToolbar.svelte # FigJam-style toolbar
│   │   ├── NodePanel.svelte    # Category panel
│   │   ├── NodeCard.svelte     # Node preview card
│   │   └── AssetBrowser.svelte # Asset management UI
│   ├── nodes/
│   │   └── library/
│   │       ├── Timer.node.ts
│   │       ├── Viewer.node.ts
│   │       ├── ImageLoader.node.ts
│   │       ├── Blur.node.ts
│   │       └── Custom.node.ts
│   ├── types/
│   │   ├── node.types.ts
│   │   ├── graph.types.ts
│   │   ├── port.types.ts
│   │   └── asset.types.ts
│   ├── utils/
│   │   ├── serialization.ts
│   │   ├── export.ts
│   │   └── keybindings.ts
│   └── stores/
│       ├── graph.store.ts
│       ├── ui.store.ts
│       └── selection.store.ts
├── public/
│   └── runtime/
│       └── cascade-runtime.js   # Minimal runtime for exports
└── graphs/
    └── examples/
        └── hello-world.cascade.json
```

---

## 🚀 Phase 1: Core Foundation (Week 1-2)

### Goal
Basic working system: create nodes, connect ports, execute graph.

### Files to Create

#### 1. `package.json`

```json
{
  "name": "cascade",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "svelte": "^4.0.0",
    "monaco-editor": "^0.44.0"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^3.0.0",
    "@tsconfig/svelte": "^5.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "svelte-check": "^3.0.0"
  }
}
```

#### 2. `tsconfig.json`

```json
{
  "extends": "@tsconfig/svelte/tsconfig.json",
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "allowJs": true,
    "checkJs": false,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.svelte"],
  "exclude": ["node_modules", "dist"]
}
```

#### 3. `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      '@': '/src'
    }
  },
  optimizeDeps: {
    exclude: ['svelte']
  }
});
```

#### 4. `src/types/node.types.ts`

```typescript
export type PortType = 'trigger' | 'param';
export type DataType = 'number' | 'string' | 'boolean' | 'color' | 'asset' | 'array' | 'object' | 'any';

export interface PortOptions {
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

export interface InputPort<T = any> {
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

export interface OutputPort<T = any> {
  id: string;
  name: string;
  portType: PortType;
  dataType: DataType;
  value: T;
  connections: Connection[];
  setValue: (value: T) => void;
  trigger: (props?: any) => void;
}

export interface NodeContext {
  id: string;
  name: string;
  type: string;
  code: string;
  position: { x: number; y: number };
  preview: HTMLCanvasElement | HTMLImageElement | null;
  comment: string;
  error: Error | null;
  warning: string | null;
  isTemplate: boolean;
  isDirty: boolean;
  
  inputs: InputPort[];
  outputs: OutputPort[];
  
  in<T>(name: string, defaultValue?: T, options?: PortOptions): InputPort<T>;
  out<T>(name: string, portType?: PortType): OutputPort<T>;
  
  onReady?: () => void;
  onDestroy?: () => void;
  
  log(...args: any[]): void;
  require(packageName: string): Promise<any>;
}

export interface Connection {
  id: string;
  from: { nodeId: string; portId: string };
  to: { nodeId: string; portId: string };
  type: PortType;
}
```

#### 5. `src/core/Node.ts`

```typescript
import type { NodeContext, InputPort, OutputPort, PortOptions, PortType, Connection } from '@/types/node.types';
import type { Graph } from './Graph';

export class Node implements NodeContext {
  id: string;
  name: string;
  type: string;
  code: string;
  position: { x: number; y: number };
  preview: HTMLCanvasElement | HTMLImageElement | null = null;
  comment: string = '';
  error: Error | null = null;
  warning: string | null = null;
  isTemplate: boolean = false;
  isDirty: boolean = false;
  
  inputs: InputPort[] = [];
  outputs: OutputPort[] = [];
  
  onReady?: () => void;
  onDestroy?: () => void;
  
  private nodeFunction?: Function;
  private graph: Graph;
  
  constructor(id: string, type: string, graph: Graph) {
    this.id = id;
    this.type = type;
    this.name = type;
    this.code = '';
    this.position = { x: 0, y: 0 };
    this.graph = graph;
  }
  
  in<T>(name: string, defaultValue?: T, options: PortOptions = {}): InputPort<T> {
    const portType = name === 'trigger' ? 'trigger' : 'param';
    
    const port: InputPort<T> = {
      id: `${this.id}_in_${name}`,
      name,
      portType,
      dataType: options.type || 'any',
      value: defaultValue as T,
      defaultValue: defaultValue as T,
      options,
      connections: []
    };
    
    this.inputs.push(port as InputPort);
    return port;
  }
  
  out<T>(name: string, portType: PortType = 'param'): OutputPort<T> {
    const port: OutputPort<T> = {
      id: `${this.id}_out_${name}`,
      name,
      portType,
      dataType: 'any',
      value: undefined as T,
      connections: [],
      
      setValue: (value: T) => {
        port.value = value;
        // Propagate to connected inputs
        port.connections.forEach(conn => {
          const targetNode = this.graph.getNode(conn.to.nodeId);
          if (targetNode) {
            const targetPort = targetNode.inputs.find(p => p.id === conn.to.portId);
            if (targetPort) {
              targetPort.value = value;
              if (targetPort.onChange) {
                targetPort.onChange(value);
              }
            }
          }
        });
      },
      
      trigger: (props?: any) => {
        // Trigger connected nodes
        port.connections.forEach(conn => {
          const targetNode = this.graph.getNode(conn.to.nodeId);
          if (targetNode) {
            const targetPort = targetNode.inputs.find(p => p.id === conn.to.portId);
            if (targetPort && targetPort.onTrigger) {
              targetPort.onTrigger(props);
            }
          }
        });
      }
    };
    
    this.outputs.push(port as OutputPort);
    return port;
  }
  
  setFunction(fn: Function) {
    this.nodeFunction = fn;
  }
  
  async execute() {
    if (this.nodeFunction) {
      try {
        await this.nodeFunction(this, this.graph);
        this.error = null;
      } catch (err) {
        this.error = err as Error;
        console.error(`Error executing node ${this.name}:`, err);
      }
    }
  }
  
  log(...args: any[]) {
    console.log(`[${this.name}]`, ...args);
  }
  
  async require(packageName: string): Promise<any> {
    return this.graph.packageManager.load(packageName);
  }
  
  preserveState() {
    return {
      inputs: this.inputs.map(p => ({
        id: p.id,
        name: p.name,
        value: p.value,
        connections: p.connections.map(c => c.id)
      })),
      outputs: this.outputs.map(p => ({
        id: p.id,
        name: p.name,
        value: p.value,
        connections: p.connections.map(c => c.id)
      }))
    };
  }
  
  restoreState(state: any) {
    state.inputs.forEach((saved: any) => {
      const port = this.inputs.find(p => p.id === saved.id);
      if (port) {
        port.value = saved.value;
      }
    });
    
    state.outputs.forEach((saved: any) => {
      const port = this.outputs.find(p => p.id === saved.id);
      if (port) {
        port.value = saved.value;
      }
    });
  }
  
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      code: this.code,
      position: this.position,
      comment: this.comment
    };
  }
}
```

#### 6. `src/core/Graph.ts`

```typescript
import { Node } from './Node';
import type { Connection } from '@/types/node.types';

export class Graph {
  nodes: Node[] = [];
  connections: Connection[] = [];
  packageManager: any; // PackageManager instance
  assetManager: any; // AssetManager instance
  sceneContainer: HTMLElement;
  
  constructor() {
    this.sceneContainer = document.createElement('div');
    this.sceneContainer.id = 'cascade-scene';
  }
  
  addNode(type: string, position: { x: number; y: number }): Node {
    const id = `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const node = new Node(id, type, this);
    node.position = position;
    this.nodes.push(node);
    return node;
  }
  
  removeNode(nodeId: string) {
    const index = this.nodes.findIndex(n => n.id === nodeId);
    if (index >= 0) {
      const node = this.nodes[index];
      
      // Call onDestroy if exists
      if (node.onDestroy) {
        node.onDestroy();
      }
      
      // Remove connections
      this.connections = this.connections.filter(
        c => c.from.nodeId !== nodeId && c.to.nodeId !== nodeId
      );
      
      // Remove node
      this.nodes.splice(index, 1);
    }
  }
  
  getNode(nodeId: string): Node | null {
    return this.nodes.find(n => n.id === nodeId) || null;
  }
  
  connect(fromPort: any, toPort: any): Connection {
    const connection: Connection = {
      id: `conn_${Date.now()}`,
      from: { 
        nodeId: fromPort.id.split('_out_')[0], 
        portId: fromPort.id 
      },
      to: { 
        nodeId: toPort.id.split('_in_')[0], 
        portId: toPort.id 
      },
      type: fromPort.portType
    };
    
    this.connections.push(connection);
    fromPort.connections.push(connection);
    toPort.connections.push(connection);
    
    return connection;
  }
  
  disconnect(connectionId: string) {
    const index = this.connections.findIndex(c => c.id === connectionId);
    if (index >= 0) {
      const conn = this.connections[index];
      
      // Remove from port connections
      this.nodes.forEach(node => {
        node.inputs.forEach(p => {
          p.connections = p.connections.filter(c => c.id !== connectionId);
        });
        node.outputs.forEach(p => {
          p.connections = p.connections.filter(c => c.id !== connectionId);
        });
      });
      
      this.connections.splice(index, 1);
    }
  }
  
  execute(entryNode?: Node) {
    if (entryNode) {
      entryNode.execute();
    } else {
      // Execute all nodes with no input connections
      this.nodes.forEach(node => {
        if (node.inputs.every(p => p.connections.length === 0)) {
          node.execute();
        }
      });
    }
  }
  
  toJSON() {
    return {
      version: '1.0.0',
      nodes: this.nodes.map(n => n.toJSON()),
      connections: this.connections
    };
  }
}
```

#### 7. `src/editor/Canvas.svelte`

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { Graph } from '@/core/Graph';
  import NodeUI from './NodeUI.svelte';
  
  export let graph = new Graph();
  
  let canvas: HTMLDivElement;
  let transform = { x: 0, y: 0, zoom: 1 };
  let isPanning = false;
  let selectedNodes: string[] = [];
  
  function handleMouseDown(e: MouseEvent) {
    if (e.button === 0 && e.spaceKey) {
      isPanning = true;
    }
  }
  
  function handleMouseMove(e: MouseEvent) {
    if (isPanning) {
      transform.x += e.movementX;
      transform.y += e.movementY;
      transform = transform;
    }
  }
  
  function handleMouseUp() {
    isPanning = false;
  }
  
  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY * -0.001;
    transform.zoom = Math.max(0.1, Math.min(2, transform.zoom + delta));
    transform = transform;
  }
  
  onMount(() => {
    // Create example nodes for testing
    const timer = graph.addNode('Timer', { x: 100, y: 100 });
    const viewer = graph.addNode('Viewer', { x: 400, y: 100 });
    
    // Load Timer node code
    timer.code = `
const tick = node.out('tick', 'trigger');
const time = node.out('time');

let frame = 0;
setInterval(() => {
  time.setValue(frame++);
  tick.trigger({ frame });
}, 1000 / 60);
    `;
    
    timer.execute();
  });
</script>

<div 
  class="canvas"
  bind:this={canvas}
  on:mousedown={handleMouseDown}
  on:mousemove={handleMouseMove}
  on:mouseup={handleMouseUp}
  on:wheel={handleWheel}
>
  <!-- Background grid -->
  <svg class="grid">
    <defs>
      <pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse">
        <circle cx="10" cy="10" r="0.5" fill="#2a2a2a" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="#0a0a0a" />
    <rect width="100%" height="100%" fill="url(#dots)" />
  </svg>
  
  <!-- Nodes -->
  <div 
    class="nodes-container"
    style="transform: translate({transform.x}px, {transform.y}px) scale({transform.zoom})"
  >
    {#each graph.nodes as node (node.id)}
      <NodeUI 
        {node}
        selected={selectedNodes.includes(node.id)}
      />
    {/each}
  </div>
</div>

<style>
  .canvas {
    position: relative;
    width: 100%;
    height: 100vh;
    overflow: hidden;
    background: #0a0a0a;
    cursor: default;
  }
  
  .grid {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  
  .nodes-container {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
  }
</style>
```

#### 8. `src/editor/NodeUI.svelte`

```svelte
<script lang="ts">
  import type { Node } from '@/core/Node';
  
  export let node: Node;
  export let selected = false;
  
  $: hasError = node.error !== null;
</script>

<div 
  class="node"
  class:selected
  class:error={hasError}
  style="left: {node.position.x}px; top: {node.position.y}px"
>
  <div class="label">{node.name}</div>
  
  <div class="body">
    {#if node.preview}
      <img src={node.preview.toDataURL?.()} alt="Preview" />
    {/if}
    
    <div class="ports">
      <div class="inputs">
        {#each node.inputs as port}
          <div class="port port-{port.portType}">
            <span class="port-label">{port.name}</span>
          </div>
        {/each}
      </div>
      
      <div class="outputs">
        {#each node.outputs as port}
          <div class="port port-{port.portType}">
            <span class="port-label">{port.name}</span>
          </div>
        {/each}
      </div>
    </div>
  </div>
  
  {#if node.comment}
    <div class="comment">{node.comment}</div>
  {/if}
  
  {#if hasError}
    <div class="error-message">{node.error?.message}</div>
  {/if}
</div>

<style>
  .node {
    position: absolute;
    min-width: 120px;
    background: #2a2a2a;
    border-radius: 4px;
    border: 2px solid transparent;
    padding: 8px;
    cursor: move;
  }
  
  .node.selected {
    border-color: #4a9eff;
  }
  
  .node.error {
    border-color: #ff4444;
  }
  
  .label {
    font-size: 12px;
    color: #888;
    margin-bottom: 4px;
  }
  
  .body {
    min-height: 40px;
  }
  
  .ports {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .port {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  
  .port::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #555;
  }
  
  .port-trigger::before {
    background: #4a9eff;
  }
  
  .port-param::before {
    background: #ffa500;
  }
  
  .port-label {
    font-size: 10px;
    color: #666;
  }
  
  .comment {
    margin-top: 4px;
    font-size: 10px;
    color: #666;
    font-style: italic;
  }
  
  .error-message {
    margin-top: 4px;
    padding: 4px;
    background: #ff4444;
    color: white;
    font-size: 10px;
    border-radius: 2px;
  }
</style>
```

#### 9. `src/App.svelte`

```svelte
<script lang="ts">
  import Canvas from './editor/Canvas.svelte';
</script>

<main>
  <Canvas />
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  
  main {
    width: 100vw;
    height: 100vh;
  }
</style>
```

#### 10. `src/main.ts`

```typescript
import App from './App.svelte';

const app = new App({
  target: document.getElementById('app')!
});

export default app;
```

#### 11. `index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cascade - Visual Programming</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

### Validation Steps

After creating Phase 1 files, run:

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Should see:
# - Canvas with dot grid background
# - Two nodes (Timer, Viewer) rendered
# - Nodes can be selected
# - Canvas can be panned with mouse
```

**Success Criteria**: You see a canvas with two nodes rendered and can interact with the UI.

---

## 🎨 Phase 2: Live Evaluation (Week 2-3)

### Goal
Implement Monaco editor with Shift+Enter compilation and state preservation.

### Files to Create

#### 1. `src/editor/CodeEditor.svelte`

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as monaco from 'monaco-editor';
  import type { Node } from '@/core/Node';
  
  export let node: Node;
  export let onClose: () => void;
  
  let container: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor;
  let status: 'idle' | 'editing' | 'compiling' | 'success' | 'error' = 'idle';
  let errorMessage = '';
  
  onMount(() => {
    editor = monaco.editor.create(container, {
      value: node.code || getDefaultNodeCode(node.type),
      language: 'typescript',
      theme: 'vs-dark',
      minimap: { enabled: false },
      fontSize: 14
    });
    
    // Shift+Enter to compile
    editor.addCommand(
      monaco.KeyMod.Shift | monaco.KeyCode.Enter,
      () => compileNode()
    );
    
    // Escape to close
    editor.addCommand(
      monaco.KeyCode.Escape,
      () => onClose()
    );
    
    editor.onDidChangeModelContent(() => {
      status = 'editing';
    });
  });
  
  onDestroy(() => {
    editor?.dispose();
  });
  
  async function compileNode() {
    status = 'compiling';
    const code = editor.getValue();
    
    try {
      // Preserve state
      const oldState = node.preserveState();
      
      // Call onDestroy
      if (node.onDestroy) {
        node.onDestroy();
      }
      
      // Compile new function
      const nodeFunction = new Function('node', 'graph', code);
      
      // Update node
      node.code = code;
      node.setFunction(nodeFunction);
      
      // Execute to initialize
      await node.execute();
      
      // Restore state
      node.restoreState(oldState);
      
      // Call onReady
      if (node.onReady) {
        node.onReady();
      }
      
      status = 'success';
      errorMessage = '';
      
      setTimeout(() => {
        if (status === 'success') {
          onClose();
        }
      }, 1000);
      
    } catch (error) {
      status = 'error';
      errorMessage = error.message;
      node.error = error;
    }
  }
  
  function getDefaultNodeCode(type: string): string {
    return `// ${type} node
export default function(node, graph) {
  // Define ports
  const trigger = node.in('trigger', 'trigger');
  const output = node.out('output');
  
  // Handle triggers
  trigger.onTrigger = () => {
    // Your code here
    output.setValue('Hello World');
  };
  
  // Lifecycle
  node.onReady = () => {
    console.log('Node ready');
  };
}`;
  }
</script>

<div class="editor-modal">
  <div class="header">
    <h3>Edit: {node.name}</h3>
    <div class="status status-{status}">
      {#if status === 'editing'}
        Editing... (Shift+Enter to compile)
      {:else if status === 'compiling'}
        ⏳ Compiling...
      {:else if status === 'success'}
        ✅ Success!
      {:else if status === 'error'}
        ❌ {errorMessage}
      {/if}
    </div>
    <button on:click={onClose}>×</button>
  </div>
  
  <div class="editor-container" bind:this={container}></div>
  
  <div class="footer">
    <button on:click={compileNode}>
      Compile (Shift+Enter)
    </button>
    <button on:click={onClose}>
      Close (Esc)
    </button>
  </div>
</div>

<style>
  .editor-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 800px;
    height: 600px;
    background: #1e1e1e;
    border-radius: 8px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    display: flex;
    flex-direction: column;
    z-index: 1000;
  }
  
  .header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px;
    border-bottom: 1px solid #333;
  }
  
  .header h3 {
    margin: 0;
    color: #fff;
  }
  
  .status {
    flex: 1;
    font-size: 14px;
    color: #888;
  }
  
  .status-error {
    color: #ff4444;
  }
  
  .status-success {
    color: #44ff44;
  }
  
  .editor-container {
    flex: 1;
  }
  
  .footer {
    display: flex;
    gap: 8px;
    padding: 16px;
    border-top: 1px solid #333;
  }
  
  button {
    padding: 8px 16px;
    background: #4a9eff;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  
  button:hover {
    background: #357abd;
  }
  
  .header button {
    margin-left: auto;
    background: transparent;
    font-size: 24px;
  }
</style>
```

Update `NodeUI.svelte` to open editor on double-click:

```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Node } from '@/core/Node';
  
  export let node: Node;
  export let selected = false;
  
  const dispatch = createEventDispatcher();
  
  function handleDoubleClick() {
    dispatch('edit', node);
  }
</script>

<div 
  class="node"
  on:dblclick={handleDoubleClick}
  ...
>
```

### Validation Steps

```bash
# Run dev server
npm run dev

# Test:
# 1. Double-click a node
# 2. See Monaco editor modal
# 3. Edit code
# 4. Press Shift+Enter
# 5. See "Success!" message
# 6. Modal closes automatically
# 7. Node behavior updated
```

---

## 📦 Phase 3: Asset Management (Week 3-4)

### Files to Create

#### 1. `src/core/AssetManager.ts`

```typescript
export type AssetType = 'image' | 'audio' | 'video' | 'json' | 'text' | 'binary';

export interface Asset {
  id: string;
  path: string;
  type: AssetType;
  data: any;
  size: number;
  metadata: Record<string, any>;
}

export class AssetManager {
  private cache = new Map<string, Asset>();
  private projectRoot: string;
  
  constructor(projectRoot: string = '') {
    this.projectRoot = projectRoot;
  }
  
  async load(path: string): Promise<Asset> {
    if (this.cache.has(path)) {
      return this.cache.get(path)!;
    }
    
    const absolutePath = this.resolve(path);
    const type = this.getAssetType(path);
    
    let data: any;
    
    switch (type) {
      case 'image':
        data = await this.loadImage(absolutePath);
        break;
      case 'json':
        data = await this.loadJSON(absolutePath);
        break;
      case 'text':
        data = await this.loadText(absolutePath);
        break;
      default:
        throw new Error(`Unsupported asset type: ${type}`);
    }
    
    const asset: Asset = {
      id: this.generateId(path),
      path,
      type,
      data,
      size: 0,
      metadata: {}
    };
    
    this.cache.set(path, asset);
    return asset;
  }
  
  private async loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }
  
  private async loadJSON(url: string): Promise<any> {
    const response = await fetch(url);
    return response.json();
  }
  
  private async loadText(url: string): Promise<string> {
    const response = await fetch(url);
    return response.text();
  }
  
  private resolve(path: string): string {
    if (path.startsWith('http')) return path;
    return `${this.projectRoot}${path}`;
  }
  
  private getAssetType(path: string): AssetType {
    const ext = path.split('.').pop()?.toLowerCase();
    
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) return 'image';
    if (['mp3', 'wav', 'ogg'].includes(ext || '')) return 'audio';
    if (['mp4', 'webm'].includes(ext || '')) return 'video';
    if (ext === 'json') return 'json';
    if (['txt', 'md'].includes(ext || '')) return 'text';
    
    return 'binary';
  }
  
  private generateId(path: string): string {
    return path.replace(/[^a-zA-Z0-9]/g, '_');
  }
}
```

Add to `Graph.ts`:

```typescript
import { AssetManager } from './AssetManager';

export class Graph {
  // ... existing code
  assetManager: AssetManager;
  
  constructor() {
    // ... existing code
    this.assetManager = new AssetManager();
  }
}
```

Update `Node.ts` to use asset manager:

```typescript
async require(packageName: string): Promise<any> {
  return this.graph.packageManager.load(packageName);
}

// Add property getter
get assets() {
  return this.graph.assetManager;
}
```

---

## 📋 Implementation Commands for Claude Code

### Phase 1 Commands

```bash
# Step 1: Initialize project
mkdir cascade && cd cascade
npm create vite@latest . -- --template svelte-ts

# Step 2: Install dependencies
npm install monaco-editor

# Step 3: Create folder structure
mkdir -p src/{core,editor,nodes/library,types,utils,stores}
mkdir -p public/runtime graphs/examples

# Step 4: Create all Phase 1 files
# (Claude Code: use the file contents provided above)

# Step 5: Run and test
npm run dev
```

### Verification Commands

```bash
# Check TypeScript compilation
npm run check

# Build for production
npm run build

# Preview production build
npm run preview
```

---

## ✅ Success Criteria

### Phase 1
- [ ] Canvas renders with dot grid
- [ ] Nodes appear at correct positions
- [ ] Can pan canvas
- [ ] Can zoom canvas
- [ ] Nodes show input/output ports

### Phase 2
- [ ] Double-click opens Monaco editor
- [ ] Can edit node code
- [ ] Shift+Enter compiles without errors
- [ ] State preserved after compilation
- [ ] ESC closes editor

### Phase 3
- [ ] Can load images as assets
- [ ] Assets cached properly
- [ ] Multiple nodes can share assets
- [ ] Asset paths resolve correctly

---

## 🚨 Critical Implementation Notes

### DO
✅ Create all TypeScript interfaces before implementations  
✅ Test each phase before moving to next  
✅ Use Svelte stores for reactive state  
✅ Follow the dual port system (trigger vs param)  
✅ Preserve node state during hot reload  

### DON'T
❌ Skip TypeScript types  
❌ Use `any` type excessively  
❌ Create nodes for primitive operations  
❌ Hardcode file paths  
❌ Forget to cleanup in onDestroy  

---

## 📖 Additional Reference

For complete details, see:
- `CASCADE_PRODUCTION_SPEC.md` - Complete specification
- `CASCADE_QUICK_REFERENCE.md` - Quick patterns and tips

---

**This spec is ready for Claude Code to implement Phase 1-3 immediately.**

Start with: `claude code implement Phase 1` 🚀
