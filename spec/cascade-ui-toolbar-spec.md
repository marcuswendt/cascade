# Cascade UI Specification: Toolbar & Presentation Mode

## Overview

Cascade features a **FigJam-style bottom toolbar** for quick access to all node types, plus a **presentation mode** (⌘.) that hides UI chrome while keeping the inspector accessible when nodes are selected.

---

## Bottom Toolbar Design

### Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Canvas Area (Graph View)                             │
│                                                                               │
│                        [Nodes appear here]                                    │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────────┐
│  [Select] [Hand] │ [Input] [Math] [Lens] [3D] [Audio] [Logic] [Output] │ [⚙]│
└──────────────────────────────────────────────────────────────────────────────┘
     Tools              Node Categories (expandable)                    Settings
```

### Visual Style

- **Position**: Fixed at bottom, always visible (unless in presentation mode)
- **Height**: 56px
- **Background**: Semi-transparent dark (rgba(20, 20, 20, 0.95))
- **Blur**: Backdrop blur for depth
- **Border**: 1px top border (rgba(255, 255, 255, 0.1))
- **Shadow**: Subtle top shadow for elevation
- **Padding**: 8px horizontal

---

## Toolbar Sections

### 1. Selection Tools (Left)

```
┌─────────┬─────────┐
│  [↖]   │  [✋]   │
│ Select  │  Hand   │
└─────────┴─────────┘
```

- **Select Tool** (↖) - Default, hotkey: V
  - Click nodes to select
  - Drag to create selection rectangle
  - Shift+click for multi-select
  
- **Hand Tool** (✋) - Panning, hotkey: H or Space (hold)
  - Drag canvas to pan
  - Scroll wheel to zoom

### 2. Node Categories (Center)

Each category button opens a **quick-add panel** above the toolbar:

```
┌──────────────────────────────────────────────────┐
│  Input Nodes                              [×]    │
│  ┌─────────┬─────────┬─────────┬─────────┐      │
│  │  [📸]   │  [🎤]   │  [⌨️]   │  [🖱️]   │      │
│  │ Image   │ Audio   │Keyboard │ Mouse   │      │
│  └─────────┴─────────┴─────────┴─────────┘      │
│  ┌─────────┬─────────┬─────────┬─────────┐      │
│  │  [⏱️]   │  [📁]   │  [🌐]   │  [📊]   │      │
│  │ Timer   │  File   │  URL    │  Data   │      │
│  └─────────┴─────────┴─────────┴─────────┘      │
└──────────────────────────────────────────────────┘
```

**Categories:**

#### **Input** 📥
- Image Loader
- Audio Input
- Video Capture
- Keyboard
- Mouse/Touch
- Gamepad
- Timer/Clock
- File Loader
- URL Fetch
- Random
- Noise Generator
- Data Source

#### **Math** ➕
- Add/Subtract/Multiply/Divide
- Sine/Cosine/Tan
- Min/Max/Clamp
- Remap/Map Range
- Round/Floor/Ceil
- Vector Math (2D/3D)
- Matrix Operations
- Interpolate (Lerp/Smoothstep)
- Modulo
- Expression Evaluator

#### **Lens** 🎨 (Image Processing)
- Blur (Gaussian/Box/Motion)
- Brightness/Contrast
- Hue/Saturation
- Color Grading
- Threshold
- Edge Detection
- Convolve
- Blend Modes
- Distortion
- Feedback
- Chromatic Aberration
- Vignette

#### **3D** 🎲
- Three.js Scene
- Camera
- Mesh/Geometry
- Material
- Light
- Model Loader (GLTF/OBJ)
- Shader
- Raymarcher
- Point Cloud
- Particles 3D

#### **Audio** 🔊
- Oscillator
- FFT Analyzer
- Peak Detector
- Beat Detection
- Audio Player
- Tone.js Synth
- Filter
- Reverb/Delay
- Compressor
- Waveform Visualizer

#### **Logic** 🔀
- If/Else
- Switch/Case
- Compare (==, >, <, etc.)
- Gate (AND/OR/NOT)
- Trigger Once
- Trigger Sequence
- Counter
- Accumulator
- Delay
- Throttle
- Debounce
- State Machine

#### **Output** 📤
- Canvas Viewer
- Image Export
- Video Recorder
- Console Log
- HTTP POST
- WebSocket Send
- File Download
- Screenshot
- Stats Display

#### **Custom** ⚡
- My Custom Nodes
- Recent
- Favorites
- NPM Search...

---

## Node Category Panel Behavior

### Opening
```typescript
// Click "Math" button
<bottom-toolbar>
  <category-button @click="openPanel('math')">
    Math
  </category-button>
</bottom-toolbar>

