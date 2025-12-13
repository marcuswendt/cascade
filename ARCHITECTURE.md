# Cascade Architecture

## Source Directory Structure

```
src/
├── engine/        # Core runtime (headless)
├── nodes/         # Node system
├── editor/        # UI components
├── types/         # TypeScript type definitions
├── utils/         # Shared utilities
├── services/      # Application services
└── cli/           # Command-line interface
```

## Folder Purposes

### `src/engine/` - Core Runtime
**Runs headlessly (no DOM required)**

Infrastructure services that power the node graph:
- `cascade.ts` - Global API (node(), ch(), time(), frame()...)
- `expressions/` - Expression evaluation engine
- `AssetManager.ts` - Asset loading (images, JSON, etc.)
- `GraphValidator.ts` - Graph structure validation
- `ModuleResolver.ts` - Module/import resolution
- `PackageManager.ts` - NPM package loading

**Rule:** If it needs to work in CLI/tests without a browser, it goes here.

### `src/nodes/` - Node System
**The node graph data model**

- `Node.ts` - Base class all nodes extend
- `Graph.ts` - Container that holds nodes and connections
- `annotations/` - Canvas annotations (text, image, group, line)
- `core/` - Core utility nodes (Select, Merge, Subnet, Input, Output)
- `lens/` - Image processing nodes

**Rule:** Node definitions and the graph data structure go here.

### `src/editor/` - Editor UI
**Browser-only, Svelte components**

- UI panels (Inspector, Viewer, Code Editor, etc.)
- Canvas rendering and interaction
- Code history / undo system
- File watching for hot reload
- Keyboard shortcuts, drag-drop, selection

**Rule:** If it renders UI or requires DOM/browser APIs, it goes here.

### `src/types/` - Type Definitions
Shared TypeScript interfaces and types:
- `node.types.ts` - Port, Prop, Connection types
- `element.types.ts` - Element type guards

### `src/utils/` - Shared Utilities
Pure functions used across the codebase:
- `nodeTypeUtils.ts` - Node class registry
- `colorUtils.ts` - Color parsing/normalization
- `fileSystem.ts` - File operations
- `export.ts` - Export utilities

### `src/services/` - Application Services
Higher-level services that coordinate between modules:
- `ProjectService.ts` - Project file management

### `src/cli/` - Command Line Interface
Node.js CLI for headless execution:
- `runner.ts` - Headless graph execution

## Decision Guide

| Need to... | Put it in... |
|------------|--------------|
| Add a new node type | `src/nodes/{package}/` |
| Add expression function | `src/engine/expressions/` |
| Add UI panel/component | `src/editor/` |
| Add shared type | `src/types/` |
| Add pure utility function | `src/utils/` |
| Add runtime feature (no UI) | `src/engine/` |
| Add editor-only feature | `src/editor/` |

## Import Conventions

```typescript
// Alias imports (preferred for cross-package)
import { Node } from '@/nodes/Node';
import { cascade } from '@/engine/cascade';

// Relative imports (within same package)
import { SubnetNode } from './nodes/SubnetNode.js';
```

## Design Principles

### Prefer Polymorphism Over Type Discrimination

Instead of checking types with string literals or switch statements:

```typescript
// Avoid
if (element.type === 'Text') { ... }
else if (element.type === 'Image') { ... }
```

Use polymorphic behavior via:

1. **Method overrides** - Subclasses override behavior (e.g., `Annotation.execute()` is a no-op)
2. **`instanceof` checks** - When type discrimination is necessary
3. **Component registries** - Map class names to UI components

```typescript
// Preferred
if (element instanceof Annotation) { ... }

// For UI rendering, use registries keyed by type
const Component = annotationRegistry.get(annotation.type);
<svelte:component this={Component} {annotation} />
```

This keeps the codebase maintainable as new types are added - just create the class and register it.
