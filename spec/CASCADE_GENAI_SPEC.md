# Cascade GenAI System Specification

## Overview

This specification defines a node-based generative AI workflow system for Cascade, enabling creative iteration with text-to-image models, prompt manipulation, and image analysis.

## Design Principles

1. **Button-Triggered Generation** - AI generation is expensive and slow; never auto-trigger on parameter changes
2. **Grid Selection as First-Class Pattern** - Multi-result generation with visual selection is core to the creative workflow
3. **Provider Abstraction** - Support multiple AI providers (Replicate, Fal.ai, Google, OpenAI) behind unified interfaces
4. **Credential Isolation** - API keys stored in user preferences, never in shareable graph files
5. **Project-Local Caching** - Generated assets cached in project directory for portability
6. **Parallel Generation** - Multiple nodes can generate simultaneously for fast exploration
7. **Background Execution** - Generation runs in background; UI remains fully responsive
8. **Optional Inputs** - All node inputs are optional; parameters work standalone, connections override them
9. **Canvas as Visual Workspace** - Nodes show their outputs directly; the canvas IS the viewer

---

## Visual Canvas

The canvas is not just a node editor—it's a visual thinking workspace where you see your creative process unfold.

### The Problem with Traditional Node Editors

```
┌─────────────┐     ┌─────────────┐
│ Generate    │────▶│ Composite   │
│ ○ prompt    │     │             │
│ ○ seed      │     │             │
└─────────────┘     └─────────────┘
     ???                 ???
```

You can't see what's happening without opening a Viewer. The canvas shows plumbing, not results.

### The Vision: Canvas as Viewer

```
┌─────────────────┐     ┌─────────────────┐
│ ┌─────────────┐ │     │ ┌─────────────┐ │
│ │             │ │     │ │             │ │
│ │  [dragon   │ │────▶│ │  [dragon    │ │
│ │   flying]  │ │     │ │   + sunset] │ │
│ │             │ │     │ │             │ │
│ └─────────────┘ │     └─────────────┘ │
│ Generate    🎲  │     │ Composite     │
└─────────────────┘     └─────────────────┘
```

**Every Lens node shows its output. The canvas IS the viewer.**

---

### Node Display Modes

```typescript
type NodeDisplayMode = 'box' | 'thumbnail' | 'grid' | 'minimal';
```

| Mode | Description | Use Case |
|------|-------------|----------|
| `box` | Traditional labeled box with ports | Non-visual nodes (Text, Random, etc.) |
| `thumbnail` | Output image as node body | Default for Lens nodes |
| `grid` | Batch results as selectable grid | Generate node with multiple results |
| `minimal` | Just the image, no chrome | Presentations, storyboards |

---

### Thumbnail Mode (Default for Lens Nodes)

```
┌─────────────────────┐
│ ┌─────────────────┐ │
│ │                 │ │
│ │   [output       │ │
│ │    image]       │ │
│ │                 │ │
│ └─────────────────┘ │
│ Generate    🎲 ⚙️ ▼ │  ← name + quick actions
└─────────────────────┘
     ● prompt    image ●  ← ports appear on hover/selection
```

**Interactions:**
- **Hover** → show ports, show name/type
- **Click** → select, show inspector
- **Double-click** → open full editor / expand
- **Drag edges** → resize thumbnail
- **⚙️** → toggle inspector panel
- **▼** → display mode menu

---

### Grid Mode (Generate with Batch Results)

```
┌───────────────────────────────────────────┐
│ ┌─────────┐ ┌─────────┐ ┌─────────┐      │
│ │   [1]   │ │   [2]   │ │  ★[3]   │      │  ← ★ = selected output
│ └─────────┘ └─────────┘ └─────────┘      │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐      │
│ │   [4]   │ │   [5]   │ │   [6]   │      │
│ └─────────┘ └─────────┘ └─────────┘      │
│                                           │
│ Generate "a majestic dragon"      🎲 ⚙️  │
└───────────────────────────────────────────┘
```

**Interactions:**
- **Click cell** → select as output (star appears)
- **Cmd+Click** → multi-select for comparison
- **Right-click cell** → context menu (Vary, Use as Reference, Promote to Node)
- **Drag cell out** → extract to Image annotation
- **1-9 keys** → quick select when node is selected

---

### Minimal Mode (Presentation)

```
┌─────────────────┐
│                 │
│   [just the     │
│    image]       │
│                 │
└─────────────────┘
```

No chrome, no ports, no name. Perfect for:
- Client presentations
- Storyboards
- Final selects
- Clean exports

---

### Curation: Status Indicators

Mark results for creative review:

```typescript
type ResultStatus = 'none' | 'starred' | 'approved' | 'rejected' | 'reference';
```

Visual representation:
```
┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
│ ★       │  │ ✓       │  │ ✗       │  │ 📌      │
│ [img]   │  │ [img]   │  │ [img]   │  │ [img]   │
│         │  │         │  │ (dimmed)│  │         │
└─────────┘  └─────────┘  └─────────┘  └─────────┘
  starred     approved     rejected    reference
```

**Keyboard shortcuts:**
| Key | Action |
|-----|--------|
| `S` | Toggle star on selected |
| `X` | Mark rejected (dims) |
| `H` | Hide/show rejected |
| `Cmd+G` | Group selected into artboard |

---

### Extract & Promote

Bridge between batch results and independent elements:

**Promote to Node** (Right-click cell → "Promote to Node")

Creates a new Generate node with:
- Same prompt
- Locked seed (exact seed that made this result)
- Result pre-loaded

Now you can vary IT specifically, use as reference for other nodes.

**Extract to Annotation** (Drag cell out of grid)

Creates Image annotation (static, no computation). Good for:
- Reference boards
- Final selects
- Breaking link to regeneration

---

### Exploration Workflows on Canvas

#### 1. Variation Tree

Click 🎲 Vary repeatedly to explore:

```
                    ┌─────────┐
               ┌───▶│ var A   │
┌─────────┐    │    └─────────┘
│ original│────┤    ┌─────────┐
│         │    ├───▶│ var B   │───┐   ┌─────────┐
└─────────┘    │    └─────────┘   ├──▶│ var B2  │
               │    ┌─────────┐   │   └─────────┘
               └───▶│ var C   │───┘
                    └─────────┘
```

**The exploration history is visible on the canvas.** Each branch is a creative direction you explored.

#### 2. Style Exploration Board

```
┌─ Style References (Image annotations) ──────────┐
│  [mood1.jpg]  [mood2.jpg]  [mood3.jpg]          │
└─────────────────────────────────────────────────┘
         │            │            │
         ▼            ▼            ▼
┌─ Results ───────────────────────────────────────┐
│ ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│ │ style 1 │  │ style 2 │  │ style 3 │          │
│ │ applied │  │ applied │  │ applied │          │
│ └─────────┘  └─────────┘  └─────────┘          │
│                                                 │
│ Same prompt + different style references        │
└─────────────────────────────────────────────────┘
```

#### 3. Storyboard Sequence

```
┌─ Act 1 ─────────────────────────────────────────┐
│                                                 │
│  ┌───────┐    ┌───────┐    ┌───────┐           │
│  │ [1]   │───▶│ [2]   │───▶│ [3]   │           │
│  │ intro │    │ rising│    │ peak  │           │
│  └───────┘    └───────┘    └───────┘           │
│                                                 │
└─────────────────────────────────────────────────┘
```

Visual connections show narrative flow. Each node carries its seed for reproducibility.

#### 4. Client Feedback Workflow

```
┌─ Round 1 (wide exploration) ────────────────────┐
│  [img] [img] [img] [img] [img] [img]            │
│  [img] [img] [img] [img] [img] [img]            │
└─────────────────────────────────────────────────┘
              │ select favorites (★)
              ▼
┌─ Round 2 (refining starred) ────────────────────┐
│  ★[img]  ★[img]  ★[img]                         │
│     │       │       │                           │
│     ▼       ▼       ▼                           │
│  [var1]  [var2]  [var3]                         │
└─────────────────────────────────────────────────┘
              │ client picks (✓)
              ▼
┌─ Final ─────────────────────────────────────────┐
│           ✓[approved.png]                       │
└─────────────────────────────────────────────────┘
```

---

### Implementation

#### ThumbnailNodeMixin

Applied to LensNode to enable visual display modes:

```typescript
// src/nodes/ThumbnailNodeMixin.ts

interface ThumbnailNodeState {
  displayMode: NodeDisplayMode;
  thumbnailSize: { width: number; height: number };
  resultStatuses: Map<string, ResultStatus>;  // resultId → status
}

const ThumbnailNodeMixin = <T extends Constructor<Node>>(Base: T) => {
  return class extends Base implements ThumbnailNodeState {
    displayMode: NodeDisplayMode = 'thumbnail';
    thumbnailSize = { width: 200, height: 200 };
    resultStatuses = new Map<string, ResultStatus>();
    
    // Determine render mode based on state
    get renderMode(): NodeDisplayMode {
      if (!this.hasImageOutput()) return 'box';
      if (this.displayMode === 'grid' && this.gridResults.length > 1) return 'grid';
      return this.displayMode;
    }
    
    hasImageOutput(): boolean {
      return this.outputs.some(o => o.type === 'image' && o.value != null);
    }
    
    // For grid mode: get all batch results
    get gridResults(): GenerationResult[] {
      if ('history' in this) {
        const batch = (this as any).history.currentBatch;
        return batch?.results ?? [];
      }
      return [];
    }
    
    get selectedGridIndex(): number {
      if ('history' in this) {
        return (this as any).history.selectedIndex ?? 0;
      }
      return 0;
    }
    
    // Status management
    setResultStatus(resultId: string, status: ResultStatus): void {
      this.resultStatuses.set(resultId, status);
      this.emit('statusChanged', { resultId, status });
    }
    
    getResultStatus(resultId: string): ResultStatus {
      return this.resultStatuses.get(resultId) ?? 'none';
    }
    
    // Promote a grid result to independent node
    promoteResult(resultIndex: number): Node {
      const result = this.gridResults[resultIndex];
      if (!result) throw new Error('Invalid result index');
      
      const graph = this.graph;
      const pos = this.position;
      
      // Create new Generate node
      const newNode = graph.createNode('lens/Generate', {
        position: { x: pos.x + 300, y: pos.y },
      });
      
      // Copy settings with locked seed
      if ('props' in this) {
        const props = (this as any).props;
        newNode.props.prompt.value = props.prompt?.value ?? '';
        newNode.props.seed.value = result.seed;  // Lock exact seed
        newNode.props.model.value = props.model?.value;
        newNode.props.width.value = props.width?.value;
        newNode.props.height.value = props.height?.value;
      }
      
      // Pre-load the result
      newNode.preloadResult(result);
      
      return newNode;
    }
    
    // Extract result to image annotation
    extractToAnnotation(resultIndex: number): ImageAnnotation {
      const result = this.gridResults[resultIndex];
      if (!result) throw new Error('Invalid result index');
      
      const graph = this.graph;
      const pos = this.position;
      
      return graph.createAnnotation('Image', {
        position: { x: pos.x + 300, y: pos.y },
        image: result.imageBuffer,
        label: `Extracted from ${this.name}`,
      });
    }
    
    // Serialization
    override serialize(): object {
      return {
        ...super.serialize(),
        displayMode: this.displayMode,
        thumbnailSize: this.thumbnailSize,
        resultStatuses: Object.fromEntries(this.resultStatuses),
      };
    }
    
    override deserialize(data: any): void {
      super.deserialize(data);
      if (data.displayMode) this.displayMode = data.displayMode;
      if (data.thumbnailSize) this.thumbnailSize = data.thumbnailSize;
      if (data.resultStatuses) {
        this.resultStatuses = new Map(Object.entries(data.resultStatuses));
      }
    }
  };
};
```

#### Canvas Node Renderer

```svelte
<!-- src/editor/canvas/NodeRenderer.svelte -->
<script lang="ts">
  import type { Node } from '$lib/nodes/Node';
  import BoxNode from './BoxNode.svelte';
  import ThumbnailNode from './ThumbnailNode.svelte';
  import GridNode from './GridNode.svelte';
  import MinimalNode from './MinimalNode.svelte';
  
  export let node: Node;
  
  $: renderMode = node.renderMode ?? 'box';
</script>

{#if renderMode === 'thumbnail'}
  <ThumbnailNode {node} />
{:else if renderMode === 'grid'}
  <GridNode {node} />
{:else if renderMode === 'minimal'}
  <MinimalNode {node} />
{:else}
  <BoxNode {node} />
{/if}
```

#### ThumbnailNode Component

```svelte
<!-- src/editor/canvas/ThumbnailNode.svelte -->
<script lang="ts">
  import type { Node } from '$lib/nodes/Node';
  import { Ports } from './Ports.svelte';
  import { imageBufferToDataUrl } from '$lib/utils/imageUtils';
  
  export let node: Node;
  
  let showPorts = false;
  let imageUrl: string | null = null;
  
  // Update image when output changes
  $: {
    const output = node.outputs.find(o => o.type === 'image');
    if (output?.value) {
      imageUrl = imageBufferToDataUrl(output.value);
    } else {
      imageUrl = null;
    }
  }
  
  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    // Show context menu with display mode options
  }
</script>

<div 
  class="thumbnail-node"
  class:selected={node.selected}
  class:generating={node.isGenerating}
  style:width="{node.thumbnailSize.width}px"
  on:mouseenter={() => showPorts = true}
  on:mouseleave={() => showPorts = false}
  on:contextmenu={handleContextMenu}
>
  <!-- Image container -->
  <div class="image-container" style:aspect-ratio="1">
    {#if imageUrl}
      <img src={imageUrl} alt={node.displayName} draggable="false" />
    {:else}
      <div class="placeholder">
        <span class="placeholder-icon">🖼️</span>
        <span class="placeholder-text">No output</span>
      </div>
    {/if}
    
    {#if node.isGenerating}
      <div class="generating-overlay">
        <div class="spinner" />
        <span class="progress">{node.progress ?? 0}%</span>
      </div>
    {/if}
    
    {#if node.error}
      <div class="error-overlay">
        <span class="error-icon">⚠️</span>
      </div>
    {/if}
  </div>
  
  <!-- Footer with name and actions -->
  <div class="footer">
    <span class="name" title={node.type}>{node.displayName}</span>
    <div class="actions">
      {#if 'generate' in node}
        <button class="action-btn" on:click={() => node.generate()} title="Generate">
          🎲
        </button>
      {/if}
      {#if 'createVariation' in node}
        <button class="action-btn" on:click={() => node.createVariation()} title="Create Variation">
          🎲+
        </button>
      {/if}
      <button class="action-btn" on:click={() => dispatch('openInspector', node)} title="Settings">
        ⚙️
      </button>
    </div>
  </div>
  
  <!-- Ports (shown on hover/selection) -->
  {#if showPorts || node.selected}
    <Ports {node} position="outside" />
  {/if}
  
  <!-- Resize handle -->
  <div class="resize-handle" on:mousedown={startResize} />
</div>

<style>
  .thumbnail-node {
    position: absolute;
    background: var(--node-bg);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    transition: box-shadow 0.15s;
  }
  
  .thumbnail-node:hover {
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
  }
  
  .thumbnail-node.selected {
    outline: 2px solid var(--accent-color);
  }
  
  .image-container {
    position: relative;
    background: var(--canvas-bg);
    overflow: hidden;
  }
  
  .image-container img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted);
  }
  
  .generating-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: white;
  }
  
  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 8px;
    background: var(--node-header-bg);
  }
  
  .name {
    font-size: 11px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .actions {
    display: flex;
    gap: 2px;
  }
  
  .action-btn {
    padding: 2px 4px;
    background: transparent;
    border: none;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.1s;
  }
  
  .action-btn:hover {
    opacity: 1;
  }
  
  .resize-handle {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 16px;
    height: 16px;
    cursor: nwse-resize;
  }
</style>
```

#### GridNode Component

