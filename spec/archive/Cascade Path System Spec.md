# Cascade Path System Specification

## Overview

This specification defines a hierarchical addressing system for Cascade that enables every subgraph, node, and parameter to be referenced via absolute or relative paths—similar to Houdini's scene hierarchy and analogous to a filesystem structure.

**Relationship to Existing Code:** The `Node` class (in `src/nodes/core/Node.ts`) provides the base implementation. This spec defines extensions to that class for path-system capabilities (hierarchy navigation, path resolution). When implementing, these extensions are added directly to the `Node` class.

**Code Organization:** Cascade follows a one-file-per-node principle. Each node type is a single TypeScript file that exports both the node class and its metadata. The core library (`src/nodes/core/`) contains both foundational classes (`Node`, `Graph`) and core node types (`Subnet`, `Input`, `Output`).

**Key Simplification vs Houdini:** Cascade has only ONE network type for organizational purposes. Unlike Houdini's specialized managers (`/obj`, `/shop`, `/cop`, `/out`, etc.), Cascade uses a unified hierarchy where any network can contain any node type. This dramatically simplifies the architecture while maintaining all the power of hierarchical organization.

**TypeScript-First:** All scripting and expressions in Cascade use TypeScript. This provides full type safety, IDE autocompletion, and aligns with Cascade's programmer-first philosophy. The expression engine compiles TypeScript at edit-time for immediate feedback.

**Inspiration Sources:**
- Houdini's Python HOM API (`hou.Node`, `hou.Parm`)
- Unix filesystem semantics
- TypeScript's type system

---

## 1. Path Semantics

### 1.1 Path Structure

```
/<network>/<node>/<parameter>

Examples:
/                           → Scene root
/effects                    → Network (subnet) named "effects"
/effects/blur1              → Node "blur1" inside effects network
/effects/blur1/radius       → Parameter "radius" on blur1
/effects/blur1/color/r      → Component "r" of vector parameter "color"
```

### 1.2 Path Types

| Type | Description | Example |
|------|-------------|---------|
| **Absolute** | Starts with `/`, resolved from root | `/effects/blur1/radius` |
| **Relative** | No leading `/`, resolved from current context | `../timer1/value` |
| **Self-reference** | Single `.` refers to current node | `./frequency` |
| **Parent-reference** | `..` navigates up one level | `../../root_param` |

### 1.3 Reserved Path Segments

- `/` — Scene root
- `.` — Current node/network context  
- `..` — Parent network

---

## 2. Core Architecture

### 2.1 Unified Network Model

Unlike Houdini's specialized network types, Cascade uses a **single unified network type**:

```
Root (path: "/")
└── Network (organizational container)
    ├── Node (any type: lens.*, math.*, geometry.*, etc.)
    ├── Node
    └── Network (nested - subnets for organization)
        ├── Node
        └── Network (infinite nesting)
```

All networks are equivalent—there's no `/obj` vs `/shop` distinction. This allows:
- Any node type anywhere in the hierarchy
- Pure organizational grouping (like folders)
- Version management (e.g., `/sketch_v1`, `/sketch_v2`)
- Logical grouping by function, not by technical category

### 2.2 Subnets as Chainable Nodes

Subnets appear as regular nodes in their parent network and can be wired together:

```
┌─────────┐     ┌─────────────────┐     ┌────────────┐
│  Color  │────▶│  SubnetEffect1  │────▶│ BlurFilter │
└─────────┘     └─────────────────┘     └────────────┘
                        │
                        ▼ (dive inside)
              ┌─────────────────────────────────┐
              │  SubnetEffect1 (inside)         │
              │                                 │
              │  ┌───────┐    ┌───────┐        │
              │  │ Input │───▶│ Noise │──┐     │
              │  └───────┘    └───────┘  │     │
              │                          ▼     │
              │               ┌─────────────┐  │
              │               │  Blend  [C] │  │  ← Cooking set
              │               └─────────────┘  │
              │                                │
              │  ┌────────┐   (not cooked -    │
              │  │ Unused │    no path to [C]) │
              │  └────────┘                    │
              └─────────────────────────────────┘
```

### 2.3 Cooking & Subnet Output

**Cooking `[C]`:** Each network has exactly ONE node with `cooking` set to true. This node defines the output of the subnet AND is the evaluation target. Only the chain of nodes leading to the cooking node is evaluated—unused branches are skipped entirely.

This unifies two concepts into the existing `cooking` property:

1. **Subnet output designation** — which node's output represents the subnet
2. **Evaluation target** — which node (and its dependencies) should be executed

```typescript
class Node {
  // EXISTING property - now also determines subnet output
  cooking: boolean = false;

  // EXISTING method - extended with exclusive-per-network behavior
  setCooking(value: boolean): void {
    if (value && this.parent) {
      // Clear cooking from siblings in same network (exclusive)
      this.parent.children()
        .filter(n => n !== this && n.cooking)
        .forEach(n => n.setCooking(false));
    }
    this.cooking = value;
    // ... existing implementation
  }
}

// For subnet nodes
class SubnetNode extends Node {
  // Get the node that defines this network's output
  outputNode(): Node | null;

  // Alias for the cooking node
  displayNode(): Node | null;
}
```

