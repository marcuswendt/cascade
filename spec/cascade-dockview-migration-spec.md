# Cascade Dockview Migration Specification

## Overview

This specification details the migration of Cascade's window management system to use **Dockview** (`dockview-core`), enabling VSCode-style flexible workspace layouts with draggable tabs, split panels, and docking zones.

### Goals

1. Replace the current fixed-region layout with a fully flexible docking system
2. Enable users to drag tabs to create splits (left/right/top/bottom)
3. Support tab groups when dropping tabs in center zones
4. Persist layouts to localStorage and graph files
5. Maintain seamless integration with existing Svelte 5 components

### Panel Types

The workspace consists of these core panel types:

| Panel ID | Component | Purpose |
|----------|-----------|---------|
| `graph` | GraphCanvas | Main node graph editor (LiteGraph.js) |
| `inspector` | NodeInspector | Selected node properties and controls |
| `viewer` | NodePreview | Output preview (images, data, etc.) |
| `log` | LogPanel | Execution logs and debug output |
| `code` | CodeEditor | Node code editor (opened on demand) |

---

## Architecture

### Package Structure

```
src/
├── lib/
│   ├── dockview/
│   │   ├── DockviewContainer.svelte    # Main wrapper component
│   │   ├── dockview-store.ts           # Svelte 5 store for Dockview state
│   │   ├── types.ts                    # TypeScript interfaces
│   │   ├── renderer.ts                 # Svelte component renderer for Dockview
│   │   └── themes/
│   │       └── cascade-dark.css        # Custom Dockview theme
│   ├── panels/
│   │   ├── GraphPanel.svelte           # Wrapper for graph canvas
│   │   ├── InspectorPanel.svelte       # Wrapper for node inspector
│   │   ├── ViewerPanel.svelte          # Wrapper for preview viewer
│   │   ├── LogPanel.svelte             # Wrapper for log output
│   │   └── CodePanel.svelte            # Wrapper for code editor
│   └── stores/
│       └── workspace.ts                # Workspace state management
```

### Dependencies

```bash
npm install dockview-core
```

**Note**: Use `dockview-core` (vanilla TypeScript), NOT `dockview` or `dockview-react`.

---

## Implementation Details

### 1. TypeScript Interfaces

Create `/src/lib/dockview/types.ts`:

```typescript
import type { 
  DockviewApi, 
  SerializedDockview,
  IContentRenderer,
  GroupPanelPartInitParameters,
  IGroupPanelInitParameters
} from 'dockview-core';

// Panel type identifiers
export type PanelType = 'graph' | 'inspector' | 'viewer' | 'log' | 'code';

// Parameters passed to each panel
export interface CascadePanelParams {
  id: string;
  type: PanelType;
  title: string;
  // Panel-specific params
  nodeId?: string;      // For inspector/code panels
  graphId?: string;     // For graph panels
}

// Component registry entry
export interface PanelComponentEntry {
  component: typeof import('svelte').SvelteComponent;
  defaultTitle: string;
}

// Store state
export interface DockviewState {
  api: DockviewApi | null;
  activePanel: string | null;
  panels: Map<string, CascadePanelParams>;
  isReady: boolean;
}

// Layout preset
export interface LayoutPreset {
  name: string;
  layout: SerializedDockview;
}
```

### 2. Svelte Component Renderer

Create `/src/lib/dockview/renderer.ts`:

