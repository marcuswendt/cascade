# Cascade

**Visual Programming Framework for Creative Coders**

Cascade is a visual programming framework where every node is a TypeScript/JavaScript function. Inspired by Nodes.io, Cascade combines the power of code with the clarity of visual graphs.

## Features

- **Live Code Editing** - Edit node code with Shift+Enter, no state loss
- **Visual Graph** - Connect nodes visually, see data flow
- **NPM Integration** - Use any NPM package with `await node.require('package-name')`
- **Lens System** - High-performance image processing with GPU-ready ImageBuffer
- **Subnet Networks** - Organize complex graphs into reusable sub-networks
- **Asset Management** - Drag-drop images, audio, and data files
- **Export to HTML** - One-click export to standalone HTML files
- **Monaco Editor** - Full TypeScript/JavaScript editing with IntelliSense
- **AI Code Generation** - Generate node code with Claude AI assistance
- **Lazy Evaluation** - Pull-based execution only computes what's needed
- **Undo/Redo** - Full history with keyboard shortcuts

## Quick Start

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
// Example: Simple math node
const input = node.in('value', 0);
const multiplier = node.in('multiplier', 2);
const output = node.out('result');

output.setValue(input.value * multiplier.value);
```

5. Press **Shift+Enter** to compile
6. Connect nodes by dragging from output ports to input ports

## Core Concepts

### Every Node is a Function

Every node in Cascade is a TypeScript/JavaScript function that runs in an async context:

```typescript
// Inputs with default values
const input = node.in('input', 0);
const name = node.in('name', 'default');

// Outputs
const output = node.out('result');

// Computation
output.setValue(input.value * 2);
```

### Ports: Inputs and Outputs

- **Input Ports**: `node.in(name, defaultValue, options)` - Read values from upstream
- **Output Ports**: `node.out(name)` - Send values downstream
- **Trigger Ports**: Special ports for event-driven execution

```typescript
// Trigger port example
const trigger = node.in('trigger', null, { type: 'trigger' });
trigger.onTrigger = (props) => {
  console.log('Triggered!', props);
};
```

### Port Types and Colors

Ports are color-coded by data type for visual clarity:

- **Gray** - Any/unknown type
- **Blue** - Number
- **Green** - String
- **Yellow** - Boolean
- **Purple** - Object/Array
- **Cyan** - Image/Canvas
- **Orange** - Trigger

### Using NPM Packages

Load any NPM package dynamically:

```typescript
const three = await node.require('three');
const chroma = await node.require('chroma-js');

const scene = new three.Scene();
const color = chroma('#4a9eff').brighten(2).hex();
```

Press **Cmd+K** (or **Ctrl+K**) in the code editor to search for packages.

### Parameters (Props)

Add UI controls to your nodes with `node.addParm()`:

```typescript
node.addParm('intensity', {
  value: 1.0,
  params: { min: 0, max: 2, step: 0.1 },
  displayName: 'Intensity',
  onChange: () => node.requestCook()
});

// Access the value
const intensity = node.props.intensity.value;
```

## Lens System (Image Processing)

Cascade includes a high-performance image processing system inspired by TouchDesigner:

### Built-in Lens Nodes

| Node | Description |
|------|-------------|
| **Checkers** | Generates checkerboard patterns |
| **Color** | Solid color output |
| **Noise** | Perlin/Simplex noise generation |
| **Ramp** | Linear/radial gradients |
| **Blur** | Box, Gaussian, and bilateral blur |
| **Composite** | Blend two images (20+ blend modes) |
| **Resize** | Scale images with fit modes |
| **NormalMap** | Generate normal maps from height |
| **Image** | Load external images |

### Creating Custom Lens Nodes

```typescript
// Extend LensNode for image processing
import { LensNode, ImageBuffer } from '@/nodes/lens/LensNode';

class MyFilterNode extends LensNode {
  protected setup(): void {
    this.in('image', null);
    this.addParm('amount', { value: 1.0, params: { min: 0, max: 1 } });
    this.out('image');
  }