**Behavior:**

- When you set `cooking = true` on a node, it's automatically cleared from siblings in the same network
- If no node is cooking, the last created node is used (or none if empty)
- The cooking node appears with a `[C]` badge in the editor
- Keyboard shortcut: `C` to toggle cooking on selected node

### 2.4 Output Node (Explicit Subnet Output)

The **Output** node is a core node type that explicitly defines a subnet's output, overriding the cooking node:

```typescript
// Core library node type (src/nodes/core/nodes/OutputNode.ts)
export const nodeMetadata = {
  type: 'Output',
  name: 'Output',
  icon: 'LogOut',
  description: 'Defines the output of a subnet',
  category: 'network'
};

export class OutputNode extends Node {
  // Which output port this routes to (default 0)
  // Multiple Output nodes with different indices = multiple subnet outputs
  outputIndex: number = 0;
}
```

**Use cases:**
- Multiple output points in a subnet (use multiple Output nodes with names)
- Explicit documentation of what exits a subnet
- Override cooking node for "locked" output while experimenting with display

```
┌─────────────────────────────────────────────────┐
│  Subnet with Output node                        │
│                                                 │
│  ┌───────┐    ┌───────┐    ┌──────────────┐    │
│  │ Input │───▶│ Blur  │───▶│ Output       │    │  ← This defines output
│  └───────┘    └───────┘    └──────────────┘    │
│                   │                             │
│                   ▼                             │
│              ┌─────────┐                        │
│              │ Debug[C]│                        │  ← Cooking for preview
│              └─────────┘                        │    but Output node wins
└─────────────────────────────────────────────────┘
```

**Output precedence:**

1. If an `Output` node exists → use it (ignore cooking node)
2. Otherwise → use cooking node
3. If nothing cooking → use last node (or null)

### 2.5 Subnet Inputs (Indirect Inputs)

When you wire into a subnet from outside, those connections appear as **Input** nodes inside:

```typescript
// Core library node type (src/nodes/core/nodes/InputNode.ts)
export const nodeMetadata = {
  type: 'Input',
  name: 'Input',
  icon: 'LogIn',
  description: 'Represents an external input to a subnet',
  category: 'network'
};

export class InputNode extends Node {
  // Which external input this represents (0, 1, 2...)
  inputIndex: number = 0;

  // Optional: named input for documentation
  inputName: string = '';
}
```

```
Parent network:
┌─────────┐     ┌─────────────────┐
│  Color  │────▶│  MySubnet       │  (input 0)
└─────────┘     │                 │
┌─────────┐     │                 │
│  Mask   │────▶│                 │  (input 1)
└─────────┘     └─────────────────┘

Inside MySubnet:
┌─────────────────────────────────────────────────┐
│                                                 │
│  ┌───────────┐                                  │
│  │ Input 0   │───▶ ...                          │
│  │ "color"   │                                  │
│  └───────────┘                                  │
│  ┌───────────┐                                  │
│  │ Input 1   │───▶ ...                          │
│  │ "mask"    │                                  │
│  └───────────┘                                  │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Behavior:**
- Input nodes are auto-created when wiring into a subnet
- They can be manually created and named for documentation
- Deleting an Input node disconnects the external wire
- Input nodes appear at the top of the subnet in the editor

### 2.6 Key Principle: Networks ARE Nodes

Following Houdini's `hou.Node.isNetwork()` pattern, networks extend the base node interface:

```typescript
// A network is just a node that can contain children
node.isNetwork()  // true if this node can contain child nodes

// Networks have inputs/outputs just like regular nodes
subnet.inputs()   // Nodes wired into this subnet
subnet.outputs()  // Nodes this subnet feeds into
subnet.outputNode() // The internal node defining the output
```

### 2.7 API Design (HOM-inspired)

The path system API follows Houdini's Python HOM patterns, providing a **facade over the existing `Node` and `Graph` classes** for path-based access and hierarchical navigation.

```typescript
// ============================================================
// cascade.node(path) - Find a node by path
// Equivalent to: hou.node(path)
// ============================================================
cascade.node("/effects/blur1")                    // Absolute path
cascade.node("blur1")                             // Relative to pwd
currentNode.node("../timer1")                     // Relative from node
currentNode.node("effects/blur1")                 // Child path

// ============================================================
// Path-based extensions to existing Node class
// ============================================================

// These methods extend the existing Node class for hierarchical navigation:
class Node {
  // EXISTING properties/methods:
  id: string;                                      // Node identifier (used as name in paths)
  type: string;                                    // Node type
  position: { x: number; y: number };
  inputs: InputPort[];
  outputs: OutputPort[];
  props: Record<string, Prop>;
  error: Error | null;
  warning: string | null;
  bypassed: boolean;
  cooking: boolean;                                // EXTENDED: now also determines subnet output
  comment: string;