```svelte
<!-- src/editor/canvas/GridNode.svelte -->
<script lang="ts">
  import type { Node } from '$lib/nodes/Node';
  import { createEventDispatcher } from 'svelte';
  
  export let node: Node;
  
  const dispatch = createEventDispatcher();
  
  $: results = node.gridResults ?? [];
  $: selectedIndex = node.selectedGridIndex ?? 0;
  $: cols = results.length <= 4 ? 2 : 3;
  
  function selectResult(index: number) {
    node.selectResult?.(index);
  }
  
  function handleCellContextMenu(e: MouseEvent, index: number) {
    e.preventDefault();
    dispatch('cellContextMenu', { node, index, x: e.clientX, y: e.clientY });
  }
  
  function handleCellDragStart(e: DragEvent, index: number) {
    e.dataTransfer?.setData('application/cascade-result', JSON.stringify({
      nodeId: node.id,
      resultIndex: index,
    }));
  }
</script>

<div 
  class="grid-node"
  class:selected={node.selected}
  style:width="{node.thumbnailSize.width * 1.5}px"
>
  <div class="grid" style:grid-template-columns="repeat({cols}, 1fr)">
    {#each results as result, index}
      <button
        class="cell"
        class:selected={selectedIndex === index}
        class:starred={node.getResultStatus?.(result.id) === 'starred'}
        class:rejected={node.getResultStatus?.(result.id) === 'rejected'}
        on:click={() => selectResult(index)}
        on:contextmenu={(e) => handleCellContextMenu(e, index)}
        draggable="true"
        on:dragstart={(e) => handleCellDragStart(e, index)}
      >
        <img src={result.thumbnailUrl} alt="Result {index + 1}" />
        
        <!-- Status badge -->
        {#if node.getResultStatus?.(result.id) === 'starred'}
          <span class="status-badge">★</span>
        {:else if node.getResultStatus?.(result.id) === 'approved'}
          <span class="status-badge approved">✓</span>
        {:else if node.getResultStatus?.(result.id) === 'rejected'}
          <span class="status-badge rejected">✗</span>
        {/if}
        
        <!-- Selection indicator -->
        {#if selectedIndex === index}
          <span class="selected-indicator">●</span>
        {/if}
        
        <!-- Keyboard hint -->
        <span class="key-hint">{index + 1}</span>
      </button>
    {/each}
  </div>
  
  <div class="footer">
    <span class="prompt" title={node.props?.prompt?.value}>
      {node.props?.prompt?.value?.slice(0, 30) ?? 'Generate'}...
    </span>
    <div class="actions">
      <button on:click={() => node.generate?.()}>🎲</button>
      <button on:click={() => node.createVariation?.()}>🎲+</button>
      <button on:click={() => dispatch('openInspector', node)}>⚙️</button>
    </div>
  </div>
</div>

<style>
  .grid-node {
    position: absolute;
    background: var(--node-bg);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  }
  
  .grid {
    display: grid;
    gap: 2px;
    padding: 4px;
    background: var(--canvas-bg);
  }
  
  .cell {
    position: relative;
    aspect-ratio: 1;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 4px;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.1s, opacity 0.1s;
  }
  
  .cell img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  .cell.selected {
    border-color: var(--accent-color);
  }
  
  .cell.starred {
    border-color: gold;
  }
  
  .cell.rejected {
    opacity: 0.4;
  }
  
  .status-badge {
    position: absolute;
    top: 4px;
    left: 4px;
    font-size: 14px;
  }
  
  .selected-indicator {
    position: absolute;
    bottom: 4px;
    right: 4px;
    color: var(--accent-color);
    font-size: 10px;
  }
  
  .key-hint {
    position: absolute;
    bottom: 4px;
    left: 4px;
    font-size: 10px;
    color: white;
    text-shadow: 0 1px 2px rgba(0,0,0,0.8);
    opacity: 0;
    transition: opacity 0.1s;
  }
  
  .grid-node:hover .key-hint {
    opacity: 0.7;
  }
</style>
```

---

### Grid Cell Context Menu

```typescript
// Right-click menu for grid cells
const gridCellContextMenu = [
  { label: '★ Star', action: 'star', key: 'S' },
  { label: '✓ Approve', action: 'approve' },
  { label: '✗ Reject', action: 'reject', key: 'X' },
  { type: 'separator' },
  { label: '🎲 Vary This', action: 'vary' },
  { label: '📌 Use as Reference', action: 'useAsReference' },
  { type: 'separator' },
  { label: 'Promote to Node', action: 'promote' },
  { label: 'Extract to Annotation', action: 'extract' },
  { type: 'separator' },
  { label: 'Copy Seed', action: 'copySeed' },
  { label: 'Save Image...', action: 'save' },
];
```

---

### Display Mode Toggle

Users can switch display modes via:
1. **Context menu** on node → "Display Mode" submenu
2. **▼ dropdown** in node footer
3. **Keyboard**: `T` to cycle through modes when node selected

```typescript
// Display mode cycling
function cycleDisplayMode(node: Node): void {
  const modes: NodeDisplayMode[] = ['thumbnail', 'grid', 'minimal', 'box'];
  const current = modes.indexOf(node.displayMode);
  node.displayMode = modes[(current + 1) % modes.length];
}
```

---

### Summary: Canvas as Creative Space

| Before | After |
|--------|-------|
| Canvas shows plumbing | Canvas shows results |
| Viewer shows one output | Every node shows its output |
| Exploration in inspector | Exploration on canvas |
| Linear workflow | Spatial thinking |
| Hide the process | See the process |

**The canvas becomes your mood board, exploration history, presentation deck, and node graph—all at once.**

---

## Artboards & Organization

As exploration grows, the canvas needs organization. Artboards group related elements visually and functionally.

### Artboard Basics

```
┌─ Round 1: Wide Exploration ─────────────────────────────────┐
│                                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │  [img]  │  │  [img]  │  │  [img]  │  │  [img]  │       │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘       │
│                                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │  [img]  │  │  [img]  │  │ ★[img]  │  │  [img]  │       │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Artboards are:**
- Named containers with visible boundaries
- Collapsible (show just title bar when collapsed)
- Color-coded for quick identification
- Optionally auto-arranged (grid layout for children)

### Creating Artboards

| Method | Action |
|--------|--------|
| `Cmd+G` | Group selected elements into new artboard |
| Context menu | "Create Artboard" |
| Draw | Hold `A` and drag to draw artboard |
| Auto | "Collect All Starred" creates artboard from starred results |

### Artboard Types

```typescript
interface Artboard extends Annotation {
  type: 'artboard';
  name: string;
  color: string;             // Border/header color
  collapsed: boolean;        // Show only title bar
  autoLayout: boolean;       // Auto-arrange children
  layoutMode: 'grid' | 'row' | 'column' | 'free';
  layoutGap: number;
  showConnections: boolean;  // Show wires to/from children when collapsed
}
```

### Auto-Layout Modes

**Grid** (default for exploration):
```
┌─ Exploration Grid ──────────────────┐
│  [img]  [img]  [img]  [img]         │
│  [img]  [img]  [img]  [img]         │
│  [img]  [img]  [img]  [img]         │
└─────────────────────────────────────┘
```

**Row** (for sequences/storyboards):
```
┌─ Storyboard ────────────────────────────────────────────────┐
│  [img] ──▶ [img] ──▶ [img] ──▶ [img] ──▶ [img]             │
└─────────────────────────────────────────────────────────────┘
```

**Column** (for variations):
```
┌─ Variations ───┐
│    [original]  │
│        │       │
│        ▼       │
│    [var 1]     │
│        │       │
│        ▼       │
│    [var 2]     │
└────────────────┘
```

**Free** (manual positioning):
```
┌─ Mood Board ────────────────────────┐
│     [ref]          [ref]            │
│            [ref]                    │
│   [ref]                [ref]        │
│                 [ref]               │
└─────────────────────────────────────┘
```

### Collapsed Artboards

When collapsed, artboard shows summary:

```
┌─ Round 1: Wide Exploration ─ 12 items │ 3★ │ ▶ ─┐
└────────────────────────────────────────────────┘
```

- Item count
- Starred count
- Expand button
- Connections still visible (as bundled wire)

### Smart Collections

Auto-generated artboards based on criteria:

```typescript
// Create artboard from all starred results in graph
function collectStarred(graph: Graph): Artboard {
  const starred = graph.getAllNodes()
    .flatMap(n => n.gridResults?.filter(r => n.getResultStatus(r.id) === 'starred') ?? []);
  
  return graph.createArtboard({
    name: `Starred (${starred.length})`,
    children: starred.map(r => r.extractToAnnotation()),
    autoLayout: true,
    layoutMode: 'grid',
  });
}

// Similar for: collectApproved(), collectByPrompt(), collectByDate()
```

### Workflow: Client Review Rounds

```
┌─ Brief ─────────────────────────────────────────────────────┐
│  [reference1.jpg]  [reference2.jpg]  [notes.txt]           │
│  Client wants: "Epic fantasy landscape, cinematic"          │
└─────────────────────────────────────────────────────────────┘
              │
              ▼
┌─ Round 1: Wide Exploration ─────────────────────────────────┐
│  Generate ──▶ [grid of 9]                                   │
│  Generate ──▶ [grid of 9]                                   │
│  Generate ──▶ [grid of 9]                                   │
│                                                             │
│  27 results, exploring different directions                 │
└─────────────────────────────────────────────────────────────┘
              │ Star favorites (★)
              ▼
┌─ Round 1 Selects ─ auto-collected ──────────────────────────┐
│  ★[img]  ★[img]  ★[img]  ★[img]  ★[img]                    │
│                                                             │
│  5 directions worth exploring                               │
└─────────────────────────────────────────────────────────────┘
              │ Vary each (🎲 Vary button)
              ▼
┌─ Round 2: Refinement ───────────────────────────────────────┐
│  ★[A] ──▶ [A1] [A2] [A3]                                   │
│  ★[B] ──▶ [B1] [B2] [B3]                                   │
│  ★[C] ──▶ [C1] [C2] [C3]                                   │
│                                                             │
│  15 variations on 5 directions                              │
└─────────────────────────────────────────────────────────────┘
              │ Client reviews, approves (✓)
              ▼
┌─ Approved ──────────────────────────────────────────────────┐
│  ✓[B2]  ✓[C1]                                              │
│                                                             │
│  Final selects for production                               │
└─────────────────────────────────────────────────────────────┘
```

### Artboard Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Cmd+G` | Group selected into artboard |
| `Cmd+Shift+G` | Ungroup (dissolve artboard, keep children) |
| `Enter` | Enter artboard (zoom to fit, isolate) |
| `Escape` | Exit artboard (return to parent view) |
| `C` | Collapse/expand selected artboard |
| `Cmd+Shift+S` | Collect all starred into new artboard |

### Implementation

```typescript
// src/nodes/annotations/Artboard.ts

class Artboard extends Annotation {
  static type = 'annotation/Artboard';
  
  name: string = 'Untitled';
  color: string = '#4a9eff';
  collapsed: boolean = false;
  autoLayout: boolean = true;
  layoutMode: 'grid' | 'row' | 'column' | 'free' = 'grid';
  layoutGap: number = 16;
  showConnections: boolean = true;
  
  // Child elements (nodes, annotations, other artboards)
  children: string[] = [];  // Element IDs
  
  // Auto-layout children
  performLayout(): void {
    if (!this.autoLayout || this.layoutMode === 'free') return;
    
    const childElements = this.children
      .map(id => this.graph.getElement(id))
      .filter(Boolean);
    
    switch (this.layoutMode) {
      case 'grid':
        this.layoutGrid(childElements);
        break;
      case 'row':
        this.layoutRow(childElements);
        break;
      case 'column':
        this.layoutColumn(childElements);
        break;
    }
  }
  
  private layoutGrid(elements: Element[]): void {
    const cols = Math.ceil(Math.sqrt(elements.length));
    const cellSize = this.estimateCellSize(elements);
    
    elements.forEach((el, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      el.position = {
        x: this.position.x + 20 + col * (cellSize + this.layoutGap),
        y: this.position.y + 50 + row * (cellSize + this.layoutGap),
      };
    });
    
    // Resize artboard to fit
    this.fitToChildren();
  }
  
  // Get summary for collapsed state
  getSummary(): { total: number; starred: number; approved: number } {
    const childElements = this.children
      .map(id => this.graph.getElement(id))
      .filter(Boolean);
    
    let starred = 0, approved = 0;
    
    for (const el of childElements) {
      if ('resultStatuses' in el) {
        for (const status of (el as any).resultStatuses.values()) {
          if (status === 'starred') starred++;
          if (status === 'approved') approved++;
        }
      }
    }
    
    return { total: childElements.length, starred, approved };
  }
  
  // Add element to artboard
  addChild(elementId: string): void {
    if (!this.children.includes(elementId)) {
      this.children.push(elementId);
      if (this.autoLayout) this.performLayout();
    }
  }
  
  // Remove element from artboard
  removeChild(elementId: string): void {
    this.children = this.children.filter(id => id !== elementId);
    if (this.autoLayout) this.performLayout();
  }
  
  // Dissolve artboard (ungroup)
  dissolve(): Element[] {
    const elements = this.children
      .map(id => this.graph.getElement(id))
      .filter(Boolean);
    
    // Clear parent reference on children
    elements.forEach(el => {
      if ('parentArtboard' in el) {
        (el as any).parentArtboard = null;
      }
    });
    
    // Remove artboard
    this.graph.removeElement(this.id);
    
    return elements;
  }
}
```

### Artboard Component

```svelte
<!-- src/editor/canvas/Artboard.svelte -->
<script lang="ts">
  import type { Artboard } from '$lib/nodes/annotations/Artboard';
  
  export let artboard: Artboard;
  export let selected: boolean = false;
  
  $: summary = artboard.getSummary();
</script>

{#if artboard.collapsed}
  <!-- Collapsed view -->
  <div 
    class="artboard-collapsed"
    class:selected
    style:border-color={artboard.color}
  >
    <span class="name">{artboard.name}</span>
    <span class="stats">
      {summary.total} items
      {#if summary.starred > 0}
        │ {summary.starred}★
      {/if}
      {#if summary.approved > 0}
        │ {summary.approved}✓
      {/if}
    </span>
    <button class="expand-btn" on:click={() => artboard.collapsed = false}>
      ▶
    </button>
  </div>
{:else}
  <!-- Expanded view -->
  <div 
    class="artboard"
    class:selected
    style:left="{artboard.position.x}px"
    style:top="{artboard.position.y}px"
    style:width="{artboard.size.width}px"
    style:height="{artboard.size.height}px"
    style:border-color={artboard.color}
  >
    <div class="header" style:background={artboard.color}>
      <span class="name">{artboard.name}</span>
      <div class="controls">
        <button on:click={() => artboard.collapsed = true}>─</button>
        <button on:click={() => dispatch('enterArtboard', artboard)}>⤢</button>
      </div>
    </div>
    
    <div class="content">
      <!-- Children rendered by parent canvas -->
      <slot />
    </div>
    
    <!-- Resize handles -->
    <div class="resize-handle resize-se" />
  </div>
{/if}

<style>
  .artboard {
    position: absolute;
    background: rgba(255,255,255,0.02);
    border: 2px dashed;
    border-radius: 8px;
    min-width: 200px;
    min-height: 100px;
  }
  
  .artboard.selected {
    border-style: solid;
  }
  
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border-radius: 6px 6px 0 0;
    color: white;
    font-weight: 500;
    font-size: 13px;
  }
  
  .artboard-collapsed {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    background: var(--node-bg);
    border: 2px solid;
    border-radius: 6px;
    font-size: 13px;
  }
  
  .stats {
    color: var(--text-muted);
    font-size: 12px;
  }
</style>
```

---

## Runtime Environment

Cascade runs as a browser Studio backed by the local Cascade server, or headlessly
through its Node.js runtime and CLI. The server owns filesystem access; browser
modules use the narrow project APIs. The cache system (`$project/cache/generate/`)
is shared by interactive and headless workflows.

---

## Canvas Element Connections

Any canvas element (annotations, images, etc.) can connect to node inputs when types match. This enables visual workflows where reference materials on the canvas feed directly into processing nodes.

### Element Output Types

| Element Type | Output Type | Example Use |
|--------------|-------------|-------------|
| Text Annotation | `string` | Prompt → Generate |
| Image Annotation | `ImageBuffer` | Reference → Generate |
| Group Annotation | — | No output (organizational only) |

### Implementation

Elements that can be connection sources implement `ConnectableElement`:

```typescript
interface ConnectableElement {
  // What this element outputs
  readonly outputType: string | null;
  readonly outputValue: any;
  
  // Visual connection point (relative to element bounds)
  readonly connectionAnchor: { x: number; y: number };
}

// In TextAnnotation
class TextAnnotation extends Annotation implements ConnectableElement {
  get outputType(): string { return 'string'; }
  get outputValue(): string { return this.content; }
  get connectionAnchor() { return { x: 1, y: 0.5 }; } // Right edge, centered
}

// In ImageAnnotation
class ImageAnnotation extends Annotation implements ConnectableElement {
  get outputType(): string { return 'image'; }
  get outputValue(): ImageBuffer | null { return this.imageBuffer; }
  get connectionAnchor() { return { x: 1, y: 0.5 }; }
}
```

### Connection System Updates

```typescript
// In Graph.ts - unified connection handling
interface Connection {
  sourceId: string;       // Node ID or Element ID
  sourcePort?: string;    // Port name (undefined for elements)
  targetId: string;       // Node ID
  targetPort: string;     // Port name
}

// Resolve input value from any source
getInputValue(nodeId: string, portName: string): any {
  const connection = this.getConnectionToPort(nodeId, portName);
  if (!connection) return null;
  
  const source = this.getElement(connection.sourceId);
  
  if (source && 'outputValue' in source) {
    // Element connection (annotation, etc.)
    return (source as ConnectableElement).outputValue;
  } else if (source instanceof Node && connection.sourcePort) {
    // Node connection
    return source.getOutput(connection.sourcePort).value;
  }
  
  return null;
}

// Type compatibility check
canConnect(sourceId: string, sourcePort: string | undefined, targetId: string, targetPort: string): boolean {
  const source = this.getElement(sourceId);
  const target = this.getElement(targetId);
  
  if (!(target instanceof Node)) return false;
  
  const targetInput = target.getInput(targetPort);
  if (!targetInput) return false;
  
  let sourceType: string;
  if (source && 'outputType' in source && !sourcePort) {
    sourceType = (source as ConnectableElement).outputType;
  } else if (source instanceof Node && sourcePort) {
    sourceType = source.getOutput(sourcePort).type;
  } else {
    return false;
  }
  
  return targetInput.acceptsType(sourceType);
}
```

