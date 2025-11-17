# Cascade Framework - Production Specification
## Open-Source Visual Programming for Creative Coders
**Version**: 1.0  
**Author**: FIELD.IO  
**Stack**: TypeScript + Svelte + Vite  
**Philosophy**: Nodes.io-inspired, programmer-first visual coding  

---

# Table of Contents

1. [Overview & Philosophy](#1-overview--philosophy)
2. [Project Architecture](#2-project-architecture)
3. [Core Systems](#3-core-systems)
4. [Asset Management](#4-asset-management)
5. [UI/UX Specifications](#5-uiux-specifications)
6. [Live Evaluation System](#6-live-evaluation-system)
7. [Node API Reference](#7-node-api-reference)
8. [Graph File Format](#8-graph-file-format)
9. [Export System](#9-export-system)
10. [NPM Package Integration](#10-npm-package-integration)
11. [Implementation Roadmap](#11-implementation-roadmap)
12. [Complete Code Examples](#12-complete-code-examples)

---

# 1. Overview & Philosophy

## Core Philosophy (from Nodes.io)

**"Making programming more visual without making it less powerful"**

Cascade is a visual programming framework designed for **creative coders**, not visual designers. Every node is just a TypeScript/JavaScript function. The visual graph and code are **equal partners**, not abstractions of each other.

### Key Principles

✅ **Live Evaluation** - Shift+Enter compiles code without destroying state  
✅ **Code-First** - Every node is just a function, fully inspectable  
✅ **High-Level Nodes** - No primitive operations (add, multiply, if-statements)  
✅ **Visual Literate Programming** - Code, visuals, and documentation coexist  
✅ **Production-Ready** - Export to standalone HTML from day one  
✅ **Programmer-First** - Power users can memorize shortcuts and work fast  

### What Cascade Is NOT

❌ **Not a beginner tool** - Assumes programming knowledge  
❌ **Not visual Scratch** - No dragging blocks, you write real code  
❌ **Not hiding code** - Code is always accessible and primary  
❌ **Not dumbing down** - Full power of JavaScript/TypeScript available  

### Target Use Cases

- Generative art systems (FIELD.IO's primary use case)
- Creative coding experiments
- Data visualization pipelines
- Audio-visual performances
- Interactive installations
- Rapid prototyping of visual systems

### Inspiration Sources

- **Nodes.io** - Core philosophy, live evaluation, dual port system
- **TouchDesigner** - Visual flow, operator networks, realtime feedback
- **Houdini** - Node-based procedural systems, parameter-driven design
- **Max/MSP** - Patching paradigm, audio-visual programming
- **Figma** - Modern UI patterns, keyboard shortcuts, polish

---

# 2. Project Architecture

## Directory Structure

```
cascade/
├── src/
│   ├── core/
│   │   ├── Node.ts              # Base node class
│   │   ├── Port.ts              # Trigger & Param ports
│   │   ├── Graph.ts             # Graph execution engine
│   │   ├── Executor.ts          # Execution scheduler
│   │   ├── AssetManager.ts      # Asset loading & management
│   │   └── PackageManager.ts    # NPM package loader
│   ├── editor/
│   │   ├── Canvas.svelte        # Main graph canvas
│   │   ├── NodeUI.svelte        # Visual node representation
│   │   ├── Connection.svelte    # Connection lines
│   │   ├── Inspector.svelte     # Parameter panel
│   │   ├── Editor.svelte        # Code editor (Monaco)
│   │   ├── BottomToolbar.svelte # FigJam-style toolbar
│   │   ├── NodePanel.svelte     # Category panel
│   │   └── AssetBrowser.svelte  # Asset management UI
│   ├── nodes/
│   │   └── library/
│   │       ├── Timer.node.ts
│   │       ├── ImageLoader.node.ts
│   │       └── CanvasViewer.node.ts
│   ├── types/
│   │   ├── node.types.ts
│   │   ├── graph.types.ts
│   │   └── asset.types.ts
│   ├── utils/
│   │   ├── serialization.ts
│   │   ├── export.ts
│   │   └── keybindings.ts
│   └── main.ts
├── public/
│   └── runtime/                 # Minimal runtime for exports
├── graphs/
│   └── examples/                # Example graph files
├── package.json
├── vite.config.ts
├── tsconfig.json
└── README.md
```

## Tech Stack

### Core Dependencies
```json
{
  "dependencies": {
    "svelte": "^4.0.0",
    "monaco-editor": "^0.44.0",
    "litegraph.js": "^0.7.16"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^3.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "@types/node": "^20.0.0"
  }
}
```

### Why These Choices?

- **Svelte** - Reactive, minimal runtime, fast compilation
- **Monaco** - VSCode editor, excellent TypeScript support
- **LiteGraph.js** - Canvas-based graph rendering (performance)
- **Vite** - Fast dev server, easy builds
- **TypeScript** - Type safety, better DX

---

# 3. Core Systems

## 3.1 Node System

### Node Structure

Every node is a **pure function** that receives two parameters:
- `node` - The node instance (for declaring ports, state, etc.)
- `graph` - The graph context (for global state, assets, etc.)

```typescript
// Basic node signature
export default function(node: NodeContext, graph: GraphContext) {
  // 1. Declare input ports
  const trigger = node.in('trigger', 'trigger');
  const value = node.in('value', 0, { type: 'number' });
  
  // 2. Declare output ports
  const output = node.out('result');
  const onComplete = node.out('onComplete', 'trigger');
  
  // 3. Handle triggers
  trigger.onTrigger = () => {
    const result = value.value * 2;
    output.setValue(result);
    onComplete.trigger();
  };
  
  // 4. Lifecycle hooks (optional)
  node.onReady = () => {
    // Called when node is ready
  };
  
  node.onDestroy = () => {
    // Cleanup before recompilation
  };
}
```

### Node Context API

```typescript
interface NodeContext {
  // Metadata
  id: string;
  name: string;
  type: string;
  
  // Port declaration
  in<T>(name: string, defaultValue?: T, options?: PortOptions): InputPort<T>;
  out<T>(name: string, type?: string): OutputPort<T>;
  
  // Visual properties
  position: { x: number; y: number };
  preview: HTMLCanvasElement | HTMLImageElement | null;
  comment: string;
  
  // State
  error: Error | null;
  warning: string | null;
  isTemplate: boolean;
  
  // Lifecycle hooks
  onReady: () => void;
  onDestroy: () => void;
  
  // Utilities
  log(...args: any[]): void;
  require(packageName: string): Promise<any>;
  
  // AI helpers (optional)
  aiMethods?: {
    explain: () => string;
    suggest: () => any;
    optimize: () => void;
  };
}
```

### Node States

Nodes have visual states that reflect their execution status:

- **Inactive** (dark grey) - Has untriggered trigger port
- **Active** (light grey) - Running without errors
- **Warning** (yellow border) - Type mismatch or non-critical issue
- **Error** (red border) - Compilation or runtime error

---

## 3.2 Port System (Dual System)

Cascade uses **two distinct port types** inspired by Nodes.io:

### Trigger Ports (Execution Flow)

- **Visual**: Solid lines, blue color
- **Purpose**: Control execution flow (like function calls)
- **Semantics**: "When this fires, do something"
- **Fire rate**: Every frame for realtime operations
- **Callback-based**: `triggerOut.trigger(props)`

```typescript
// Output trigger
const onComplete = node.out('onComplete', 'trigger');
onComplete.trigger({ time: performance.now() });

// Input trigger
const trigger = node.in('trigger', 'trigger');
trigger.onTrigger = (props) => {
  console.log('Triggered at time:', props.time);
  // Execute node logic
};
```

### Param Ports (Data Flow)

- **Visual**: Dotted lines, orange color
- **Purpose**: Pass data between nodes
- **Semantics**: "Here's a value you can use"
- **Fire rate**: Only when values change
- **Value-based**: `paramOut.setValue(data)`

```typescript
// Output param
const output = node.out('result');
output.setValue(42);

// Input param (read synchronously)
const input = node.in('value', 0);
console.log(input.value); // 42

// Or subscribe to changes
input.onChange = (newValue) => {
  console.log('Value changed:', newValue);
};
```

### Port Options

```typescript
interface PortOptions {
  type?: 'number' | 'string' | 'boolean' | 'color' | 'asset' | 'array' | 'object';
  min?: number;
  max?: number;
  step?: number;
  values?: any[]; // Dropdown options
  accept?: string[]; // File types for assets
  description?: string;
  hidden?: boolean;
  published?: boolean; // Show in exported bundle
}

// Examples
node.in('scale', 0.01, {
  type: 'number',
  min: 0.001,
  max: 1,
  step: 0.001,
  description: 'Noise scale factor'
});

node.in('image', '', {
  type: 'asset',
  accept: ['image/*'],
  description: 'Source image'
});

node.in('mode', 'normal', {
  type: 'string',
  values: ['normal', 'multiply', 'screen', 'overlay']
});
```

---

## 3.3 Graph Execution

### Execution Model

Cascade uses a **demand-driven execution model**:

1. Trigger ports fire events
2. Events propagate through trigger connections
3. Param ports are read on-demand
4. Nodes execute when triggered
5. Output values update downstream param connections

```typescript
class GraphExecutor {
  private executionQueue: Node[] = [];
  private executingNodes: Set<Node> = new Set();
  
  execute(entryNode: Node) {
    // Start execution from entry point
    this.executionQueue.push(entryNode);
    
    while (this.executionQueue.length > 0) {
      const node = this.executionQueue.shift()!;
      
      // Prevent circular execution
      if (this.executingNodes.has(node)) {
        continue;
      }
      
      this.executingNodes.add(node);
      
      try {
        // Execute node (triggers will queue downstream nodes)
        node.execute();
      } catch (error) {
        node.error = error;
        console.error(`Error in node ${node.name}:`, error);
      } finally {
        this.executingNodes.delete(node);
      }
    }
  }
  
  // Schedule node for next frame
  scheduleExecution(node: Node, delay = 0) {
    setTimeout(() => {
      this.execute(node);
    }, delay);
  }
}
```

### Execution Entry Points

Graphs can have multiple entry points:

```typescript
interface GraphMetadata {
  entryPoints: string[]; // Node IDs to start execution
  autoStart: boolean;     // Run automatically on load
  fps?: number;           // Target frame rate (if using Timer node)
}

// Example: Animation loop
{
  "entryPoints": ["timer_1"],
  "autoStart": true,
  "fps": 60
}
```

---

# 4. Asset Management

## Philosophy

All project assets (images, audio, video, data files, fonts, 3D models) are stored in a dedicated folder alongside the graph JSON. This ensures projects are **completely self-contained** and can be:

- Zipped and shared without broken links
- Versioned in Git with relative paths
- Exported as standalone bundles
- Moved between machines without issues

## Project Structure

```
my-project/
├── flow-field.cascade.json          # Main graph file
├── assets/                          # All project assets
│   ├── images/
│   │   ├── background.jpg
│   │   ├── texture-001.png
│   │   └── sprites/
│   │       └── particle.png
│   ├── audio/
│   │   ├── ambient.mp3
│   │   └── hit.wav
│   ├── data/
│   │   ├── points.json
│   │   └── config.toml
│   ├── fonts/
│   │   └── custom.ttf
│   └── models/
│       └── scene.gltf
├── nodes/                           # Custom nodes (optional)
│   └── CustomEffect.node.ts
└── README.md
```

## Asset Manager API

```typescript
interface AssetManager {
  /**
   * Load an asset by path (relative to graph file)
   * Automatically caches loaded assets
   */
  load(path: string): Promise<Asset>;
  
  /**
   * Load an asset by manifest ID
   */
  get(id: string): Promise<Asset>;
  
  /**
   * Add a new asset to the project
   * Copies file to assets folder and updates manifest
   */
  add(file: File, options?: AddAssetOptions): Promise<string>;
  
  /**
   * Remove an asset from project
   * Only removes if not referenced by any node
   */
  remove(id: string): Promise<void>;
  
  /**
   * Get all assets of a specific type
   */
  list(filter?: AssetFilter): Asset[];
  
  /**
   * Resolve relative path to absolute URL
   */
  resolve(path: string): string;
  
  /**
   * Watch for asset changes (hot reload)
   */
  watch(path: string, callback: (asset: Asset) => void): () => void;
  
  /**
   * Preload multiple assets
   */
  preload(paths: string[]): Promise<void>;
  
  /**
   * Clear unused assets
   */
  cleanup(): Promise<string[]>;
}

interface Asset {
  id: string;
  path: string;
  type: AssetType;
  data: any; // Loaded data (Image, AudioBuffer, ArrayBuffer, etc.)
  metadata: Record<string, any>;
  size: number;
  hash: string;
}

type AssetType = 
  | 'image' 
  | 'audio' 
  | 'video' 
  | 'font' 
  | 'json' 
  | 'text'
  | 'binary'
  | 'model'
  | 'shader';
```

## Asset Referencing in Nodes

```typescript
export default async function(node: NodeContext, graph: GraphContext) {
  // Asset path input with file picker
  const imagePath = node.in('image', '', {
    type: 'asset',
    accept: ['image/*'],
    description: 'Source image to process'
  });
  
  const trigger = node.in('process', 'trigger');
  const output = node.out('result');
  
  let sourceImage: HTMLImageElement | null = null;
  
  // Load image when path changes
  imagePath.onChange = async (path) => {
    if (!path) return;
    
    try {
      const asset = await graph.assets.load(path);
      sourceImage = asset.data as HTMLImageElement;
      node.comment = `${sourceImage.width}×${sourceImage.height}`;
    } catch (error) {
      node.error = error;
    }
  };
  
  trigger.onTrigger = () => {
    if (!sourceImage) {
      node.error = new Error('No image loaded');
      return;
    }
    
    // Process image...
    output.setValue(processedImage);
  };
}
```

## Asset Manifest in Graph JSON

```json
{
  "$schema": "./cascade.schema.json",
  "version": "1.0.0",
  "metadata": {
    "name": "Flow Field Particles",
    "description": "Particles following Perlin noise vectors"
  },
  "assets": {
    "manifest": [
      {
        "id": "bg-image",
        "path": "./assets/images/background.jpg",
        "type": "image",
        "size": 2048576,
        "hash": "sha256:abc123...",
        "metadata": {
          "width": 1920,
          "height": 1080,
          "format": "jpeg"
        }
      },
      {
        "id": "ambient-sound",
        "path": "./assets/audio/ambient.mp3",
        "type": "audio",
        "size": 5242880,
        "hash": "sha256:def456...",
        "metadata": {
          "duration": 180,
          "format": "mp3",
          "bitrate": 320
        }
      }
    ]
  },
  "nodes": [...],
  "connections": [...]
}
```

## Hot Reload

During development, assets can be edited externally and automatically reload:

```typescript
// Watch for asset changes
graph.assets.watch('./assets/images/bg.jpg', (asset) => {
  console.log('Asset updated:', asset.path);
  
  // Update all nodes using this asset
  graph.nodes.forEach(node => {
    node.inputs.forEach(input => {
      if (input.value === asset.path) {
        input.setValue(asset.path, { force: true });
      }
    });
  });
});
```

---

# 5. UI/UX Specifications

## 5.1 Overall Layout

### Default View (Normal Mode)

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Cascade  [File] [Edit] [View] [Graph]    [Assets 📁] [Export 📦] [? Help] │ ← Menu Bar
├────────┬───────────────────────────────────────────────────────┬────────────┤
│ Layers │                                                       │ Inspector  │
│  [+]   │                                                       │            │
│        │                                                       │  Width     │
│ Timer  │            Canvas (Graph View)                       │  [■■■] 800 │
│ Flow   │                                                       │            │
│ Viewer │                                                       │  Height    │
│        │         Nodes & connections displayed here           │  [■■■] 600 │
│ Search │                                                       │            │
│ [🔍]   │                                                       │  Preview   │
│ [___]  │                                                       │  [image]   │
│        │                                                       │            │
│  240px │                                                       │    320px   │
├────────┴───────────────────────────────────────────────────────┴────────────┤
│  [↖][✋] │ [📥Input] [➕Math] [🎨Lens] [🎲3D] [🔊Audio] [📤Output] │ [⚙]     │ ← Bottom Toolbar
└────────────────────────────────────────────────────────────────────────────┘
   Tools        Node Categories (expandable panels)               Settings
```

### Key Dimensions

- **Menu Bar**: 40px height
- **Left Panel (Layers)**: 240px width (collapsible)
- **Right Panel (Inspector)**: 320px width (collapsible)
- **Bottom Toolbar**: 56px height (hideable)
- **Canvas**: Fills remaining space

---

## 5.2 Canvas Component

### Features

- **Pan**: Space + Drag or Hand Tool (H)
- **Zoom**: ⌘+/⌘- or scroll wheel
- **Select**: Click or drag rectangle (V)
- **Multi-select**: Shift+Click
- **Vertical Flow**: Nodes arranged top-to-bottom by default
- **Dot Grid**: Subtle background with major/minor dots
- **Snap to Grid**: Optional (toggle with ⌘Shift+G)

### Canvas.svelte Structure

```svelte
<script lang="ts">
  import { Graph } from '../core/Graph';
  import NodeUI from './NodeUI.svelte';
  import Connection from './Connection.svelte';
  
  let graph = new Graph();
  let transform = { x: 0, y: 0, zoom: 1 };
  let selectedNodes: Node[] = [];
  let tool: 'select' | 'hand' = 'select';
  
  // Keyboard shortcuts
  function handleKeyPress(e: KeyboardEvent) {
    if (e.key === 'v') tool = 'select';
    if (e.key === 'h') tool = 'hand';
    if (e.key === 'Tab') {
      e.preventDefault();
      showNodeSearch();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteSelectedNodes();
    }
  }
  
  // Pan with Space + Drag
  function handleMouseMove(e: MouseEvent) {
    if (e.buttons === 1 && (keys.space || tool === 'hand')) {
      transform.x += e.movementX;
      transform.y += e.movementY;
    }
  }
  
  // Zoom
  function handleWheel(e: WheelEvent) {
    const zoomSpeed = 0.001;
    const newZoom = transform.zoom * (1 - e.deltaY * zoomSpeed);
    transform.zoom = Math.max(0.1, Math.min(2, newZoom));
  }
</script>

<svelte:window on:keydown={handleKeyPress} />

<div class="canvas" 
  on:mousemove={handleMouseMove}
  on:wheel={handleWheel}>
  
  <!-- Dot grid background -->
  <svg class="grid">
    <rect fill="#0a0a0a" width="100%" height="100%" />
    <pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="10" cy="10" r="0.5" fill="#2a2a2a" />
    </pattern>
    <rect fill="url(#dots)" width="100%" height="100%" />
  </svg>
  
  <!-- Connections -->
  <svg class="connections">
    {#each graph.connections as conn}
      <Connection {conn} {transform} />
    {/each}
  </svg>
  
  <!-- Nodes -->
  <div class="nodes" style="transform: translate({transform.x}px, {transform.y}px) scale({transform.zoom})">
    {#each graph.nodes as node}
      <NodeUI 
        {node} 
        selected={selectedNodes.includes(node)}
        on:select={() => selectNode(node)}
        on:edit={() => openCodeEditor(node)} />
    {/each}
  </div>
</div>
```

---

## 5.3 Bottom Toolbar (FigJam-style)

### Design

- **Position**: Fixed at bottom, always visible (unless presentation mode)
- **Height**: 56px
- **Background**: Semi-transparent dark with backdrop blur
- **Style**: Modern, flat, with hover states

### Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│  [↖] [✋] │ [📥Input] [➕Math] [🎨Lens] [🎲3D] [🔊Audio] [📤Output] │[⚙]│
└────────────────────────────────────────────────────────────────────────┘
   Tools          Node Categories (click to expand)              Settings
```

### Node Categories

Each category opens a panel above the toolbar:

#### Input 📥
- Image Loader
- Audio Input
- Video Capture
- Keyboard/Mouse
- Timer/Clock
- File Loader
- Random/Noise

#### Math ➕
- Add/Subtract/Multiply/Divide
- Trigonometry (Sin/Cos/Tan)
- Min/Max/Clamp
- Remap/Lerp
- Vector Math
- Matrix Operations

#### Lens 🎨 (Image Processing)
- Blur (Gaussian/Box/Motion)
- Brightness/Contrast
- Hue/Saturation
- Threshold
- Edge Detection
- Blend Modes
- Feedback

#### 3D 🎲
- Three.js Scene
- Camera/Mesh/Material
- Light
- Model Loader (GLTF/OBJ)
- Shader
- Particles 3D

#### Audio 🔊
- Oscillator
- FFT Analyzer
- Beat Detection
- Audio Player
- Filter/Reverb/Delay
- Waveform Visualizer

#### Logic 🔀
- If/Else
- Switch/Case
- Compare
- Gate (AND/OR/NOT)
- Counter/Accumulator
- Delay/Throttle

#### Output 📤
- Canvas Viewer
- Image Export
- Video Recorder
- Console Log
- File Download

### Node Panel (Example: Math Category)

```
┌──────────────────────────────────────────────────────────────────┐
│  Math Nodes                                               [×]    │
│  ┌────────┬────────┬────────┬────────┬────────┬────────┐        │
│  │  [➕]  │  [➖]  │  [✖️]  │  [➗]  │  [%]   │  [^]   │        │
│  │  Add   │  Sub   │  Mult  │  Div   │  Mod   │  Power │        │
│  ├────────┼────────┼────────┼────────┼────────┼────────┤        │
│  │  [~]   │ [cos]  │ [tan]  │ [min]  │ [max]  │  [↕]   │        │
│  │  Sin   │  Cos   │  Tan   │  Min   │  Max   │ Clamp  │        │
│  └────────┴────────┴────────┴────────┴────────┴────────┘        │
│                                                                  │
│  🔍 Search nodes...                                              │
└──────────────────────────────────────────────────────────────────┘
```

### Node Creation Modes

**1. Drag-to-Add**
- Drag node card from panel onto canvas
- Ghost node follows cursor
- Drop to place

**2. Click-to-Place**
- Click node card
- Cursor becomes ghost node
- Click canvas to place
- ESC to cancel

---

## 5.4 Presentation Mode (⌘.)

### Purpose

Hide all UI chrome for **distraction-free editing** and **client presentations**.

### Behavior

**Toggle**: Press ⌘. (Command + Period)

**Normal Mode** → **Presentation Mode**:
- Menu bar fades out
- Left panel (Layers) slides left
- Right panel (Inspector) slides right
- Bottom toolbar slides down
- Canvas expands to full screen

**When Node Selected in Presentation Mode**:
- Inspector slides in from right
- Shows only selected node's parameters
- Minimal, focused interface
- Auto-hides after deselection (optional)

### Implementation

```typescript
// Store for UI state
export const uiState = writable({
  presentationMode: false,
  showMenuBar: true,
  showLeftPanel: true,
  showRightPanel: true,
  showBottomToolbar: true,
  selectedNode: null
});

// Toggle function
export function togglePresentationMode() {
  uiState.update(state => ({
    ...state,
    presentationMode: !state.presentationMode,
    showMenuBar: state.presentationMode,
    showLeftPanel: state.presentationMode,
    showRightPanel: false, // Only show when node selected
    showBottomToolbar: state.presentationMode
  }));
}

// Auto-show inspector on selection
uiState.subscribe(state => {
  if (state.presentationMode && state.selectedNode) {
    state.showRightPanel = true;
  } else if (state.presentationMode && !state.selectedNode) {
    state.showRightPanel = false;
  }
});
```

---

## 5.5 Inspector Panel

### Purpose

Show and edit parameters for selected node(s).

### Dynamic Widget Generation

```typescript
function getWidget(port: Port): WidgetType {
  const { type, options } = port;
  
  if (type === 'number') {
    if (options.min !== undefined && options.max !== undefined) {
      return 'Slider'; // Range input
    }
    return 'NumberInput';
  }
  
  if (type === 'color') return 'ColorPicker';
  if (type === 'string' && options.multiline) return 'TextArea';
  if (type === 'boolean') return 'Checkbox';
  if (type === 'asset') return 'AssetPicker';
  if (options.values) return 'Dropdown';
  if (type === 'array') return 'ArrayEditor';
  if (type === 'object') return 'JSONEditor';
  
  return 'TextInput';
}
```

### Inspector.svelte

```svelte
<script lang="ts">
  export let selectedNode: Node | null;
  
  $: widgets = selectedNode?.inputs.map(port => ({
    port,
    widget: getWidget(port)
  })) || [];
</script>

{#if selectedNode}
  <div class="inspector">
    <h3>{selectedNode.name}</h3>
    
    <div class="params">
      {#each widgets as { port, widget }}
        <div class="param-row">
          <label>{port.name}</label>
          
          {#if widget === 'Slider'}
            <input 
              type="range"
              bind:value={port.value}
              min={port.options.min}
              max={port.options.max}
              step={port.options.step} />
            <span class="value">{port.value}</span>
          {/if}
          
          {#if widget === 'ColorPicker'}
            <ColorPicker bind:value={port.value} />
          {/if}
          
          {#if widget === 'AssetPicker'}
            <AssetPicker bind:value={port.value} accept={port.options.accept} />
          {/if}
          
          <!-- More widgets... -->
        </div>
      {/each}
    </div>
    
    <!-- Trigger buttons -->
    <div class="triggers">
      {#each selectedNode.inputs.filter(p => p.type === 'trigger') as trigger}
        <button on:click={() => trigger.onTrigger()}>
          {trigger.name}
        </button>
      {/each}
    </div>
    
    <!-- Preview -->
    {#if selectedNode.preview}
      <div class="preview">
        <img src={selectedNode.preview} alt="Preview" />
      </div>
    {/if}
    
    <!-- Save as Template -->
    <button on:click={() => saveAsTemplate(selectedNode)}>
      Save as Template
    </button>
  </div>
{/if}
```

---

# 6. Live Evaluation System

## Philosophy

**Live evaluation** is the core feature that makes Cascade powerful. You can edit node code and press **Shift+Enter** to recompile WITHOUT losing state.

## How It Works

1. User double-clicks node to open code editor
2. User edits TypeScript/JavaScript code
3. User presses **Shift+Enter**
4. System preserves current state (port values, connections)
5. New code is compiled (using Function constructor or eval)
6. Node function is hot-swapped
7. State is restored
8. Node re-executes if needed

## State Preservation

```typescript
class Node {
  preserveState() {
    return {
      inputs: this.inputs.map(port => ({
        id: port.id,
        value: port.value,
        connections: port.connections.map(c => c.id)
      })),
      outputs: this.outputs.map(port => ({
        id: port.id,
        value: port.value,
        connections: port.connections.map(c => c.id)
      })),
      params: { ...this.params }
    };
  }
  
  restoreState(state: any) {
    // Restore input ports
    state.inputs.forEach(saved => {
      const port = this.inputs.find(p => p.id === saved.id);
      if (port) {
        port.value = saved.value;
        // Reconnect
        saved.connections.forEach(connId => {
          const conn = graph.connections.find(c => c.id === connId);
          if (conn) port.connections.push(conn);
        });
      }
    });
    
    // Restore outputs similarly
    // Restore params
    Object.assign(this.params, state.params);
  }
}
```

## Code Editor Component

```svelte
<!-- Editor.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import * as monaco from 'monaco-editor';
  
  export let node: Node;
  export let onClose: () => void;
  
  let editor: monaco.editor.IStandaloneCodeEditor;
  let status: 'idle' | 'editing' | 'compiling' | 'success' | 'error' = 'idle';
  let errorMessage = '';
  
  onMount(() => {
    editor = monaco.editor.create(container, {
      value: node.code,
      language: 'typescript',
      theme: 'vs-dark',
      minimap: { enabled: false },
      fontSize: 14,
      lineNumbers: 'on',
      automaticLayout: true
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
    
    // Detect changes
    editor.onDidChangeModelContent(() => {
      status = 'editing';
    });
  });
  
  async function compileNode() {
    status = 'compiling';
    const code = editor.getValue();
    
    try {
      // Preserve state
      const oldState = node.preserveState();
      
      // Call onDestroy if exists
      if (node.onDestroy) {
        node.onDestroy();
      }
      
      // Compile new function
      const nodeFunction = new Function('node', 'graph', `
        ${code}
        return arguments.callee;
      `);
      
      // Hot-swap
      node.code = code;
      node.setFunction(nodeFunction);
      
      // Execute function to re-initialize
      nodeFunction(node, graph);
      
      // Restore state
      node.restoreState(oldState);
      
      // Call onReady if exists
      if (node.onReady) {
        node.onReady();
      }
      
      status = 'success';
      errorMessage = '';
      
      // Re-execute if needed
      if (node.isDirty) {
        node.execute();
      }
      
      // Auto-close after 1s
      setTimeout(() => {
        if (status === 'success') {
          onClose();
        }
      }, 1000);
      
    } catch (error) {
      status = 'error';
      errorMessage = error.message;
      node.error = error;
      console.error('Compilation error:', error);
    }
  }
</script>

<div class="editor-modal">
  <div class="editor-header">
    <h3>{node.name}</h3>
    <div class="status status-{status}">
      {#if status === 'editing'}
        <span>Editing... (Shift+Enter to compile)</span>
      {:else if status === 'compiling'}
        <span>⏳ Compiling...</span>
      {:else if status === 'success'}
        <span>✅ Compiled successfully!</span>
      {:else if status === 'error'}
        <span>❌ {errorMessage}</span>
      {/if}
    </div>
    <button on:click={onClose}>×</button>
  </div>
  
  <div bind:this={container} class="editor-container"></div>
  
  <div class="editor-footer">
    <button on:click={compileNode} disabled={status === 'compiling'}>
      Compile (Shift+Enter)
    </button>
    <button on:click={onClose}>Close (Esc)</button>
  </div>
</div>
```

---

# 7. Node API Reference

## Complete API

```typescript
// Node function signature
export default function(node: NodeContext, graph: GraphContext) {
  // Your node code
}

interface NodeContext {
  // === Identity ===
  id: string;                        // Unique node ID
  name: string;                      // Node name (editable)
  type: string;                      // Node type (e.g., "Timer", "Blur")
  
  // === Port Declaration ===
  in<T>(
    name: string,
    defaultValue?: T,
    options?: PortOptions
  ): InputPort<T>;
  
  out<T>(
    name: string,
    type?: 'trigger' | 'param'
  ): OutputPort<T>;
  
  // === Visual Properties ===
  position: { x: number; y: number };  // Node position on canvas
  preview: HTMLCanvasElement | HTMLImageElement | null;  // Visual preview
  comment: string;                     // Comment below node
  
  // === State ===
  error: Error | null;                 // Runtime error
  warning: string | null;              // Non-critical warning
  isTemplate: boolean;                 // Is this a template node?
  isDirty: boolean;                    // Needs re-execution?
  
  // === Lifecycle Hooks ===
  onReady: () => void;                 // Called after compilation
  onDestroy: () => void;               // Called before recompilation
  
  // === Utilities ===
  log(...args: any[]): void;           // Log to console and node
  require(packageName: string): Promise<any>;  // Load NPM package
  
  // === AI Helpers (Optional) ===
  aiMethods?: {
    explain: () => string;             // Explain what node does
    suggest: () => any;                // Suggest settings/connections
    optimize: () => void;              // Optimize node performance
  };
}

interface GraphContext {
  // === Nodes ===
  nodes: Node[];                       // All nodes in graph
  getNode(id: string): Node | null;    // Get node by ID
  addNode(type: string, position: { x: number; y: number }): Node;
  removeNode(id: string): void;
  
  // === Connections ===
  connections: Connection[];           // All connections
  connect(from: OutputPort, to: InputPort): Connection;
  disconnect(connection: Connection): void;
  
  // === Execution ===
  execute(entryNode?: Node): void;     // Start execution
  stop(): void;                        // Stop execution
  reset(): void;                       // Reset all nodes
  
  // === Assets ===
  assets: AssetManager;                // Asset management API
  
  // === Packages ===
  packages: PackageManager;            // NPM package management
  
  // === Metadata ===
  metadata: GraphMetadata;             // Graph metadata
  
  // === UI ===
  sceneContainer: HTMLElement;         // Container for output (Viewer nodes)
  
  // === Serialization ===
  toJSON(): object;                    // Export graph as JSON
  fromJSON(json: object): void;        // Import graph from JSON
}

interface PortOptions {
  type?: 'number' | 'string' | 'boolean' | 'color' | 'asset' | 'array' | 'object';
  min?: number;
  max?: number;
  step?: number;
  values?: any[];              // Dropdown options
  accept?: string[];           // File types for assets
  description?: string;
  hidden?: boolean;
  published?: boolean;         // Show in exported bundle
  multiline?: boolean;         // For string inputs
}

interface InputPort<T> {
  id: string;
  name: string;
  value: T;
  onChange: (newValue: T) => void;     // Subscribe to changes
  onTrigger: (props?: any) => void;    // For trigger ports
  connections: Connection[];
}

interface OutputPort<T> {
  id: string;
  name: string;
  value: T;
  setValue(value: T): void;            // For param ports
  trigger(props?: any): void;          // For trigger ports
  connections: Connection[];
}
```

## Example: Complete Node

```typescript
// Blur.node.ts - Complete example with all features
export default async function(node: NodeContext, graph: GraphContext) {
  // Load npm package
  const { StackBlur } = await node.require('stackblur-canvas');
  
  // === INPUTS ===
  const input = node.in<HTMLCanvasElement>('image', null, {
    type: 'asset',
    description: 'Source image or canvas'
  });
  
  const radius = node.in<number>('radius', 10, {
    type: 'number',
    min: 0,
    max: 100,
    step: 1,
    description: 'Blur radius in pixels'
  });
  
  const trigger = node.in('process', 'trigger');
  
  // === OUTPUTS ===
  const output = node.out<HTMLCanvasElement>('result');
  const onComplete = node.out('onComplete', 'trigger');
  
  // === STATE ===
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  
  // === LIFECYCLE ===
  node.onReady = () => {
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d')!;
    node.log('Blur node ready');
  };
  
  node.onDestroy = () => {
    // Cleanup
    canvas = null;
    ctx = null;
  };
  
  // === LOGIC ===
  trigger.onTrigger = () => {
    const source = input.value;
    
    if (!source) {
      node.error = new Error('No input image');
      return;
    }
    
    try {
      // Resize canvas to match source
      canvas.width = source.width;
      canvas.height = source.height;
      
      // Draw source
      ctx.drawImage(source, 0, 0);
      
      // Apply blur
      StackBlur.canvasRGBA(canvas, 0, 0, canvas.width, canvas.height, radius.value);
      
      // Output
      output.setValue(canvas);
      node.preview = canvas;
      node.comment = `Blur radius: ${radius.value}px`;
      node.error = null;
      
      // Trigger downstream
      onComplete.trigger({ time: performance.now() });
      
    } catch (error) {
      node.error = error;
      node.log('Error:', error.message);
    }
  };
  
  // === REACTIVE UPDATES ===
  radius.onChange = (newRadius) => {
    node.log(`Radius changed to ${newRadius}`);
    // Optionally re-execute
    if (input.value) {
      trigger.onTrigger();
    }
  };
  
  // === AI HELPERS ===
  node.aiMethods = {
    explain: () => 
      'Applies Gaussian blur to an image using the StackBlur algorithm',
    
    suggest: () => ({
      goodRadiusValues: [5, 10, 20, 50],
      performance: 'O(n) regardless of blur radius',
      alternatives: ['Box Blur (faster)', 'Motion Blur (directional)']
    }),
    
    optimize: () => {
      // Switch to WebGL implementation for large images
      if (canvas.width * canvas.height > 1920 * 1080) {
        node.warning = 'Consider using WebGL blur for large images';
      }
    }
  };
}
```

---

# 8. Graph File Format

## JSON Structure

```json
{
  "$schema": "./cascade.schema.json",
  "version": "1.0.0",
  
  "metadata": {
    "name": "Flow Field Particles",
    "description": "Particles following Perlin noise vectors",
    "author": "FIELD.IO",
    "created": "2024-01-15T10:30:00Z",
    "modified": "2024-01-20T15:45:00Z",
    "tags": ["generative", "particles", "flow-field", "perlin-noise"],
    "thumbnail": "./assets/thumbnail.png"
  },
  
  "packages": [
    { "name": "simplex-noise", "version": "4.0.0" },
    { "name": "chroma-js", "version": "2.4.2" }
  ],
  
  "assets": {
    "manifest": [
      {
        "id": "bg-image",
        "path": "./assets/images/background.jpg",
        "type": "image",
        "size": 2048576,
        "hash": "sha256:abc123..."
      }
    ]
  },
  
  "nodes": [
    {
      "id": "timer_1",
      "type": "Timer",
      "position": { "x": 100, "y": 100 },
      "params": {
        "fps": 60
      },
      "comment": "Main animation loop"
    },
    {
      "id": "flow_field_1",
      "type": "FlowField",
      "position": { "x": 300, "y": 100 },
      "params": {
        "width": 1920,
        "height": 1080,
        "scale": 0.008,
        "colors": ["#0a0a0a", "#4a9eff", "#ffffff"]
      }
    },
    {
      "id": "custom_1",
      "type": "Custom",
      "position": { "x": 500, "y": 200 },
      "code": "// Custom node code\nexport default function(node, graph) {\n  // ...\n}"
    }
  ],
  
  "connections": [
    {
      "id": "conn_1",
      "from": { "node": "timer_1", "port": "tick" },
      "to": { "node": "flow_field_1", "port": "generate" },
      "type": "trigger"
    },
    {
      "id": "conn_2",
      "from": { "node": "timer_1", "port": "time" },
      "to": { "node": "flow_field_1", "port": "time" },
      "type": "param"
    }
  ],
  
  "execution": {
    "entryPoints": ["timer_1"],
    "autoStart": true,
    "fps": 60
  },
  
  "ui": {
    "canvas": {
      "transform": { "x": 0, "y": 0, "zoom": 1 },
      "snapToGrid": true,
      "gridSize": 20
    },
    "selectedNodes": []
  }
}
```

## Serialization API

```typescript
class Graph {
  toJSON(): object {
    return {
      $schema: './cascade.schema.json',
      version: '1.0.0',
      metadata: this.metadata,
      packages: this.packages.map(p => ({ name: p.name, version: p.version })),
      assets: {
        manifest: this.assets.list().map(a => ({
          id: a.id,
          path: a.path,
          type: a.type,
          size: a.size,
          hash: a.hash
        }))
      },
      nodes: this.nodes.map(n => n.toJSON()),
      connections: this.connections.map(c => c.toJSON()),
      execution: this.execution,
      ui: this.ui
    };
  }
  
  static fromJSON(json: any): Graph {
    const graph = new Graph();
    
    // Restore metadata
    graph.metadata = json.metadata;
    
    // Load packages
    json.packages.forEach(pkg => {
      graph.packages.add(pkg.name, pkg.version);
    });
    
    // Create nodes
    json.nodes.forEach(nodeData => {
      const node = graph.addNode(nodeData.type, nodeData.position);
      node.id = nodeData.id;
      if (nodeData.code) node.code = nodeData.code;
      if (nodeData.params) Object.assign(node.params, nodeData.params);
      if (nodeData.comment) node.comment = nodeData.comment;
    });
    
    // Restore connections
    json.connections.forEach(connData => {
      const fromNode = graph.getNode(connData.from.node);
      const toNode = graph.getNode(connData.to.node);
      if (fromNode && toNode) {
        const fromPort = fromNode.outputs.find(p => p.id === connData.from.port);
        const toPort = toNode.inputs.find(p => p.id === connData.to.port);
        if (fromPort && toPort) {
          graph.connect(fromPort, toPort);
        }
      }
    });
    
    return graph;
  }
}
```

---

# 9. Export System

## Export Formats

### 1. Single HTML File

Complete standalone bundle with embedded assets (base64):

```typescript
async function exportSingleHTML(graph: Graph): Promise<string> {
  // Bundle runtime
  const runtime = await bundleRuntime();
  
  // Embed assets as data URLs
  const embeddedAssets = await Promise.all(
    graph.assets.list().map(async (asset) => {
      const blob = await fetch(asset.path).then(r => r.blob());
      const base64 = await blobToBase64(blob);
      return {
        id: asset.id,
        path: asset.path,
        dataUrl: `data:${blob.type};base64,${base64}`
      };
    })
  );
  
  // Compile graph
  const compiledGraph = compileGraph(graph);
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${graph.metadata.name}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #0a0a0a;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    #cascade-root {
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  <div id="cascade-root"></div>
  
  <script>
    // Embedded runtime
    ${runtime}
    
    // Embedded assets
    const ASSETS = ${JSON.stringify(embeddedAssets)};
    
    // Override fetch for asset loading
    const originalFetch = window.fetch;
    window.fetch = function(url) {
      const asset = ASSETS.find(a => url.includes(a.path));
      if (asset) {
        return Promise.resolve(new Response(
          dataUrlToBlob(asset.dataUrl)
        ));
      }
      return originalFetch.apply(this, arguments);
    };
    
    // Compiled graph
    ${compiledGraph}
    
    // Start execution
    Cascade.run(graph, document.getElementById('cascade-root'));
  </script>
</body>
</html>
  `;
}
```

### 2. HTML + Assets Folder

For larger projects with many/large assets:

```
exported-project/
├── index.html           # Main HTML file
├── cascade-runtime.js   # Minimal runtime (~50KB)
├── graph.js            # Compiled graph
└── assets/             # Copied assets
    ├── images/
    ├── audio/
    └── data/
```

```typescript
async function exportWithAssets(graph: Graph, outputDir: string) {
  // Copy assets folder
  await fs.copy(
    path.join(graph.projectRoot, 'assets'),
    path.join(outputDir, 'assets')
  );
  
  // Generate runtime.js
  const runtime = await bundleRuntime();
  await fs.writeFile(
    path.join(outputDir, 'cascade-runtime.js'),
    runtime
  );
  
  // Generate graph.js
  const compiledGraph = compileGraph(graph);
  await fs.writeFile(
    path.join(outputDir, 'graph.js'),
    `const graph = ${compiledGraph};\nCascade.run(graph);`
  );
  
  // Generate index.html
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>${graph.metadata.name}</title>
  <script src="cascade-runtime.js"></script>
</head>
<body>
  <div id="cascade-root"></div>
  <script src="graph.js"></script>
</body>
</html>
  `;
  
  await fs.writeFile(path.join(outputDir, 'index.html'), html);
}
```

### 3. Full Project Export

Include source code for editing:

```
exported-project/
├── graph.cascade.json   # Source graph
├── assets/             # Source assets
├── nodes/              # Custom nodes
├── index.html          # Built HTML
└── package.json        # Dependencies
```

## Minimal Runtime

The runtime is a stripped-down version of Cascade that only executes graphs, without the editor:

```typescript
// cascade-runtime.js
class CascadeRuntime {
  static run(graphData: any, container: HTMLElement) {
    const graph = this.buildGraph(graphData);
    
    // Find entry points
    const entryNodes = graphData.execution.entryPoints.map(id => 
      graph.nodes.find(n => n.id === id)
    );
    
    // Start execution
    entryNodes.forEach(node => {
      if (graphData.execution.autoStart) {
        graph.execute(node);
      }
    });
    
    // Mount to container
    container.appendChild(graph.sceneContainer);
  }
  
  private static buildGraph(graphData: any): Graph {
    // Minimal graph implementation
    // Just execution, no editor features
  }
}

// Global export
window.Cascade = CascadeRuntime;
```

---

# 10. NPM Package Integration

## Dynamic Package Loading

Cascade can load any NPM package at runtime using `node.require()`:

```typescript
export default async function(node: NodeContext, graph: GraphContext) {
  // Auto-install and load packages
  const three = await node.require('three');
  const chroma = await node.require('chroma-js');
  const _ = await node.require('lodash');
  
  // Use immediately
  const color = chroma('#4a9eff').brighten(2).hex();
  const shuffled = _.shuffle([1, 2, 3, 4, 5]);
}
```

## Package Manager API

```typescript
class PackageManager {
  private cache = new Map<string, any>();
  
  async load(packageName: string, version?: string): Promise<any> {
    const key = `${packageName}@${version || 'latest'}`;
    
    // Check cache
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    
    // Load from CDN (esm.sh or unpkg)
    const url = `https://esm.sh/${key}`;
    
    try {
      const module = await import(url);
      this.cache.set(key, module.default || module);
      return this.cache.get(key);
    } catch (error) {
      throw new Error(`Failed to load package ${key}: ${error.message}`);
    }
  }
  
  search(query: string): Promise<PackageInfo[]> {
    // Search npm registry
    return fetch(`https://registry.npmjs.org/-/v1/search?text=${query}`)
      .then(r => r.json())
      .then(data => data.objects.map(obj => obj.package));
  }
}
```

## Popular Packages for Creative Coding

Pre-configured suggestions in UI:

- **three** - 3D graphics
- **tone** - Audio synthesis
- **d3** - Data visualization
- **chroma-js** - Color manipulation
- **matter-js** - 2D physics
- **simplex-noise** - Perlin noise
- **gsap** - Animation
- **p5** - Creative coding (optional)
- **@tensorflow/tfjs** - Machine learning
- **pixi.js** - 2D WebGL rendering

---

# 11. Implementation Roadmap

## Phase 1: Core Foundation (Week 1-2)

### Goal: Basic working system

**Tasks:**
1. Project setup (Vite + TypeScript + Svelte)
2. Core classes (Node, Port, Graph)
3. Basic execution engine
4. Simple Canvas component
5. Node/Port rendering
6. Connection drawing

**Deliverable:** Can create nodes, connect ports, trigger execution

---

## Phase 2: Live Evaluation (Week 2-3)

### Goal: Code editing with hot reload

**Tasks:**
1. Monaco editor integration
2. Code editor modal
3. Shift+Enter compilation
4. State preservation system
5. Error handling and display

**Deliverable:** Can edit node code live without losing state

---

## Phase 3: Asset Management (Week 3-4)

### Goal: Self-contained projects

**Tasks:**
1. AssetManager class
2. Drag-drop asset importing
3. Asset browser panel
4. Hot reload for assets
5. Manifest generation
6. Asset picker widget

**Deliverable:** Projects with images/audio/data files all in one folder

---

## Phase 4: UI Polish (Week 4-5)

### Goal: Professional interface

**Tasks:**
1. Bottom toolbar with categories
2. Node panel with search
3. Presentation mode (⌘.)
4. Inspector panel refinement
5. Keyboard shortcuts
6. Themes and styling

**Deliverable:** Modern, Figma-quality UI

---

## Phase 5: Export System (Week 5-6)

### Goal: Standalone HTML exports

**Tasks:**
1. Graph compiler
2. Minimal runtime
3. Single HTML export
4. HTML + assets export
5. Full project export
6. Asset embedding (base64)

**Deliverable:** One-click export to shareable HTML

---

## Phase 6: Node Library (Week 6-8)

### Goal: Essential nodes for common tasks

**Tasks:**
1. Core nodes (Timer, Viewer)
2. Input nodes (Image, Audio, Mouse, Keyboard)
3. Math nodes (basic operations)
4. Lens nodes (Blur, Brightness, etc.)
5. Logic nodes (If, Switch, Counter)
6. Output nodes (Export, Console)

**Deliverable:** Can create complete projects without custom nodes

---

## Phase 7: NPM Integration (Week 8-9)

### Goal: Dynamic package loading

**Tasks:**
1. PackageManager class
2. CDN loading (esm.sh)
3. Package search UI
4. Auto-completion for packages
5. Version management

**Deliverable:** Can use any NPM package in nodes

---

## Phase 8: Polish & Testing (Week 9-10)

### Goal: Production-ready release

**Tasks:**
1. Bug fixes and stability
2. Performance optimization
3. Documentation
4. Example projects
5. Video tutorials
6. Launch!

**Deliverable:** v1.0 release ready for FIELD.IO use

---

# 12. Complete Code Examples

## Example 1: Simple Generator Node

```typescript
// Generator.node.ts
export default function(node: NodeContext, graph: GraphContext) {
  const trigger = node.in('trigger', 'trigger');
  const width = node.in('width', 512, { type: 'number', min: 1, max: 2048 });
  const height = node.in('height', 512, { type: 'number', min: 1, max: 2048 });
  const color = node.in('color', [1, 0, 0, 1], { type: 'color' });
  
  const output = node.out('canvas');
  const onComplete = node.out('onComplete', 'trigger');
  
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  
  node.onReady = () => {
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d')!;
  };
  
  trigger.onTrigger = () => {
    canvas.width = width.value;
    canvas.height = height.value;
    
    const [r, g, b, a] = color.value;
    ctx.fillStyle = `rgba(${r * 255}, ${g * 255}, ${b * 255}, ${a})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    output.setValue(canvas);
    node.preview = canvas;
    node.comment = `${canvas.width}×${canvas.height}`;
    
    onComplete.trigger();
  };
}
```

## Example 2: Timer Node

```typescript
// Timer.node.ts
export default function(node: NodeContext, graph: GraphContext) {
  const fps = node.in('fps', 60, { type: 'number', min: 1, max: 120 });
  const running = node.in('running', true, { type: 'boolean' });
  
  const tick = node.out('tick', 'trigger');
  const time = node.out('time');
  const frame = node.out('frame');
  
  let rafId: number;
  let startTime: number;
  let frameCount = 0;
  
  node.onReady = () => {
    startTime = performance.now();
    if (running.value) {
      start();
    }
  };
  
  node.onDestroy = () => {
    stop();
  };
  
  running.onChange = (isRunning) => {
    if (isRunning) {
      start();
    } else {
      stop();
    }
  };
  
  function start() {
    function loop() {
      const now = performance.now();
      const elapsed = (now - startTime) / 1000;
      
      time.setValue(elapsed);
      frame.setValue(frameCount++);
      tick.trigger({ time: elapsed, frame: frameCount });
      
      // Schedule next frame
      const targetDelay = 1000 / fps.value;
      rafId = requestAnimationFrame(loop);
    }
    
    loop();
  }
  
  function stop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
  }
}
```

## Example 3: Flow Field (with NPM package)

```typescript
// FlowField.node.ts
export default async function(node: NodeContext, graph: GraphContext) {
  const { createNoise2D } = await node.require('simplex-noise');
  const chroma = await node.require('chroma-js');
  
  const width = node.in('width', 800, { type: 'number' });
  const height = node.in('height', 600, { type: 'number' });
  const scale = node.in('scale', 0.01, { type: 'number', min: 0.001, max: 0.1 });
  const time = node.in('time', 0, { type: 'number' });
  const colors = node.in('colors', ['#000428', '#004e92'], { type: 'array' });
  const trigger = node.in('generate', 'trigger');
  
  const field = node.out('field');
  const preview = node.out('preview');
  const onComplete = node.out('onComplete', 'trigger');
  
  let noise2D: any;
  let colorScale: any;
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  
  node.onReady = () => {
    noise2D = createNoise2D();
    colorScale = chroma.scale(colors.value);
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d')!;
  };
  
  colors.onChange = (newColors) => {
    colorScale = chroma.scale(newColors);
  };
  
  trigger.onTrigger = () => {
    const w = width.value;
    const h = height.value;
    const s = scale.value;
    const t = time.value;
    
    canvas.width = w;
    canvas.height = h;
    
    const fieldData = [];
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;
    
    for (let y = 0; y < h; y++) {
      fieldData[y] = [];
      for (let x = 0; x < w; x++) {
        const noiseValue = noise2D(x * s, y * s + t);
        const angle = (noiseValue + 1) * Math.PI;
        const strength = (noiseValue + 1) / 2;
        
        fieldData[y][x] = {
          x: Math.cos(angle),
          y: Math.sin(angle),
          angle,
          strength
        };
        
        const color = colorScale(strength);
        const rgb = chroma(color).rgb();
        const index = (y * w + x) * 4;
        
        data[index] = rgb[0];
        data[index + 1] = rgb[1];
        data[index + 2] = rgb[2];
        data[index + 3] = 255;
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
    
    field.setValue(fieldData);
    preview.setValue(canvas);
    node.preview = canvas;
    node.comment = `${w}×${h} @ scale ${s}`;
    
    onComplete.trigger();
  };
}
```

## Example 4: Canvas Viewer

```typescript
// Viewer.node.ts
export default function(node: NodeContext, graph: GraphContext) {
  const input = node.in<HTMLCanvasElement>('input', null, {
    type: 'canvas',
    description: 'Canvas or image to display'
  });
  
  const scale = node.in('scale', 1, {
    type: 'number',
    min: 0.1,
    max: 2,
    step: 0.1
  });
  
  let container: HTMLElement;
  
  node.onReady = () => {
    container = graph.sceneContainer;
  };
  
  input.onChange = (canvas) => {
    if (!canvas) return;
    
    container.innerHTML = '';
    
    const wrapper = document.createElement('div');
    wrapper.style.transform = `scale(${scale.value})`;
    wrapper.style.transformOrigin = 'top left';
    wrapper.appendChild(canvas);
    
    container.appendChild(wrapper);
  };
  
  scale.onChange = (newScale) => {
    if (container.firstChild) {
      (container.firstChild as HTMLElement).style.transform = 
        `scale(${newScale})`;
    }
  };
}
```

---

# Summary

This specification provides a **complete blueprint** for implementing Cascade. Key systems:

1. **Node System** - Functions with dual port types (trigger/param)
2. **Live Evaluation** - Shift+Enter hot reload with state preservation
3. **Asset Management** - Self-contained projects with all resources
4. **Modern UI** - FigJam-style toolbar with presentation mode
5. **Export System** - Standalone HTML bundles
6. **NPM Integration** - Dynamic package loading

**Philosophy**: Programmer-first visual programming that doesn't sacrifice power for simplicity.

**Timeline**: 8-10 weeks for complete v1.0 implementation.

**Next Step**: Begin Phase 1 - Core Foundation.

Ready to build! 🚀