  // NEW: Path system extensions
  parent: Node | null;                             // Parent network node
  path(): string;                                  // "/effects/blur1" (computed from hierarchy)
  children(): Node[];                              // Child nodes (if this is a subnet)
  node(relativePath: string): Node | null;         // Find by relative path
  relativePathTo(other: Node): string;             // "../other/path"
  isNetwork(): boolean;                            // True if this is a Subnet node

  // EXISTING - extended with exclusive-per-network behavior:
  setCooking(on: boolean): void;                   // Sets cooking, clears siblings

  // EXISTING (already in Node class):
  setBypassed(on: boolean): void;
  markDirty(): void;
  get isDirty(): boolean;

  // NEW: Parameter access by name (wraps props system)
  parm(name: string): Parm | null;                 // Get prop as Parm wrapper
  evalParm(name: string): any;                     // this.props[name]?.value
  setParm(name: string, value: any): void;         // this.updateProp(name, value)

  // NEW: Connection queries
  inputNodes(): Node[];                            // Nodes connected to inputs
  outputNodes(): Node[];                           // Nodes connected to outputs

  // NEW: Subnet operations (when isNetwork() === true)
  outputNode(): Node | null;                       // Node defining subnet output
  displayNode(): Node | null;                      // Cooking node
  indirectInputs(): InputNode[];                   // core.Input nodes inside
}

// ============================================================
// Parm wrapper (adapts Props system to HOM-style API)
// ============================================================
interface Parm {
  name(): string;                                  // Prop key
  path(): string;                                  // "/effects/blur1/radius"
  node(): Node;                                    // Owning node
  
  // Value access (delegates to Prop)
  eval(): any;                                     // prop.value (respects expressions)
  evalAsFloat(): number;
  evalAsInt(): number;
  evalAsString(): string;
  evalAsVector(): number[];
  
  rawValue(): any;                                 // Raw value (ignores expressions)
  set(value: any): void;                           // node.updateProp(name, value)
  
  // Expression support (NEW)
  expression(): string | null;                     // Get expression text
  setExpression(expr: string): void;               // Set TypeScript expression
  deleteExpression(): void;
  hasExpression(): boolean;
  
  // Type info (from Prop)
  parmType(): string;                              // prop.type
  numComponents(): number;                         // 1 for scalar, 3 for vector, etc.
}

// ============================================================
// Network-specific interface (for Subnet nodes)
// ============================================================
interface NetworkNode extends Node {
  outputNode(): Node | null;                       // Node defining this subnet's output
  displayNode(): Node | null;                      // Cooking node
  indirectInputs(): InputNode[];                   // Get all core.Input nodes inside
}
```

---

## 3. Execution Model

This section documents Cascade's execution model. The core `Node` class already implements most of this — this spec documents the design and extends it for hierarchical networks.

### 3.1 Data Flow & Types

Connections carry typed data via ports. Each port has a `dataType` property. Wire colors indicate data type:

| Type | Wire Color | Description |
|------|------------|-------------|
| `ImageData` | Orange | Pixel buffers (RGBA) |
| `number` | Blue | Scalar values |
| `number[]` | Purple | Vectors, colors |
| `string` | Green | Text data |
| `Geometry` | Yellow | 2D/3D shapes |
| `any` | Gray | Untyped/generic |

**Type Mismatch Handling:**
- Mismatched connections show a warning badge on the downstream node (`node.warning`)
- Some implicit conversions are allowed (e.g., `number` → `number[]` as `[n, n, n]`)
- Invalid connections still render (for debugging) but show warning state

```typescript
// Existing port structure (from Node class)
interface InputPort<T = any> {
  dataType: string;        // 'any', 'number', 'ImageData', etc.
  value: T;
  // ...
}

interface OutputPort<T = any> {
  dataType: string;
  value: T;
  setValue(value: T): void;
  // ...
}

// Type checking on connection
function validateConnection(source: OutputPort, target: InputPort): boolean {
  if (source.dataType === 'any' || target.dataType === 'any') return true;
  return source.dataType === target.dataType;
}
```

### 3.2 Viewer / Preview

The **viewer pane** shows the output of:
1. **Selected node** (if any node is selected) — allows inspection anywhere in chain
2. **Cooking node** (if nothing selected) — the "output" of current network

```typescript
// Get what the viewer should display
function viewerTarget(graph: Graph): Node | null {
  const selected = graph.getSelectedNodes();
  if (selected.length === 1) {
    return selected[0];  // Show selected node's preview
  }
  // Fall back to cooking node or last node
  return graph.getCookingNode() ?? graph.getLastNode();
}
```

Each node already has `preview: HTMLCanvasElement | HTMLImageElement | null` for rendering.

### 3.3 Error Handling

Errors and warnings appear as badges on nodes in the canvas:

```
┌─────────────┐
│  BadNode    │ ⚠️  ← Warning badge
└─────────────┘

