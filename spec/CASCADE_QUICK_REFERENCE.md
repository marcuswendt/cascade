# Cascade Quick Reference
## For Claude Code - Start Here First

This is a **condensed reference** for implementing Cascade. Read this first, then dive into `CASCADE_PRODUCTION_SPEC.md` for complete details.

---

## 🎯 What is Cascade?

**Visual programming framework for creative coders** - think Nodes.io meets TouchDesigner, built for the web.

**Core Concept**: Every node is just a JavaScript/TypeScript function. The visual graph and code are equal partners, not abstractions.

---

## 🏗️ Project Setup

```bash
# Quick start
npm create vite@latest cascade -- --template svelte-ts
cd cascade
npm install monaco-editor litegraph.js
npm run dev
```

**Key files to create:**
```
src/
├── core/
│   ├── Node.ts              # Base node class
│   ├── Port.ts              # Trigger & Param ports
│   ├── Graph.ts             # Execution engine
│   └── AssetManager.ts      # Asset handling
├── editor/
│   ├── Canvas.svelte        # Main canvas
│   ├── NodeUI.svelte        # Node rendering
│   ├── BottomToolbar.svelte # FigJam-style toolbar
│   └── Inspector.svelte     # Parameter panel
└── nodes/library/
    ├── Timer.node.ts
    └── Viewer.node.ts
```

---

## 💡 Core Concepts

### 1. Every Node is a Function

```typescript
export default function(node: NodeContext, graph: GraphContext) {
  // 1. Declare ports
  const trigger = node.in('trigger', 'trigger');
  const value = node.in('value', 0, { type: 'number' });
  const output = node.out('result');
  
  // 2. Handle triggers
  trigger.onTrigger = () => {
    output.setValue(value.value * 2);
  };
  
  // 3. Lifecycle (optional)
  node.onReady = () => { /* setup */ };
  node.onDestroy = () => { /* cleanup */ };
}
```

### 2. Dual Port System (Inspired by Nodes.io)

**Trigger Ports** (execution flow):
- Solid lines, blue color
- Fire callbacks: `triggerOut.trigger()`
- Receive via: `triggerIn.onTrigger = () => {...}`
- Use for: Control flow, events, "do something"

**Param Ports** (data flow):
- Dotted lines, orange color
- Set values: `paramOut.setValue(data)`
- Read values: `paramIn.value`
- Subscribe: `paramIn.onChange = (val) => {...}`
- Use for: Passing data between nodes

### 3. Live Evaluation

- Double-click node → Opens code editor
- Edit code
- Press **Shift+Enter** → Compiles WITHOUT losing state
- Magic: State preservation + hot reload

**Implementation:**
```typescript
async function compileNode() {
  const oldState = node.preserveState();
  const newFunction = new Function('node', 'graph', code);
  node.setFunction(newFunction);
  node.restoreState(oldState);
}
```

### 4. Asset Management

All assets live in `assets/` folder next to graph JSON:

```
my-project/
├── flow-field.cascade.json
└── assets/
    ├── images/
    ├── audio/
    └── data/
```

**In nodes:**
```typescript
const image = node.in('image', '', { 
  type: 'asset', 
  accept: ['image/*'] 
});

// Load via asset manager
const asset = await graph.assets.load(image.value);
```

---

## 🎨 UI Components

### Bottom Toolbar (FigJam-style)

```
┌─────────────────────────────────────────────────────┐
│ [↖][✋] │ [📥Input] [➕Math] [🎨Lens] [🔊Audio] │ [⚙]│
└─────────────────────────────────────────────────────┘
```

- Categories open panels above toolbar
- Drag nodes onto canvas OR click-to-place
- Search within categories

### Presentation Mode (⌘.)

- Hides all UI chrome
- Shows inspector when node selected
- Full-screen canvas for client demos

---

## 📝 Implementation Priorities

### Week 1-2: Core Foundation
```typescript
// Implement these classes first:
class Node {
  id: string;
  in<T>(name, default?, options?): InputPort<T>;
  out<T>(name, type?): OutputPort<T>;
  execute(): void;
}

class Graph {
  nodes: Node[];
  connections: Connection[];
  execute(entryNode: Node): void;
}

class Port {
  value: any;
  setValue(val): void;      // For params
  trigger(props?): void;    // For triggers
  onTrigger: (props) => void;
  onChange: (val) => void;
}
```