### UI Behavior

- Elements show connection handle on hover (right edge by default)
- Handle styled consistently with node output ports
- Dragging creates noodle that snaps to compatible inputs
- Connection line drawn from element anchor to node port
- When element content changes, connected nodes re-cook
- Incompatible connections show visual feedback (red highlight, snap rejection)

---

## Variation Workflow

Creating variations is a **connection pattern**, not a separate node. This is more flexible than a dedicated Vary node because you can customize any parameter.

### Basic Variation Pattern

```
┌────────────┐     ┌─────────────────────┐
│ Generate A │────▶│ Generate B          │
│            │     │                     │
│       seed─┼────▶│ seed input          │
│      image─┼────▶│ style reference     │
│     prompt─┼────▶│ prompt input        │
│            │     │ seedOffset: 10      │
└────────────┘     └─────────────────────┘
```

### How It Works

1. **Connect seed** - Generate B receives Generate A's seed
2. **Connect image as reference** - Original image influences the new one
3. **Set seed offset** - Small offset (10-100) creates related but different results
4. **Generate** - New image is a variation of the original

### Variation Intensity via Seed Offset

| Offset | Effect |
|--------|--------|
| ±1-10 | Subtle variations (tiny details change) |
| ±10-100 | Medium variations (composition similar, details differ) |
| ±100-1000 | Strong variations (same subject, different interpretation) |

### Variation Intensity via Reference Strength

| Strength | Effect |
|----------|--------|
| 0.8-1.0 | Very close to original |
| 0.5-0.7 | Balanced - similar feel, new details |
| 0.2-0.4 | Loose inspiration |
| 0.0 | No reference influence (just seed relationship) |

### Why Pattern > Node

A dedicated Vary node would have preset modes (subtle/medium/strong). The pattern approach lets you:
- Combine seed offset AND reference strength freely
- Change the model between original and variation
- Modify the prompt slightly
- Chain multiple variations with different settings

---

## Parallel Generation Manager

Multiple AI nodes can generate simultaneously. A central manager coordinates active generations for UI feedback and optional rate limiting.

```typescript
// src/services/ai/GenerationManager.ts

interface ActiveGeneration {
  nodeId: string;
  nodeName: string;
  batchId: string;
  status: 'queued' | 'generating';
  progress: number;
  startTime: Date;
  abortController: AbortController;
}

class GenerationManager {
  private static instance: GenerationManager;
  private activeGenerations = new Map<string, ActiveGeneration>();
  private listeners = new Set<(generations: ActiveGeneration[]) => void>();
  
  static getInstance(): GenerationManager {
    if (!this.instance) {
      this.instance = new GenerationManager();
    }
    return this.instance;
  }
  
  // Register a new generation
  register(nodeId: string, nodeName: string, batchId: string): AbortController {
    const abortController = new AbortController();
    
    this.activeGenerations.set(batchId, {
      nodeId,
      nodeName,
      batchId,
      status: 'generating',
      progress: 0,
      startTime: new Date(),
      abortController,
    });
    
    this.notifyListeners();
    return abortController;
  }
  
  // Update progress
  updateProgress(batchId: string, progress: number): void {
    const gen = this.activeGenerations.get(batchId);
    if (gen) {
      gen.progress = progress;
      this.notifyListeners();
    }
  }
  
  // Complete or cancel generation
  complete(batchId: string): void {
    this.activeGenerations.delete(batchId);
    this.notifyListeners();
  }
  
  // Cancel a specific generation
  cancel(batchId: string): void {
    const gen = this.activeGenerations.get(batchId);
    if (gen) {
      gen.abortController.abort();
      this.complete(batchId);
    }
  }
  
  // Cancel all active generations
  cancelAll(): void {
    for (const gen of this.activeGenerations.values()) {
      gen.abortController.abort();
    }
    this.activeGenerations.clear();
    this.notifyListeners();
  }
  
  // Subscribe to updates
  subscribe(callback: (generations: ActiveGeneration[]) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  
  private notifyListeners(): void {
    const generations = Array.from(this.activeGenerations.values());
    for (const listener of this.listeners) {
      listener(generations);
    }
  }
  
  // Get active count for UI
  get activeCount(): number {
    return this.activeGenerations.size;
  }
  
  get isGenerating(): boolean {
    return this.activeGenerations.size > 0;
  }
}
```

### Status Bar Integration

Show active generations in the editor status bar:

```svelte
<!-- GenerationStatus.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { GenerationManager, type ActiveGeneration } from '$lib/services/ai/GenerationManager';
  
  let generations: ActiveGeneration[] = [];
  let unsubscribe: () => void;
  
  onMount(() => {
    const manager = GenerationManager.getInstance();
    unsubscribe = manager.subscribe(g => generations = g);
  });
  
  onDestroy(() => unsubscribe?.());
</script>

{#if generations.length > 0}
  <div class="generation-status">
    <span class="spinner"></span>
    <span class="count">{generations.length} generating</span>
    
    <div class="dropdown">
      {#each generations as gen}
        <div class="generation-item">
          <span class="name">{gen.nodeName}</span>
          <div class="progress-bar">
            <div class="fill" style="width: {gen.progress}%"></div>
          </div>
          <button class="cancel" on:click={() => GenerationManager.getInstance().cancel(gen.batchId)}>
            ✕
          </button>
        </div>
      {/each}
      
      {#if generations.length > 1}
        <button class="cancel-all" on:click={() => GenerationManager.getInstance().cancelAll()}>
          Cancel All
        </button>
      {/if}
    </div>
  </div>
{/if}
```

### Node Integration

```typescript
// In AINodeMixin - updated generate flow
async generate(): Promise<void> {
  if (this.isGenerating) return;
  
  this.isGenerating = true;
  const batch = this.createBatch();
  
  // Register with manager (provides abort controller)
  const manager = GenerationManager.getInstance();
  this.abortController = manager.register(this.id, this.name, batch.id);
  
  try {
    await this.doGenerate(batch, {
      signal: this.abortController.signal,
      onProgress: (progress) => {
        batch.progress = progress;
        manager.updateProgress(batch.id, progress);
        this.markDirty();
      }
    });
    
    batch.status = 'complete';
    batch.selectedIndex = 0;
    await this.cacheResults(batch);
    this.requestCook();
    
  } catch (error) {
    this.handleGenerationError(error, batch);
  } finally {
    manager.complete(batch.id);
    this.isGenerating = false;
    this.abortController = null;
    this.markDirty();
  }
}
```

---

### Directory Structure

```
src/
├── nodes/
│   ├── core/                          # Fundamentals
│   │   ├── Random.ts                  # Random seed OR choice with lock
│   │   ├── Select.ts                  # Pick from array by index
│   │   ├── Freeze.ts                  # Lock value
│   │   ├── Merge.ts
│   │   └── Subnet.ts
│   ├── lens/                          # Image operators (output images)
│   │   ├── LensNode.ts                # Base class
│   │   ├── Blur.ts
│   │   ├── Composite.ts
│   │   ├── Generate.ts                # AI text-to-image
│   │   └── Edit.ts                    # AI image editing
│   └── quill/                         # Text operators (output text)
│       ├── QuillNode.ts               # Base class
│       ├── Text.ts                    # Constant OR template with {placeholders}
│       ├── Describe.ts                # AI image-to-text
│       └── Enhance.ts                 # AI prompt enhancement
├── services/
│   └── ai/                            # AI provider infrastructure
│       ├── GenerationManager.ts       # Parallel generation + global history
│       ├── ProviderRegistry.ts        # Model & provider registry
│       ├── GenerationCache.ts         # Local cache management
│       ├── providers/
│       │   ├── Provider.ts            # Abstract provider interface
│       │   ├── ReplicateProvider.ts
│       │   ├── FalProvider.ts
│       │   ├── GoogleProvider.ts
│       │   └── OpenAIProvider.ts
│       └── models/
│           ├── ModelSchema.ts         # Model definition types
│           └── modelDefinitions.ts    # All supported models
└── editor/
    └── components/
        └── ai/
            ├── GenerationGrid.svelte       # Multi-result grid selector
            ├── GenerationStatus.svelte     # Status bar indicator
            ├── GenerationHistoryPanel.svelte # Global history panel
            ├── ReferenceImageList.svelte
            └── ModelSelector.svelte
```

**8 AI/utility nodes total:**

| Package | Nodes | Purpose |
|---------|-------|---------|
| `lens` | Generate, Edit | AI image generation and editing |
| `quill` | Text, Describe, Enhance | Text manipulation and AI text generation |
| `core` | Random, Select, Freeze | Utilities for exploration workflows |

---

## Core Types

### Generation System

```typescript
// Generation result from a single API call
interface GenerationResult {
  id: string;                          // Unique ID (uuid)
  seed: number;
  imageBuffer: ImageBuffer;
  thumbnailUrl: string;                // For grid display
  prompt: string;
  negativePrompt?: string;
  parameters: Record<string, any>;     // Model-specific params
  model: string;                       // Model ID used
  timestamp: Date;
}

// A batch of results from one generation request
interface GenerationBatch {
  id: string;
  results: GenerationResult[];
  selectedIndex: number | null;        // Which result is "active"
  status: 'pending' | 'generating' | 'complete' | 'error';
  progress?: number;                   // 0-100
  error?: string;
}

// Full generation history for a node
interface GenerationHistory {
  batches: GenerationBatch[];
  currentBatchId: string | null;
}

// Request for image generation
interface GenerationRequest {
  prompt: string;
  negativePrompt?: string;
  model: string;
  batchSize: number;
  seed: number;
  width: number;
  height: number;
  references?: ReferenceImage[];
  parameters: Record<string, any>;
}

// Request for image editing
interface EditRequest {
  image: ImageBuffer;
  instruction: string;
  mask?: ImageBuffer;
  mode: 'inpaint' | 'instruct' | 'outpaint';
  model: string;
  batchSize: number;
  seed: number;
  strength: number;
  // Outpaint-specific
  expandDirection?: 'all' | 'left' | 'right' | 'up' | 'down' | 'horizontal' | 'vertical';
  expandAmount?: number;
  parameters?: Record<string, any>;
}
```

### Reference Images

```typescript
type ReferenceImageType = 
  | 'style'        // Style/aesthetic reference
  | 'composition'  // Layout/structure reference  
  | 'character'    // Character/subject reference
  | 'mask'         // Inpainting mask
  | 'depth'        // Depth map
  | 'canny'        // Edge detection
  | 'general';     // Untyped reference

interface ReferenceImage {
  id: string;
  image: ImageBuffer;                   // Normalized at input boundary
  type: ReferenceImageType;
  strength: number;                     // 0-1, influence weight
  label?: string;                       // User-defined label
}

// When accepting reference images from various sources, normalize immediately:
function normalizeReferenceImage(input: ImageBuffer | HTMLCanvasElement | string): ImageBuffer {
  if (input instanceof ImageBuffer) {
    return input;
  }
  if (input instanceof HTMLCanvasElement) {
    return ImageBuffer.fromCanvas(input);
  }
  if (typeof input === 'string') {
    // URL or data URL - load asynchronously
    throw new Error('Use loadReferenceImage() for URLs');
  }
  throw new Error('Invalid reference image input');
}

async function loadReferenceImage(url: string): Promise<ImageBuffer> {
  const img = await loadImage(url);
  return ImageBuffer.fromImage(img);
}
```

### Model Definitions

```typescript
type ProviderType = 'replicate' | 'fal' | 'google' | 'openai';

interface ModelParameter {
  name: string;
  type: 'number' | 'string' | 'boolean' | 'select';
  default: any;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  description?: string;
  advanced?: boolean;                  // Hide in simple mode
}

interface ModelSchema {
  id: string;                          // e.g., 'flux-fast'
  name: string;                        // e.g., 'Flux Fast'
  provider: ProviderType;
  endpoint: string;                    // API endpoint or model ID
  
  // Capabilities
  supportsImageInput: boolean;
  supportedReferenceTypes: ReferenceImageType[];
  supportsNegativePrompt: boolean;
  supportsBatchGeneration: boolean;
  maxBatchSize: number;
  
  // Parameters
  parameters: ModelParameter[];
  
  // Output
  defaultWidth: number;
  defaultHeight: number;
  maxResolution: number;
  outputFormat: 'png' | 'jpg' | 'webp';
  
  // UI
  icon?: string;
  category: 'fast' | 'quality' | 'specialized';
}
```

---

## Node Specifications

### QuillNode (Base Class)

**Purpose:** Abstract base class for all text-producing nodes.

**Location:** `src/nodes/quill/QuillNode.ts`

```typescript
abstract class QuillNode extends Node {
  // Text nodes output strings
  protected outputType = 'string';
  
  // Preview shows truncated output text
  get preview(): string | null {
    const output = this.outputs[0]?.value;
    if (typeof output === 'string') {
      return output.length > 100 ? output.slice(0, 100) + '...' : output;
    }
    return null;
  }
}
```

---

### 1. AINode (Base Mixin)

**Purpose:** Shared functionality for all AI-powered nodes (both lens and quill).

**Location:** `src/nodes/AINode.ts`

```typescript
// Mixin for AI-powered nodes - works with both LensNode and QuillNode
interface AINodeState {
  history: GenerationHistory;
  isGenerating: boolean;
  abortController: AbortController | null;
}

const AINodeMixin = <T extends Constructor<Node>>(Base: T) => {
  return class extends Base implements AINodeState {
    history: GenerationHistory = { batches: [], currentBatchId: null };
    isGenerating = false;
    abortController: AbortController | null = null;
    private cacheLoaded = false;
    
    // Cache directory for this node's outputs
    // Located in project directory: $project/cache/generate/<nodeId>/
    protected get cacheDir(): string {
      const projectDir = this.graph.projectDirectory;
      return `${projectDir}/cache/generate/${this.id}`;
    }
    
    // Debounce timer for auto-execute
    private autoExecuteTimer: ReturnType<typeof setTimeout> | null = null;
    
    // Common setup for all AI nodes
    protected setupAI(): void {
      this.addParm('generate', {
        type: 'button',
        displayName: 'Generate',
        onClick: () => this.generate(),
        disabled: () => this.isGenerating
      });
      
      this.addParm('cancel', {
        type: 'button',
        displayName: 'Cancel',
        onClick: () => this.cancelGeneration(),
        hidden: () => !this.isGenerating
      });
      
      this.addParm('autoExecute', {
        type: 'checkbox',
        value: false,
        displayName: 'Auto-run',
        description: 'Automatically generate when inputs change (500ms debounce)'
      });
    }
    
    // Call this when inputs change (from onInputChange hook)
    protected onInputChanged(): void {
      if (this.props.autoExecute?.value && !this.isGenerating) {
        this.scheduleAutoGenerate();
      }
    }
    
    private scheduleAutoGenerate(): void {
      if (this.autoExecuteTimer) {
        clearTimeout(this.autoExecuteTimer);
      }
      this.autoExecuteTimer = setTimeout(() => {
        this.autoExecuteTimer = null;
        this.generate();
      }, 500);
    }
    
    // Override in subclasses
    abstract generate(): Promise<void>;
    
    protected cancelGeneration(): void {
      this.abortController?.abort();
      this.isGenerating = false;
      this.markDirty();
    }
    
    // Get the currently selected result
    protected getSelectedResult(): GenerationResult | null {
      const batch = this.history.batches.find(b => b.id === this.history.currentBatchId);
      if (!batch || batch.selectedIndex === null) return null;
      return batch.results[batch.selectedIndex];
    }
    
    // Select a result from the grid
    selectResult(batchId: string, index: number): void {
      const batch = this.history.batches.find(b => b.id === batchId);
      if (batch) {
        batch.selectedIndex = index;
        this.history.currentBatchId = batchId;
        this.requestCook();
      }
    }
    
    // Serialize generation history with the node
    // Note: Only metadata is serialized, images are in cache directory
    override serialize(): object {
      return {
        ...super.serialize(),
        generationHistory: {
          currentBatchId: this.history.currentBatchId,
          // Store batch metadata but not image data
          batches: this.history.batches.map(batch => ({
            id: batch.id,
            selectedIndex: batch.selectedIndex,
            status: batch.status,
            // Results store references to cached files, not image data
            results: batch.results.map(r => ({
              id: r.id,
              seed: r.seed,
              prompt: r.prompt,
              negativePrompt: r.negativePrompt,
              parameters: r.parameters,
              model: r.model,
              timestamp: r.timestamp,
              // File references (relative to cache dir)
              imageFile: `${batch.id}_${r.id}.png`,
              thumbnailFile: `${batch.id}_${r.id}_thumb.jpg`,
            })),
          })),
        },
      };
    }
    
    override async deserialize(data: any): Promise<void> {
      await super.deserialize(data);
      
      if (data.generationHistory) {
        // Restore history metadata
        this.history.currentBatchId = data.generationHistory.currentBatchId;
        this.history.batches = data.generationHistory.batches.map((batch: any) => ({
          ...batch,
          results: batch.results.map((r: any) => ({
            ...r,
            timestamp: new Date(r.timestamp),
            // Image data loaded lazily
            imageBuffer: null,
            thumbnailUrl: null,
          })),
        }));
        
        // Load cached images for current batch (needed for immediate output)
        await this.loadCurrentBatchFromCache();
      }
    }
    
    // Called after deserialize - load images needed for graph execution
    private async loadCurrentBatchFromCache(): Promise<void> {
      if (this.cacheLoaded) return;
      
      const currentBatch = this.history.batches.find(
        b => b.id === this.history.currentBatchId
      );
      
      if (!currentBatch) return;
      
      try {
        // Load full images for current batch (needed for output)
        for (const result of currentBatch.results) {
          const imagePath = `${this.cacheDir}/${result.imageFile}`;
          result.imageBuffer = await GenerationCache.loadImage(imagePath);
          
          // Load thumbnail for grid display
          const thumbPath = `${this.cacheDir}/${result.thumbnailFile}`;
          result.thumbnailUrl = await GenerationCache.loadThumbnailUrl(thumbPath);
        }
        
        this.cacheLoaded = true;
        
        // Now that cache is loaded, mark ready for cooking
        this.markDirty();
        
      } catch (error) {
        console.warn(`Failed to load cache for node ${this.id}:`, error);
        // Clear history if cache is corrupted/missing
        this.history = { batches: [], currentBatchId: null };
      }
    }
    
    // Lazy-load historical batches when user browses history
    async loadBatchFromCache(batchId: string): Promise<void> {
      const batch = this.history.batches.find(b => b.id === batchId);
      if (!batch) return;
      
      // Skip if already loaded
      if (batch.results[0]?.imageBuffer) return;
      
      for (const result of batch.results) {
        const imagePath = `${this.cacheDir}/${result.imageFile}`;
        result.imageBuffer = await GenerationCache.loadImage(imagePath);
        
        const thumbPath = `${this.cacheDir}/${result.thumbnailFile}`;
        result.thumbnailUrl = await GenerationCache.loadThumbnailUrl(thumbPath);
      }
    }
    
    // Called during execute/render - ensures cache is loaded
    protected async ensureCacheLoaded(): Promise<boolean> {
      if (!this.cacheLoaded && this.history.currentBatchId) {
        await this.loadCurrentBatchFromCache();
      }
      return this.cacheLoaded && this.getSelectedResult() !== null;
    }
  };
};
```