┌─────────────┐
│  FailNode   │ ❌  ← Error badge  
└─────────────┘
```

**Error behavior:**
- **Node error** → Execution stops at this node; downstream nodes receive `null`
- **Expression error** → Parameter uses fallback value (default or last valid)
- **Type mismatch** → Warning shown; node attempts to process anyway

```typescript
// Existing Node class properties
class Node {
  error: Error | null = null;      // Set during execute() catch block
  warning: string | null = null;   // For non-fatal issues (type mismatch, etc.)
  
  // Error is set automatically in execute():
  async execute(): Promise<void> {
    try {
      // ... execution
      this.error = null;
    } catch (err: any) {
      this.error = err as Error;
      this.manualDirty = true;
    }
  }
}
```

**UI rendering:** The canvas renderer checks `node.error` and `node.warning` to render badges.

### 3.4 Dirty Propagation & Caching

Nodes cache their output until marked **dirty**. The existing `Node` class implements this:

```typescript
class Node {
  protected hasExecuted: boolean = false;
  protected lastInputHash: string = '';
  protected manualDirty: boolean = false;
  
  markDirty(): void {
    this.manualDirty = true;
  }
  
  get isDirty(): boolean {
    if (!this.hasExecuted || this.manualDirty) return true;
    return this.calculateInputHash() !== this.lastInputHash;
  }
}
```

**A node becomes dirty when:**
1. **Parameter changes** — `updateProp()` calls `markDirty()`
2. **Input changes** — Detected via `calculateInputHash()` comparing input values
3. **Time changes** — If node depends on `time`/`frame` (requires time dependency tracking)
4. **Explicit invalidation** — `node.markDirty()`

**Time dependency detection (extension needed):**

```typescript
class Node {
  // NEW: Track if this node uses time-varying expressions
  isTimeDependent: boolean = false;
  
  // Called by expression compiler when analyzing expressions
  setTimeDependent(value: boolean): void {
    this.isTimeDependent = value;
  }
}

// In animation loop, dirty all time-dependent nodes
function onFrame() {
  graph.nodes.forEach(node => {
    if (node.isTimeDependent) node.markDirty();
  });
}
```

### 3.5 Bypass Behavior

The existing `Node` class implements bypass:

```typescript
class Node {
  bypassed: boolean = false;
  bypassOpacity: number = 1.0;
  
  setBypassed(value: boolean): void {
    this.bypassed = value;
    this.bypassOpacity = value ? 0.5 : 1.0;
    this.markDirty();
  }
  
  shouldExecute(): boolean {
    if (this.bypassed) return false;
    // ... cooking logic
  }
  
  executeBypass(): void {
    // Pass input 0 through to matching output
    this.inputs.forEach(input => {
      if (input.portType === 'param') {
        const matchingOutput = this.outputs.find(out => 
          out.name === input.name || this.outputs.length === 1
        );
        if (matchingOutput) matchingOutput.setValue(input.value);
      }
    });
  }
}
```

Bypassed nodes appear dimmed (`bypassOpacity: 0.5`) with a `[B]` badge.

### 3.6 Cook Order & Lazy Evaluation

Evaluation proceeds **demand-driven** from the output backward:

```typescript
async function cookGraph(graph: Graph): Promise<void> {
  // Find output node (cooking or last)
  const output = graph.getCookingNode() ?? graph.getLastNode();
  if (!output) return;
  
  // Topological sort from output backward
  const order = graph.getExecutionOrder(output);
  
  // Execute in dependency order
  for (const node of order) {
    if (node.isDirty) {
      await node.execute();
    }
  }
}
```

**Lazy evaluation:** Nodes not in the dependency chain of the output are never cooked.

### 3.7 Copy/Paste Path Handling

When nodes are copied and pasted:

1. **Relative paths within selection** → Preserved as-is (they still work)
2. **Relative paths to nodes outside selection** → Attempt to resolve:
   - If target exists at same relative location → keep relative
   - If target exists elsewhere → convert to absolute path
   - If target doesn't exist → mark as broken, set `node.warning`
3. **Absolute paths** → Kept as-is (they still work if target exists)

```typescript
interface PasteResult {
  nodes: Node[];
  remappedPaths: { original: string; remapped: string; nodeId: string; prop: string }[];
  brokenPaths: { path: string; nodeId: string; prop: string }[];
}
```

---

## 4. Global Functions

Following Houdini's module-level functions:

```typescript
// ============================================================
// Module-level functions (cascade.*)
// ============================================================

// Node access
cascade.node(path: string): CascadeNode | null;   // Find node by path
cascade.parm(path: string): CascadeParm | null;   // Find parameter by path
cascade.root(): CascadeNode;                      // Get root node ("/")
cascade.pwd(): CascadeNode;                       // Current working directory/node
cascade.setPwd(node: CascadeNode): void;          // Set current node

// Selection
cascade.selectedNodes(): CascadeNode[];           // All selected nodes
cascade.clearAllSelected(): void;

// Time/playback globals
cascade.frame(): number;                          // Current frame number
cascade.time(): number;                           // Current time in seconds  
cascade.fps(): number;                            // Frames per second
cascade.setFrame(frame: number): void;
cascade.setTime(time: number): void;

