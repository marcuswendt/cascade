# CASCADE UNIVERSAL SPECIFICATION
## Complete Visual Programming Framework for Creative Coders

**Version**: 0.1  
**Date**: November 18, 2025  
**Author**: FIELD.IO  
**Stack**: TypeScript + Svelte + Vite + Express  
**Philosophy**: Nodes.io-inspired, programmer-first visual coding  
**Status**: Complete specification with all features consolidated  
**Implementation Status**: ~90% Complete (see IMPLEMENTATION_STATUS.md)

---

# TABLE OF CONTENTS

1. [Overview & Philosophy](#1-overview--philosophy)
2. [Complete Feature Set](#2-complete-feature-set)
3. [Architecture](#3-architecture)
4. [Implementation Phases](#4-implementation-phases)
5. [Core Systems](#5-core-systems)
   - 5.1 [Node System](#51-node-system)
   - 5.2 [Port System](#52-port-system)
   - 5.3 [Graph Execution](#53-graph-execution)
6. [Enhanced Features](#6-enhanced-features)
   - 6.1 [Live Evaluation](#61-live-evaluation)
   - 6.2 [Props System](#62-props-system)
   - 6.3 [Node Behavior Toggles](#63-node-behavior-toggles)
   - 6.4 [Canvas Annotations](#64-canvas-annotations)
7. [Storage & Assets](#7-storage--assets)
   - 7.1 [Asset Management](#71-asset-management)
   - 7.2 [Local Server](#72-local-server)
8. [User Interface](#8-user-interface)
9. [Export System](#9-export-system)
10. [NPM Integration](#10-npm-integration)
11. [Graph File Format](#11-graph-file-format)
12. [API Reference](#12-api-reference)
13. [Keyboard Shortcuts](#13-keyboard-shortcuts)
14. [Quick Start Guide](#14-quick-start-guide)

---

# 1. Overview & Philosophy

## Core Philosophy

**"Making programming more visual without making it less powerful"**

Cascade is a visual programming framework designed for **creative coders**, not visual designers. Every node is just a TypeScript/JavaScript function. The visual graph and code are **equal partners**, not abstractions of each other.

### Key Principles

✅ **Live Evaluation** - Shift+Enter compiles code without destroying state  
✅ **Code-First** - Every node is just a function, fully inspectable  
✅ **High-Level Nodes** - No primitive operations (add, multiply)  
✅ **Visual Literate Programming** - Code, visuals, and documentation coexist  
✅ **Production-Ready** - Export to standalone HTML  
✅ **Programmer-First** - Power users with keyboard shortcuts  
✅ **Professional Tools** - Props, toggles, annotations from industry tools  

### What Cascade Is NOT

❌ **Not a beginner tool** - Assumes programming knowledge  
❌ **Not visual Scratch** - You write real code  
❌ **Not hiding code** - Code is always accessible  
❌ **Not dumbing down** - Full TypeScript/JavaScript power  

### Inspiration Sources

- **Nodes.io** - Core philosophy, live evaluation, dual port system
- **TouchDesigner** - Visual flow, operator networks, realtime feedback
- **Houdini** - Node graph workflow, bypass/cook toggles
- **Figma/FigJam** - Modern UI patterns, canvas annotations
- **Fragment** - Props system with automatic UI generation

---

# 2. Complete Feature Set

## Core Features (v1.0)
- ✅ **Node-based visual programming** - Drag, connect, execute
- ✅ **Dual port system** - Trigger ports (execution) + Param ports (data)
- ✅ **Live code evaluation** - Edit without losing state
- ✅ **Canvas with pan/zoom** - Professional graph navigation

## Enhanced Features (v1.1-1.3)
- ✅ **Props System** (v1.1) - Auto-generated UI controls for parameters
- ✅ **Node Behavior Toggles** (v1.2) - Houdini-style bypass/cook controls
- ✅ **Canvas Annotations** (v1.3) - FigJam-style text, images, groups
- ✅ **Local Server Storage** - File system based project management

## Custom Enhancements (Beyond Spec)
- ✅ **Line Annotations** - Draw lines on canvas (custom addition)
- ✅ **Polyline Annotations** - Draw polylines on canvas (custom addition)
- ✅ **Alt+H Home Shortcut** - Reset canvas view (custom addition)

## Professional Features
- ✅ **Asset Management** - Drag & drop images, audio, data
- ✅ **Inspector Panel** - Rich parameter controls
- ✅ **Export to HTML** - Standalone, shareable output
- ✅ **NPM Integration** - Use any package dynamically
- ✅ **Keyboard Shortcuts** - Power user workflows
- ✅ **Hot Reload** - WebSocket-based live updates

---

# 3. Architecture

## Technology Stack

### Frontend (Port 5173)
```
Vite + Svelte + TypeScript
├── Canvas rendering (inspired by LiteGraph.js)
├── Monaco Editor (code editing)
├── Props UI controls (12+ types)
└── Canvas annotations (text, images)
```

### Backend (Port 3030)
```
Express + Node.js + TypeScript
├── REST API (project CRUD)
├── File system storage
├── Asset management
└── WebSocket server (port 3031)
```

### Storage
```
~/cascade-projects/
├── project-1/
│   ├── graph.cascade.json
│   ├── metadata.json
│   └── assets/
│       ├── images/
│       ├── audio/
│       └── data/
└── project-2/
```

## Directory Structure

```
cascade/
├── src/                          # Frontend
│   ├── core/
│   │   ├── Node.ts              # Node class with props & toggles
│   │   ├── Port.ts              # Trigger & Param ports
│   │   ├── Graph.ts             # Execution engine
│   │   ├── AssetManager.ts      # Asset handling
│   │   └── PackageManager.ts    # NPM integration
│   ├── editor/
│   │   ├── Canvas.svelte        # Main graph canvas
│   │   ├── NodeUI.svelte        # Node rendering with toggles
│   │   ├── Inspector.svelte     # Props panel
│   │   ├── CodeEditor.svelte    # Monaco integration
│   │   ├── BottomToolbar.svelte # FigJam-style toolbar
│   │   └── Annotations.svelte   # Canvas text/images
│   ├── controls/                # Props UI controls
│   │   ├── NumberInput.svelte
│   │   ├── SliderInput.svelte
│   │   ├── ColorInput.svelte
│   │   ├── ImageInput.svelte
│   │   └── ... (12+ controls)
│   ├── services/
│   │   └── ProjectService.ts    # Server API client
│   └── nodes/library/
│       ├── Timer.node.ts
│       ├── ImageLoader.node.ts
│       └── Viewer.node.ts
├── server/                       # Backend
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/
│   │   │   ├── projects.ts
│   │   │   ├── graphs.ts
│   │   │   └── assets.ts
│   │   └── services/
│   │       ├── FileSystem.ts
│   │       └── Watcher.ts
│   └── package.json
└── package.json
```

---

# 4. Implementation Phases

## Timeline: 8-Week Development Path

### Phase 1: Core Foundation (Week 1-2)
**Goal**: Basic working system
- Node, Port, Graph classes
- Canvas with pan/zoom
- Basic node rendering
- Connection drawing
- Simple execution engine

### Phase 2: Live Evaluation (Week 2-3)
**Goal**: Code editing with hot reload
- Monaco editor integration
- Double-click to edit
- Shift+Enter compilation
- State preservation
- Error handling

### Phase 2.5: Props System (Week 3) ⭐ NEW
**Goal**: Interactive parameters with auto-UI
- Props definition API
- Control type inference
- Inspector panel
- 12+ control types
- Folders & groups
- onChange callbacks

### Phase 2.6: Node Behavior Toggles (Week 3) ⭐ NEW
**Goal**: Houdini-style execution control
- Bypass toggle (yellow band, skip execution)
- Cook toggle (blue band, force execution)
- Visual indicators
- Keyboard shortcuts (B, C)
- Multi-select support

### Phase 3: Asset Management (Week 3-4)
**Goal**: Self-contained projects
- AssetManager class
- Drag-drop import
- Caching system
- Hot reload
- Path resolution

### Phase 3.5: Local Server (Week 4) ⭐ NEW
**Goal**: File system storage
- Express REST API
- Project CRUD operations
- Graph save/load
- Asset upload
- WebSocket hot reload

### Phase 4: UI Polish & Annotations (Week 5) ⭐ ENHANCED
**Goal**: Professional interface with documentation
- Canvas annotations (text, images, groups)
- FigJam-style bottom toolbar
- Node category panels
- Inspector refinement
- Presentation mode (⌘.)
- Keyboard shortcuts

### Phase 5: Export System (Week 6)
**Goal**: Standalone HTML output
- Graph compiler
- Minimal runtime (~50KB)
- Single HTML with base64 assets
- Folder export option

### Phase 6: NPM Integration (Week 7-8)
**Goal**: Dynamic package loading
- PackageManager class
- CDN loading (esm.sh)
- Dynamic require()
- Package search UI

### Phase 7+: Cloud Sync (Future)
**Goal**: Remote collaboration
- GitHub integration
- Firebase real-time sync
- Public gallery
- Team workspaces

---

# 5. Core Systems

## 5.1 Node System

### Base Node Class

```typescript
export class Node {
  // Identity
  id: string;
  type: string;
  name: string;
  
  // Position & Visual
  position: { x: number; y: number };
  size: { width: number; height: number };
  preview?: HTMLCanvasElement;
  
  // Ports
  inputs: InputPort[] = [];
  outputs: OutputPort[] = [];
  
  // Props System (v1.1)
  props: Record<string, Prop> = {};
  
  // Behavior Toggles (v1.2)
  bypassed: boolean = false;
  cooking: boolean = false;
  bypassOpacity: number = 1.0;
  cookAnimation: boolean = false;
  
  // Core Methods
  in<T>(name: string, defaultValue?: T, options?: PortOptions): InputPort<T>;
  out<T>(name: string, type?: string): OutputPort<T>;
  
  // Props Methods
  defineProp<T>(name: string, config: Prop<T>): void;
  updateProp(name: string, value: any): void;
  watchProp(name: string, callback: Function): void;
  
  // Execution
  execute(): void;
  executeBypass(): void;
  shouldExecute(): boolean;
  
  // State Management
  preserveState(): any;
  restoreState(state: any): void;
  markDirty(): void;
  
  // Lifecycle
  onReady?: () => void;
  onDestroy?: () => void;
}
```

### Node Definition Pattern

```typescript
export default function MyNode(node: NodeContext, graph: GraphContext) {
  // 1. Define props with auto-UI
  node.props = {
    text: {
      value: "Hello World",
      displayName: "Display Text"
    },
    fontSize: {
      value: 16,
      params: { min: 8, max: 72, step: 1 }
    },
    color: {
      value: "#ffffff",
      type: "color"
    },
    image: {
      value: "",
      type: "image",
      params: { accept: "image/*" },
      onChange: async (prop) => {
        const img = await loadImage(prop.value);
        node.preview = createThumbnail(img, 60, 60);
        node.size = { width: 180, height: 120 };
      }
    }
  };
  
  // 2. Define ports
  const trigger = node.in('trigger', 'trigger');
  const value = node.in('value', 0);
  const output = node.out('result');
  
  // 3. Handle execution
  trigger.onTrigger = () => {
    const result = processWithProps(node.props);
    output.setValue(result);
  };
  
  // 4. Lifecycle hooks
  node.onReady = () => {
    console.log('Node initialized');
  };
}
```

## 5.2 Port System

### Dual Port Architecture

**Trigger Ports** (Execution Flow):
- Callback-based execution
- Solid blue lines
- Fire with `.trigger()`
- Receive via `.onTrigger`

**Param Ports** (Data Flow):
- Value-based data passing
- Dotted orange lines
- Set with `.setValue()`
- Read via `.value`

```typescript
// Trigger port (execution)
const trigger = node.in('trigger', 'trigger');
trigger.onTrigger = () => {
  console.log('Executed!');
};

// Param port (data)
const radius = node.in('radius', 10);
console.log(radius.value); // Read synchronously

radius.onChange = (newValue) => {
  console.log('Radius changed:', newValue);
};
```

## 5.3 Graph Execution

### Execution Engine

```typescript
export class Graph {
  nodes: Node[] = [];
  connections: Connection[] = [];
  annotations: CanvasAnnotation[] = [];  // v1.3
  
  // Execution Control
  cookingNodes: Set<Node> = new Set();   // v1.2
  multiCookMode: boolean = false;        // v1.2
  
  // Core Methods
  addNode(type: string, position: Position): Node;
  removeNode(node: Node): void;
  connect(from: Port, to: Port): Connection;
  disconnect(connection: Connection): void;
  
  // Execution
  execute(entryNode?: Node): void;
  executeUpstream(node: Node): void;
  stop(): void;
  reset(): void;
  
  // Behavior Control (v1.2)
  clearCookingNodes(except?: Node): void;
  isDownstreamOfCooking(node: Node): boolean;
  
  // Serialization
  toJSON(): GraphJSON;
  fromJSON(json: GraphJSON): void;
  
  // Asset Management
  assets: AssetManager;
  packages: PackageManager;
}
```

---

# 6. Enhanced Features

## 6.1 Live Evaluation

### Hot Reload Without State Loss

```typescript
async function compileNode(node: Node, newCode: string) {
  // 1. Preserve state
  const oldState = node.preserveState();
  const propValues = Object.entries(node.props).reduce((acc, [key, prop]) => {
    acc[key] = prop.value;
    return acc;
  }, {});
  
  // 2. Compile new code
  const newFunction = new Function('node', 'graph', newCode);
  node.setFunction(newFunction);
  
  // 3. Restore state
  node.restoreState(oldState);
  Object.entries(propValues).forEach(([key, value]) => {
    if (node.props[key]) {
      node.props[key].value = value;
    }
  });
  
  // 4. Re-execute
  node.markDirty();
  graph.execute();
}
```

**Keyboard**: `Shift+Enter` to compile, `ESC` to cancel

## 6.2 Props System

### Automatic UI Generation

```typescript
interface Prop<T = any> {
  value: T;
  
  // Parameters
  params?: {
    min?: number | number[];
    max?: number | number[];
    step?: number;
    options?: Array<T | { value: T; label: string }>;
    accept?: string;  // For file inputs
    locked?: boolean; // For vector inputs
  };
  
  // Callbacks
  onChange?: (prop: Prop<T>, context: NodeContext) => void;
  
  // Display
  displayName?: string | null;
  type?: PropControlType;
  
  // Visibility
  disabled?: boolean | (() => boolean);
  hidden?: boolean | (() => boolean);
  
  // Organization
  folder?: string;
  group?: string;
}
```

### Control Type Inference

| Value Type | Parameters | Generated Control |
|------------|------------|------------------|
| `number` | `{ min, max }` | Slider + Number |
| `string` | - | Text input |
| `string` | `{ options }` | Select dropdown |
| `boolean` | - | Checkbox |
| `"#hex"` | - | Color picker |
| `function` | - | Button |
| `""` | `type: "image"` | Image picker |
| `[x, y, z]` | - | Vector input |
| `[min, max]` | `{ min, max }` | Range slider |

### Example: Image Loader with Props

```typescript
node.props = {
  image: {
    value: "",
    type: "image",
    displayName: "Source Image",
    params: { accept: "image/*" },
    onChange: async (prop) => {
      const img = await loadImage(prop.value);
      node.preview = createThumbnail(img, 60, 60);
      node.size = { width: 180, height: 120 };
    }
  },
  scale: {
    value: 1.0,
    params: { min: 0.1, max: 2.0, step: 0.1 },
    displayName: "Scale Factor"
  },
  quality: {
    value: "high",
    params: {
      options: [
        { value: "low", label: "Low (fast)" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High (slow)" }
      ]
    }
  }
};
```

## 6.3 Node Behavior Toggles

### Visual Execution Control

```
        (Input 1) (Input 2)
 ┌─────────────────────────────────┐
 │ ▓▓▓ │                    │ ▓▓▓ │
 │ ▓▓▓ │    🎨 Preview      │ ▓▓▓ │
 │ ▓▓▓ │                    │ ▓▓▓ │
 └─────────────────────────────────┘
   ↑ Bypass                    ↑ Cook
   (Yellow, 50% opacity)       (Blue, pulsing)
        (Output 1) (Output 2)
```

### Bypass Mode
- **Visual**: Yellow band on left, 50% opacity
- **Behavior**: Skip execution, pass inputs to outputs
- **Shortcut**: `B` key
- **Use**: Debugging, A/B testing

### Cook Mode
- **Visual**: Blue band on right, pulsing animation
- **Behavior**: Force execution of this chain
- **Shortcut**: `C` key, `Shift+C` for multi-cook
- **Use**: Focused development, testing

## 6.4 Canvas Annotations

### FigJam-Style Documentation Elements

```typescript
// Text Annotation Types
type TextAnnotationType = 'h1' | 'h2' | 'h3' | 'paragraph' | 'sticky';

// Create heading
const heading = new TextAnnotation('h1', '# Project Title');
heading.position = { x: 100, y: 50 };
canvas.addAnnotation(heading);

// Add image
const image = new ImageAnnotation('./assets/reference.jpg');
image.size = { width: 200, height: 150 };
image.caption = "Visual reference";
canvas.addAnnotation(image);

// Group elements
const group = new GroupAnnotation('Section Name');
group.containedElements = [node1.id, node2.id, annotation1.id];
canvas.addAnnotation(group);
```

### Visual Elements

**Text Elements**:
```
╔═══════════════════════════════════╗
║ PROJECT TITLE                     ║  ← H1
╚═══════════════════════════════════╝

┌───────────────────────────────────┐
│ Section Title                     │  ← H2
└───────────────────────────────────┘

┌───────────────────────────────────┐
│ Documentation with **markdown**   │  ← Paragraph
└───────────────────────────────────┘

╭───────────────╮
│ 📝 TODO note  │                      ← Sticky
╰───────────────╯
```

**Shortcuts**:
- `T` - Text tool
- `I` - Image
- `G` - Group selected
- `L` - Line (custom)
- `P` - Polyline (custom)

---

# 7. Storage & Assets

## 7.1 Asset Management

### Project Structure

```
my-project/
├── graph.cascade.json
├── metadata.json
└── assets/
    ├── images/
    │   ├── reference.jpg
    │   └── texture.png
    ├── audio/
    │   └── sample.mp3
    └── data/
        └── dataset.csv
```

### AssetManager API

```typescript
class AssetManager {
  constructor(projectPath: string);
  
  // Asset Operations
  async load(path: string): Promise<Asset>;
  async add(file: File): Promise<string>;
  async remove(path: string): void;
  
  // Caching
  cache: Map<string, Asset>;
  preload(paths: string[]): Promise<void>;
  
  // Hot Reload
  watch(path: string, callback: Function): void;
  
  // Export
  async embedAsBase64(): Promise<Record<string, string>>;
}
```

## 7.2 Local Server

### REST API Endpoints

```typescript
// Project Management
GET    /api/projects              // List all projects
POST   /api/projects              // Create new project
GET    /api/projects/:id          // Get project details
DELETE /api/projects/:id          // Delete project

// Graph Operations
GET    /api/projects/:id/graph    // Load graph
PUT    /api/projects/:id/graph    // Save graph
POST   /api/projects/:id/export   // Export to HTML

// Asset Management
POST   /api/projects/:id/assets   // Upload asset
GET    /api/projects/:id/assets/* // Serve asset
DELETE /api/projects/:id/assets/* // Delete asset
```

### WebSocket Events

```typescript
// WebSocket connection on port 3031
const ws = new WebSocket('ws://localhost:3031');

// Event types
interface WSEvent {
  type: 'file-changed' | 'graph-updated' | 'asset-added' | 'asset-removed';
  projectId: string;
  data: any;
}

// Hot reload on file change
ws.onmessage = (event) => {
  const { type, data } = JSON.parse(event.data);
  if (type === 'file-changed') {
    reloadAsset(data.path);
  }
};
```

---

# 8. User Interface

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Cascade                                    [Min] [Max] [X] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    Main Canvas Area                        │
│                                                             │
│   [Node] ──→ [Node] ──→ [Node]                           │
│     ↓                                                      │
│   [Node] ──→ [Node]                                       │
│                                                             │
│   ## Documentation Section                                 │
│   Text explaining the graph...                             │
│                                                             │
│   [🖼️ Reference Image]                                    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ [↖][✋] │ [🔥][➕][🎨][🔊] │ [T][1][2][3][N][I] │ [⚙]    │
└─────────────────────────────────────────────────────────────┘

                    Inspector Panel (Right)
                    ┌───────────────┐
                    │ Node Props    │
                    │ ─────────     │
                    │ Text [___]    │
                    │ Size [▣]      │
                    │ Color [■]     │
                    └───────────────┘
```

## Bottom Toolbar (FigJam-style)

- **Navigation**: Pan, Zoom tools
- **Node Categories**: Input, Math, Visual, Audio
- **Annotations**: Text, Image tools
- **Settings**: Preferences, Export

## Inspector Panel

Dynamic props panel showing:
- Node parameters (auto-generated from props)
- Bypass/Cook toggles
- Error states
- Preview window

## Presentation Mode

`⌘.` to enter presentation mode:
- Hide all UI chrome
- Full screen canvas
- Navigate with arrow keys
- Inspector on selection only

---

# 9. Export System

## Export Options

### 1. Single HTML File
```html
<!DOCTYPE html>
<html>
<head>
  <style>/* Minimal runtime CSS */</style>
</head>
<body>
  <canvas id="output"></canvas>
  <script>
    // Embedded graph JSON
    const graph = {...};
    
    // Embedded assets (base64)
    const assets = {
      "images/bg.jpg": "data:image/jpeg;base64,..."
    };
    
    // Minimal runtime (~50KB)
    class Runtime {
      execute() {...}
    }
    
    // Auto-start
    new Runtime(graph, assets).start();
  </script>
</body>
</html>
```

### 2. Folder Export
```
export/
├── index.html
├── runtime.js
├── graph.json
└── assets/
    └── images/
        └── bg.jpg
```

---

# 10. NPM Integration

## Dynamic Package Loading

```typescript
// In node definition
export default async function(node: NodeContext, graph: GraphContext) {
  // Load NPM packages dynamically
  const three = await node.require('three');
  const { createNoise2D } = await node.require('simplex-noise');
  
  // Use normally
  const scene = new three.Scene();
  const noise = createNoise2D();
  
  // ...
}
```

## PackageManager

```typescript
class PackageManager {
  // CDN loading
  async load(packageName: string, version?: string): Promise<any>;
  
  // Cache loaded packages
  cache: Map<string, any>;
  
  // Package info
  async search(query: string): Promise<PackageInfo[]>;
  async getVersions(packageName: string): Promise<string[]>;
}
```

---

# 11. Graph File Format

## Complete JSON Structure

```json
{
  "version": "0.1",
  "metadata": {
    "name": "My Visual Program",
    "author": "FIELD.IO",
    "created": "2025-11-18T10:00:00Z",
    "modified": "2025-11-18T12:00:00Z",
    "description": "Generative particle system"
  },
  
  "packages": [
    { "name": "three", "version": "0.160.0" },
    { "name": "simplex-noise", "version": "4.0.0" }
  ],
  
  "assets": {
    "manifest": [
      {
        "id": "bg",
        "path": "./assets/images/background.jpg",
        "type": "image",
        "size": 102400
      }
    ]
  },
  
  "nodes": [
    {
      "id": "timer_1",
      "type": "Timer",
      "name": "Main Timer",
      "position": { "x": 100, "y": 100 },
      "size": { "width": 140, "height": 80 },
      
      "props": {
        "fps": 60,
        "duration": 10
      },
      
      "bypassed": false,
      "cooking": false,
      
      "code": "export default function(node, graph) { ... }"
    }
  ],
  
  "connections": [
    {
      "id": "conn_1",
      "from": { "node": "timer_1", "port": "tick" },
      "to": { "node": "flow_1", "port": "trigger" },
      "type": "trigger"
    }
  ],
  
  "annotations": [
    {
      "id": "ann_1",
      "type": "text",
      "subtype": "h1",
      "content": "# Particle System",
      "position": { "x": 50, "y": 50 },
      "style": { "fontSize": 24 }
    },
    {
      "id": "ann_2",
      "type": "image",
      "src": "./assets/images/reference.jpg",
      "position": { "x": 400, "y": 100 },
      "size": { "width": 200, "height": 150 }
    }
  ],
  
  "execution": {
    "entryPoints": ["timer_1"],
    "cookingNodes": [],
    "autoStart": true
  }
}
```

---

# 12. API Reference

## NodeContext Interface

```typescript
interface NodeContext {
  // Identity
  id: string;
  type: string;
  name: string;
  
  // Position & Visual
  position: Position;
  size: Size;
  preview?: HTMLCanvasElement;
  
  // Ports
  in<T>(name: string, defaultValue?: T, options?: PortOptions): InputPort<T>;
  out<T>(name: string, type?: string): OutputPort<T>;
  
  // Props System
  props: Record<string, Prop>;
  defineProp<T>(name: string, config: Prop<T>): void;
  updateProp(name: string, value: any): void;
  watchProp(name: string, callback: Function): void;
  
  // Behavior Toggles
  bypassed: boolean;
  cooking: boolean;
  setBypassed(value: boolean): void;
  setCooking(value: boolean): void;
  
  // Execution
  execute(): void;
  shouldExecute(): boolean;
  markDirty(): void;
  
  // State Management
  preserveState(): any;
  restoreState(state: any): void;
  
  // Lifecycle
  onReady?: () => void;
  onDestroy?: () => void;
  
  // Utilities
  log(...args: any[]): void;
  require(packageName: string): Promise<any>;
}
```

## GraphContext Interface

```typescript
interface GraphContext {
  // Nodes & Connections
  nodes: Node[];
  connections: Connection[];
  annotations: CanvasAnnotation[];
  
  // Node Operations
  addNode(type: string, position?: Position): Node;
  removeNode(node: Node | string): void;
  getNode(id: string): Node | undefined;
  
  // Connection Operations
  connect(from: Port, to: Port): Connection;
  disconnect(connection: Connection | string): void;
  
  // Annotations
  addAnnotation(annotation: CanvasAnnotation): void;
  removeAnnotation(id: string): void;
  
  // Execution Control
  execute(entryNode?: Node): void;
  stop(): void;
  reset(): void;
  
  // Behavior Control
  cookingNodes: Set<Node>;
  multiCookMode: boolean;
  clearCookingNodes(except?: Node): void;
  
  // Assets & Packages
  assets: AssetManager;
  packages: PackageManager;
  
  // Serialization
  toJSON(): GraphJSON;
  fromJSON(json: GraphJSON): void;
  
  // Events
  on(event: GraphEvent, callback: Function): void;
  off(event: GraphEvent, callback: Function): void;
  emit(event: GraphEvent, data?: any): void;
}
```

## ProjectService Interface

```typescript
interface ProjectService {
  // Configuration
  baseURL: string;  // Default: 'http://localhost:3030'
  wsURL: string;    // Default: 'ws://localhost:3031'
  
  // Project Operations
  list(): Promise<Project[]>;
  create(name: string): Promise<Project>;
  load(id: string): Promise<Project>;
  delete(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  
  // Graph Operations
  saveGraph(projectId: string, graph: Graph): Promise<void>;
  loadGraph(projectId: string): Promise<GraphJSON>;
  exportGraph(projectId: string, format: 'html' | 'folder'): Promise<Blob>;
  
  // Asset Operations
  uploadAsset(projectId: string, file: File): Promise<Asset>;
  deleteAsset(projectId: string, assetPath: string): Promise<void>;
  getAssetUrl(projectId: string, assetPath: string): string;
  
  // WebSocket
  connect(): WebSocket;
  onHotReload: (callback: Function) => void;
  onGraphUpdate: (callback: Function) => void;
}
```

---

# 13. Keyboard Shortcuts

## Essential Shortcuts

| Shortcut | Action | Description | Status |
|----------|--------|-------------|--------|
| **Navigation** |
| `Space + Drag` | Pan | Pan canvas | ✅ Implemented |
| `Scroll` | Zoom | Zoom in/out | ✅ Implemented |
| `Alt+H` | Home | Reset view | ✅ Implemented (custom) |
| `H` | Hand Tool | Switch to hand tool | ✅ Implemented |
| `V` | Select Tool | Switch to select tool | ✅ Implemented |
| **Node Operations** |
| `Tab` | Node Search | Open node palette | ✅ Implemented |
| `Delete` | Delete | Delete selected | ✅ Implemented |
| `⌘D` | Duplicate | Duplicate selected | ✅ Implemented |
| `Double-click` | Edit Code | Open code editor | ✅ Implemented |
| **Code Editing** |
| `Shift+Enter` | Compile | Compile without losing state | ✅ Implemented |
| `ESC` | Cancel | Close editor | ✅ Implemented |
| `⌘K` | Package Search | Open package search (in editor) | ✅ Implemented |
| **Behavior Toggles** |
| `B` | Bypass | Toggle bypass on selected | ✅ Implemented |
| `C` | Cook | Toggle cook on selected | ✅ Implemented |
| `Shift+C` | Multi-Cook | Cook multiple chains | ✅ Implemented |
| `Alt+B` | Clear Bypass | Remove all bypasses | ✅ Implemented |
| `Alt+C` | Clear Cook | Stop all cooking | ✅ Implemented |
| **Canvas Annotations** |
| `T` | Text Tool | Add text element | ✅ Implemented |
| `I` | Image | Add image | ✅ Implemented |
| `G` | Group | Add group | ✅ Implemented |
| `L` | Line | Add line (custom) | ✅ Implemented |
| `P` | Polyline | Add polyline (custom) | ✅ Implemented |
| **UI** |
| `⌘.` | Present | Presentation mode | ✅ Implemented |
| `⌘;` | Inspector | Toggle inspector | ✅ Implemented |
| `⌘S` | Save | Save project | ✅ Implemented |
| `⌘Shift+S` | Save As | Save project with new name | ✅ Implemented |
| `⌘E` | Export | Export to HTML | ✅ Implemented |
| `⌘N` | New Project | Create new project | ✅ Implemented |
| `⌘O` | Open Project | Open existing project | ✅ Implemented |

---

# 14. Quick Start Guide

## Installation

```bash
# 1. Create project
npm create vite@latest cascade -- --template svelte-ts
cd cascade

# 2. Install frontend dependencies
npm install monaco-editor
npm install marked  # For markdown in annotations

# 3. Setup server
mkdir server && cd server
npm init -y
npm install express cors body-parser multer ws chokidar
npm install -D @types/express @types/node typescript nodemon

# 4. Create folder structure
mkdir -p src/core src/editor src/controls src/services
mkdir -p src/nodes/library
mkdir -p server/src/routes server/src/services

# 5. Start development
npm run dev              # Terminal 1: Frontend
cd server && npm run dev # Terminal 2: Backend
```

## Create Your First Node

```typescript
// Timer.node.ts
export default function TimerNode(node: NodeContext, graph: GraphContext) {
  // Define props for UI
  node.props = {
    fps: {
      value: 60,
      params: { options: [24, 30, 60, 120] },
      displayName: "Frame Rate"
    },
    duration: {
      value: 10,
      params: { min: 1, max: 60, step: 1 },
      displayName: "Duration (seconds)"
    }
  };
  
  // Define ports
  const tick = node.out('tick', 'trigger');
  const frame = node.out('frame');
  
  // Implementation
  let currentFrame = 0;
  const interval = setInterval(() => {
    frame.setValue(currentFrame++);
    tick.trigger();
    
    if (currentFrame >= node.props.fps.value * node.props.duration.value) {
      clearInterval(interval);
    }
  }, 1000 / node.props.fps.value);
  
  // Cleanup
  node.onDestroy = () => {
    clearInterval(interval);
  };
}
```

## Build a Simple Graph

```typescript
// Create graph
const graph = new Graph();

// Add nodes
const timer = graph.addNode('Timer', { x: 100, y: 100 });
const viewer = graph.addNode('Viewer', { x: 300, y: 100 });

// Connect
graph.connect(timer.outputs[0], viewer.inputs[0]);

// Add documentation
const title = new TextAnnotation('h1', '# My First Graph');
title.position = { x: 100, y: 50 };
graph.annotations.push(title);

// Execute
graph.execute(timer);
```

## Save to Server

```typescript
const projectService = new ProjectService();

// Create project
const project = await projectService.create('My Project');

// Save graph
await projectService.saveGraph(project.id, graph);

// Upload asset
const file = await selectFile();
const asset = await projectService.uploadAsset(project.id, file);
```

---

# Summary

Cascade is a **complete visual programming framework** that combines:

1. **Core Systems**: Nodes, ports, graph execution
2. **Live Coding**: Edit without losing state
3. **Rich Parameters**: Auto-generated UI from props
4. **Execution Control**: Bypass/cook toggles
5. **Visual Documentation**: Canvas annotations
6. **Professional Storage**: File system with hot reload
7. **Export Ready**: Standalone HTML output
8. **Extensible**: NPM package integration

**Target Users**: Creative coders, generative artists, data visualizers

**Philosophy**: Code is never hidden, always powerful, beautifully visual

**Status**: Complete specification with ~90% implementation complete

## Implementation Status

As of November 2025, the Cascade framework is **~90% complete** and production-ready. All major systems are implemented:

- ✅ Core Systems (100%)
- ✅ Props System (100%)
- ✅ Behavior Toggles (100%)
- ✅ Canvas Annotations (85% - missing header shortcuts and markdown)
- ✅ Local Server (100%)
- ✅ Export System (90%)
- ✅ NPM Integration (100%)

**Custom Enhancements**: The implementation includes features beyond this spec:
- Line and polyline annotation types
- Alt+H shortcut for home/reset view
- Enhanced annotation editing capabilities

See `IMPLEMENTATION_STATUS.md` for detailed implementation status.

---

*Cascade Universal Specification v0.1*  
*Complete consolidation of all features*  
*Prepared for FIELD.IO*  
*November 18, 2025*