### Week 2-3: Live Evaluation
- Monaco editor integration
- Shift+Enter compilation
- State preservation system

### Week 3-4: Asset Management
- AssetManager class
- Drag-drop import
- Hot reload

### Week 4-5: UI Polish
- Bottom toolbar
- Node panels
- Presentation mode

### Week 5-6: Export
- Compile to standalone HTML
- Embed assets as base64

---

## 🔑 Key APIs

### Node Context
```typescript
interface NodeContext {
  // Identity
  id: string;
  name: string;
  type: string;
  
  // Ports
  in<T>(name, default?, options?): InputPort<T>;
  out<T>(name, type?): OutputPort<T>;
  
  // Visual
  position: { x, y };
  preview: HTMLCanvasElement | null;
  comment: string;
  
  // State
  error: Error | null;
  warning: string | null;
  
  // Lifecycle
  onReady: () => void;
  onDestroy: () => void;
  
  // Utils
  log(...args): void;
  require(pkg): Promise<any>;  // NPM packages
}
```

### Graph Context
```typescript
interface GraphContext {
  nodes: Node[];
  connections: Connection[];
  assets: AssetManager;
  packages: PackageManager;
  
  execute(node?): void;
  stop(): void;
  reset(): void;
  
  toJSON(): object;
  fromJSON(json): void;
}
```

---

## 📦 Graph File Format

```json
{
  "version": "1.0.0",
  "metadata": { "name": "My Project" },
  "packages": [
    { "name": "three", "version": "0.160.0" }
  ],
  "assets": {
    "manifest": [
      {
        "id": "bg",
        "path": "./assets/images/bg.jpg",
        "type": "image"
      }
    ]
  },
  "nodes": [
    {
      "id": "timer_1",
      "type": "Timer",
      "position": { "x": 100, "y": 100 },
      "params": { "fps": 60 }
    }
  ],
  "connections": [
    {
      "from": { "node": "timer_1", "port": "tick" },
      "to": { "node": "flow_1", "port": "trigger" },
      "type": "trigger"
    }
  ],
  "execution": {
    "entryPoints": ["timer_1"],
    "autoStart": true
  }
}
```

---

## 🚀 Getting Started Checklist

### Phase 1: Minimal Working System
- [ ] Set up Vite + TypeScript + Svelte
- [ ] Create Node, Port, Graph classes
- [ ] Basic Canvas.svelte component
- [ ] Render nodes as rectangles
- [ ] Draw connections with SVG
- [ ] Click to select nodes
- [ ] Basic execution engine

**Goal**: Can manually create nodes in code, see them on canvas, execute graph.

### Phase 2: Node Creation
- [ ] Node type registry
- [ ] Create Timer.node.ts
- [ ] Create Viewer.node.ts
- [ ] Add node via UI (simple button)
- [ ] Connect ports by dragging

**Goal**: Can create Timer → Viewer graph in UI.

### Phase 3: Code Editing
- [ ] Integrate Monaco editor
- [ ] Double-click node to edit
- [ ] Shift+Enter to compile
- [ ] Basic state preservation
- [ ] Error display

**Goal**: Can edit node code and see changes without restart.

### Phase 4: Assets
- [ ] AssetManager class
- [ ] Drag-drop file onto canvas
- [ ] Copy to assets/ folder
- [ ] Create ImageLoader node
- [ ] Hot reload on file change

**Goal**: Can add images to project and use in nodes.

### Phase 5: UI
- [ ] Bottom toolbar
- [ ] Node category panels
- [ ] Drag node from panel
- [ ] Inspector panel
- [ ] Presentation mode (⌘.)

**Goal**: Professional, polished interface.

### Phase 6: Export
- [ ] Compile graph to JavaScript
- [ ] Minimal runtime (~50KB)
- [ ] Export single HTML
- [ ] Embed assets as base64

**Goal**: One-click export to shareable HTML.

---

## 💻 Minimal Working Example

**Create this first to validate architecture:**