### Cache Loading Strategy

On project load:

1. **Deserialize** - Node restores history metadata from `.cascade` file
2. **Load current batch** - Images for the currently selected batch load from cache
3. **Output ready** - Node can immediately output the selected result
4. **Graph cooks** - Downstream nodes receive cached output, no regeneration needed
5. **Lazy load history** - Other batches load thumbnails only when user opens history panel

```
Project Load Flow:
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  .cascade file  │────▶│   deserialize   │────▶│  load current   │
│  (metadata)     │     │   history IDs   │     │  batch images   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
        ┌───────────────────────────────────────────────┘
        ▼
┌─────────────────┐     ┌─────────────────┐
│  markDirty()    │────▶│  graph cooks    │
│  output ready   │     │  with cached    │
└─────────────────┘     └─────────────────┘
```

### GenerationCache Extensions

```typescript
// Add to GenerationCache class

static async loadImage(path: string): Promise<ImageBuffer> {
  const blob = await this.readFile(path);
  const img = await createImageBitmap(blob);
  return ImageBuffer.fromImageBitmap(img);
}

static async loadThumbnailUrl(path: string): Promise<string> {
  const blob = await this.readFile(path);
  return URL.createObjectURL(blob);
}

// Clean up object URLs when node is destroyed
static revokeThumbnailUrls(batch: GenerationBatch): void {
  for (const result of batch.results) {
    if (result.thumbnailUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(result.thumbnailUrl);
    }
  }
}
```
```

---

### 2. Generate (lens)

**Purpose:** Text-to-image generation. Works standalone OR with connected inputs.

**Location:** `src/nodes/lens/Generate.ts`

**Design Principle:** All inputs are optional. Parameters work standalone; connections override them.

```
┌─────────────────────────────────────────┐
│ FAST MODE          │  GRAPH MODE        │
│                    │                    │
│  ┌──────────┐      │  ┌──────┐          │
│  │ Generate │      │  │ Text │──prompt──┐│
│  │          │      │  └──────┘          ││
│  │ prompt:  │      │                    ▼│
│  │ "a cat"  │      │  ┌────────────────┐│
│  │          │      │  │ Generate       ││
│  │ 🎲 seed  │      │  │ prompt: (←)    ││
│  └──────────┘      │  └────────────────┘│
│                    │                    │
│  One node. Done.   │  Visible data flow │
└─────────────────────────────────────────┘
```

```typescript
class Generate extends AINodeMixin(LensNode) {
  static type = 'lens/Generate';
  static displayName = 'Generate';
  static category = 'Lens';
  
  protected setup(): void {
    // === OPTIONAL INPUTS ===
    // All inputs optional - parameters work without them
    this.in<string>('prompt', null);           // Overrides prompt param
    this.in<ImageInput>('style', null);        // Style reference
    this.in<ImageInput>('composition', null);  // Composition reference  
    this.in<number>('seed', null);             // Overrides seed param
    
    // === PROMPT (standalone or overridden) ===
    this.addParm('prompt', {
      value: '',
      type: 'textarea',
      displayName: 'Prompt',
      params: { rows: 3 },
      overriddenBy: 'prompt',  // Grayed out when input connected
    });
    
    this.addParm('negativePrompt', {
      value: '',
      type: 'textarea', 
      displayName: 'Negative',
      params: { rows: 2 },
      advanced: true,
    });
    
    // === MODEL ===
    this.addParm('model', {
      value: 'flux-schnell',
      type: 'select',
      displayName: 'Model',
      params: {
        options: [
          { value: 'flux-schnell', label: 'Flux Schnell (fast)' },
          { value: 'flux-dev', label: 'Flux Dev (quality)' },
          { value: 'sdxl', label: 'Stable Diffusion XL' },
        ]
      }
    });
    
    // === GENERATION SETTINGS ===
    this.addParm('batchSize', {
      value: 4,
      type: 'number',
      displayName: 'Batch Size',
      params: { min: 1, max: 9, step: 1 }
    });
    
    this.addParm('seed', {
      value: -1,
      type: 'number',
      displayName: 'Seed',
      params: { min: -1, max: 2147483647, step: 1 },
      description: '-1 for random',
      overriddenBy: 'seed',
    });
    
    this.addParm('rerollSeed', {
      type: 'button',
      displayName: '🎲',
      inline: true,
      onClick: () => this.rerollSeed(),
      hidden: () => this.inputs[3].isConnected,
    });
    
    this.addParm('seedOffset', {
      value: 0,
      type: 'number',
      displayName: 'Seed Offset',
      params: { min: -10000, max: 10000, step: 1 },
      description: 'Added to input seed (for variations)',
      hidden: () => !this.inputs[3].isConnected,
    });
    
    // === SIZE ===
    this.addParm('width', {
      value: 1024,
      type: 'number',
      displayName: 'Width',
      params: { min: 256, max: 2048, step: 64 }
    });
    
    this.addParm('height', {
      value: 1024,
      type: 'number',
      displayName: 'Height',
      params: { min: 256, max: 2048, step: 64 }
    });
    
    // === REFERENCE IMAGES (parameter-based) ===
    this.addParm('references', {
      type: 'imageList',
      value: [],
      displayName: 'Reference Images',
      description: 'Drag images here or connect style/composition inputs',
    });
    
    this.addParm('referenceStrength', {
      type: 'number',
      value: 0.5,
      displayName: 'Reference Strength',
      params: { min: 0, max: 1, step: 0.05 },
      hidden: () => this.getEffectiveReferences().length === 0,
    });
    
    // === AI CONTROLS ===
    this.setupAI();  // From AINodeMixin: generate button, status, history
    
    // === VARIATION BUTTON ===
    this.addParm('vary', {
      type: 'button',
      displayName: '🎲 Vary',
      description: 'Create variation node connected to this one',
      onClick: () => this.createVariation(),
      hidden: () => !this.hasResults(),
    });
    
    // === OUTPUTS ===
    this.out<ImageBuffer>('image', 'image');
    this.out<ImageBuffer[]>('all', 'image');
    this.out<number>('seed', 'number');
  }
  
  // === EFFECTIVE VALUES (input > parameter) ===
  
  private getEffectivePrompt(): string {
    return this.inputs[0].value ?? this.props.prompt.value;
  }
  
  private getEffectiveSeed(): number {
    const inputSeed = this.inputs[3].value;
    const paramSeed = this.props.seed.value;
    const offset = this.props.seedOffset.value;
    const base = inputSeed ?? paramSeed;
    return base === -1 ? this.randomSeed() : base + offset;
  }
  
  private getEffectiveReferences(): ReferenceImage[] {
    const refs: ReferenceImage[] = [];
    
    // From input connections
    if (this.inputs[1].value) {
      refs.push({
        image: this.toImageBuffer(this.inputs[1].value),
        type: 'style',
        strength: this.props.referenceStrength.value,
      });
    }
    if (this.inputs[2].value) {
      refs.push({
        image: this.toImageBuffer(this.inputs[2].value),
        type: 'composition',
        strength: this.props.referenceStrength.value,
      });
    }
    
    // From parameter list
    for (const ref of this.props.references.value) {
      refs.push(ref);
    }
    
    return refs;
  }
  
  // === VARIATION CREATION ===
  
  private createVariation(): void {
    if (!this.hasResults()) return;
    
    const graph = this.graph;
    const myPos = this.position;
    
    // Create new Generate node
    const variation = graph.createNode('lens/Generate', {
      position: { x: myPos.x + 250, y: myPos.y },
    });
    
    // Copy prompt (or connect if we have a prompt input)
    if (this.inputs[0].isConnected) {
      // Connect same prompt source to variation
      const promptConnection = graph.getConnectionToPort(this.id, 'prompt');
      if (promptConnection) {
        graph.connect(promptConnection.sourceId, promptConnection.sourcePort, variation.id, 'prompt');
      }
    } else {
      // Copy prompt value
      variation.props.prompt.value = this.props.prompt.value;
    }
    
    // Connect seed: this.seed → variation.seed
    graph.connect(this.id, 'seed', variation.id, 'seed');
    
    // Connect image as style reference: this.image → variation.style
    graph.connect(this.id, 'image', variation.id, 'style');
    
    // Set seed offset for variation
    variation.props.seedOffset.value = 10;
    
    // Copy other settings
    variation.props.model.value = this.props.model.value;
    variation.props.width.value = this.props.width.value;
    variation.props.height.value = this.props.height.value;
    variation.props.referenceStrength.value = 0.3;  // Light influence
    
    // Select the new node
    this.editor?.selectElement(variation);
  }
  
  private rerollSeed(): void {
    this.props.seed.value = this.randomSeed();
  }
  
  private randomSeed(): number {
    return Math.floor(Math.random() * 2147483647);
  }
  
  // === GENERATION ===
  
  async generate(): Promise<void> {
    if (this.isGenerating) return;
    
    const prompt = this.getEffectivePrompt();
    if (!prompt.trim()) {
      this.setError('Prompt is required');
      return;
    }
    
    this.isGenerating = true;
    this.abortController = new AbortController();
    
    try {
      const actualSeed = this.getEffectiveSeed();
      const references = this.getEffectiveReferences();
      
      const request: GenerationRequest = {
        prompt,
        negativePrompt: this.props.negativePrompt.value,
        model: this.props.model.value,
        batchSize: this.props.batchSize.value,
        seed: actualSeed,
        width: this.props.width.value,
        height: this.props.height.value,
        references,
      };
      
      // ... generation and batch handling ...
      
      // Store the seed that was actually used
      this.lastUsedSeed = actualSeed;
      
    } catch (error) {
      this.handleGenerationError(error);
    } finally {
      this.isGenerating = false;
      this.abortController = null;
    }
  }
  
  async execute(): Promise<void> {
    const selected = this.getSelectedResult();
    this.setOutput(this.outputs[0], selected);
    this.setOutput(this.outputs[1], this.getAllResults());
    this.setOutput(this.outputs[2], this.lastUsedSeed);
  }
}
```

### Variation Flow

When user clicks **🎲 Vary**:

```
BEFORE                          AFTER
                                
┌──────────┐                    ┌──────────┐     ┌──────────────────┐
│ Generate │                    │ Generate │────▶│ Generate         │
│          │        ──▶         │          │     │                  │
│ [result] │                    │ [result] │──┬─▶│ seed (offset: 10)│
└──────────┘                    └──────────┘  │  │ style reference  │
                                      │       │  └──────────────────┘
                                      │ seed  │
                                      └───────┘
```

**What "🎲 Vary" creates:**
1. New Generate node positioned to the right
2. Seed connection (for reproducible relationship)
3. Image → style connection (for visual influence)
4. Seed offset of 10 (subtle variation)
5. Reference strength of 0.3 (light touch)

**User can then:**
- Adjust `seedOffset` for more/less variation (10=subtle, 100=medium, 1000=strong)
- Adjust `referenceStrength` for more/less influence
- Click 🎲 Vary again to chain variations
- Disconnect style if they want seed-only variation

---

### 3. Edit (lens)

**Purpose:** Edit images using text instructions. Supports inpainting, outpainting, and instruction-based transformations.

**Location:** `src/nodes/lens/Edit.ts`

```typescript
class Edit extends AINodeMixin(LensNode) {
  static type = 'lens/Edit';
  static displayName = 'Edit';
  static category = 'Lens';
  
  private currentModel: ModelSchema | null = null;
  
  protected setup(): void {
    // === INPUTS ===
    this.in<ImageInput>('image', null, {
      displayName: 'Image'
    });
    
    this.in<string>('instruction', null, {
      displayName: 'Instruction'
    });
    
    this.in<ImageInput>('mask', null, {
      displayName: 'Mask',
      description: 'White = edit, Black = preserve'
    });
    
    // === MODEL SELECTION ===
    this.addParm('model', {
      value: 'flux-fill',
      type: 'select',
      displayName: 'Model',
      params: {
        options: this.getEditModelOptions()
      },
      onChange: () => this.onModelChange()
    });
    
    // === EDIT MODE ===
    this.addParm('mode', {
      value: 'inpaint',
      type: 'select',
      displayName: 'Mode',
      params: {
        options: [
          { value: 'inpaint', label: 'Inpaint - Fill masked area' },
          { value: 'instruct', label: 'Instruct - Transform whole image' },
          { value: 'outpaint', label: 'Outpaint - Extend canvas' },
        ]
      },
      onChange: () => this.onModeChange()
    });
    
    // === INSTRUCTION (when input not connected) ===
    this.addParm('instructionText', {
      value: '',
      type: 'textarea',
      displayName: 'Instruction',
      hidden: () => this.inputs[1].isConnected,
      params: {
        rows: 3,
        placeholder: 'DescribeImage the edit: "Replace sky with sunset", "Add a red hat", "Make it winter"...'
      }
    });
    
    // === OUTPAINT SETTINGS ===
    this.addParm('expandDirection', {
      value: 'all',
      type: 'select',
      displayName: 'Expand Direction',
      hidden: () => this.props.mode.value !== 'outpaint',
      params: {
        options: [
          { value: 'all', label: 'All sides' },
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
          { value: 'up', label: 'Up' },
          { value: 'down', label: 'Down' },
          { value: 'horizontal', label: 'Left + Right' },
          { value: 'vertical', label: 'Up + Down' },
        ]
      }
    });
    
    this.addParm('expandAmount', {
      value: 256,
      type: 'number',
      displayName: 'Expand (px)',
      hidden: () => this.props.mode.value !== 'outpaint',
      params: { min: 64, max: 1024, step: 64 }
    });
    
    // === GENERATION SETTINGS ===
    this.addParm('batchSize', {
      value: 4,
      type: 'number',
      displayName: 'Batch Size',
      params: { min: 1, max: 9, step: 1 }
    });
    
    this.addParm('seed', {
      value: -1,
      type: 'number',
      displayName: 'Seed',
      params: { min: -1, max: 2147483647, step: 1 }
    });
    
    this.addParm('strength', {
      value: 0.85,
      type: 'number',
      displayName: 'Edit Strength',
      description: 'How much to change (0 = subtle, 1 = complete)',
      params: { min: 0, max: 1, step: 0.05 }
    });
    
    // === AI CONTROLS ===
    this.setupAI();
    
    // === OUTPUTS ===
    this.out<ImageBuffer>('image', 'image');
    this.out<ImageBuffer[]>('all', 'image');
    this.out<number>('seed', 'number');  // Seed used for selected result
  }
  