// Panel appears above toolbar
<node-panel category="math" position="above-toolbar">
  <node-grid>
    {mathNodes.map(node => <NodeCard node={node} />)}
  </node-grid>
</node-panel>
```

### Panel Features
- **Auto-close**: Clicks outside panel or ESC key
- **Search**: Type to filter nodes in current category
- **Drag-to-add**: Drag node card onto canvas
- **Click-to-add**: Click node → cursor becomes "ghost node" → click canvas to place
- **Favorites**: Star icon to add to Custom/Favorites
- **Recent**: Last 10 used nodes appear in Custom section

### Node Card Design
```
┌─────────────────┐
│      [📸]       │  ← Icon (emoji or SVG)
│   Image Loader  │  ← Name
│   Load images   │  ← Description (1 line)
│   from assets   │
│                 │
│   ⭐ 89        │  ← Favorite count
└─────────────────┘
     120×140px
```

---

## Presentation Mode (⌘.)

### Toggle Behavior

**Default View (Normal Mode):**
```
┌──────────────────────────────────────────────────────────┐
│  [File] [Edit] [View]              [Assets] [?]          │ ← Top Bar
├──────────────────────────────────────────────────────────┤
│ Layers │                                    │ Inspector  │
│        │        Canvas Area                 │            │
│  [+]   │                                    │  [props]   │
│  Node1 │                                    │            │
│  Node2 │                                    │            │
└────────┴────────────────────────────────────┴────────────┘
└──────────────────────────────────────────────────────────┘
│          Bottom Toolbar (Node Categories)                │
└──────────────────────────────────────────────────────────┘
```

**Presentation Mode (⌘.):**
```
┌──────────────────────────────────────────────────────────┐
│                                                           │
│                                                           │
│                                                           │
│                     Canvas Area                           │
│                   (Full Screen)                          │
│                                                           │
│                                                           │
│                                                           │
└──────────────────────────────────────────────────────────┘

                    (All toolbars hidden)
```

**Presentation Mode + Node Selected:**
```
┌──────────────────────────────────────────────────────────┐
│                                                           │
│                  Canvas Area             │ Inspector     │
│                                          │               │
│          [Selected Node]                 │  ┌─────────┐ │
│                                          │  │ Value   │ │
│                                          │  │ [100]   │ │
│                                          │  ├─────────┤ │
│                                          │  │ Speed   │ │
│                                          │  │ [2.5]   │ │
│                                          │  └─────────┘ │
└──────────────────────────────────────────────────────────┘

            Inspector appears on selection
```

### Implementation

```typescript
// PresentationMode.svelte
<script>
  let presentationMode = false;
  let selectedNode = null;
  
  function togglePresentationMode() {
    presentationMode = !presentationMode;
  }
  
  // Keyboard shortcut
  onMount(() => {
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        togglePresentationMode();
      }
    });
  });
</script>

