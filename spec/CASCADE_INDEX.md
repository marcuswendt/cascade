# Cascade Framework - Documentation Index
## Complete Specification Package for Claude Code

Last Updated: November 17, 2024

---

## 📦 What's Included

This package contains **everything needed** to implement Cascade from scratch:

1. **Production Specification** (80KB, 2241 lines) - Complete technical reference
2. **Quick Reference** (15KB, 420 lines) - Start here for rapid implementation
3. **Example Projects** - Complete working examples with NPM packages
4. **AI Integration Guide** - How to work with Cascade using AI assistants

---

## 🎯 Start Here

### For Claude Code / AI Assistants

**Read in this order:**

1. **START** → [`CASCADE_QUICK_REFERENCE.md`](CASCADE_QUICK_REFERENCE.md)
   - Condensed overview (15 min read)
   - Key concepts and patterns
   - Implementation checklist
   - Common pitfalls

2. **REFERENCE** → [`CASCADE_PRODUCTION_SPEC.md`](CASCADE_PRODUCTION_SPEC.md)
   - Complete technical specification (2+ hours)
   - All APIs and interfaces
   - Full code examples
   - Implementation roadmap

3. **EXAMPLES** → [`cascade-example-project.md`](cascade-example-project.md)
   - Flow field particles project
   - Using NPM packages (simplex-noise, chroma-js)
   - Complete working code

4. **AI GUIDE** → [`README_ai.md`](README_ai.md)
   - How AI assistants should work with Cascade
   - Node generation patterns
   - Code conversion examples

---

## 📚 Document Guide

### Core Specifications

#### [`CASCADE_PRODUCTION_SPEC.md`](CASCADE_PRODUCTION_SPEC.md) ⭐
**Size**: 80KB | **Lines**: 2,241 | **Type**: Complete Reference

**Contents**:
1. Overview & Philosophy
2. Project Architecture
3. Core Systems (Node, Port, Graph)
4. Asset Management System
5. UI/UX Specifications
6. Live Evaluation System
7. Node API Reference
8. Graph File Format
9. Export System
10. NPM Package Integration
11. Implementation Roadmap (10 weeks)
12. Complete Code Examples

**Use this for**: Complete implementation details, all APIs, full architecture.

---

#### [`CASCADE_QUICK_REFERENCE.md`](CASCADE_QUICK_REFERENCE.md) 🚀
**Size**: 15KB | **Lines**: 420 | **Type**: Quick Start Guide

**Contents**:
- Core concepts (5 min)
- Key APIs (10 min)
- Implementation priorities
- Common patterns
- Checklist for Phase 1-6

**Use this for**: Quick implementation start, refresher, concept validation.

---

### Detailed Specifications

#### [`cascade-asset-management.md`](cascade-asset-management.md)
**Size**: 19KB | **Focus**: Asset System

Self-contained project structure:
- Asset folder organization
- AssetManager API
- Hot reload system
- Export with embedded assets
- Git-friendly workflows

---

#### [`cascade-ui-toolbar-spec.md`](cascade-ui-toolbar-spec.md)
**Size**: 24KB | **Focus**: UI/UX

FigJam-style interface:
- Bottom toolbar design
- Node category panels
- Presentation mode (⌘.)
- Inspector panel
- Keyboard shortcuts

---

#### [`cascade-ui-mockup.md`](cascade-ui-mockup.md)
**Size**: 37KB | **Focus**: Visual Design

ASCII mockups and layouts:
- Full interface layout
- Toolbar states
- Panel interactions
- Mobile adaptations
- Design tokens

---

### Examples & Guides

#### [`cascade-example-project.md`](cascade-example-project.md)
**Size**: 11KB | **Focus**: Complete Example

Flow field particles project:
- FlowField node (simplex-noise)
- ParticleSystem node (chroma-js)
- Complete graph JSON
- Running instructions
- AI modification examples

---

#### [`README_ai.md`](README_ai.md)
**Size**: 13KB | **Focus**: AI Integration

Guide for Claude/Cursor:
- Creating nodes from descriptions
- Converting existing code
- Optimizing graphs
- Node templates
- Testing patterns

---

## 🗺️ Implementation Roadmap

### Phase 1: Core (Week 1-2)
**Goal**: Basic working system

```typescript
// You'll implement:
class Node { in(), out(), execute() }
class Graph { nodes[], execute() }
class Port { value, setValue(), trigger() }

// Canvas.svelte - basic graph view
// NodeUI.svelte - node rendering
```

**Deliverable**: Can create nodes, connect ports, execute graph.

---