```typescript
import type { 
  IContentRenderer, 
  GroupPanelPartInitParameters 
} from 'dockview-core';
import type { SvelteComponent } from 'svelte';
import type { CascadePanelParams, PanelComponentEntry } from './types';

// Registry of panel components
const componentRegistry = new Map<string, PanelComponentEntry>();

export function registerPanelComponent(
  type: string, 
  component: typeof SvelteComponent,
  defaultTitle: string
): void {
  componentRegistry.set(type, { component, defaultTitle });
}

/**
 * Creates a Dockview-compatible renderer that mounts Svelte components
 */
export function createSvelteRenderer(
  params: CascadePanelParams
): IContentRenderer {
  let instance: SvelteComponent | null = null;
  let container: HTMLElement | null = null;

  return {
    element: document.createElement('div'),
    
    init(parameters: GroupPanelPartInitParameters): void {
      container = this.element;
      container.style.height = '100%';
      container.style.width = '100%';
      container.style.overflow = 'hidden';
      
      const entry = componentRegistry.get(params.type);
      if (!entry) {
        console.error(`Unknown panel type: ${params.type}`);
        return;
      }
      
      // Mount Svelte component
      instance = new entry.component({
        target: container,
        props: {
          panelId: params.id,
          panelParams: params,
          panelApi: parameters.api,
          containerApi: parameters.containerApi
        }
      });
    },
    
    update(params: GroupPanelPartInitParameters): void {
      // Update Svelte component props if needed
      if (instance) {
        instance.$set({
          panelParams: params.params
        });
      }
    },
    
    dispose(): void {
      if (instance) {
        instance.$destroy();
        instance = null;
      }
    }
  };
}
```

### 3. Dockview Store (Svelte 5 Runes)

Create `/src/lib/dockview/dockview-store.ts`:

```typescript
import { 
  DockviewComponent,
  type DockviewApi,
  type SerializedDockview,
  type AddPanelOptions
} from 'dockview-core';
import type { CascadePanelParams, PanelType, DockviewState } from './types';
import { createSvelteRenderer } from './renderer';

const STORAGE_KEY = 'cascade-workspace-layout';

class DockviewStore {
  // Svelte 5 runes
  private _api = $state<DockviewApi | null>(null);
  private _activePanel = $state<string | null>(null);
  private _panels = $state<Map<string, CascadePanelParams>>(new Map());
  private _isReady = $state(false);

  // Getters
  get api() { return this._api; }
  get activePanel() { return this._activePanel; }
  get panels() { return this._panels; }
  get isReady() { return this._isReady; }

  /**
   * Initialize Dockview in a container element
   */
  initialize(container: HTMLElement): void {
    const dockview = new DockviewComponent({
      parentElement: container,
      createComponent: (options) => {
        const params = options.params as CascadePanelParams;
        return createSvelteRenderer(params);
      },
      // Enable all docking features
      watermarkComponent: undefined,
      disableFloatingGroups: false,
    });

    this._api = dockview.api;
    
    // Track active panel changes
    dockview.api.onDidActivePanelChange((event) => {
      this._activePanel = event.panel?.id ?? null;
    });

    // Track panel additions/removals
    dockview.api.onDidAddPanel((event) => {
      const params = event.panel.params as CascadePanelParams;
      this._panels.set(event.panel.id, params);
    });

    dockview.api.onDidRemovePanel((event) => {
      this._panels.delete(event.panel.id);
    });

    // Load saved layout or default
    this.loadLayout();
    
    this._isReady = true;
  }

  /**
   * Add a new panel to the workspace
   */
  addPanel(options: {
    id: string;
    type: PanelType;
    title: string;
    position?: 'left' | 'right' | 'top' | 'bottom' | 'within';
    referencePanel?: string;
    params?: Record<string, unknown>;
  }): void {
    if (!this._api) return;

    const panelParams: CascadePanelParams = {
      id: options.id,
      type: options.type,
      title: options.title,
      ...options.params
    };

    const addOptions: AddPanelOptions = {
      id: options.id,
      component: options.type,
      title: options.title,
      params: panelParams
    };

    // Position relative to reference panel
    if (options.referencePanel && options.position) {
      const refPanel = this._api.getPanel(options.referencePanel);
      if (refPanel) {
        addOptions.position = {
          referencePanel: refPanel,
          direction: options.position === 'within' 
            ? undefined 
            : options.position
        };
      }
    }

    this._api.addPanel(addOptions);
  }

  /**
   * Remove a panel by ID
   */
  removePanel(panelId: string): void {
    if (!this._api) return;
    const panel = this._api.getPanel(panelId);
    if (panel) {
      panel.api.close();
    }
  }

  /**
   * Focus a panel by ID
   */
  focusPanel(panelId: string): void {
    if (!this._api) return;
    const panel = this._api.getPanel(panelId);
    if (panel) {
      panel.api.setActive();
    }
  }

  /**
   * Open or focus a code editor for a specific node
   */
  openCodeEditor(nodeId: string, nodeTitle: string): void {
    const panelId = `code-${nodeId}`;
    
    // Check if already open
    if (this._panels.has(panelId)) {
      this.focusPanel(panelId);
      return;
    }

    this.addPanel({
      id: panelId,
      type: 'code',
      title: `Code: ${nodeTitle}`,
      position: 'right',
      referencePanel: 'graph-main',
      params: { nodeId }
    });
  }

  /**
   * Save current layout to localStorage
   */
  saveLayout(): void {
    if (!this._api) return;
    const layout = this._api.toJSON();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }

  /**
   * Load layout from localStorage or use default
   */
  loadLayout(layout?: SerializedDockview): void {
    if (!this._api) return;

    const savedLayout = layout 
      ?? JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      ?? this.getDefaultLayout();

    try {
      this._api.fromJSON(savedLayout);
    } catch (error) {
      console.warn('Failed to load layout, using default:', error);
      this._api.fromJSON(this.getDefaultLayout());
    }
  }

  /**
   * Reset to default layout
   */
  resetLayout(): void {
    if (!this._api) return;
    this._api.clear();
    this._api.fromJSON(this.getDefaultLayout());
    this.saveLayout();
  }

  /**
   * Default layout configuration
   */
  private getDefaultLayout(): SerializedDockview {
    return {
      grid: {
        root: {
          type: 'branch',
          data: [
            {
              type: 'branch',
              data: [
                {
                  type: 'leaf',
                  data: {
                    views: ['graph-main'],
                    activeView: 'graph-main',
                    id: 'group-graph'
                  },
                  size: 600
                },
                {
                  type: 'leaf',
                  data: {
                    views: ['viewer-main'],
                    activeView: 'viewer-main',
                    id: 'group-viewer'
                  },
                  size: 400
                }
              ],
              size: 800
            },
            {
              type: 'branch',
              data: [
                {
                  type: 'leaf',
                  data: {
                    views: ['inspector-main'],
                    activeView: 'inspector-main',
                    id: 'group-inspector'
                  },
                  size: 500
                },
                {
                  type: 'leaf',
                  data: {
                    views: ['log-main'],
                    activeView: 'log-main',
                    id: 'group-log'
                  },
                  size: 300
                }
              ],
              size: 320
            }
          ]
        },
        width: 1120,
        height: 800,
        orientation: 'HORIZONTAL'
      },
      panels: {
        'graph-main': {
          id: 'graph-main',
          contentComponent: 'graph',
          title: 'Graph',
          params: {
            id: 'graph-main',
            type: 'graph',
            title: 'Graph'
          }
        },
        'viewer-main': {
          id: 'viewer-main',
          contentComponent: 'viewer',
          title: 'Viewer',
          params: {
            id: 'viewer-main',
            type: 'viewer',
            title: 'Viewer'
          }
        },
        'inspector-main': {
          id: 'inspector-main',
          contentComponent: 'inspector',
          title: 'Inspector',
          params: {
            id: 'inspector-main',
            type: 'inspector',
            title: 'Inspector'
          }
        },
        'log-main': {
          id: 'log-main',
          contentComponent: 'log',
          title: 'Log',
          params: {
            id: 'log-main',
            type: 'log',
            title: 'Log'
          }
        }
      },
      activeGroup: 'group-graph'
    };
  }

  /**
   * Export layout for saving with graph file
   */
  exportLayout(): SerializedDockview | null {
    return this._api?.toJSON() ?? null;
  }

  /**
   * Clean up
   */
  dispose(): void {
    this.saveLayout();
    if (this._api) {
      // Dockview cleanup
    }
    this._api = null;
    this._isReady = false;
  }
}

// Singleton instance
export const dockviewStore = new DockviewStore();
```

