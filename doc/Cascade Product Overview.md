# Cascade Product Overview

## What Is It?

**Cascade** is a visual programming framework for creative coders who want the clarity of node-based workflows without sacrificing the power of real code. It combines TypeScript/JavaScript programming with a professional-grade graph editor, built-in image processing, and multi-provider AI integration—all running locally on your machine.

---

## Core Features

### 1. Visual Programming with Real Code

| Capability | Description |
|------------|-------------|
| **Node Graphs** | Every node is a TypeScript/JavaScript function connected visually |
| **Live Code Editing** | Monaco editor with full IntelliSense, Shift+Enter to compile without losing state |
| **NPM Integration** | Load any package dynamically via `await node.require('package-name')` |
| **Dual Port System** | Trigger ports for execution flow, Param ports for data flow |
| **Subnet Networks** | Group complex logic into reusable sub-networks with Input/Output interfaces |

All graphs saved locally as human-readable `.cascade` JSON files.

### 2. The Lens System (Image Processing)

- **Generator Nodes** — Checkers, Color, Noise, Ramp
- **Filter Nodes** — Blur (box, gaussian, bilateral), Composite, Resize, NormalMap, Transform
- **20+ Blend Modes** — Multiply, Screen, Overlay, and more in Composite node
- **Thumbnail Display** — Nodes show their image output live on the canvas
- **Grid Mode** — Generate variations, browse with keyboard, select favorites
- **High Performance** — Float32Array-based ImageBuffer with bilinear interpolation

### 3. AI Conversations (Quill System)

Multi-turn conversational AI with visual context:
- **Multi-Provider Support** — Anthropic (Claude), OpenAI (GPT-4), Google (Gemini)
- **Streaming Responses** — Watch text generate in real-time with token counting
- **Vision Support** — Attach images from Lens nodes to prompts
- **Conversation as Canvas** — Your exploration branches are visible, not hidden in history
- **Model Chaining** — Different AI providers for different steps in the same workflow
- **Keyboard-First** — Tab for follow-up, R to regenerate, F to freeze

### 4. Professional Editor

- **Canvas Navigation** — Pan, zoom, selection, multi-select
- **Inspector Panel** — Rich parameter controls with sliders, color pickers, dropdowns
- **Props System** — Auto-generated UI from parameter definitions
- **Dockview Panels** — Flexible drag-drop layout management
- **Undo/Redo** — Full history with Cmd+Z / Cmd+Shift+Z
- **Annotations** — Text, images, groups, lines on canvas (FigJam-style)

### 5. Export & Integration

- **HTML Export** — One-click standalone export with base64 assets
- **Project Files** — Save/load `.cascade` files with full state preservation
- **Asset Management** — Drag-drop import for images, audio, data files
- **Local Studio** — browser UI served by the project-scoped Cascade CLI

---

## What Makes Cascade Unique

### 1. Code and Visuals as Equal Partners
This isn't Scratch or a "visual alternative" to coding. Every node contains real TypeScript/JavaScript with full language power. The graph shows structure; the code shows logic. Neither hides the other.

### 2. Canvas Is Your Workspace
The canvas isn't just plumbing between nodes. It's where you see results:
- **Lens nodes** display their image output as thumbnails
- **Chat nodes** show conversation history inline
- **Annotations** let you document directly on the graph
- **Exploration branches** remain visible, not buried in undo history

### 3. Multi-Provider AI Integration
Don't lock into one AI provider. Chain them:
- Claude for nuanced writing
- GPT-4 for code generation
- Gemini for fast iteration

Each Chat node can use a different model. Context flows through connections.

### 4. Procedural Image Processing
The Lens system brings Houdini/Nuke-style procedural workflows to a code-first environment:
- **Non-destructive** — Change upstream, downstream updates automatically
- **Resolution-aware** — Nodes adapt to input sizes
- **Live preview** — See results immediately on canvas
- **Grid exploration** — Generate 9 variations, pick favorites with number keys

### 5. Keyboard-First Design
Every action has a shortcut. Power users never touch the mouse:
- `Tab` — Create new node / follow-up chat
- `Shift+Enter` — Compile code without losing state
- `R` — Regenerate AI response
- `1-9` — Select grid variations
- `Cmd+K` — Search NPM packages

### 6. Local-First Philosophy
Everything runs on your machine:
- No cloud dependencies for core functionality
- API keys stored locally, never transmitted
- Projects are portable JSON files
- Full offline capability

### 7. Made for Creative Coders
Not simplified for beginners. Not bloated for enterprise. Built for people who:
- Think in code but want visual structure
- Need real programming power, not drag-drop limitations
- Work iteratively and experimentally
- Value seeing their work, not just managing files

### 8. Performance by Design
Large graphs with hundreds of nodes work smoothly:
- **O(1) lookups** — Map-based indices for nodes, ports, connections
- **Lazy evaluation** — Only compute what's needed
- **Parallel execution** — Independent branches run concurrently
- **Dirty propagation** — Only re-execute changed nodes
- **Throttled preview** — 30fps max to save resources

### 9. Extensible Architecture
Build on the foundation:
- Create custom nodes from the UI
- Choose base class (Node, LensNode, QuillNode)
- Load any NPM package dynamically
- Provider system ready for new AI integrations

### 10. Readable Project Files
`.cascade` files are human-readable JSON:
- Version control friendly
- Diff and merge possible
- No proprietary binary formats
- Back up, fork, share freely

---

## Technical Philosophy

- **Local-first** — Everything on your machine, your data stays yours
- **Code-native** — Real TypeScript/JavaScript, not a visual subset
- **Web-native Studio** — one browser UI backed by the same local/server host used headlessly
- **JSON storage** — No database, human-readable files
- **Modern stack** — Svelte 5, TypeScript 5, Vite 6, Monaco Editor

---

## Target User

Creative coders and technical artists who:
- Write code daily but want visual structure for complex workflows
- Build generative art, interactive installations, or AI-powered tools
- Need procedural image processing without learning Nuke or Houdini
- Want to experiment with multi-model AI conversations visually
- Value owning their tools and data over platform convenience
- Prefer honest tooling over gamified "no-code" marketing

---

## Use Cases

| Workflow | Example |
|----------|---------|
| **Generative Art** | Noise → Transform → Composite → Export PNG |
| **AI Prompt Engineering** | System prompt → Chat → Follow-up chains → Compare outputs |
| **Image Processing** | Load → Blur → Resize → Blend → Export |
| **Style Exploration** | Generate 9 variations → Select favorites → Refine with new prompts |
| **Multi-Model AI** | Claude for strategy → GPT-4 for code → Gemini for review |
| **Procedural Design** | Parameters → Custom nodes → Visual output → Iterate |