```typescript
// main.ts
import { Graph } from './core/Graph';
import { Node } from './core/Node';

// Create graph
const graph = new Graph();

// Create Timer node
const timer = graph.addNode('Timer', { x: 100, y: 100 });
timer.setCode(`
  export default function(node, graph) {
    const tick = node.out('tick', 'trigger');
    const time = node.out('time');
    
    let frame = 0;
    setInterval(() => {
      time.setValue(frame++);
      tick.trigger({ frame });
    }, 1000 / 60);
  }
`);

// Create Console node
const console = graph.addNode('Console', { x: 300, y: 100 });
console.setCode(`
  export default function(node, graph) {
    const trigger = node.in('trigger', 'trigger');
    const input = node.in('input', null);
    
    trigger.onTrigger = () => {
      console.log('Value:', input.value);
    };
  }
`);

// Connect: Timer.tick → Console.trigger
graph.connect(timer.outputs[0], console.inputs[0]);

// Connect: Timer.time → Console.input
graph.connect(timer.outputs[1], console.inputs[1]);

// Execute
graph.execute(timer);

// Should log frame numbers to console at 60fps
```

---

## 📚 Key Patterns

### Pattern 1: Reactive Parameters
```typescript
const radius = node.in('radius', 10);

radius.onChange = (newRadius) => {
  // Re-execute when parameter changes
  trigger.onTrigger();
};
```

### Pattern 2: Canvas Output
```typescript
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');

trigger.onTrigger = () => {
  // Draw something
  ctx.fillRect(0, 0, 100, 100);
  
  // Output canvas
  output.setValue(canvas);
  node.preview = canvas;  // Show in node
};
```

### Pattern 3: NPM Package Usage
```typescript
const three = await node.require('three');

const scene = new three.Scene();
// Use Three.js normally
```

### Pattern 4: Asset Loading
```typescript
const imagePath = node.in('image', '', { type: 'asset' });

imagePath.onChange = async (path) => {
  const asset = await graph.assets.load(path);
  sourceImage = asset.data;  // HTMLImageElement
};
```

---

## 🎓 Learning Resources

1. **Nodes.io**: Study the [Nodes.io philosophy](https://nodes.io) - especially dual port system
2. **TouchDesigner**: Reference for operator networks
3. **LiteGraph.js**: [GitHub repo](https://github.com/jagenjo/litegraph.js) for canvas rendering
4. **Monaco Editor**: [Docs](https://microsoft.github.io/monaco-editor/) for code editing

---

## 🐛 Common Pitfalls

### ❌ Don't: Create nodes for primitives
```typescript
// BAD - too low-level
AddNode, SubtractNode, MultiplyNode
```

### ✅ Do: Create high-level nodes
```typescript
// GOOD - meaningful operations
FlowFieldNode, ParticleSystemNode, BlurNode
```

### ❌ Don't: Hide code from users
```typescript
// BAD - users can't see internals
<Node locked={true} />
```

### ✅ Do: Make code accessible
```typescript
// GOOD - double-click to edit
<Node onDoubleClick={openEditor} />
```

### ❌ Don't: Lose state on recompile
```typescript
// BAD
node.setState({});  // State lost!
compileNewCode();
```

### ✅ Do: Preserve state
```typescript
// GOOD
const state = node.preserveState();
compileNewCode();
node.restoreState(state);
```

---

## 🎯 Success Criteria

You'll know Cascade is working when:

1. ✅ Can create nodes visually
2. ✅ Can connect ports with mouse
3. ✅ Can edit node code (Shift+Enter)
4. ✅ State preserved during hot reload
5. ✅ Can add images/assets to project
6. ✅ Can export to standalone HTML
7. ✅ Can use any NPM package in nodes
8. ✅ UI feels polished and professional

---

## 📞 Next Steps

1. **Read this document** ✅ (you just did!)
2. **Skim the full spec** - `CASCADE_PRODUCTION_SPEC.md` for details
3. **Start Phase 1** - Basic Node/Graph/Canvas
4. **Build Timer → Viewer** - First working example
5. **Add live evaluation** - The magic feature
6. **Iterate and polish** - Make it feel great

---

**Remember**: Programmer-first visual programming. Code is never hidden, always accessible, always powerful.

Let's build Cascade! 🚀
