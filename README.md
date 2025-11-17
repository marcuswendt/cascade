# Cascade 🌊

**Visual Programming Framework for Creative Coders**

Cascade is a visual programming framework where every node is a TypeScript/JavaScript function. Inspired by Nodes.io, Cascade combines the power of code with the clarity of visual graphs.

## ✨ Features

- **Live Code Editing** - Edit node code with Shift+Enter, no state loss
- **Visual Graph** - Connect nodes visually, see data flow
- **NPM Integration** - Use any NPM package with `await node.require('package-name')`
- **Asset Management** - Drag-drop images, audio, and data files
- **Export to HTML** - One-click export to standalone HTML files
- **Monaco Editor** - Full TypeScript/JavaScript editing with IntelliSense
- **Modern UI** - FigJam-style interface with presentation mode

## 🚀 Quick Start

### Installation

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Creating Your First Node

1. **Double-click** on the canvas or press **Tab** to open the node creation panel
2. Click **"Custom"** to create a custom node
3. **Double-click** the node to edit its code
4. Write your node function:

```typescript
// Example: Simple counter node
const trigger = node.in('trigger', null, { type: 'trigger' });
const count = node.in('count', 0);
const output = node.out('result');

let currentCount = count.value || 0;

if (trigger) {
  trigger.onTrigger = () => {
    currentCount++;
    output.setValue(currentCount);
  };
}
```

5. Press **Shift+Enter** to compile
6. Connect nodes by dragging from output ports to input ports

## 📖 Core Concepts

### Every Node is a Function

Every node in Cascade is just a TypeScript/JavaScript function:

```typescript
export default async function(node, graph) {
  // Your code here
  const input = node.in('input', 0);
  const output = node.out('output');
  
  // Use the input value
  output.setValue(input.value * 2);
}
```

### Ports: Inputs and Outputs

- **Input Ports**: Read values with `node.in(name, defaultValue, options)`
- **Output Ports**: Set values with `node.out(name)`
- **Trigger Ports**: Execute callbacks with `trigger.onTrigger = () => { ... }`

### Using NPM Packages

Load any NPM package dynamically:

```typescript
// Load a package
const three = await node.require('three');
const chroma = await node.require('chroma-js');

// Use it immediately
const scene = new three.Scene();
const color = chroma('#4a9eff').brighten(2).hex();
```

Press **⌘K** (or **Ctrl+K**) in the code editor to search for packages.

### Asset Management

Load assets in your nodes:

```typescript
// Load an image
const image = await node.assets.load('./assets/images/photo.jpg');

// Use it
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
ctx.drawImage(image, 0, 0);
```

## 🎨 UI Overview

### Canvas
- **Pan**: Middle mouse button, Space + drag, or two-finger drag
- **Zoom**: Mouse wheel or pinch gesture
- **Create Node**: Double-click or press Tab
- **Edit Node**: Double-click a node
- **Connect Nodes**: Drag from output port to input port

### Keyboard Shortcuts

- **Tab** - Open node creation panel
- **⌘K / Ctrl+K** - Search NPM packages (in code editor)
- **Shift+Enter** - Compile node code
- **Esc** - Close editor/panel
- **⌘N** - New project
- **⌘O** - Open project
- **⌘S** - Save project
- **⌘E** - Export HTML

## 📁 Project Structure

```
cascade/
├── src/
│   ├── core/           # Core classes (Node, Graph, PackageManager)
│   ├── editor/         # UI components (Canvas, CodeEditor, etc.)
│   ├── types/          # TypeScript type definitions
│   └── utils/          # Utilities (export, fileSystem)
├── spec/               # Specification documents
└── graphs/             # Example projects (create your own!)
```

## 💾 Saving and Loading

### Save Project
- **⌘S** or click the document name → Save
- Projects are saved as `.cascade.json` files

### Export to HTML
- **⌘E** or click the document name → Export HTML
- Creates a standalone HTML file with embedded assets
- Works offline, no server required

## 🔧 Development

### Build for Production

```bash
npm run build
```

Outputs to `dist/` directory.

### Type Checking

```bash
npm run check
```

### Preview Production Build

```bash
npm run preview
```

## 📚 Documentation

- **Quick Start**: See this README
- **Complete Spec**: `spec/CASCADE_PRODUCTION_SPEC.md`
- **API Reference**: `spec/CASCADE_QUICK_REFERENCE.md`
- **Implementation Guide**: `spec/CASCADE_CLAUDE_CODE_SPEC.md`

## 🎯 Example Projects

Check out `graphs/examples/` for example projects:

- **Hello World** - Basic node connection
- **Image Processing** - Load and process images
- **Generative Art** - Create art with NPM packages

## 🐛 Troubleshooting

### Node code won't compile
- Make sure you're using valid JavaScript/TypeScript
- Check the error message in the editor status bar
- Ensure `await` is only used at the top level (it's automatically wrapped)

### Packages won't load
- Check your internet connection (packages load from esm.sh CDN)
- Some packages may not be compatible with ESM
- Try a different version: `await node.require('package@1.0.0')`

### Assets won't load
- Use relative paths: `./assets/images/photo.jpg`
- Make sure the file exists in your project directory
- Check the browser console for errors

## 🤝 Contributing

Cascade is designed for creative coders. If you find bugs or have ideas:

1. Check existing issues
2. Create a new issue with details
3. For code changes, follow the existing code style

## 📄 License

See LICENSE file for details.

## 🙏 Acknowledgments

- Inspired by [Nodes.io](https://nodes.io/)
- Built with [Svelte](https://svelte.dev/), [Monaco Editor](https://microsoft.github.io/monaco-editor/), and [Vite](https://vitejs.dev/)

---

**Made with 🌊 for creative coders**