  private getEditModelOptions(): { value: string; label: string }[] {
    return ProviderRegistry.getEditModels().map(model => ({
      value: model.id,
      label: model.name
    }));
  }
  
  async generate(): Promise<void> {
    if (this.isGenerating) return;
    
    const image = this.inputs[0].value;
    if (!image) {
      this.setError('No image provided');
      return;
    }
    
    const instruction = this.inputs[1].value ?? this.props.instructionText.value;
    if (!instruction && this.props.mode.value !== 'outpaint') {
      this.setError('No instruction provided');
      return;
    }
    
    this.isGenerating = true;
    this.abortController = new AbortController();
    
    try {
      const imageBuffer = this.toImageBuffer(image);
      const mask = this.inputs[2].value ? this.toImageBuffer(this.inputs[2].value) : null;
      
      const request: EditRequest = {
        image: imageBuffer,
        instruction,
        mask,
        mode: this.props.mode.value,
        model: this.props.model.value,
        batchSize: this.props.batchSize.value,
        seed: this.props.seed.value === -1 
          ? Math.floor(Math.random() * 2147483647) 
          : this.props.seed.value,
        strength: this.props.strength.value,
        // Outpaint-specific
        expandDirection: this.props.expandDirection?.value,
        expandAmount: this.props.expandAmount?.value,
      };
      
      const batch: GenerationBatch = {
        id: crypto.randomUUID(),
        results: [],
        selectedIndex: null,
        status: 'generating',
        progress: 0,
      };
      
      this.history.batches.unshift(batch);
      this.history.currentBatchId = batch.id;
      this.markDirty();
      
      const provider = ProviderRegistry.getProvider(this.currentModel!.provider);
      const results = await provider.editImage(request, {
        signal: this.abortController.signal,
        onProgress: (progress) => {
          batch.progress = progress;
          this.markDirty();
        }
      });
      
      batch.results = results;
      batch.status = 'complete';
      batch.selectedIndex = 0;
      
      await this.cacheResults(batch);
      this.requestCook();
      
    } catch (error) {
      this.handleGenerationError(error);
    } finally {
      this.isGenerating = false;
      this.abortController = null;
      this.markDirty();
    }
  }
  
  protected async render(): Promise<void> {
    // Ensure cache is loaded before outputting
    const hasOutput = await this.ensureCacheLoaded();
    
    if (hasOutput) {
      const selected = this.getSelectedResult();
      this.setOutput(this.outputs[0], selected!.imageBuffer);
      this.setOutput(this.outputs[2], selected!.seed);
    } else {
      this.setOutput(this.outputs[0], null);
      this.setOutput(this.outputs[2], -1);
    }
    
    const currentBatch = this.history.batches.find(
      b => b.id === this.history.currentBatchId
    );
    this.setOutput(this.outputs[1], currentBatch?.results.map(r => r.imageBuffer) ?? []);
  }
}
```

**Edit Modes:**

| Mode | Input Required | Description |
|------|----------------|-------------|
| Inpaint | Image + Mask + Instruction | Fill masked area based on instruction |
| Instruct | Image + Instruction | Transform entire image following instruction |
| Outpaint | Image + Direction | Extend image beyond original bounds |

**Model Support:**

```typescript
// Add to modelDefinitions.ts
export const editModels: ModelSchema[] = [
  {
    id: 'flux-fill',
    name: 'Flux Fill',
    provider: 'replicate',
    endpoint: 'black-forest-labs/flux-fill-pro',
    capabilities: ['inpaint', 'outpaint'],
    // ...
  },
  {
    id: 'sdxl-inpaint',
    name: 'SDXL Inpaint',
    provider: 'replicate', 
    endpoint: 'stability-ai/sdxl-inpainting',
    capabilities: ['inpaint'],
    // ...
  },
  {
    id: 'instruct-pix2pix',
    name: 'InstructPix2Pix',
    provider: 'replicate',
    endpoint: 'timothybrooks/instruct-pix2pix',
    capabilities: ['instruct'],
    // ...
  },
];
```

---

### 4. Describe (quill)

**Purpose:** Generate text descriptions of images using vision LLMs.

**Location:** `src/nodes/quill/Describe.ts`

```typescript
class Describe extends AINodeMixin(QuillNode) {
  static type = 'quill/Describe';
  static displayName = 'Describe';
  static category = 'Quill';
  
  private lastDescription: string = '';
  