### 4. DockviewContainer Component

Create `/src/lib/dockview/DockviewContainer.svelte`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { dockviewStore } from './dockview-store';
  import { registerPanelComponent } from './renderer';
  
  // Import panel components
  import GraphPanel from '$lib/panels/GraphPanel.svelte';
  import InspectorPanel from '$lib/panels/InspectorPanel.svelte';
  import ViewerPanel from '$lib/panels/ViewerPanel.svelte';
  import LogPanel from '$lib/panels/LogPanel.svelte';
  import CodePanel from '$lib/panels/CodePanel.svelte';
  
  // Import Dockview styles
  import 'dockview-core/dist/styles/dockview.css';
  
  let containerEl: HTMLElement;

  onMount(() => {
    // Register all panel components
    registerPanelComponent('graph', GraphPanel, 'Graph');
    registerPanelComponent('inspector', InspectorPanel, 'Inspector');
    registerPanelComponent('viewer', ViewerPanel, 'Viewer');
    registerPanelComponent('log', LogPanel, 'Log');
    registerPanelComponent('code', CodePanel, 'Code');
    
    // Initialize Dockview
    dockviewStore.initialize(containerEl);
    
    // Auto-save layout on changes
    const saveInterval = setInterval(() => {
      dockviewStore.saveLayout();
    }, 30000); // Save every 30 seconds
    
    return () => clearInterval(saveInterval);
  });

  onDestroy(() => {
    dockviewStore.dispose();
  });
</script>

<div 
  bind:this={containerEl} 
  class="dockview-container cascade-theme"
></div>