// Utility
cascade.ch(path: string): number;                 // Shorthand for parm eval
cascade.chs(path: string): string;                // Eval as string
cascade.chv(path: string): number[];              // Eval as vector
```

---

## 5. Path Resolution

### 5.1 Resolution Algorithm

```typescript
function resolvePath(path: string, context: CascadeNode): CascadeNode | null {
  // Absolute path - start from root
  if (path.startsWith('/')) {
    return cascade.root().node(path.slice(1));
  }
  
  // Relative path - start from context
  let current: CascadeNode | null = context;
  const segments = path.split('/').filter(s => s.length > 0);
  
  for (const segment of segments) {
    if (!current) return null;
    
    if (segment === '.') {
      continue;  // Stay at current
    }
    if (segment === '..') {
      current = current.parent();  // Go up
      continue;
    }
    
    // Try as child node
    if (current.isNetwork()) {
      const child = current.children().find(c => c.id === segment);
      if (child) {
        current = child;
        continue;
      }
    }
    
    return null;  // Segment not found
  }
  
  return current;
}
```

### 5.2 Pattern Matching (Globbing)

Based on Houdini's `node.glob()` and `node.recursiveGlob()`:

```typescript
interface CascadeNode {
  // Pattern matching (from hou.Node.glob)
  glob(pattern: string): CascadeNode[];           // Match direct children
  recursiveGlob(pattern: string): CascadeNode[];  // Match all descendants
}

// Pattern syntax
*           // Match any characters: "blur*" matches blur1, blur2, blurFinal
?           // Match single character: "node?" matches node1, nodeA
[abc]       // Match character set: "blur[123]" matches blur1, blur2, blur3
[!abc]      // Exclude character set
^pattern    // Exclude matches: "* ^backup*" matches all except backup*

// Examples
node.glob("blur*")                    // All children starting with "blur"
node.glob("* ^temp*")                 // All children except those starting with "temp"
node.recursiveGlob("**/timer*")       // All timer* nodes at any depth
cascade.root().recursiveGlob("**")    // ALL nodes in entire graph
```

---

## 6. Parameter Expressions

### 6.1 Expression Syntax

Parameters support TypeScript expressions with special functions. The expression engine provides full type safety and IDE autocompletion.

```typescript
// ============================================================
// Numeric parameters evaluate expressions directly
// ============================================================

// Simple math
Math.sin(time) * 12.5

// Reference another parameter (absolute)
ch("/effects/noise1/amplitude") * 2

// Reference another parameter (relative to this node)
ch("../timer1/value")

// Reference sibling parameter on same node
ch("./frequency") * 0.5

// Conditional
frame < 100 ? ch("./startValue") : ch("./endValue")

// ============================================================
// String parameters use template literals for expressions
// ============================================================
`frame_${padzero(5, frame)}.png`    // → "frame_00042.png"

// ============================================================
// Type-safe vector operations
// ============================================================
const color = chv<[number, number, number]>("./baseColor");
[color[0] * 0.5, color[1], color[2]]  // Darken red channel
```

### 6.2 Expression Functions

All expression functions are fully typed for IDE autocompletion:

```typescript
// Channel reference functions
declare function ch(path: string): number;
declare function chs(path: string): string;
declare function chv<T extends number[] = number[]>(path: string): T;

// Node queries  
declare function opexist(path: string): 0 | 1;
declare function opinput<T = CascadeNode>(index: number): T | null;

// Math utilities
declare function fit(value: number, oldMin: number, oldMax: number, newMin: number, newMax: number): number;
declare function fit01(value: number, newMin: number, newMax: number): number;
declare function clamp(value: number, min: number, max: number): number;
declare function lerp(a: number, b: number, t: number): number;
declare function smooth(value: number, min: number, max: number): number;

// Noise functions
declare function noise(x: number): number;                    // 1D, returns -1 to 1
declare function noise(x: number, y: number): number;         // 2D
declare function noise(x: number, y: number, z: number): number; // 3D
declare function random(seed: number): number;                // Deterministic 0-1