  protected setup(): void {
    this.in<ImageInput>('image', null);
    
    this.addParm('model', {
      value: 'gemini-1.5-flash',
      type: 'select',
      displayName: 'Model',
      params: {
        options: [
          { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
          { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
          { value: 'gpt-4o', label: 'GPT-4o' },
        ]
      }
    });
    
    this.addParm('style', {
      value: 'prompt',
      type: 'select',
      displayName: 'Output Style',
      params: {
        options: [
          { value: 'prompt', label: 'As Generation Prompt' },
          { value: 'detailed', label: 'Detailed Description' },
          { value: 'brief', label: 'Brief Summary' },
          { value: 'custom', label: 'Custom Instructions' },
        ]
      }
    });
    
    this.addParm('instructions', {
      value: '',
      type: 'textarea',
      displayName: 'Instructions',
      hidden: () => this.props.style.value !== 'custom',
      params: { rows: 3 }
    });
    
    this.setupAI();
    
    this.out<string>('text');
  }
  
  private getSystemPrompt(): string {
    switch (this.props.style.value) {
      case 'prompt':
        return 'Generate an image generation prompt that would recreate this image. Include style, subject, composition, lighting. Output only the prompt.';
      case 'detailed':
        return 'Describe this image in detail: subjects, setting, colors, lighting, mood, composition.';
      case 'brief':
        return 'Describe this image in one sentence.';
      case 'custom':
        return this.props.instructions.value || 'Describe this image.';
      default:
        return 'Describe this image.';
    }
  }
  
  async generate(): Promise<void> {
    if (this.isGenerating) return;
    
    const image = this.inputs[0].value;
    if (!image) {
      this.setError('No image provided');
      return;
    }
    
    this.isGenerating = true;
    
    try {
      const provider = ProviderRegistry.getVisionProvider(this.props.model.value);
      this.lastDescription = await provider.describeImage({
        image: this.toImageBuffer(image),
        prompt: this.getSystemPrompt(),
      });
      this.requestCook();
    } catch (error) {
      this.setError(error.message);
    } finally {
      this.isGenerating = false;
      this.markDirty();
    }
  }
  
  async execute(): Promise<void> {
    this.setOutput(this.outputs[0], this.lastDescription);
  }
}
```

---

### 5. Enhance (quill)

**Purpose:** Use an LLM to enhance and expand prompts for better image generation.

**Location:** `src/nodes/quill/Enhance.ts`

```typescript
class Enhance extends AINodeMixin(QuillNode) {
  static type = 'quill/Enhance';
  static displayName = 'Enhance';
  static category = 'Quill';
  
  private lastEnhanced: string = '';
  
  protected setup(): void {
    this.in<string>('prompt', null);
    
    // Prompt parameter (when input not connected)
    this.addParm('promptText', {
      value: '',
      type: 'textarea',
      displayName: 'Prompt',
      hidden: () => this.inputs[0].isConnected,
      params: { rows: 3 }
    });
    
    this.addParm('model', {
      value: 'gemini-1.5-flash',
      type: 'select',
      displayName: 'Model',
      params: {
        options: [
          { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
          { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
        ]
      }
    });
    
    this.addParm('style', {
      value: 'balanced',
      type: 'select',
      displayName: 'Style',
      params: {
        options: [
          { value: 'minimal', label: 'Minimal' },
          { value: 'balanced', label: 'Balanced' },
          { value: 'detailed', label: 'Detailed' },
        ]
      }
    });
    
    this.setupAI();
    
    this.out<string>('text');
  }
  
  async generate(): Promise<void> {
    if (this.isGenerating) return;
    
    const prompt = this.inputs[0].value ?? this.props.promptText.value;
    if (!prompt) {
      this.setError('No prompt provided');
      return;
    }
    
    this.isGenerating = true;
    
    try {
      const style = this.props.style.value;
      const systemPrompt = {
        minimal: 'Lightly enhance this image generation prompt. Fix grammar, add 1-2 helpful details. Output only the prompt.',
        balanced: 'Enhance this image generation prompt with details about lighting, composition, style, mood. Output only the prompt.',
        detailed: 'Expand this into a comprehensive image generation prompt with style, lighting, composition, colors, atmosphere. Output only the prompt.',
      }[style];
      
      const provider = ProviderRegistry.getLLMProvider(this.props.model.value);
      this.lastEnhanced = (await provider.complete({
        system: systemPrompt,
        prompt: prompt,
        maxTokens: 500,
      })).trim();
      
      this.requestCook();
    } catch (error) {
      this.setError(error.message);
    } finally {
      this.isGenerating = false;
      this.markDirty();
    }
  }
  
  async execute(): Promise<void> {
    this.setOutput(this.outputs[0], this.lastEnhanced);
  }
}
```

---

### 6. Text (quill)

**Purpose:** Text constant OR template with `{placeholder}` inputs. Consolidates Prompt, Template, and Concat functionality.

**Location:** `src/nodes/quill/Text.ts`

```typescript
class Text extends QuillNode {
  static type = 'quill/Text';
  static displayName = 'Text';
  static category = 'Quill';
  
  protected setup(): void {
    this.addParm('text', {
      value: '',
      type: 'textarea',
      displayName: 'Text',
      params: { rows: 3 },
      onChange: () => this.updateDynamicInputs()
    });
    
    this.out<string>('text');
    
    // Parse initial text for placeholders
    this.updateDynamicInputs();
  }
  
  // Dynamically create/remove inputs based on {placeholder} patterns
  private updateDynamicInputs(): void {
    const text = this.props.text.value;
    const placeholders = this.extractPlaceholders(text);
    
    // Remove inputs that are no longer in template
    for (const input of [...this.inputs]) {
      if (!placeholders.has(input.name)) {
        this.removeInput(input.name);
      }
    }
    
    // Add inputs for new placeholders
    const existingNames = new Set(this.inputs.map(i => i.name));
    for (const name of placeholders) {
      if (!existingNames.has(name)) {
        this.in<string>(name, '');
      }
    }
  }
  
  private extractPlaceholders(text: string): Set<string> {
    const regex = /\{(\w+)\}/g;
    const result = new Set<string>();
    let match;
    while ((match = regex.exec(text)) !== null) {
      result.add(match[1]);
    }
    return result;
  }
  
  async execute(): Promise<void> {
    let result = this.props.text.value;
    
    // Replace placeholders with input values
    for (const input of this.inputs) {
      const value = input.value ?? '';
      result = result.replaceAll(`{${input.name}}`, value);
    }
    
    this.setOutput(this.outputs[0], result);
  }
}
```

**Usage examples:**

```
// As constant (no placeholders)
text: "a majestic dragon flying"
→ output: "a majestic dragon flying"

// As template (with placeholders)
text: "a {subject} in {style} style"
→ creates inputs: subject, style
→ connect: subject="cat", style="watercolor"
→ output: "a cat in watercolor style"

// As concat (all placeholders, no literals)
text: "{prefix}{main}{suffix}"
→ creates inputs: prefix, main, suffix
→ output: concatenation of all inputs
```

---

### 7. Select (core)

**Purpose:** Pick an item from an array by index. Works with any array type.

**Location:** `src/nodes/core/Select.ts`

```typescript
class Select extends Node {
  static type = 'core/Select';
  static displayName = 'Select';
  static category = 'Core';
  
  protected setup(): void {
    this.in<any[]>('array', []);
    
    this.addParm('index', {
      value: 0,
      type: 'number',
      displayName: 'Index',
      params: { min: 0, step: 1 }
    });
    
    this.addParm('wrap', {
      value: true,
      type: 'checkbox',
      displayName: 'Wrap Around',
      description: 'Wrap index if out of bounds'
    });
    
    this.out('item');
    this.out<number>('count', 'number');  // Array length for reference
  }
  
  async execute(): Promise<void> {
    const arr = this.inputs[0].value ?? [];
    const count = arr.length;
    
    this.setOutput(this.outputs[1], count);
    
    if (count === 0) {
      this.setOutput(this.outputs[0], null);
      return;
    }
    
    let idx = this.props.index.value;
    
    if (this.props.wrap.value) {
      // Wrap around (modulo)
      idx = ((idx % count) + count) % count;
    } else {
      // Clamp to valid range
      idx = Math.max(0, Math.min(idx, count - 1));
    }
    
    this.setOutput(this.outputs[0], arr[idx]);
  }
}
```

**Usage with Generate:**
```
Generate.all ──→ Select ──→ downstream processing
                  index: 2
```

---

### 8. Random (core)

**Purpose:** Generate random seed values OR pick random choice from options. Consolidates RandomSeed and RandomChoice.

**Location:** `src/nodes/core/Random.ts`

```typescript
class Random extends Node {
  static type = 'core/Random';
  static displayName = 'Random';
  static category = 'Core';
  
  private currentSeed: number = 0;
  private currentIndex: number = 0;
  
  protected setup(): void {
    this.addParm('mode', {
      value: 'seed',
      type: 'select',
      displayName: 'Mode',
      params: {
        options: [
          { value: 'seed', label: 'Random Seed' },
          { value: 'choice', label: 'Random Choice' },
        ]
      },
      onChange: () => this.requestCook()
    });
    
    // Choice mode options
    this.addParm('options', {
      value: 'option 1\noption 2\noption 3',
      type: 'textarea',
      displayName: 'Options',
      description: 'One per line',
      hidden: () => this.props.mode.value !== 'choice',
      params: { rows: 4 }
    });
    
    this.addParm('reroll', {
      type: 'button',
      displayName: '🎲 Reroll',
      onClick: () => this.reroll()
    });
    
    this.addParm('lock', {
      type: 'checkbox',
      value: false,
      displayName: '🔒 Lock'
    });
    
    // Outputs - both always present for flexibility
    this.out<number>('seed', 'number');
    this.out<string>('choice', 'string');
    this.out<number>('index', 'number');
    
    // Initialize
    this.currentSeed = this.randomSeed();
  }
  
  private randomSeed(): number {
    return Math.floor(Math.random() * 2147483647);
  }
  
  private getOptions(): string[] {
    return this.props.options.value
      .split('\n')
      .map((s: string) => s.trim())
      .filter(Boolean);
  }
  
  reroll(): void {
    if (this.props.lock.value) return;
    
    if (this.props.mode.value === 'seed') {
      this.currentSeed = this.randomSeed();
    } else {
      const options = this.getOptions();
      if (options.length > 0) {
        this.currentIndex = Math.floor(Math.random() * options.length);
      }
    }
    this.requestCook();
  }
  
  async execute(): Promise<void> {
    const options = this.getOptions();
    
    this.setOutput(this.outputs[0], this.currentSeed);
    this.setOutput(this.outputs[1], options[this.currentIndex] ?? '');
    this.setOutput(this.outputs[2], this.currentIndex);
  }
  
  override serialize(): object {
    return {
      ...super.serialize(),
      currentSeed: this.currentSeed,
      currentIndex: this.currentIndex,
    };
  }
  
  override deserialize(data: any): void {
    super.deserialize(data);
    if (data.currentSeed !== undefined) this.currentSeed = data.currentSeed;
    if (data.currentIndex !== undefined) this.currentIndex = data.currentIndex;
  }
}
```

**Usage - Seed mode:**
```
Random (seed) ──seed──→ Generate A
   🔒 lock     └─seed──→ Generate B   (same seed to both)
```

**Usage - Choice mode:**
```
Random (choice) ──choice──→ Text "{style}"
options:
  watercolor
  oil painting
  pencil sketch
  
🎲 Reroll → instant new style
```

**Keyboard:** `R` to reroll all unlocked Random nodes, `L` to toggle lock.

---

### 9. Freeze (core)

**Purpose:** Capture and lock a value, preventing upstream changes from affecting downstream nodes.

**Location:** `src/nodes/core/Freeze.ts`

```typescript
class Freeze extends Node {
  static type = 'core/Freeze';
  static displayName = 'Freeze';
  static category = 'Core';
  
  private frozenValue: any = undefined;
  
  protected setup(): void {
    this.in<any>('input');
    
    this.addParm('frozen', {
      type: 'checkbox',
      value: false,
      displayName: '❄️ Frozen'
    });
    
    this.addParm('capture', {
      type: 'button',
      displayName: '📸 Capture',
      onClick: () => this.capture()
    });
    
    this.addParm('clear', {
      type: 'button',
      displayName: '🗑️ Clear',
      onClick: () => this.clear(),
      hidden: () => this.frozenValue === undefined
    });
    
    this.out('output');
  }
  
  capture(): void {
    const input = this.inputs[0].value;
    if (input instanceof ImageBuffer) {
      this.frozenValue = input.clone();
    } else {
      this.frozenValue = structuredClone(input);
    }
    this.props.frozen.value = true;
    this.requestCook();
  }
  
  private clear(): void {
    this.frozenValue = undefined;
    this.props.frozen.value = false;
    this.requestCook();
  }
  
  async execute(): Promise<void> {
    if (this.props.frozen.value && this.frozenValue !== undefined) {
      this.setOutput(this.outputs[0], this.frozenValue);
    } else {
      this.setOutput(this.outputs[0], this.inputs[0].value);
    }
  }
  
  override serialize(): object {
    return {
      ...super.serialize(),
      frozenValue: this.serializeFrozenValue(),
      frozen: this.props.frozen.value,
    };
  }
  
  override async deserialize(data: any): Promise<void> {
    await super.deserialize(data);
    if (data.frozenValue !== undefined) {
      this.frozenValue = await this.deserializeFrozenValue(data.frozenValue);
    }
  }
}
```

**Usage:**
```
Generate → Freeze → Composite
              ❄️       ↑
                       │
         [upstream changes don't affect frozen image]
```

**Keyboard:** `F` to toggle freeze.

---

## Provider System

### Abstract Provider Interface

```typescript
// src/services/genai/providers/Provider.ts

interface GenerationOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

interface GenerationRequest {
  prompt: string;
  negativePrompt?: string;
  model: string;
  batchSize: number;
  seed: number;
  width: number;
  height: number;
  references?: ReferenceImage[];
  parameters: Record<string, any>;
}

interface LLMRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

interface VisionRequest {
  image: ImageBuffer;
  prompt: string;
  maxTokens?: number;
}

abstract class Provider {
  abstract readonly name: string;
  abstract readonly id: ProviderType;
  
  // Check if API key is configured
  abstract isConfigured(): boolean;
  
  // Image generation
  abstract generateImages(
    request: GenerationRequest, 
    options?: GenerationOptions
  ): Promise<GenerationResult[]>;
  
  // Image editing (inpaint, instruct, outpaint)
  async editImage(
    request: EditRequest,
    options?: GenerationOptions
  ): Promise<GenerationResult[]> {
    throw new Error('Image editing not supported by this provider');
  }
  
  // Check edit mode support
  supportsEditMode(mode: EditRequest['mode']): boolean { return false; }
  
  // For providers that also offer LLM/vision
  supportsLLM(): boolean { return false; }
  supportsVision(): boolean { return false; }
  
  async complete(request: LLMRequest): Promise<string> {
    throw new Error('LLM not supported by this provider');
  }
  
  async describeImage(request: VisionRequest): Promise<string> {
    throw new Error('Vision not supported by this provider');
  }
}
```

### Replicate Provider Example

```typescript
// src/services/genai/providers/ReplicateProvider.ts

class ReplicateProvider extends Provider {
  readonly name = 'Replicate';
  readonly id = 'replicate' as const;
  
  private get apiKey(): string | null {
    return UserPreferences.get('replicate_api_key');
  }
  
  isConfigured(): boolean {
    return !!this.apiKey;
  }
  
  async generateImages(
    request: GenerationRequest,
    options?: GenerationOptions
  ): Promise<GenerationResult[]> {
    if (!this.isConfigured()) {
      throw new Error('Replicate API key not configured. Set it in Settings > API Keys.');
    }
    
    const model = ProviderRegistry.getModel(request.model);
    if (!model || model.provider !== 'replicate') {
      throw new Error(`Invalid model: ${request.model}`);
    }
    
    const results: GenerationResult[] = [];
    
    // Replicate doesn't support native batch, so we run multiple
    for (let i = 0; i < request.batchSize; i++) {
      if (options?.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      
      const seed = request.seed + i;
      
      const input = this.buildInput(request, model, seed);
      
      // Start prediction
      const prediction = await this.createPrediction(model.endpoint, input);
      
      // Poll for completion
      const output = await this.waitForPrediction(prediction.id, options);
      
      // Download and convert image
      const imageBuffer = await this.downloadImage(output[0]);
      
      results.push({
        id: crypto.randomUUID(),
        seed,
        imageBuffer,
        thumbnailUrl: output[0],  // Use URL for thumbnail
        prompt: request.prompt,
        negativePrompt: request.negativePrompt,
        parameters: request.parameters,
        model: request.model,
        timestamp: new Date(),
      });
      
      // Report progress
      options?.onProgress?.(((i + 1) / request.batchSize) * 100);
    }
    
    return results;
  }
  
  private buildInput(request: GenerationRequest, model: ModelSchema, seed: number): object {
    // Map generic request to Replicate model-specific input
    const input: any = {
      prompt: request.prompt,
      seed,
      width: request.width,
      height: request.height,
    };
    
    if (request.negativePrompt && model.supportsNegativePrompt) {
      input.negative_prompt = request.negativePrompt;
    }
    
    // Add model-specific parameters
    for (const [key, value] of Object.entries(request.parameters)) {
      input[key] = value;
    }
    
    // Handle reference images
    if (request.references?.length && model.supportsImageInput) {
      // Upload image and get URL
      // Different models expect this differently
      input.image = request.references[0].image;  // Simplified
    }
    
    return input;
  }
  
  private async createPrediction(model: string, input: object): Promise<any> {
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: model,
        input,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Replicate API error: ${response.statusText}`);
    }
    
    return response.json();
  }
  
  private async waitForPrediction(
    id: string, 
    options?: GenerationOptions
  ): Promise<string[]> {
    while (true) {
      if (options?.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      
      const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
        headers: {
          'Authorization': `Token ${this.apiKey}`,
        },
      });
      
      const prediction = await response.json();
      
      if (prediction.status === 'succeeded') {
        return prediction.output;
      } else if (prediction.status === 'failed') {
        throw new Error(prediction.error || 'Generation failed');
      }
      
      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
```

---

## Model Definitions

```typescript
// src/services/genai/models/modelDefinitions.ts

export const imageModels: ModelSchema[] = [
  // === FLUX MODELS ===
  {
    id: 'flux-fast',
    name: 'Flux Fast',
    provider: 'replicate',
    endpoint: 'black-forest-labs/flux-schnell',
    supportsImageInput: false,
    supportedReferenceTypes: [],
    supportsNegativePrompt: false,
    supportsBatchGeneration: false,
    maxBatchSize: 4,
    parameters: [
      {
        name: 'num_inference_steps',
        type: 'number',
        default: 4,
        min: 1,
        max: 12,
        description: 'Number of denoising steps'
      },
    ],
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxResolution: 2048,
    outputFormat: 'png',
    category: 'fast',
  },
  
  {
    id: 'flux-pro',
    name: 'Flux Pro 1.1',
    provider: 'replicate',
    endpoint: 'black-forest-labs/flux-1.1-pro',
    supportsImageInput: true,
    supportedReferenceTypes: ['general'],
    supportsNegativePrompt: false,
    supportsBatchGeneration: false,
    maxBatchSize: 4,
    parameters: [
      {
        name: 'guidance',
        type: 'number',
        default: 3.5,
        min: 1,
        max: 10,
        step: 0.5,
        description: 'Guidance scale'
      },
      {
        name: 'num_inference_steps',
        type: 'number',
        default: 28,
        min: 1,
        max: 50,
      },
      {
        name: 'output_quality',
        type: 'number',
        default: 80,
        min: 1,
        max: 100,
        description: 'Output JPEG quality'
      },
    ],
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxResolution: 2048,
    outputFormat: 'jpg',
    category: 'quality',
  },
  
  // === GOOGLE MODELS ===
  {
    id: 'imagen-4',
    name: 'Imagen 4',
    provider: 'google',
    endpoint: 'imagen-4.0',
    supportsImageInput: true,
    supportedReferenceTypes: ['style', 'composition'],
    supportsNegativePrompt: true,
    supportsBatchGeneration: true,
    maxBatchSize: 4,
    parameters: [
      {
        name: 'aspectRatio',
        type: 'select',
        default: '1:1',
        options: [
          { value: '1:1', label: 'Square' },
          { value: '16:9', label: 'Landscape' },
          { value: '9:16', label: 'Portrait' },
          { value: '4:3', label: '4:3' },
          { value: '3:4', label: '3:4' },
        ],
      },
    ],
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxResolution: 2048,
    outputFormat: 'png',
    category: 'quality',
  },
  
  // === SDXL ===
  {
    id: 'sdxl',
    name: 'Stable Diffusion XL',
    provider: 'replicate',
    endpoint: 'stability-ai/sdxl',
    supportsImageInput: true,
    supportedReferenceTypes: ['general', 'mask'],
    supportsNegativePrompt: true,
    supportsBatchGeneration: false,
    maxBatchSize: 4,
    parameters: [
      {
        name: 'guidance_scale',
        type: 'number',
        default: 7.5,
        min: 0,
        max: 20,
        step: 0.5,
      },
      {
        name: 'num_inference_steps',
        type: 'number',
        default: 30,
        min: 1,
        max: 100,
      },
      {
        name: 'scheduler',
        type: 'select',
        default: 'K_EULER',
        options: [
          { value: 'K_EULER', label: 'Euler' },
          { value: 'K_DPM_2_ANCESTRAL', label: 'DPM++ 2M' },
          { value: 'DDIM', label: 'DDIM' },
        ],
        advanced: true,
      },
    ],
    defaultWidth: 1024,
    defaultHeight: 1024,
    maxResolution: 2048,
    outputFormat: 'png',
    category: 'quality',
  },
];
```

---

## UI Components

### GenerationGrid.svelte

Displays batch results with selection capability.

```svelte
<script lang="ts">
  import type { GenerationBatch, GenerationResult } from '$lib/types';
  
  export let batch: GenerationBatch;
  export let onSelect: (index: number) => void;
  export let selectedIndex: number | null;
  
  $: gridCols = batch.results.length <= 4 ? 2 : 3;
</script>

<div 
  class="generation-grid" 
  style="grid-template-columns: repeat({gridCols}, 1fr)"
>
  {#if batch.status === 'generating'}
    <div class="loading">
      <div class="progress-ring" style="--progress: {batch.progress}%"></div>
      <span>{batch.progress?.toFixed(0) ?? 0}%</span>
    </div>
  {:else if batch.status === 'error'}
    <div class="error">
      <span class="error-icon">⚠️</span>
      <span>{batch.error}</span>
    </div>
  {:else}
    {#each batch.results as result, index}
      <button
        class="result-cell"
        class:selected={selectedIndex === index}
        on:click={() => onSelect(index)}
        title="Seed: {result.seed}"
      >
        <img src={result.thumbnailUrl} alt="Result {index + 1}" />
        <div class="result-overlay">
          <span class="seed-badge">#{result.seed}</span>
        </div>
      </button>
    {/each}
  {/if}
</div>

<style>
  .generation-grid {
    display: grid;
    gap: 4px;
    padding: 4px;
    background: var(--bg-darker);
    border-radius: 4px;
  }
  
  .result-cell {
    position: relative;
    aspect-ratio: 1;
    border: 2px solid transparent;
    border-radius: 4px;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.15s, transform 0.1s;
  }
  
  .result-cell:hover {
    border-color: var(--accent-muted);
    transform: scale(1.02);
  }
  
  .result-cell.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-glow);
  }
  
  .result-cell img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  .result-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 4px;
    background: linear-gradient(transparent, rgba(0,0,0,0.7));
    opacity: 0;
    transition: opacity 0.15s;
  }
  
  .result-cell:hover .result-overlay {
    opacity: 1;
  }
  
  .seed-badge {
    font-size: 10px;
    color: white;
    font-family: monospace;
  }
  
  .loading {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px;
    color: var(--text-muted);
  }
</style>
```

### ReferenceImageList.svelte

Multi-image input with type selection.

```svelte
<script lang="ts">
  import type { ReferenceImage, ReferenceImageType } from '$lib/types';
  
  export let value: ReferenceImage[] = [];
  export let onChange: (value: ReferenceImage[]) => void;
  export let supportedTypes: ReferenceImageType[] = ['general'];
  
  let dragOver = false;
  
  function addImage(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const newRef: ReferenceImage = {
        id: crypto.randomUUID(),
        image: e.target.result as string,
        type: supportedTypes[0],
        strength: 0.75,
      };
      onChange([...value, newRef]);
    };
    reader.readAsDataURL(file);
  }
  
  function removeImage(id: string) {
    onChange(value.filter(r => r.id !== id));
  }
  
  function updateType(id: string, type: ReferenceImageType) {
    onChange(value.map(r => r.id === id ? { ...r, type } : r));
  }
  
  function updateStrength(id: string, strength: number) {
    onChange(value.map(r => r.id === id ? { ...r, strength } : r));
  }
  
  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    
    const files = Array.from(e.dataTransfer?.files ?? []);
    files.filter(f => f.type.startsWith('image/')).forEach(addImage);
  }
</script>

<div class="reference-list">
  {#each value as ref (ref.id)}
    <div class="reference-item">
      <img src={ref.image} alt="Reference" class="thumbnail" />
      
      <div class="controls">
        {#if supportedTypes.length > 1}
          <select 
            value={ref.type}
            on:change={(e) => updateType(ref.id, e.target.value)}
          >
            {#each supportedTypes as type}
              <option value={type}>{type}</option>
            {/each}
          </select>
        {/if}
        
        <input 
          type="range" 
          min="0" 
          max="1" 
          step="0.05"
          value={ref.strength}
          on:input={(e) => updateStrength(ref.id, parseFloat(e.target.value))}
          title="Strength: {(ref.strength * 100).toFixed(0)}%"
        />
        
        <button class="remove" on:click={() => removeImage(ref.id)}>×</button>
      </div>
    </div>
  {/each}
  
  <button 
    class="add-button"
    class:drag-over={dragOver}
    on:click={() => document.getElementById('ref-input')?.click()}
    on:dragover|preventDefault={() => dragOver = true}
    on:dragleave={() => dragOver = false}
    on:drop={handleDrop}
  >
    <span class="icon">+</span>
    <span>Add Reference</span>
  </button>
  
  <input 
    id="ref-input"
    type="file"
    accept="image/*"
    multiple
    hidden
    on:change={(e) => {
      const files = Array.from(e.target.files ?? []);
      files.forEach(addImage);
      e.target.value = '';
    }}
  />
</div>

<style>
  .reference-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  
  .reference-item {
    display: flex;
    gap: 8px;
    padding: 8px;
    background: var(--bg-darker);
    border-radius: 4px;
  }
  
  .thumbnail {
    width: 64px;
    height: 64px;
    object-fit: cover;
    border-radius: 4px;
  }
  
  .controls {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .add-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px;
    border: 2px dashed var(--border);
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s;
  }
  
  .add-button:hover,
  .add-button.drag-over {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-ghost);
  }
</style>
```

---

## Inspector Panel Integration

When a Generate node is selected, the Inspector panel shows:

### Inspector Layout for Generate

```
┌─────────────────────────────────────┐
│ Generate                       ⋮    │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │  [img1] [img2] [img3] [img4]   │ │  ← Generation Grid
│ │          ✓ selected            │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [Generate]  [Vary]                  │  ← Action buttons
│                                     │
├─────────────────────────────────────┤
│ Model        [Flux Fast     ▼]     │
│ Batch Size   [4        ]           │
│                                     │
│ Prompt (when not connected)         │
│ ┌─────────────────────────────────┐ │
│ │ A beautiful sunset...           │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ▶ Advanced                          │  ← Collapsible
│   Seed [-1        ]                │
│   Width [1024     ]                │
│   Height [1024    ]                │
│   ...model-specific params...       │
│                                     │
├─────────────────────────────────────┤
│ ▶ History (3 batches)               │  ← Collapsible
│   ┌─────────────────────────────┐   │
│   │ [t1][t2][t3][t4] 2 min ago  │   │  ← Previous batch
│   └─────────────────────────────┘   │
│   ┌─────────────────────────────┐   │
│   │ [t1][t2][t3][t4] 5 min ago  │   │
│   └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

### Inspector Component

```svelte
<!-- GenerateInspector.svelte -->
<script lang="ts">
  import { GenerationGrid, ReferenceImageList } from './ai';
  import type { Generate } from '$lib/nodes/lens/Generate';
  
  export let node: Generate;
  
  $: currentBatch = node.history.batches.find(
    b => b.id === node.history.currentBatchId
  );
  $: historyBatches = node.history.batches.filter(
    b => b.id !== node.history.currentBatchId
  );
  
  // Lazy-load thumbnails when history section opens
  async function onHistoryOpen() {
    for (const batch of historyBatches) {
      // Load thumbnails if not already loaded
      if (!batch.results[0]?.thumbnailUrl) {
        await node.loadBatchFromCache(batch.id);
      }
    }
  }
</script>

<div class="generate-inspector">
  <!-- Preview Panel - shows what will be sent to API -->
  <section class="preview-panel">
    <h4>Preview</h4>
    <div class="preview-content">
      <div class="preview-row">
        <label>Prompt:</label>
        <span class="preview-value">{node.getEffectivePrompt() || '(empty)'}</span>
      </div>
      {#if node.props.negativePrompt?.value}
        <div class="preview-row">
          <label>Negative:</label>
          <span class="preview-value">{node.props.negativePrompt.value}</span>
        </div>
      {/if}
      <div class="preview-row">
        <label>Model:</label>
        <span class="preview-value">{node.currentModel?.name}</span>
      </div>
      <div class="preview-row">
        <label>Size:</label>
        <span class="preview-value">{node.props.width.value}×{node.props.height.value}</span>
      </div>
      <div class="preview-row">
        <label>Seed:</label>
        <span class="preview-value">
          {node.getEffectiveSeed() === -1 ? 'Random' : node.getEffectiveSeed()}
          {#if node.inputs[4]?.isConnected}(from input){/if}
        </span>
      </div>
      {#if node.collectReferences().length > 0}
        <div class="preview-row">
          <label>References:</label>
          <div class="preview-refs">
            {#each node.collectReferences() as ref}
              <span class="ref-badge">{ref.type} ({ref.strength})</span>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </section>

  <!-- Current Generation Grid -->
  {#if currentBatch}
    <section class="current-generation">
      <GenerationGrid 
        batch={currentBatch}
        selectedIndex={currentBatch.selectedIndex}
        onSelect={(index) => node.selectResult(currentBatch.id, index)}
      />
    </section>
  {/if}
  
  <!-- Action Buttons -->
  <section class="actions">
    <button 
      class="primary"
      on:click={() => node.generate()}
      disabled={node.isGenerating}
    >
      {node.isGenerating ? 'Generating...' : 'Generate'}
    </button>
  </section>
  
  <!-- Tip for variations -->
  {#if currentBatch?.selectedIndex != null}
    <p class="tip">💡 Use a <strong>Vary</strong> node to create variations of the selected result.</p>
  {/if}
  
  <!-- Standard Parameters (rendered by Inspector) -->
  <!-- ... model, batchSize, prompt, etc ... -->
  
  <!-- History (collapsible) - lazy loads thumbnails on open -->
  {#if historyBatches.length > 0}
    <details class="history-section" on:toggle={(e) => e.target.open && onHistoryOpen()}>
      <summary>History ({historyBatches.length} batches)</summary>
      
      <div class="history-list">
        {#each historyBatches as batch}
          <div class="history-item">
            <div class="history-thumbnails">
              {#each batch.results.slice(0, 4) as result}
                {#if result.thumbnailUrl}
                  <img 
                    src={result.thumbnailUrl} 
                    alt="History"
                    on:click={() => {
                      node.history.currentBatchId = batch.id;
                      node.selectResult(batch.id, batch.results.indexOf(result));
                    }}
                  />
                {:else}
                  <div class="thumbnail-placeholder"></div>
                {/if}
              {/each}
            </div>
            <span class="history-time">
              {formatRelativeTime(batch.results[0]?.timestamp)}
            </span>
          </div>
        {/each}
      </div>
    </details>
  {/if}
</div>
```

---

## Cache System

```typescript
// src/services/genai/GenerationCache.ts

class GenerationCache {
  private static readonly CACHE_VERSION = 1;
  
  // Ensure cache directory exists in project
  static async ensureCacheDir(projectDir: string, nodeId: string): Promise<string> {
    const cacheDir = `${projectDir}/cache/generate/${nodeId}`;
    await this.ensureDirectory(cacheDir);
    return cacheDir;
  }
  
  static async saveImage(
    cacheDir: string, 
    filename: string, 
    image: ImageBuffer
  ): Promise<void> {
    const path = `${cacheDir}/${filename}`;
    const canvas = image.toCanvas();
    const blob = await new Promise<Blob>((resolve) => 
      canvas.toBlob(resolve, 'image/png')
    );
    
    // Using File System Access API or server endpoint
    await this.writeFile(path, blob);
  }
  
  static async saveThumbnail(
    cacheDir: string,
    filename: string,
    image: ImageBuffer,
    maxSize: number
  ): Promise<void> {
    // Resize to thumbnail
    const aspect = image.width / image.height;
    const width = aspect >= 1 ? maxSize : Math.round(maxSize * aspect);
    const height = aspect >= 1 ? Math.round(maxSize / aspect) : maxSize;
    
    const thumb = image.resize(width, height);
    
    const canvas = thumb.toCanvas();
    const blob = await new Promise<Blob>((resolve) => 
      canvas.toBlob(resolve, 'image/jpeg', 0.8)
    );
    
    await this.writeFile(`${cacheDir}/${filename}`, blob);
  }
  
  static async saveMetadata(cacheDir: string, batch: GenerationBatch): Promise<void> {
    const metadata = {
      version: this.CACHE_VERSION,
      batch: {
        ...batch,
        results: batch.results.map(r => ({
          ...r,
          imageBuffer: undefined,  // Don't serialize image data
          thumbnailUrl: `${r.id}_thumb.jpg`,
          imageFile: `${r.id}.png`,
        })),
      },
    };
    
    await this.writeFile(
      `${cacheDir}/metadata.json`, 
      new Blob([JSON.stringify(metadata, null, 2)])
    );
  }
  
  static async loadHistory(cacheDir: string): Promise<GenerationHistory> {
    // Load all batch metadata from cache directory
    // Reconstruct GenerationHistory
    // Load thumbnails for UI display
    // Defer full image loading until needed
  }
  
  // Handle node rename - update cache directory
  static async renameNodeCache(
    projectDir: string, 
    oldId: string, 
    newId: string
  ): Promise<void> {
    const oldDir = `${projectDir}/cache/generate/${oldId}`;
    const newDir = `${projectDir}/cache/generate/${newId}`;
    await this.moveDirectory(oldDir, newDir);
  }
  
  // Clean up orphaned cache directories (nodes that no longer exist)
  static async cleanOrphanedCaches(
    projectDir: string, 
    existingNodeIds: Set<string>
  ): Promise<void> {
    const cacheRoot = `${projectDir}/cache/generate`;
    const dirs = await this.listDirectories(cacheRoot);
    
    for (const dir of dirs) {
      if (!existingNodeIds.has(dir)) {
        await this.removeDirectory(`${cacheRoot}/${dir}`);
      }
    }
  }
}
```

---

## Error Handling

AI operations can fail for many reasons. The system provides clear feedback and recovery options.

### Error Types

```typescript
enum AIErrorType {
  NO_API_KEY = 'no_api_key',
  INVALID_API_KEY = 'invalid_api_key',
  RATE_LIMITED = 'rate_limited',
  CONTENT_POLICY = 'content_policy',
  NETWORK_ERROR = 'network_error',
  TIMEOUT = 'timeout',
  MODEL_UNAVAILABLE = 'model_unavailable',
  INVALID_INPUT = 'invalid_input',
  INSUFFICIENT_CREDITS = 'insufficient_credits',
  UNKNOWN = 'unknown',
}

class AIError extends Error {
  constructor(
    public type: AIErrorType,
    message: string,
    public retryable: boolean = false,
    public retryAfterMs?: number
  ) {
    super(message);
  }
}
```

### Error UI

Errors display in multiple places:

1. **Node badge** - Red error indicator on node
2. **Inspector** - Full error message with actions
3. **Toast** - Brief notification for background failures

```svelte
<!-- ErrorDisplay.svelte (in inspector) -->
<script lang="ts">
  import type { AIError } from '$lib/services/ai/errors';
  
  export let error: AIError | null;
  export let onRetry: () => void;
  export let onDismiss: () => void;
</script>

{#if error}
  <div class="error-display" class:retryable={error.retryable}>
    <div class="error-icon">⚠️</div>
    <div class="error-content">
      <div class="error-message">{error.message}</div>
      
      {#if error.type === 'no_api_key'}
        <a href="#settings/api-keys" class="error-action">
          Configure API Key →
        </a>
      {:else if error.type === 'rate_limited' && error.retryAfterMs}
        <span class="error-hint">
          Retry available in {Math.ceil(error.retryAfterMs / 1000)}s
        </span>
      {:else if error.type === 'content_policy'}
        <span class="error-hint">
          Try rephrasing your prompt
        </span>
      {/if}
    </div>
    
    <div class="error-actions">
      {#if error.retryable}
        <button class="retry" on:click={onRetry}>Retry</button>
      {/if}
      <button class="dismiss" on:click={onDismiss}>✕</button>
    </div>
  </div>
{/if}
```

### Provider Error Mapping

Each provider maps API errors to AIError:

```typescript
// In ReplicateProvider
private mapError(error: any): AIError {
  if (error.status === 401) {
    return new AIError(AIErrorType.INVALID_API_KEY, 
      'Invalid Replicate API key. Check Settings > API Keys.');
  }
  if (error.status === 429) {
    const retryAfter = parseInt(error.headers?.['retry-after'] || '60') * 1000;
    return new AIError(AIErrorType.RATE_LIMITED,
      'Rate limit exceeded. Please wait before retrying.',
      true, retryAfter);
  }
  if (error.status === 422 && error.detail?.includes('safety')) {
    return new AIError(AIErrorType.CONTENT_POLICY,
      'Content blocked by safety filter. Try a different prompt.');
  }
  // ... more mappings
  
  return new AIError(AIErrorType.UNKNOWN, 
    error.message || 'An unexpected error occurred', true);
}
```

### Retry Logic

```typescript
// In AINodeMixin
protected async withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 2
): Promise<T> {
  let lastError: AIError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof AIError ? error : 
        new AIError(AIErrorType.UNKNOWN, error.message, true);
      
      if (!lastError.retryable || attempt === maxRetries) {
        throw lastError;
      }
      
      // Wait before retry (exponential backoff)
      const delay = lastError.retryAfterMs || (1000 * Math.pow(2, attempt));
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}
```

---

## Global Generation History

A panel showing all generations from the current session, across all nodes.

### GenerationHistoryPanel.svelte

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { GenerationManager } from '$lib/services/ai/GenerationManager';
  import type { GenerationBatch, GenerationResult } from '$lib/types';
  
  interface HistoryEntry {
    nodeId: string;
    nodeName: string;
    nodeType: string;
    batch: GenerationBatch;
    timestamp: Date;
  }
  
  let history: HistoryEntry[] = [];
  let filter: 'all' | 'images' | 'text' = 'all';
  let unsubscribe: () => void;
  
  onMount(() => {
    const manager = GenerationManager.getInstance();
    unsubscribe = manager.subscribeToHistory((entries) => {
      history = entries;
    });
  });
  
  onDestroy(() => unsubscribe?.());
  
  $: filteredHistory = history.filter(entry => {
    if (filter === 'all') return true;
    if (filter === 'images') return entry.nodeType.startsWith('lens/');
    if (filter === 'text') return entry.nodeType.startsWith('quill/');
    return true;
  });
  
  function focusNode(nodeId: string) {
    graph.selectElement(nodeId);
    graph.panToElement(nodeId);
  }
  
  function useResult(entry: HistoryEntry, result: GenerationResult) {
    // Copy result to clipboard or create annotation
  }
</script>

<div class="history-panel">
  <header>
    <h3>Generation History</h3>
    <div class="filters">
      <button class:active={filter === 'all'} on:click={() => filter = 'all'}>All</button>
      <button class:active={filter === 'images'} on:click={() => filter = 'images'}>Images</button>
      <button class:active={filter === 'text'} on:click={() => filter = 'text'}>Text</button>
    </div>
  </header>
  
  <div class="history-list">
    {#each filteredHistory as entry (entry.batch.id)}
      <div class="history-entry">
        <div class="entry-header">
          <button class="node-link" on:click={() => focusNode(entry.nodeId)}>
            {entry.nodeName}
          </button>
          <span class="timestamp">{formatTime(entry.timestamp)}</span>
        </div>
        
        <div class="entry-results">
          {#if entry.nodeType.startsWith('lens/')}
            <!-- Image results as thumbnail grid -->
            <div class="thumbnail-grid">
              {#each entry.batch.results as result}
                <img 
                  src={result.thumbnailUrl}
                  alt="Result"
                  class:selected={result === entry.batch.results[entry.batch.selectedIndex]}
                  on:click={() => useResult(entry, result)}
                />
              {/each}
            </div>
          {:else}
            <!-- Text results -->
            <div class="text-result">
              {entry.batch.results[0]?.text?.slice(0, 200)}...
            </div>
          {/if}
        </div>
      </div>
    {/each}
    
    {#if filteredHistory.length === 0}
      <div class="empty-state">
        No generations yet. Create a Generate node and click Generate!
      </div>
    {/if}
  </div>
</div>

<style>
  .history-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--panel-bg);
  }
  
  header {
    padding: 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .filters {
    display: flex;
    gap: 4px;
  }
  
  .filters button {
    padding: 4px 8px;
    border-radius: 4px;
    background: transparent;
    border: 1px solid var(--border);
  }
  
  .filters button.active {
    background: var(--accent);
    color: white;
  }
  
  .history-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }
  
  .history-entry {
    background: var(--surface);
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 8px;
  }
  
  .entry-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  
  .node-link {
    color: var(--accent);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }
  
  .node-link:hover {
    text-decoration: underline;
  }
  
  .timestamp {
    color: var(--text-muted);
    font-size: 12px;
  }
  
  .thumbnail-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
    gap: 4px;
  }
  
  .thumbnail-grid img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 4px;
    cursor: pointer;
    border: 2px solid transparent;
  }
  
  .thumbnail-grid img.selected {
    border-color: var(--accent);
  }
  
  .thumbnail-grid img:hover {
    opacity: 0.8;
  }
  
  .text-result {
    font-size: 13px;
    color: var(--text);
    line-height: 1.4;
  }
  
  .empty-state {
    text-align: center;
    color: var(--text-muted);
    padding: 32px;
  }
</style>
```

### GenerationManager History Tracking

```typescript
// Add to GenerationManager class

interface HistoryEntry {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  batch: GenerationBatch;
  timestamp: Date;
}

class GenerationManager {
  // ... existing code ...
  
  private history: HistoryEntry[] = [];
  private historyListeners = new Set<(entries: HistoryEntry[]) => void>();
  private maxHistorySize = 100;  // Keep last 100 generations
  
  // Record a completed generation
  recordGeneration(nodeId: string, nodeName: string, nodeType: string, batch: GenerationBatch): void {
    const entry: HistoryEntry = {
      nodeId,
      nodeName,
      nodeType,
      batch,
      timestamp: new Date(),
    };
    
    this.history.unshift(entry);
    
    // Trim to max size
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(0, this.maxHistorySize);
    }
    
    this.notifyHistoryListeners();
  }
  
  subscribeToHistory(callback: (entries: HistoryEntry[]) => void): () => void {
    this.historyListeners.add(callback);
    callback(this.history);  // Initial call with current history
    return () => this.historyListeners.delete(callback);
  }
  
  private notifyHistoryListeners(): void {
    for (const listener of this.historyListeners) {
      listener(this.history);
    }
  }
  
  clearHistory(): void {
    this.history = [];
    this.notifyHistoryListeners();
  }
}
```

---

## Keyboard Shortcuts

Keyboard shortcuts for efficient exploration workflows.

### AI Generation Shortcuts

| Shortcut | Action | Context |
|----------|--------|---------|
| `G` | Generate | AI node selected |
| `Shift+G` | Generate on all selected AI nodes | Multiple AI nodes selected |
| `Escape` | Cancel generation | AI node generating |
| `1-9` | Select result 1-9 in grid | AI node with results selected |
| `R` | Re-roll all Random nodes | Any |
| `F` | Capture + freeze | Freeze node selected |
| `L` | Toggle lock on Random node | Random node selected |

### Curation Shortcuts

| Shortcut | Action | Context |
|----------|--------|---------|
| `S` | Toggle star (★) | Result or node selected |
| `X` | Mark rejected (✗) | Result or node selected |
| `H` | Hide/show rejected | Canvas |
| `Cmd+Shift+S` | Collect all starred into artboard | Canvas |

### Display Mode Shortcuts

| Shortcut | Action | Context |
|----------|--------|---------|
| `T` | Cycle display mode (thumbnail → grid → minimal → box) | Visual node selected |
| `Cmd+1` | Thumbnail mode | Visual node selected |
| `Cmd+2` | Grid mode | Visual node selected |
| `Cmd+3` | Minimal mode | Visual node selected |
| `Cmd+4` | Box mode | Visual node selected |

### Artboard Shortcuts

| Shortcut | Action | Context |
|----------|--------|---------|
| `Cmd+G` | Group selected into artboard | Elements selected |
| `Cmd+Shift+G` | Ungroup (dissolve artboard) | Artboard selected |
| `Enter` | Enter artboard (zoom to fit) | Artboard selected |
| `Escape` | Exit artboard | Inside artboard |
| `C` | Toggle collapse | Artboard selected |

### Implementation

```typescript
// src/editor/KeyboardShortcuts.ts

class AIKeyboardShortcuts {
  constructor(private graph: Graph, private editor: Editor) {
    this.setupShortcuts();
  }
  
  private setupShortcuts(): void {
    document.addEventListener('keydown', this.handleKeydown.bind(this));
  }
  
  private handleKeydown(e: KeyboardEvent): void {
    // Skip if typing in input/textarea
    if (this.isTyping(e)) return;
    
    const selected = this.editor.getSelectedElements();
    const firstNode = selected.find(el => el instanceof Node);
    
    switch (e.key.toLowerCase()) {
      case 'g':
        if (e.shiftKey) {
          this.generateAllSelected(selected);
        } else if (firstNode && this.isAINode(firstNode)) {
          firstNode.generate();
        }
        e.preventDefault();
        break;
        
      case 'escape':
        if (this.editor.isInsideArtboard()) {
          this.editor.exitArtboard();
        } else {
          this.cancelAllGenerating();
        }
        break;
        
      case 'r':
        this.rerollAllRandom();
        e.preventDefault();
        break;
        
      case 'f':
        if (firstNode?.type === 'core/Freeze') {
          firstNode.capture();
        }
        e.preventDefault();
        break;
        
      case 'l':
        if (firstNode?.type === 'core/Random') {
          firstNode.props.lock.value = !firstNode.props.lock.value;
        }
        e.preventDefault();
        break;
        
      case 's':
        if (e.metaKey && e.shiftKey) {
          this.collectStarred();
        } else if (!e.metaKey) {
          this.toggleStar(selected);
        }
        e.preventDefault();
        break;
        
      case 'x':
        this.toggleRejected(selected);
        e.preventDefault();
        break;
        
      case 'h':
        this.editor.toggleHideRejected();
        e.preventDefault();
        break;
        
      case 't':
        if (firstNode && 'displayMode' in firstNode) {
          this.cycleDisplayMode(firstNode);
        }
        e.preventDefault();
        break;
        
      case 'c':
        if (firstNode?.type === 'annotation/Artboard') {
          firstNode.collapsed = !firstNode.collapsed;
        }
        e.preventDefault();
        break;
        
      case 'enter':
        if (firstNode?.type === 'annotation/Artboard') {
          this.editor.enterArtboard(firstNode);
        }
        e.preventDefault();
        break;
        
      default:
        // Number keys for result selection
        if (/^[1-9]$/.test(e.key) && firstNode && this.isAINode(firstNode)) {
          const index = parseInt(e.key) - 1;
          const batch = firstNode.history.batches.find(
            b => b.id === firstNode.history.currentBatchId
          );
          if (batch && index < batch.results.length) {
            firstNode.selectResult(batch.id, index);
          }
          e.preventDefault();
        }
    }
  }
  
  private isAINode(node: Node): boolean {
    return 'generate' in node && typeof node.generate === 'function';
  }
  
  private isTyping(e: KeyboardEvent): boolean {
    const target = e.target as HTMLElement;
    return target.tagName === 'INPUT' || 
           target.tagName === 'TEXTAREA' || 
           target.isContentEditable;
  }
  
  private generateAllSelected(elements: Element[]): void {
    const aiNodes = elements.filter(el => el instanceof Node && this.isAINode(el));
    for (const node of aiNodes) {
      node.generate();
    }
  }
  
  private cancelAllGenerating(): void {
    const manager = GenerationManager.getInstance();
    manager.cancelAll();
  }
  
  private rerollAllRandom(): void {
    const randomNodes = this.graph.getNodes().filter(
      n => n.type === 'core/Random'
    );
    for (const node of randomNodes) {
      if (!node.props.lock.value) {
        node.reroll();
      }
    }
  }
  
  private toggleStar(elements: Element[]): void {
    for (const el of elements) {
      if ('getResultStatus' in el && 'setResultStatus' in el) {
        const current = el.getResultStatus(el.selectedResultId);
        el.setResultStatus(el.selectedResultId, current === 'starred' ? 'none' : 'starred');
      }
    }
  }
  
  private toggleRejected(elements: Element[]): void {
    for (const el of elements) {
      if ('getResultStatus' in el && 'setResultStatus' in el) {
        const current = el.getResultStatus(el.selectedResultId);
        el.setResultStatus(el.selectedResultId, current === 'rejected' ? 'none' : 'rejected');
      }
    }
  }
  
  private collectStarred(): void {
    const starred = this.graph.getAllElements()
      .filter(el => 'resultStatuses' in el)
      .flatMap(el => {
        const statuses = (el as any).resultStatuses as Map<string, string>;
        return Array.from(statuses.entries())
          .filter(([_, status]) => status === 'starred')
          .map(([id, _]) => ({ element: el, resultId: id }));
      });
    
    if (starred.length === 0) return;
    
    const artboard = this.graph.createArtboard({
      name: `Starred (${starred.length})`,
      autoLayout: true,
      layoutMode: 'grid',
    });
    
    for (const { element, resultId } of starred) {
      const annotation = (element as any).extractResultToAnnotation(resultId);
      artboard.addChild(annotation.id);
    }
  }
  
  private cycleDisplayMode(node: Node): void {
    const modes = ['thumbnail', 'grid', 'minimal', 'box'];
    const current = modes.indexOf(node.displayMode);
    node.displayMode = modes[(current + 1) % modes.length];
  }
}
```

### Quick Reference Card

```
╔══════════════════════════════════════════════════════════════╗
║                    CASCADE AI SHORTCUTS                       ║
╠══════════════════════════════════════════════════════════════╣
║  GENERATION                                                   ║
║  G          Generate on selected node                         ║
║  Shift+G    Generate on ALL selected nodes                    ║
║  Escape     Cancel generations / Exit artboard                ║
║  1-9        Select result 1-9 in grid                         ║
║  R          Re-roll all unlocked Random nodes                 ║
║                                                               ║
║  CURATION                                                     ║
║  S          Toggle star (★) on selected                       ║
║  X          Toggle rejected (✗) on selected                   ║
║  H          Hide/show rejected results                        ║
║  ⌘⇧S        Collect all starred into artboard                 ║
║                                                               ║
║  DISPLAY                                                      ║
║  T          Cycle display mode                                ║
║  F          Capture + freeze                                  ║
║  L          Toggle lock on Random node                        ║
║                                                               ║
║  ARTBOARDS                                                    ║
║  ⌘G         Group into artboard                               ║
║  ⌘⇧G        Ungroup (dissolve artboard)                       ║
║  Enter      Enter artboard                                    ║
║  C          Collapse/expand artboard                          ║
╚══════════════════════════════════════════════════════════════╝
```

---

## Settings Integration

Add to existing Settings panel:

```typescript
// In SettingsStore.ts or UserPreferences

interface GenAISettings {
  // API Keys (stored securely, never in graph files)
  replicate_api_key?: string;
  fal_api_key?: string;
  google_ai_api_key?: string;
  openai_api_key?: string;
  
  // Defaults
  default_image_model: string;
  default_llm_model: string;
  default_batch_size: number;
}
```

Settings UI section:

```svelte
<section class="settings-section">
  <h3>Generative AI</h3>
  
  <div class="api-keys">
    <h4>API Keys</h4>
    <p class="hint">Keys are stored locally and never shared in project files.</p>
    
    <label>
      Replicate
      <input type="password" bind:value={$settings.replicate_api_key} />
      <a href="https://replicate.com/account" target="_blank">Get key</a>
    </label>
    
    <label>
      Fal.ai
      <input type="password" bind:value={$settings.fal_api_key} />
      <a href="https://fal.ai/dashboard/keys" target="_blank">Get key</a>
    </label>
    
    <label>
      Google AI
      <input type="password" bind:value={$settings.google_ai_api_key} />
      <a href="https://aistudio.google.com/apikey" target="_blank">Get key</a>
    </label>
    
    <label>
      OpenAI
      <input type="password" bind:value={$settings.openai_api_key} />
      <a href="https://platform.openai.com/api-keys" target="_blank">Get key</a>
    </label>
  </div>
  
  <div class="defaults">
    <h4>Defaults</h4>
    
    <label>
      Default Image Model
      <select bind:value={$settings.default_image_model}>
        {#each imageModels as model}
          <option value={model.id}>{model.name}</option>
        {/each}
      </select>
    </label>
    
    <label>
      Default Batch Size
      <input type="number" min="1" max="9" bind:value={$settings.default_batch_size} />
    </label>
  </div>
</section>
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Provider abstraction (`Provider.ts`, `ProviderRegistry.ts`)
- [ ] Replicate provider with async polling
- [ ] GenerationManager for parallel generation + global history tracking
- [ ] AINodeMixin for shared AI functionality
- [ ] **lens/Generate** with seed input/output + seedOffset + 🎲 Vary button
- [ ] **quill/Text** (constant + template modes)
- [ ] **core/Random** (seed + choice modes)
- [ ] Settings UI for API keys
- [ ] Basic cache system (project-relative)
- [ ] Status bar generation indicator

### Phase 2: Visual Canvas & Grid (Week 3-4)
- [ ] ThumbnailNodeMixin for visual node rendering
- [ ] ThumbnailNode component (image as node body)
- [ ] GridNode component (batch results in node)
- [ ] Node display modes (box/thumbnail/grid/minimal)
- [ ] Result status system (starred/approved/rejected/reference)
- [ ] Grid cell interactions (click select, drag extract, context menu)
- [ ] "Promote to Node" action
- [ ] "Extract to Annotation" action
- [ ] Keyboard shortcuts (G, R, L, S, X, 1-9)
- [ ] Display mode toggle (T key, context menu)

### Phase 3: History & Curation (Week 5)
- [ ] Generation history per node
- [ ] Global GenerationHistoryPanel
- [ ] Thumbnail caching
- [ ] Cache restoration on project load
- [ ] "Collect Starred" smart collection
- [ ] Batch status operations (star all, reject all)

### Phase 4: Artboards & Organization (Week 6)
- [ ] Artboard annotation type
- [ ] Artboard component (expanded/collapsed)
- [ ] Auto-layout modes (grid/row/column/free)
- [ ] Group to artboard (Cmd+G)
- [ ] Ungroup/dissolve artboard
- [ ] Enter/exit artboard navigation
- [ ] Collapsed artboard summary

### Phase 5: Edit & Text AI (Week 7)
- [ ] **lens/Edit** with inpaint/instruct/outpaint modes
- [ ] **quill/Describe** with vision models
- [ ] **quill/Enhance** with LLM integration
- [ ] **core/Select** (pick from array)
- [ ] **core/Freeze** for locking values
- [ ] Google and OpenAI provider support

### Phase 6: Canvas Connections & Polish (Week 8)
- [ ] ConnectableElement interface
- [ ] Text annotation → string input connections
- [ ] Image annotation → image input connections
- [ ] Reference image inputs on Generate
- [ ] Mask painting UI for Edit node
- [ ] Error handling and retry logic
- [ ] Documentation

---

## Future Considerations

### Video Generation
- lens/GenerateVideo - Same architecture, different providers (Runway, Pika, etc.)
- Frame-by-frame preview during generation
- Output as video file or image sequence

### Upscaling & Enhancement
- lens/Upscale with multiple algorithms
- Super-resolution models (Real-ESRGAN, etc.)
- Face enhancement

### LoRA & Custom Models
- Support for custom-trained models on Replicate
- LoRA weight management
- CivitAI integration

### Parameter Sweeps (v2)
- core/Range - Generate number sequences
- core/ForEach - Run operation N times with different values
- Useful for systematic exploration but adds complexity

### Compare Node (v2)
- core/Compare - Side-by-side image comparison in single output
- Alternative: use multiple Viewer panels or Composite node

---

## Example Workflows

These examples demonstrate how the node-graph approach enables powerful exploration workflows.

### 1. Reproducible Seed Exploration

```
┌────────────┐     ┌──────────┐
│ Random     │────▶│ Generate │──▶ image
│ mode: seed │     │          │
│ 🔒 locked  │     └──────────┘
│ [🎲 reroll]│            │
└────────────┘            │ seed
                          ▼
                    [saved: 42]
```

**Flow:** Random generates seed → Generate uses it → Like the result? Lock 🔒 → Seed persists across regenerations.

**Keyboard:** `R` to reroll all unlocked Random nodes, `L` to toggle lock.

### 2. Same Seed, Multiple Models (A/B Testing)

```
┌────────────┐     ┌─────────────────┐
│ Random     │──┬─▶│ Generate (Flux) │──┐
│ mode: seed │  │  └─────────────────┘  │
└────────────┘  │                       │    ┌───────────┐
                │  ┌─────────────────┐  ├───▶│ Composite │──▶ side-by-side
┌────────┐      └─▶│ Generate (SDXL) │──┘    │           │
│ Text   │────────▶│                 │       └───────────┘
│ "cat"  │         └─────────────────┘
└────────┘
```

**Flow:** Same seed + same prompt to different models → Composite shows side-by-side → Fair comparison.

### 3. Style Exploration with Random Choice

```
┌──────────────────┐
│ Random           │
│ mode: choice     │
│ "watercolor      │──────────┐
│  oil painting    │          │
│  pencil sketch"  │          │
│ [🎲 Reroll]      │          ▼
└──────────────────┘     ┌─────────────────────┐
                         │ Text                │──▶ Generate
┌────────┐               │ "a {subject}        │
│ Text   │──────────────▶│  in {style} style"  │
│ "cat"  │               └─────────────────────┘
└────────┘
```

**Flow:** Random picks a style → Text template combines with subject → Generate. Click 🎲 to try a different style instantly.

**Keyboard:** `R` to reroll, `L` to lock when you find a good style.

### 4. Variation via Seed Offset

```
┌────────┐     ┌──────────┐     ┌───────────────────┐
│ Text   │────▶│ Generate │────▶│ Generate          │
│        │     │          │     │ seedOffset: 10    │
└────────┘     │     seed─┼────▶│ seed input        │
               │    image─┼────▶│ style reference   │
               └──────────┘     └───────────────────┘
                    │                    │
                    ▼                    ▼
               [original]          [variation]
```

**Flow:** Connect Generate's seed and image outputs to another Generate's inputs → Set seed offset → Generates related variations.

### 5. Locking Results with Freeze

```
┌────────┐     ┌──────────┐     ┌────────┐     ┌───────────┐
│ Text   │────▶│ Generate │────▶│ Freeze │────▶│ Composite │
│        │     │          │     │ ❄️     │     │           │
└────────┘     └──────────┘     └────────┘     └───────────┘
                                                     ▲
┌────────┐     ┌──────────┐                          │
│ Text   │────▶│ Generate │──────────────────────────┘
│ (v2)   │     │          │
└────────┘     └──────────┘
```

**Flow:** Generate first image → Freeze it → Experiment with second image freely → Frozen image stays stable.

**Keyboard:** `F` to toggle freeze.

### 6. Auto-Enhanced Prompts

```
┌────────┐     ┌─────────┐     ┌──────────┐
│ Text   │────▶│ Enhance │────▶│ Generate │
│        │     │ ☑️ auto │     │          │
└────────┘     └─────────┘     └──────────┘
```

**Flow:** Enhance has auto-run enabled → Edit the Text → Enhancement runs automatically after 500ms → Ready to Generate.

### 7. Full Exploration Setup

```
┌────────────┐     
│ Random     │──────────────────────────────────┐
│ mode: seed │                                  │
│ 🔒         │                                  │
└────────────┘                                  │
                                                ▼
┌──────────────────┐                       ┌──────────┐
│ Random           │──────┐                │          │
│ mode: choice     │      │                │ Generate │──▶ Freeze
│ styles...        │      ▼                │          │
└──────────────────┘  ┌──────────────┐     └──────────┘
                      │ Text         │──────────▲
┌──────────────────┐  │ "{subject}   │
│ Random           │──┤  in {style}" │
│ mode: choice     │  └──────────────┘
│ subjects...      │
└──────────────────┘
```

**Flow:** Two Random (choice mode) for style/subject → Text combines → Generate with shared seed.

**Keyboard workflow:**
1. `R` - Reroll all random nodes (new style + subject combo)
2. `G` - Generate
3. Like it? `L` to lock the random nodes
4. `F` to freeze the result

---

### 8. Style Transfer with Description

```
┌─────────────────┐     ┌──────────┐     ┌─────────────────┐
│ [Style Image]   │────▶│ Describe │────▶│ Text            │
│ (annotation)    │     │ ☑️ auto  │     │ "{style}        │──▶ Generate
└─────────────────┘     └──────────┘  ┌─▶│  {subject}"     │
                                      │  └─────────────────┘
┌─────────────────┐                   │
│ Text            │───────────────────┘
│ "a warrior"     │
└─────────────────┘
```

**Flow:** Drag style image to canvas → Describe auto-runs → Text combines with subject → Generate.

### 9. Iterative Refinement with Seed Tracking

```
┌────────────┐     ┌──────────┐           ┌──────┐
│ Random     │────▶│ Generate │──image───▶│ Edit │──▶ final
│ mode: seed │     │          │           │      │
└────────────┘     └──────────┘           └──────┘
                        │                     │
                        │ seed                │ seed
                        ▼                     ▼
                   [1847293]             [1847293]
                   
                   Like it? Lock the Random node!
```

**Flow:** Random drives Generate → Edit refines → Both seed outputs match → Can recreate exact pipeline.

---

## Why Node-Graph for AI Exploration?

| Traditional UI | Node-Graph |
|----------------|------------|
| Settings buried in panels | Parameters visible in graph |
| One generation at a time | Parallel generations |
| Copy/paste to compare | Composite or multiple viewers |
| Manual seed entry | Random node with lock |
| Lost when you change prompt | Freeze preserves results |
| Can't see what affects what | Connections show data flow |
| Hard to A/B test | Same seed to multiple nodes |

**The graph IS your exploration history** - every experiment is visible, reproducible, and tweakable.