### Phase 2: Live Evaluation (Week 2-3)
**Goal**: Code editing with hot reload

```typescript
// Monaco editor integration
// Shift+Enter compilation
// State preservation
```

**Deliverable**: Edit node code without losing state.

---

### Phase 3: Asset Management (Week 3-4)
**Goal**: Self-contained projects

```typescript
class AssetManager {
  load(path), add(file), watch(path)
}
```

**Deliverable**: Drag-drop assets, hot reload, organized folders.

---

### Phase 4: UI Polish (Week 4-5)
**Goal**: Professional interface

```svelte
<BottomToolbar />   // FigJam-style
<NodePanel />       // Category panels
<Inspector />       // Parameters
```

**Deliverable**: Modern UI with presentation mode.

---

### Phase 5: Export (Week 5-6)
**Goal**: Standalone HTML

```typescript
exportSingleHTML(graph)   // With base64 assets
exportWithAssets(graph)   // As folder
```

**Deliverable**: One-click export to shareable bundles.

---

### Phase 6: NPM Integration (Week 6-8)
**Goal**: Dynamic package loading

```typescript
await node.require('three')
await node.require('tone')
```

**Deliverable**: Use any NPM package in nodes.

---

## 🎨 Key Design Decisions

### 1. Nodes.io Philosophy
- Every node is a function
- Live evaluation (Shift+Enter)
- High-level nodes, not primitives
- Code and visuals are equal partners

### 2. Dual Port System
- **Trigger ports**: Execution flow (callbacks)
- **Param ports**: Data flow (values)

### 3. Asset Management
- All assets in `assets/` folder
- Relative paths only
- Git-friendly, portable
- Hot reload during development

### 4. Export System
- Single HTML with base64 assets
- OR folder with assets
- Minimal runtime (~50KB)
- No external dependencies

### 5. UI Paradigm
- FigJam-style toolbar (bottom)
- Vertical node flow (top-to-bottom)
- Presentation mode (⌘.)
- Keyboard-first for power users

---

## 💡 Core Concepts

### Every Node is a Function

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
  
  // 3. Lifecycle
  node.onReady = () => { /* setup */ };
  node.onDestroy = () => { /* cleanup */ };
}
```

### Trigger vs Param Ports

```typescript
// Trigger (execution flow)
const trigger = node.in('trigger', 'trigger');
trigger.onTrigger = () => {
  // Do something when triggered
};

// Param (data flow)
const value = node.in('value', 0);
console.log(value.value);  // Read synchronously

value.onChange = (newValue) => {
  // React to changes
};
```

### Live Evaluation Magic

```typescript
// User edits code → Press Shift+Enter
const oldState = node.preserveState();
compileNewCode();
node.restoreState(oldState);
// State preserved! 🎉
```

---

## 🔧 Quick Setup

```bash
# 1. Create project
npm create vite@latest cascade -- --template svelte-ts
cd cascade

# 2. Install dependencies
npm install monaco-editor litegraph.js

# 3. Create core files (see CASCADE_QUICK_REFERENCE.md)
mkdir -p src/core src/editor src/nodes/library

# 4. Start development
npm run dev
```

---

## 📖 Usage Examples

### Example 1: Simple Timer → Console

```typescript
// Timer node
const timer = graph.addNode('Timer', { x: 100, y: 100 });

// Console node
const console = graph.addNode('Console', { x: 300, y: 100 });

// Connect: Timer.tick → Console.trigger
graph.connect(timer.outputs[0], console.inputs[0]);

// Execute
graph.execute(timer);
```

### Example 2: Image Processing Pipeline

```typescript
// ImageLoader → Blur → Viewer
const loader = graph.addNode('ImageLoader', { x: 100, y: 100 });
const blur = graph.addNode('Blur', { x: 300, y: 100 });
const viewer = graph.addNode('Viewer', { x: 500, y: 100 });

graph.connect(loader.outputs[0], blur.inputs[0]);
graph.connect(blur.outputs[0], viewer.inputs[0]);