// String utilities
declare function padzero(digits: number, value: number): string;
```

| Function | Description | Example |
|----------|-------------|---------|
| `ch(path)` | Get parameter value as number | `ch("/node1/scale")` |
| `chs(path)` | Get parameter value as string | `chs("../name")` |
| `chv<T>(path)` | Get vector parameter (typed) | `chv<[r,g,b]>("./color")` |
| `opexist(path)` | Check if node exists (returns 0/1) | `opexist("../backup")` |
| `opinput(idx)` | Get input node reference | `opinput(0)?.path()` |
| `fit(v, omin, omax, nmin, nmax)` | Remap value range | `fit(time, 0, 10, 0, 1)` |
| `fit01(v, nmin, nmax)` | Remap 0-1 to new range | `fit01(ch("./t"), 0, 100)` |
| `clamp(v, min, max)` | Clamp value | `clamp(ch("./x"), 0, 100)` |
| `lerp(a, b, t)` | Linear interpolation | `lerp(0, 100, time / 10)` |
| `smooth(v, min, max)` | Smooth hermite interpolation | `smooth(ch("./t"), 0, 1)` |
| `noise(x, ...)` | Perlin noise (-1 to 1) | `noise(time)` |
| `random(seed)` | Deterministic random (0-1) | `random(frame)` |
| `padzero(digits, num)` | Zero-pad number | `padzero(4, frame)` → "0042" |

### 6.3 Global Variables in Expressions

```typescript
// These are always available in expression context
declare const time: number;   // Current time in seconds
declare const frame: number;  // Current frame number  
declare const fps: number;    // Frames per second
```

| Variable | Type | Description |
|----------|------|-------------|
| `time` | `number` | Current time in seconds (`$T` in Houdini) |
| `frame` | `number` | Current frame number (`$F` in Houdini) |
| `fps` | `number` | Frames per second (`$FPS`) |

### 6.4 Expression Evaluation Context

The expression engine compiles TypeScript to JavaScript at edit-time, providing:
- **Type checking** — Errors shown inline before evaluation
- **Autocompletion** — Full IDE support for all functions and node paths
- **Type inference** — Parameter types flow through expressions

```typescript
interface ExpressionContext {
  // Globals (automatically available)
  readonly time: number;
  readonly frame: number;  
  readonly fps: number;
  
  // Node context
  readonly self: CascadeNode;           // Current node (for relative paths)
  
  // Functions (automatically bound with full types)
  ch: (path: string) => number;
  chs: (path: string) => string;
  chv: <T extends number[]>(path: string) => T;
  opexist: (path: string) => 0 | 1;
  fit: (v: number, omin: number, omax: number, nmin: number, nmax: number) => number;
  clamp: (v: number, min: number, max: number) => number;
  lerp: (a: number, b: number, t: number) => number;
  noise: (...coords: number[]) => number;
  random: (seed: number) => number;
}

// Expression compiler (edit-time)
interface ExpressionCompiler {
  compile(expr: string, expectedType: 'number' | 'string' | 'vector'): CompiledExpression;
  validate(expr: string): ValidationResult;
  getCompletions(expr: string, cursorPos: number, context: CascadeNode): CompletionItem[];
}

interface ValidationResult {
  valid: boolean;
  errors: { message: string; line: number; column: number }[];
  inferredType: string;
}
```

---

## 7. Editor UI Integration

### 7.1 Network Navigation

**Path Display Bar:**
```
┌─────────────────────────────────────────────────────────────┐
│  /  ›  effects  ›  blur_stack  ›  gaussian1                 │
│  ↑     ↑           ↑              ↑                         │
│  clickable breadcrumb segments                              │
└─────────────────────────────────────────────────────────────┘
```

**Keyboard Shortcuts:**
| Key | Action | Houdini Equivalent |
|-----|--------|-------------------|
| `i` or `Enter` or double-click | Dive into selected subnet | Same |
| `o` or `Backspace` | Jump out one level (up to root) | Same |
| `u` | Jump up to parent (alternate) | Same |
| `Shift+C` | Collapse selected nodes into new subnet | Same |
| `C` | Toggle cooking on selected node (subnet output) | Display flag |
| `B` | Toggle bypass flag on selected node | Same |
| `/` | Focus path input for direct navigation | — |

### 7.2 Network Navigator Component

```typescript
interface NetworkNavigator {
  // Current state
  currentNetwork(): CascadeNode;        // Network being viewed
  currentPath(): string;                // e.g., "/effects/blur_stack"
  
  // Navigation
  cd(path: string): void;               // Navigate to path (like hou.cd)
  diveInto(node: CascadeNode): void;    // Enter subnet
  jumpOut(): void;                      // Go to parent
  jumpToRoot(): void;                   // Go to "/"
  
  // Breadcrumbs
  breadcrumbs(): { name: string; path: string; node: CascadeNode }[];
}
```

### 7.3 Subnet Operations

```typescript
// Collapse selection into subnet (Shift+C)
function collapseIntoSubnet(
  parent: CascadeNode, 
  nodesToCollapse: CascadeNode[], 
  subnetName?: string
): CascadeNode {
  // Like hou.Node.collapseIntoSubnet()
  const subnet = parent.createNode("subnet", subnetName ?? "subnet1");
  
  // Move nodes into subnet preserving relative positions
  for (const node of nodesToCollapse) {
    // ... move logic
  }
  
  // Rewire external connections through subnet inputs/outputs
  // ...
  
  return subnet;
}