  protected render(): void {
    const input = this.toImageBuffer(this.inputs[0].value);
    if (!input) return;

    const result = ImageBuffer.rgba(input.width, input.height);
    // Process pixels...
    this.setOutput(this.outputs[0], result);
  }
}
```

### Resolution Control

Multi-input nodes support automatic resolution matching:
- **Input 1/2** - Use specific input's resolution
- **Largest/Smallest** - Use largest or smallest input
- **Custom** - Specify exact dimensions
- **Fit Modes**: Fill, Fit, Stretch, Native

## Subnet Networks

Organize complex graphs into reusable sub-networks:

1. Create a **Subnet** node from the node panel
2. Double-click to enter the subnet
3. Add **Input** and **Output** nodes to define the interface
4. The subnet automatically exposes ports based on internal Input/Output nodes

## UI Overview

### Canvas Navigation

- **Pan**: Middle mouse, Space+drag, or two-finger drag
- **Zoom**: Mouse wheel or pinch gesture (Cmd+Plus/Minus)
- **Create Node**: Double-click or Tab
- **Edit Node**: Double-click a node
- **Connect**: Drag from output to input port

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Tab** | Open node creation panel |
| **Cmd+K** | Search NPM packages (in editor) |
| **Shift+Enter** | Compile node code |
| **Cmd+Z / Cmd+Shift+Z** | Undo / Redo |
| **Cmd+N** | New project |
| **Cmd+O** | Open project |
| **Cmd+S** | Save project |
| **Cmd+E** | Export HTML |
| **Esc** | Close editor/panel |
| **Delete/Backspace** | Delete selected |
| **Cmd+A** | Select all |
| **Alt+A** | Add annotation |

## Project Structure

```text
cascade/
├── src/
│   ├── nodes/           # Core node system
│   │   ├── Graph.ts     # Graph management
│   │   ├── Node.ts      # Base node class
│   │   └── lens/        # Image processing system
│   ├── editor/          # UI components (18 Svelte components)
│   ├── engine/          # Execution engine
│   └── types/           # TypeScript definitions
├── tests/               # Test suite (605+ tests)
│   ├── performance/     # Performance regression tests
│   └── workflows/       # Integration tests
├── spec/                # Documentation
└── graphs/              # Example projects
```

## Testing

Cascade has comprehensive test coverage:

```bash
# Run all tests
npm run test:run

# Run with watch mode
npm run test

# Run specific test file
npm run test:run -- tests/graph-execution.test.ts
```

**Test Coverage:**

- 605+ tests across 23 test files
- Unit tests for core modules (Graph, Node, execution)
- Performance regression tests (lookups, connections, dirty propagation)
- Integration/workflow tests
- AI code generation tests

## Performance

Cascade is optimized for large graphs:

- **O(1) Lookups** - Node, port, and connection lookups use Map indices
- **Lazy Evaluation** - Pull-based execution only computes visible outputs
- **Parallel Execution** - Independent nodes execute concurrently
- **Dirty Propagation** - Only re-execute changed subgraphs
- **Throttled Preview** - Image previews update at 30fps max

## Command Line Interface

Run graphs headlessly for automation and CI/CD:

```bash
# Build CLI
npm run build:cli

# Install globally
npm link

# Run a graph
cascade run graphs/examples/hello-world.cascade

# Validate without executing
cascade validate graph.cascade

# Verbose output
cascade run graph.cascade --verbose
```

## AI Code Generation

Cascade integrates with Claude AI for code generation:

1. Open the code editor
2. Press **Cmd+K** and type a description
3. Claude generates node code based on context

Configure your API key in Settings (gear icon).

## Development

### Build Commands

```bash
npm run dev        # Start dev server
npm run build      # Production build
npm run preview    # Preview production build
npm run check      # TypeScript type checking
npm run check:ts   # Strict type checking
npm run build:cli  # Build CLI tool
```

### Adding New Node Types

1. Create a class extending `Node` (or `LensNode` for image processing)
2. Register in the appropriate package index
3. Add to the node panel categories

## Documentation

- **Quick Reference**: `spec/CASCADE_QUICK_REFERENCE.md`
- **Production Spec**: `spec/CASCADE_PRODUCTION_SPEC.md`
- **Implementation Guide**: `spec/CASCADE_CLAUDE_CODE_SPEC.md`

## Troubleshooting

### Node code won't compile

- Check for syntax errors in the editor status bar
- Ensure `await` is only used at top level
- Verify all variables are defined

### Packages won't load

- Check internet connection (packages load from esm.sh CDN)
- Try specifying a version: `await node.require('package@1.0.0')`
- Some packages may not support ESM

### Graph is slow

- Use lazy evaluation (only evaluate visible nodes)
- Check for circular dependencies
- Profile with browser DevTools

## Contributing

1. Check existing issues
2. Create a new issue with details
3. Follow existing code style
4. Add tests for new features

## License

See LICENSE file for details.

## Acknowledgments

- Inspired by [Nodes.io](https://nodes.io/) and [TouchDesigner](https://derivative.ca/)
- Built with [Svelte](https://svelte.dev/), [Monaco Editor](https://microsoft.github.io/monaco-editor/), and [Vite](https://vitejs.dev/)

---

Made for creative coders