loader.params.path = './assets/images/photo.jpg';
blur.params.radius = 20;
```

### Example 3: Generative Art with NPM

```typescript
// FlowField node using simplex-noise
export default async function(node, graph) {
  const { createNoise2D } = await node.require('simplex-noise');
  const noise2D = createNoise2D();
  
  // Generate flow field...
}
```

---

## 🎯 Success Criteria

Cascade is working when:

✅ Nodes can be created and connected visually  
✅ Code can be edited with Shift+Enter (hot reload)  
✅ State preserved during recompilation  
✅ Assets can be drag-dropped into project  
✅ Graphs export to standalone HTML  
✅ Any NPM package works via `node.require()`  
✅ UI feels polished and professional  

---

## 🚨 Common Pitfalls

### ❌ Creating Primitive Nodes
```typescript
// BAD - too low-level
AddNode, MultiplyNode, IfNode
```

### ✅ Creating High-Level Nodes
```typescript
// GOOD - meaningful operations
FlowFieldNode, ParticleSystemNode, FFTAnalyzerNode
```

---

### ❌ Losing State on Recompile
```typescript
// BAD
compileNewCode();  // State lost!
```

### ✅ Preserving State
```typescript
// GOOD
const state = node.preserveState();
compileNewCode();
node.restoreState(state);
```

---

### ❌ Absolute Asset Paths
```typescript
// BAD - not portable
path: '/Users/marcus/project/image.jpg'
```

### ✅ Relative Asset Paths
```typescript
// GOOD - works everywhere
path: './assets/images/image.jpg'
```

---

## 📞 Getting Help

### Understanding Core Concepts
→ Read **CASCADE_QUICK_REFERENCE.md** sections 1-3

### Implementing Specific Features
→ Search **CASCADE_PRODUCTION_SPEC.md** for relevant section

### Building Example Nodes
→ See **cascade-example-project.md** for patterns

### Working with AI Assistants
→ Follow **README_ai.md** guidelines

---

## 🎓 Learning Path

**Day 1**: Read Quick Reference (1 hour)  
**Day 2**: Implement Phase 1 - Core classes (6 hours)  
**Day 3**: Build Canvas component (4 hours)  
**Day 4**: Add node rendering (4 hours)  
**Day 5**: Implement execution engine (4 hours)  

**Week 2**: Live evaluation + Monaco editor  
**Week 3**: Asset management system  
**Week 4**: UI polish (toolbar, panels)  
**Week 5**: Export system  
**Week 6+**: Node library, NPM integration  

---

## 🚀 Quick Start Checklist

### Setup
- [ ] Create Vite project with Svelte + TypeScript
- [ ] Install monaco-editor, litegraph.js
- [ ] Set up folder structure

### Core (Phase 1)
- [ ] Implement Node class
- [ ] Implement Port class (InputPort, OutputPort)
- [ ] Implement Graph class
- [ ] Basic execution engine

### UI (Phase 1)
- [ ] Canvas.svelte with pan/zoom
- [ ] NodeUI.svelte renders nodes
- [ ] Connection.svelte draws lines
- [ ] Can select nodes with mouse

### Validation
- [ ] Create Timer node manually in code
- [ ] Create Viewer node manually
- [ ] Connect Timer → Viewer
- [ ] Execute graph
- [ ] See output in viewer

**When this works, you've validated the architecture! Continue to Phase 2.**

---

## 📊 File Size Reference

| File | Size | Lines | Type |
|------|------|-------|------|
| CASCADE_PRODUCTION_SPEC.md | 80KB | 2,241 | Complete reference |
| CASCADE_QUICK_REFERENCE.md | 15KB | 420 | Quick start |
| cascade-asset-management.md | 19KB | ~600 | Asset system |
| cascade-ui-toolbar-spec.md | 24KB | ~800 | UI specification |
| cascade-ui-mockup.md | 37KB | ~1,200 | Visual mockups |
| cascade-example-project.md | 11KB | ~350 | Working example |
| README_ai.md | 13KB | ~450 | AI integration |

**Total**: ~200KB of documentation

---

## 🎯 Project Goals

### Primary Goal
Build a **visual programming framework** for creative coders that:
- Never hides code from users
- Supports live editing without state loss
- Exports to standalone HTML
- Integrates any NPM package
- Feels professional and polished

### Success Metrics
- **Complete in 8-10 weeks**
- **Used for real FIELD.IO projects**
- **Open sourced on GitHub**
- **Community creates nodes**

---

## 🤝 Contributing

Once Cascade is built, contributions welcome:
- New node types
- UI improvements
- Performance optimizations
- Documentation
- Example projects

---

## 📄 License

Cascade is designed to be **open source** (MIT License).

---

## 🙏 Acknowledgments

Inspired by:
- **Nodes.io** - Core philosophy and live evaluation
- **TouchDesigner** - Operator networks and realtime feedback
- **Houdini** - Procedural workflows
- **Figma** - Modern UI patterns

---

**Ready to build Cascade?** Start with [`CASCADE_QUICK_REFERENCE.md`](CASCADE_QUICK_REFERENCE.md)! 🚀

---

*This documentation package prepared for Claude Code by Marcus Wendt @ FIELD.IO*  
*Last updated: November 17, 2024*