<style>
  .dockview-container {
    width: 100%;
    height: 100%;
    position: relative;
  }
  
  /* Cascade dark theme overrides */
  .dockview-container :global(.dv-tabs-container) {
    background: var(--cascade-bg-secondary, #1e1e1e);
  }
  
  .dockview-container :global(.dv-tab) {
    background: var(--cascade-bg-tertiary, #2d2d2d);
    color: var(--cascade-text-primary, #cccccc);
    border: none;
    padding: 4px 12px;
  }
  
  .dockview-container :global(.dv-tab.dv-active-tab) {
    background: var(--cascade-bg-primary, #1e1e1e);
    color: var(--cascade-text-highlight, #ffffff);
  }
  
  .dockview-container :global(.dv-tabs-container .dv-tab:hover) {
    background: var(--cascade-bg-hover, #383838);
  }
  
  .dockview-container :global(.dv-resize-container-handle) {
    background: var(--cascade-border, #404040);
  }
  
  .dockview-container :global(.dv-resize-container-handle:hover) {
    background: var(--cascade-accent, #0078d4);
  }
  
  .dockview-container :global(.dv-groupview-content) {
    background: var(--cascade-bg-primary, #1e1e1e);
  }
</style>
```

### 5. Panel Wrapper Components

Each existing Cascade component needs a thin wrapper to integrate with Dockview.

Create `/src/lib/panels/GraphPanel.svelte`:

```svelte
<script lang="ts">
  import type { IDockviewPanelProps } from 'dockview-core';
  import type { CascadePanelParams } from '$lib/dockview/types';
  import GraphCanvas from '$lib/components/GraphCanvas.svelte';
  
  export let panelId: string;
  export let panelParams: CascadePanelParams;
  export let panelApi: IDockviewPanelProps['api'];
  export let containerApi: IDockviewPanelProps['containerApi'];
  
  // Track panel dimensions for resize handling
  let width = $state(0);
  let height = $state(0);
  
  $effect(() => {
    // Listen to panel resize events
    const disposable = panelApi.onDidDimensionsChange((dimensions) => {
      width = dimensions.width;
      height = dimensions.height;
    });
    
    return () => disposable.dispose();
  });
</script>

<div class="panel-wrapper">
  <GraphCanvas {width} {height} />
</div>

<style>
  .panel-wrapper {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
</style>
```

Create `/src/lib/panels/InspectorPanel.svelte`:

```svelte
<script lang="ts">
  import type { CascadePanelParams } from '$lib/dockview/types';
  import NodeInspector from '$lib/components/NodeInspector.svelte';
  import { selectedNode } from '$lib/stores/graph';
  
  export let panelId: string;
  export let panelParams: CascadePanelParams;
  export let panelApi: any;
  export let containerApi: any;
  
  // Update panel title when selected node changes
  $effect(() => {
    if ($selectedNode) {
      panelApi.setTitle(`Inspector: ${$selectedNode.title}`);
    } else {
      panelApi.setTitle('Inspector');
    }
  });
</script>

<div class="panel-wrapper">
  <NodeInspector />
</div>

<style>
  .panel-wrapper {
    width: 100%;
    height: 100%;
    overflow: auto;
    padding: 8px;
  }
</style>
```

Create `/src/lib/panels/ViewerPanel.svelte`:

```svelte
<script lang="ts">
  import type { CascadePanelParams } from '$lib/dockview/types';
  import NodePreview from '$lib/components/NodePreview.svelte';
  
  export let panelId: string;
  export let panelParams: CascadePanelParams;
  export let panelApi: any;
  export let containerApi: any;
</script>

<div class="panel-wrapper">
  <NodePreview />
</div>

<style>
  .panel-wrapper {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #000;
  }
</style>
```

Create `/src/lib/panels/LogPanel.svelte`:

```svelte
<script lang="ts">
  import type { CascadePanelParams } from '$lib/dockview/types';
  import LogOutput from '$lib/components/LogOutput.svelte';
  
  export let panelId: string;
  export let panelParams: CascadePanelParams;
  export let panelApi: any;
  export let containerApi: any;
</script>

<div class="panel-wrapper">
  <LogOutput />
</div>

<style>
  .panel-wrapper {
    width: 100%;
    height: 100%;
    overflow: auto;
    font-family: var(--cascade-font-mono);
    font-size: 12px;
  }
</style>
```

Create `/src/lib/panels/CodePanel.svelte`:

```svelte
<script lang="ts">
  import type { CascadePanelParams } from '$lib/dockview/types';
  import CodeEditor from '$lib/components/CodeEditor.svelte';
  import { getNode } from '$lib/stores/graph';
  
  export let panelId: string;
  export let panelParams: CascadePanelParams;
  export let panelApi: any;
  export let containerApi: any;
  
  const nodeId = panelParams.nodeId;
  const node = nodeId ? getNode(nodeId) : null;
</script>

<div class="panel-wrapper">
  {#if node}
    <CodeEditor {nodeId} initialCode={node.code} />
  {:else}
    <div class="error">Node not found</div>
  {/if}
</div>

<style>
  .panel-wrapper {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  
  .error {
    padding: 16px;
    color: var(--cascade-error);
  }
</style>
```

---

## Integration Points

### Graph Canvas Integration

Update the graph canvas to open code panels on double-click:

```typescript
// In GraphCanvas.svelte or graph event handler
import { dockviewStore } from '$lib/dockview/dockview-store';

function handleNodeDoubleClick(node: GraphNode) {
  dockviewStore.openCodeEditor(node.id, node.title);
}
```

### Menu Bar Integration

Add layout controls to the View menu:

```svelte
<script>
  import { dockviewStore } from '$lib/dockview/dockview-store';
  
  function resetLayout() {
    dockviewStore.resetLayout();
  }
  
  function togglePanel(type: string) {
    const panelId = `${type}-main`;
    if (dockviewStore.panels.has(panelId)) {
      dockviewStore.removePanel(panelId);
    } else {
      dockviewStore.addPanel({
        id: panelId,
        type,
        title: type.charAt(0).toUpperCase() + type.slice(1)
      });
    }
  }
</script>

<menu>
  <menuitem on:click={() => togglePanel('inspector')}>
    Toggle Inspector
  </menuitem>
  <menuitem on:click={() => togglePanel('viewer')}>
    Toggle Viewer
  </menuitem>
  <menuitem on:click={() => togglePanel('log')}>
    Toggle Log
  </menuitem>
  <separator />
  <menuitem on:click={resetLayout}>
    Reset Layout
  </menuitem>
</menu>
```

### Keyboard Shortcuts

```typescript
// Add to keyboard handler
const shortcuts = {
  'Ctrl+1': () => dockviewStore.focusPanel('graph-main'),
  'Ctrl+2': () => dockviewStore.focusPanel('viewer-main'),
  'Ctrl+3': () => dockviewStore.focusPanel('inspector-main'),
  'Ctrl+4': () => dockviewStore.focusPanel('log-main'),
  'Ctrl+W': () => {
    const activePanel = dockviewStore.activePanel;
    if (activePanel && activePanel !== 'graph-main') {
      dockviewStore.removePanel(activePanel);
    }
  },
  'Ctrl+Shift+P': () => dockviewStore.resetLayout()
};
```

### Graph File Layout Persistence

Extend the graph file format to include layout:

```typescript
interface CascadeGraphFile {
  version: string;
  name: string;
  nodes: GraphNode[];
  connections: Connection[];
  annotations: Annotation[];
  // NEW: workspace layout
  workspace?: SerializedDockview;
}

// On save
function saveGraph(graph: CascadeGraphFile) {
  graph.workspace = dockviewStore.exportLayout();
  // ... save to file
}

// On load
function loadGraph(graph: CascadeGraphFile) {
  // ... load nodes, connections, etc.
  if (graph.workspace) {
    dockviewStore.loadLayout(graph.workspace);
  }
}
```

---

## Migration Checklist

### Phase 1: Setup (Day 1)

- [ ] Install `dockview-core` package
- [ ] Create `/src/lib/dockview/` directory structure
- [ ] Implement `types.ts` with all TypeScript interfaces
- [ ] Implement `renderer.ts` for Svelte component mounting
- [ ] Add Dockview CSS import and custom theme overrides

### Phase 2: Core Store (Day 2)

- [ ] Implement `dockview-store.ts` with Svelte 5 runes
- [ ] Add panel registration system
- [ ] Implement default layout configuration
- [ ] Add localStorage persistence

### Phase 3: Container & Panels (Day 3)

- [ ] Create `DockviewContainer.svelte`
- [ ] Create panel wrapper components (Graph, Inspector, Viewer, Log, Code)
- [ ] Wire up existing Cascade components inside wrappers
- [ ] Test panel resize handling

### Phase 4: Integration (Day 4)

- [ ] Connect graph canvas double-click to code panel opening
- [ ] Update menu bar with layout controls
- [ ] Add keyboard shortcuts
- [ ] Connect to graph file save/load for layout persistence

### Phase 5: Polish (Day 5)

- [ ] Refine theme styling to match Cascade design
- [ ] Add panel icons in tabs
- [ ] Test all docking interactions (drag to split, drag to group)
- [ ] Test layout save/restore across sessions
- [ ] Remove old layout system code

---

## Testing Scenarios

1. **Basic Docking**: Drag a tab to each edge (left/right/top/bottom) and verify splits
2. **Tab Groups**: Drag a tab to center of another panel and verify grouping
3. **Resize**: Drag dividers and verify all panels resize correctly
4. **Layout Persistence**: Close browser, reopen, verify layout restored
5. **Graph File Layout**: Save graph, reload, verify layout matches
6. **Code Panel**: Double-click node, verify code editor opens in new tab
7. **Panel Close**: Close non-graph panels, verify they can be reopened from menu
8. **Keyboard Navigation**: Test all Ctrl+number shortcuts

---

## Notes

- **Do NOT use** `dockview` or `dockview-react` packages — use `dockview-core` only
- The renderer creates Svelte components imperatively using `new Component()` — this is intentional for Dockview integration
- Always dispose Svelte components in the renderer's `dispose()` method to prevent memory leaks
- The default layout should always include at least the `graph-main` panel which cannot be closed
- Layout JSON can become large — consider compressing for graph file storage