// Extract subnet contents (opposite operation)
function extractAndDelete(subnet: CascadeNode): CascadeNode[] {
  // Like hou.Node.extractAndDelete()
  const extracted = subnet.children();
  // Move children to parent, rewire, delete subnet
  // ...
  return extracted;
}
```

---

## 8. Persistence & Serialization

### 8.1 Graph File Format

Paths in expressions are stored as-is (relative or absolute). Expressions are stored as TypeScript source. Cooking state and connections are explicitly saved:

```json
{
  "version": "1.0",
  "children": {
    "effects": {
      "type": "core.Subnet",
      "children": {
        "input0": {
          "type": "core.Input",
          "parameters": {
            "name": { "value": "source" }
          }
        },
        "noise1": {
          "type": "lens.Noise",
          "inputs": ["input0"],
          "parameters": {
            "amplitude": { "value": 5.0 }
          }
        },
        "blur1": {
          "type": "lens.GaussianBlur",
          "inputs": ["noise1"],
          "cooking": true,
          "parameters": {
            "radius": { "value": 10 },
            "amount": { 
              "expression": "ch('../noise1/amplitude') * 2" 
            }
          }
        },
        "output": {
          "type": "core.Output",
          "inputs": ["blur1"]
        }
      }
    }
  }
}
```

### 8.2 Expression Compilation Cache

TypeScript expressions are compiled at load-time and cached:

```typescript
interface CompiledExpression {
  source: string;                    // Original TypeScript
  compiled: () => unknown;           // Compiled function
  dependencies: string[];            // Referenced paths (for dirty tracking)
  returnType: string;                // Inferred return type
}
```

### 8.3 Path Validation on Load

```typescript
interface LoadResult {
  success: boolean;
  warnings: PathWarning[];
}

interface PathWarning {
  location: string;           // "/effects/blur1/amount"
  expression: string;         // "ch('../noise1/amplitude') * 2"
  brokenPath: string;         // "../noise1/amplitude"
  suggestion?: string;        // Possible fix
}
```

---

## 9. Implementation Phases

### Phase 1: Code Reorganization & Core Path System

**Reorganize core library (`src/nodes/core/`):**

- [ ] Move `Node.ts` from `src/core/engine/` to `src/nodes/core/`
- [ ] Move `Graph.ts` from `src/core/engine/` to `src/nodes/core/`
- [ ] Move supporting files (`GraphValidator.ts`, `ModuleResolver.ts`, etc.)
- [ ] Update all import paths across codebase
- [ ] Convert to one-file-per-node pattern with `nodeMetadata` exports

**Extend existing `Node` class:**

- [ ] Add `parent: Node | null` property
- [ ] Add `path()` method (computed from hierarchy)
- [ ] Add `children()` — child nodes for subnet types
- [ ] Add `node(relativePath)` for relative resolution
- [ ] Add `relativePathTo(other)`
- [ ] Add `isNetwork()` — true for Subnet type
- [ ] Extend `setCooking()` with exclusive-per-network behavior

**New node types (one file each in `src/nodes/core/nodes/`):**

- [ ] `SubnetNode.ts` — network container with `children()`, `outputNode()`, `displayNode()`
- [ ] `InputNode.ts` — represents external input to subnet
- [ ] `OutputNode.ts` — explicit subnet output designation
- [ ] Unit tests for path resolution

**Already exists in Node class:** `id`, `type`, `inputs`, `outputs`, `props`, `error`, `warning`, `bypassed`, `cooking`, `markDirty()`, `isDirty`, `setBypassed()`, `setCooking()`, `execute()`

### Phase 2: Expression Engine

- [ ] Set up TypeScript compiler API for expression parsing
- [ ] Implement `ch()`, `chs()`, `chv<T>()` typed functions
- [ ] Add global variables (`time`, `frame`, `fps`)
- [ ] Expression validation with inline error reporting
- [ ] Type inference for parameter expressions
- [ ] Add `isTimeDependent` tracking to Node class
- [ ] Unit tests for expression evaluation

### Phase 3: UI Integration

- [ ] Network path bar with breadcrumbs
- [ ] Keyboard navigation (`i`, `o`, `Shift+C`, `C`, `B`)
- [ ] `collapseIntoSubnet()` operation
- [ ] Cooking visualization (`[C]` badge)
- [ ] Input/Output node auto-creation when wiring subnets
- [ ] Expression editor with TypeScript autocompletion
- [ ] Path autocomplete in parameter fields
- [ ] Error/warning badge rendering (already have `node.error` and `node.warning`)

### Phase 4: Advanced Features

- [ ] `glob()` and `recursiveGlob()` pattern matching
- [ ] Broken path detection and warnings on load
- [ ] Expression debugging UI (show evaluated values, types)
- [ ] Copy/paste with path remapping
- [ ] Type mismatch detection and warnings
- [ ] Lazy evaluation (only cook nodes in path to output)

---

## 10. API Quick Reference

```typescript
// ============================================================
// Finding nodes
// ============================================================
cascade.node("/effects/blur1")           // Find by absolute path
cascade.node("blur1")                    // Find relative to pwd
node.node("../timer1")                   // Find relative to node
cascade.root()                           // Get root node "/"
cascade.pwd()                            // Get current node

// ============================================================
// Node properties
// ============================================================
node.id                                  // "blur1" (used as name in paths)
node.path()                              // "/effects/blur1"
node.parent                              // Parent node
node.children()                          // Child nodes (if network)
node.isNetwork()                         // Can contain children?
node.relativePathTo(otherNode)           // "../other"