<div class="cascade-app" class:presentation-mode={presentationMode}>
  {#if !presentationMode}
    <TopBar />
    <LeftPanel />
    <BottomToolbar />
  {/if}
  
  <Canvas bind:selectedNode />
  
  {#if presentationMode && selectedNode}
    <Inspector node={selectedNode} position="right" />
  {/if}
</div>

<style>
  .cascade-app.presentation-mode {
    /* Full screen canvas */
    --top-bar-height: 0;
    --left-panel-width: 0;
    --bottom-toolbar-height: 0;
  }
  
  .presentation-mode .canvas {
    width: 100%;
    height: 100vh;
  }
  
  .presentation-mode .inspector {
    position: fixed;
    right: 0;
    top: 0;
    height: 100vh;
    width: 300px;
    background: rgba(20, 20, 20, 0.95);
    backdrop-filter: blur(10px);
    animation: slideIn 0.2s ease;
  }
  
  @keyframes slideIn {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(0);
    }
  }
</style>
```

---

## Complete Keyboard Shortcuts

### Tools
- **V** - Select tool
- **H** - Hand tool (or hold Space)
- **Tab** - Quick search (node search)

### Canvas
- **⌘+** / **⌘-** - Zoom in/out
- **⌘0** - Reset zoom to 100%
- **⌘1** - Fit all nodes
- **⌘2** - Fit selected nodes
- **Space + Drag** - Pan canvas

### Nodes
- **⌘D** - Duplicate selected
- **Delete** / **Backspace** - Delete selected
- **⌘C** / **⌘V** - Copy/Paste
- **⌘G** - Group selected
- **⌘Shift+G** - Ungroup
- **Double-click node** - Edit code
- **Shift+Enter** - Compile/Run (in code editor)

### View
- **⌘.** - Toggle presentation mode
- **⌘B** - Toggle bottom toolbar
- **⌘/** - Toggle left panel
- **⌘;** - Toggle right inspector
- **⌘\** - Toggle all panels (zen mode)

### Execution
- **⌘Enter** - Run graph
- **⌘Shift+Enter** - Run from selected node
- **⌘K** - Stop execution
- **⌘R** - Reset all nodes

---

## Bottom Toolbar States

### Default State
```css
.bottom-toolbar {
  height: 56px;
  background: rgba(20, 20, 20, 0.95);
  backdrop-filter: blur(10px);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  transform: translateY(0);
  transition: transform 0.3s ease;
}
```

### Hidden State (Presentation Mode)
```css
.bottom-toolbar.hidden {
  transform: translateY(100%);
}
```

### Active Category
```css
.category-button.active {
  background: rgba(66, 133, 244, 0.2);
  border-top: 2px solid #4285f4;
}
```

---

## Node Panel Variants

### Compact Grid (Default)
```
┌───┬───┬───┬───┬───┬───┐
│ 1 │ 2 │ 3 │ 4 │ 5 │ 6 │
├───┼───┼───┼───┼───┼───┤
│ 7 │ 8 │ 9 │10 │11 │12 │
└───┴───┴───┴───┴───┴───┘
  120×140px cards, 6 columns
```

### List View (Search Active)
```
┌──────────────────────────────────┐
│ 🔍 [blur___________]        [×] │
├──────────────────────────────────┤
│ [🎨] Gaussian Blur              │
│      Smooth blur effect          │
├──────────────────────────────────┤
│ [🎨] Box Blur                   │
│      Fast box blur               │
├──────────────────────────────────┤
│ [🎨] Motion Blur                │
│      Directional blur            │
└──────────────────────────────────┘
```

### Favorites (Custom Tab)
```
┌──────────────────────────────────┐
│  Custom & Favorites         [×]  │
├──────────────────────────────────┤
│  ⭐ Your Favorites               │
│  ┌───┬───┬───┬───┐              │
│  │ 1 │ 2 │ 3 │ 4 │              │
│  └───┴───┴───┴───┘              │
│                                  │
│  📦 NPM Packages                 │
│  ┌─────────────────────────┐    │
│  │ [🔍] Search npm...      │    │
│  └─────────────────────────┘    │
│                                  │
│  📝 Recent                       │
│  ┌───┬───┬───┬───┐              │
│  │ 1 │ 2 │ 3 │ 4 │              │
│  └───┴───┴───┴───┘              │
└──────────────────────────────────┘
```

---

## Inspector in Presentation Mode

### Behavior Rules

1. **No Selection**: Inspector hidden
2. **Single Node Selected**: Inspector slides in from right
3. **Multiple Nodes**: Show common properties only
4. **Deselect**: Inspector slides out

### Inspector Layout (Presentation Mode)
```
┌────────────────────────┐
│  Node: FlowField       │
│  ────────────────────  │
│                        │
│  Width                 │
│  [■■■■■■──────] 800    │
│                        │
│  Height                │
│  [■■■■■────────] 600   │
│                        │
│  Scale                 │
│  [■────────────] 0.01  │
│                        │
│  Colors                │
│  [🎨] [🎨] [🎨]        │
│                        │
│  ┌──────────────────┐  │
│  │  Generate        │  │  ← Trigger button
│  └──────────────────┘  │
│                        │
│  [□] Show Preview      │  ← Checkbox
│                        │
└────────────────────────┘
```

### Auto-Hide Inspector
```typescript
// Optional: Auto-hide after delay
let inspectorTimeout: number;

function showInspector(node: Node) {
  clearTimeout(inspectorTimeout);
  selectedNode = node;
}

function scheduleHideInspector() {
  if (presentationMode) {
    inspectorTimeout = setTimeout(() => {
      if (!isHoveringInspector && !isEditingParam) {
        selectedNode = null;
      }
    }, 3000); // Hide after 3s of inactivity
  }
}
```

---

## Mobile/Tablet Considerations

### Bottom Toolbar on Touch Devices
```
┌──────────────────────────────────┐
│  [☰] [Input ▾] [Math ▾] [...▾]  │  ← Condensed, scrollable
└──────────────────────────────────┘
```

- Categories become dropdown menus
- Node panels full-screen on small devices
- Swipe down to close panel
- Tap canvas with 2 fingers for pan mode

---

## Animation Details

### Panel Slide-In
```css
@keyframes panelSlideIn {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.node-panel {
  animation: panelSlideIn 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
```

### Category Button Highlight
```css
.category-button:hover {
  background: rgba(255, 255, 255, 0.05);
  transform: translateY(-2px);
  transition: all 0.15s ease;
}

.category-button:active {
  transform: translateY(0);
}
```

### Ghost Node (Drag Placement)
```css
.ghost-node {
  position: fixed;
  pointer-events: none;
  opacity: 0.6;
  transform: scale(0.9);
  cursor: none;
  z-index: 9999;
}

.ghost-node.can-place {
  opacity: 1;
  transform: scale(1);
}

.ghost-node.cannot-place {
  opacity: 0.3;
  filter: grayscale(100%);
}
```

---

## Settings Panel (Right of Toolbar)

```
┌──────────────────────────────────┐
│  Settings                   [×]  │
├──────────────────────────────────┤
│  [□] Auto-save                   │
│  [□] Show grid                   │
│  [■] Snap to grid                │
│  [□] Show minimap                │
│  [■] Node previews               │
│  [□] Auto-compile                │
│                                  │
│  Theme                           │
│  ( ) Light                       │
│  (•) Dark                        │
│  ( ) High Contrast               │
│                                  │
│  Grid Size: [20] px              │
│  Zoom Speed: [■■■──] 1.0         │
│                                  │
│  ┌────────────────────────────┐  │
│  │  Reset to Defaults         │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

---

## Toolbar Context Menu (Right-Click)

Right-click on toolbar itself:
```
┌──────────────────────────────┐
│  Customize Toolbar           │
│  ────────────────            │
│  [■] Show Icons              │
│  [□] Show Labels             │
│  [■] Show Tooltips           │
│                              │
│  ─────────────────           │
│  Reset Toolbar Layout        │
│  Export Toolbar Config       │
│  Import Toolbar Config       │
└──────────────────────────────┘
```

---

## Implementation Files

### Component Structure
```
src/ui/
├── BottomToolbar.svelte           # Main toolbar
├── NodePanel.svelte               # Category panel
├── NodeCard.svelte                # Individual node card
├── InspectorPanel.svelte          # Property inspector
├── PresentationMode.svelte        # Wrapper component
└── ToolButton.svelte              # Reusable button
```

### State Management
```typescript
// src/stores/ui.store.ts
import { writable } from 'svelte/store';

export const uiState = writable({
  presentationMode: false,
  activeCategory: null,
  showBottomToolbar: true,
  showLeftPanel: true,
  showRightInspector: true,
  selectedNodes: [],
  currentTool: 'select'
});

export function togglePresentationMode() {
  uiState.update(state => ({
    ...state,
    presentationMode: !state.presentationMode,
    showBottomToolbar: state.presentationMode,
    showLeftPanel: state.presentationMode,
    showRightInspector: false
  }));
}
```

---

## Visual Design Tokens

```css
:root {
  /* Toolbar */
  --toolbar-height: 56px;
  --toolbar-bg: rgba(20, 20, 20, 0.95);
  --toolbar-border: rgba(255, 255, 255, 0.1);
  --toolbar-shadow: 0 -2px 10px rgba(0, 0, 0, 0.3);
  
  /* Panel */
  --panel-bg: rgba(30, 30, 30, 0.98);
  --panel-border-radius: 12px;
  --panel-padding: 16px;
  --panel-max-height: 400px;
  
  /* Node Card */
  --card-width: 120px;
  --card-height: 140px;
  --card-bg: rgba(40, 40, 40, 1);
  --card-hover-bg: rgba(60, 60, 60, 1);
  --card-border-radius: 8px;
  
  /* Inspector */
  --inspector-width: 300px;
  --inspector-bg: rgba(20, 20, 20, 0.95);
  
  /* Colors */
  --primary-blue: #4285f4;
  --hover-overlay: rgba(255, 255, 255, 0.05);
  --active-overlay: rgba(66, 133, 244, 0.2);
}
```

---

## Accessibility

### Keyboard Navigation
- **Tab** - Cycle through toolbar buttons
- **Enter** - Activate button/open panel
- **Arrow Keys** - Navigate within panel
- **Escape** - Close panel
- **/** - Focus search

### Screen Reader Support
```html
<button 
  class="category-button"
  aria-label="Math nodes category"
  aria-expanded={panelOpen}
  aria-controls="math-panel"
>
  Math
</button>

<div 
  id="math-panel"
  role="dialog"
  aria-label="Math nodes panel"
>
  <!-- Node cards -->
</div>
```

---

## Summary

**Key Features:**
✅ FigJam-style bottom toolbar for quick node access
✅ Categorized node browser with search
✅ Presentation mode (⌘.) hides UI chrome
✅ Smart inspector appears when node selected in presentation mode
✅ Drag-to-add or click-to-place node creation
✅ Favorites and recent nodes for quick access
✅ NPM package search integrated
✅ Fully keyboard navigable
✅ Smooth animations and transitions

This creates a **professional, efficient workflow** that scales from beginners exploring nodes to advanced users who memorize shortcuts!