// ============================================================
// Subnet I/O
// ============================================================
subnet.outputNode()                      // Node defining subnet's output
subnet.displayNode()                     // Cooking node
subnet.indirectInputs()                  // Input nodes inside subnet

node.cooking                             // Is this the output/evaluation target?
node.setCooking(true)                    // Make this the output (clears siblings)

// ============================================================
// Parameters (fully typed)
// ============================================================
node.parm("radius")                      // Get parameter object
node.evalParm("radius")                  // Evaluate parameter value
node.setParm("radius", 10)               // Set parameter value
parm.expression()                        // Get expression string
parm.setExpression("ch('../x') * 2")     // Set expression

// ============================================================
// Pattern matching
// ============================================================
node.glob("blur*")                       // Children matching pattern
node.recursiveGlob("**/timer*")          // All descendants matching

// ============================================================
// Selection & Flags
// ============================================================
cascade.selectedNodes()                  // All selected nodes
node.setSelected(true)                   // Select node
node.setCurrent(true)                    // Make current node
node.setCooking(true)                    // Set as subnet output (clears siblings)
node.setBypassed(true)                   // Bypass this node

// ============================================================
// TypeScript Expressions (in parameter fields)
// ============================================================

// Basic references
ch("/effects/blur1/radius")              // Get parameter value
ch("../timer1/value") * 2                // Relative reference + math

// Type-safe vector access
const [r, g, b] = chv<[number, number, number]>("./color");
[r * 0.5, g, b]                          // Return modified color

// Math utilities
fit(time, 0, 10, 0, 1)                   // Remap time 0-10 → 0-1
clamp(ch("./x"), 0, 100)                 // Clamp to range
lerp(0, 100, time / 10)                  // Linear interpolation

// Noise and randomness
noise(frame * 0.1) * 10                  // Animated noise
random(frame)                            // Deterministic random

// String expressions (template literals)
`output_${padzero(4, frame)}.png`        // "output_0042.png"

// Conditional logic
frame < 100 
  ? ch("./intro") 
  : ch("./main")
```

---

## 11. Core Library Structure

The core library (`src/nodes/core/`) contains both foundational classes and node types:

```text
src/nodes/core/
├── Node.ts              # Base class for all nodes
├── Graph.ts             # Graph manager
├── GraphValidator.ts    # Validation & topological sort
├── ModuleResolver.ts    # Module resolution
├── PackageManager.ts    # NPM package loading
├── AssetManager.ts      # Asset management
├── index.ts             # Exports & registration
│
└── nodes/
    ├── SubnetNode.ts    # Network container
    ├── InputNode.ts     # Subnet input
    ├── OutputNode.ts    # Subnet output
    ├── SelectNode.ts    # Data routing
    └── MergeNode.ts     # Data aggregation
```

### One-File-Per-Node Pattern

Each node file exports both metadata and class:

```typescript
// src/nodes/core/nodes/SubnetNode.ts
import { Node } from '../Node';

export const nodeMetadata = {
  type: 'Subnet',
  name: 'Subnet',
  icon: 'FolderTree',
  description: 'Network container for organizing nodes',
  category: 'network'
};

export class SubnetNode extends Node {
  private _children: Node[] = [];

  isNetwork(): boolean {
    return true;
  }

  children(): Node[] {
    return this._children;
  }

  outputNode(): Node | null {
    // 1. Check for explicit Output node
    const output = this._children.find(n => n.type === 'core.Output');
    if (output) return output;

    // 2. Use cooking node
    const cooking = this._children.find(n => n.cooking);
    if (cooking) return cooking;

    // 3. Fall back to last node
    return this._children.at(-1) ?? null;
  }

  displayNode(): Node | null {
    return this._children.find(n => n.cooking) ?? null;
  }
}
```

### Core Node Types

| Node Type | File | Description |
|-----------|------|-------------|
| `core.Subnet` | `SubnetNode.ts` | Network container for organizing nodes |
| `core.Input` | `InputNode.ts` | Represents external input to subnet (auto-created when wiring) |
| `core.Output` | `OutputNode.ts` | Explicit subnet output (overrides cooking node) |
| `core.Select` | `SelectNode.ts` | Select one of multiple inputs by index |
| `core.Merge` | `MergeNode.ts` | Combine multiple inputs into array |

### Usage Example

```typescript
// Create a subnet with explicit I/O
const subnet = parent.createNode("core.Subnet", "myEffect");
cascade.setPwd(subnet);

const input = subnet.createNode("core.Input", "source");
const blur = subnet.createNode("lens.GaussianBlur", "blur1");
const output = subnet.createNode("core.Output", "out");

blur.setInput(0, input);
output.setInput(0, blur);
```

---

## References

- [Houdini HOM: hou.Node](https://www.sidefx.com/docs/houdini/hom/hou/Node.html)
- [Houdini Networks and Parameters](https://www.sidefx.com/docs/houdini/network/index.html)
- [Houdini Parameter Expressions](https://www.sidefx.com/docs/houdini/network/expressions.html)
