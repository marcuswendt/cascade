import type {
  IContentRenderer,
  GroupPanelPartInitParameters
} from 'dockview';
import { mount, unmount, type Component } from 'svelte';
import { writable, get, type Writable } from 'svelte/store';
import type { CascadePanelParams, PanelContext } from './types';
import type { Node } from '@/nodes/Node';
import type { Graph } from '@/nodes/Graph';

// Registry of panel components
// Round 32: "load Monaco only on demand when someone opens that editor
// view (mostly they don't)" — a panel type can now be registered either
// eagerly (registerPanelComponent, the existing behavior — every panel
// type except 'code') or lazily (registerLazyPanelComponent, a loader
// returning a dynamic `import()`), as two explicit entry shapes rather
// than one type sniffed at runtime — a Svelte 5 component's compiled
// function signature isn't a reliable enough signal to branch on. A
// static `import CodePanel from ...` at the top of DockviewContainer.svelte
// was pulling monaco-editor (3MB+ minified) into the eagerly-loaded
// bundle graph regardless of whether the code panel was ever opened —
// Vite's own manualChunks split for monaco-editor didn't help, since
// chunk splitting only changes how a chunk is grouped, not WHEN it
// fetches. Only createSvelteRenderer's init() (below) knows when a panel
// is actually being created, so that's the one place that can
// legitimately defer the fetch.
export type PanelComponentLoader = () => Promise<{ default: Component<any> }>;

export type PanelComponentEntry =
  | { lazy: false; component: Component<any>; defaultTitle: string }
  | { lazy: true; loader: PanelComponentLoader; defaultTitle: string };

const componentRegistry = new Map<string, PanelComponentEntry>();

// Shared context store for reactive updates
export const sharedContextStore: Writable<PanelContext | null> = writable(null);

// Lock state for panels (panel ID -> locked node)
export interface PanelLockState {
  isLocked: boolean;
  /** The node object, so a rename (which keeps the object) is followed. Null
   *  while a lock restored from a saved layout waits for its node to load. */
  lockedNode: Node | null;
  lockedAnnotationId: string | null;
  /** The locked node's id as last seen: what the layout persists, and how a
   *  lock re-binds when the graph rebuilds its node objects (undo, reload). */
  lockedNodeId?: string | null;
  /** The graph the node was found in. A node missing from that same graph
   *  was deleted; missing from a different one may simply not be loaded yet. */
  graph?: Graph;
}

export const panelLockStore: Writable<Map<string, PanelLockState>> = writable(new Map());

function setLock(panelId: string, state: PanelLockState | null): void {
  panelLockStore.update(locks => {
    const newLocks = new Map(locks);
    if (state) newLocks.set(panelId, state);
    else newLocks.delete(panelId);
    return newLocks;
  });
}

export function togglePanelLock(panelId: string): void {
  const context = get(sharedContextStore);
  const current = get(panelLockStore).get(panelId);
  if (current?.isLocked) {
    setLock(panelId, null);
  } else if (context?.selectedNode || context?.selectedAnnotation) {
    setLock(panelId, {
      isLocked: true,
      lockedNode: context.selectedNode,
      lockedAnnotationId: context.selectedAnnotation,
      lockedNodeId: context.selectedNode?.id ?? null,
      graph: context.graph,
    });
  }
}

/** Pin a panel to one node — the drop of a node dragged out of the graph. */
export function lockPanelToNode(panelId: string, node: Node, graph?: Graph): void {
  setLock(panelId, { isLocked: true, lockedNode: node, lockedAnnotationId: null, lockedNodeId: node.id, graph });
}

export function unlockPanel(panelId: string): void {
  if (get(panelLockStore).has(panelId)) setLock(panelId, null);
}

/** A lock read back from a saved layout: only the id is known until the
 *  graph that holds it has loaded. */
export function restorePanelLock(panelId: string, nodeId: string): void {
  if (get(panelLockStore).get(panelId)?.isLocked) return;
  setLock(panelId, { isLocked: true, lockedNode: null, lockedAnnotationId: null, lockedNodeId: nodeId });
}

export type LockResolution =
  | { kind: 'node'; node: Node }
  | { kind: 'pending' }
  | { kind: 'gone' };

/**
 * Where a node lock points in `graph` right now. The object wins (a rename
 * keeps it); failing that the id (a rebuilt graph has new objects under the
 * same ids). A node missing from the very graph it was locked in was deleted.
 * A lock restored from a saved layout waits only while the graph is empty.
 */
export function resolveLockedNode(lock: PanelLockState, graph: Graph | undefined): LockResolution {
  if (!graph) return { kind: 'pending' };
  if (lock.lockedNode && graph.nodes.includes(lock.lockedNode)) return { kind: 'node', node: lock.lockedNode };
  const byId = lock.lockedNodeId ? graph.getNode(lock.lockedNodeId) : null;
  if (byId) return { kind: 'node', node: byId };
  if (lock.graph === graph) return { kind: 'gone' };
  // A restored lock (no object yet) on a graph that has loaded nodes, none of
  // them the one it names: the node was deleted or never saved.
  if (!lock.lockedNode && graph.nodes.length > 0) return { kind: 'gone' };
  return { kind: 'pending' };
}

/** Apply `resolveLockedNode` to the store: re-bind, or drop a deleted lock. */
export function reconcilePanelLock(panelId: string, graph: Graph | undefined): void {
  const lock = get(panelLockStore).get(panelId);
  if (!lock?.isLocked || lock.lockedAnnotationId) return;
  if (!lock.lockedNode && !lock.lockedNodeId) return;
  const resolved = resolveLockedNode(lock, graph);
  if (resolved.kind === 'gone') {
    setLock(panelId, null);
  } else if (resolved.kind === 'node') {
    const node = resolved.node;
    if (node !== lock.lockedNode || node.id !== lock.lockedNodeId || lock.graph !== graph) {
      setLock(panelId, { ...lock, lockedNode: node, lockedNodeId: node.id, graph });
    }
  }
}

export function getPanelLockState(panelId: string): PanelLockState | undefined {
  return get(panelLockStore).get(panelId);
}

export function isPanelLocked(panelId: string): boolean {
  return get(panelLockStore).get(panelId)?.isLocked ?? false;
}

export function setSharedContext(context: PanelContext): void {
  sharedContextStore.set(context);
}

export function getSharedContext(): PanelContext | null {
  let value: PanelContext | null = null;
  sharedContextStore.subscribe(v => value = v)();
  return value;
}

export function registerPanelComponent(
  type: string,
  component: Component<any>,
  defaultTitle: string
): void {
  componentRegistry.set(type, { lazy: false, component, defaultTitle });
}

/** See PanelComponentEntry's own note — for a panel type whose component
 * (and its imports) should only be fetched once a panel of that type is
 * actually created, not at app startup. */
export function registerLazyPanelComponent(
  type: string,
  loader: PanelComponentLoader,
  defaultTitle: string
): void {
  componentRegistry.set(type, { lazy: true, loader, defaultTitle });
}

export function getPanelComponent(type: string): PanelComponentEntry | undefined {
  return componentRegistry.get(type);
}

export function resolvePanelParams(
  initialParams: CascadePanelParams,
  parameters: GroupPanelPartInitParameters,
): CascadePanelParams {
  const savedParams = parameters.params as Partial<CascadePanelParams> | undefined;
  return {
    ...initialParams,
    ...savedParams,
    id: parameters.api.id,
    type: (savedParams?.type ?? initialParams.type) as CascadePanelParams['type'],
    title: savedParams?.title ?? parameters.api.title ?? initialParams.title,
  };
}

/**
 * Creates a Dockview-compatible renderer that mounts Svelte 5 components
 */
export function createSvelteRenderer(
  initialParams: CascadePanelParams
): IContentRenderer {
  let params = initialParams;
  let instance: Record<string, any> | null = null;
  let container: HTMLElement | null = null;
  // Round 32: guards the lazy-load path — a panel can be closed (dispose())
  // while its dynamic import() is still in flight; without this the mount
  // that resolves afterward would attach to a container dockview has
  // already torn down.
  let disposed = false;

  function buildProps(parameters: GroupPanelPartInitParameters) {
    const context = getSharedContext();
    return {
      panelId: params.id,
      panelParams: params,
      panelApi: parameters.api,
      containerApi: parameters.containerApi,
      graph: context?.graph,
      selectedNode: context?.selectedNode,
      selectedAnnotation: context?.selectedAnnotation,
      activeTool: context?.activeTool || 'select',
      presentationMode: context?.presentationMode || false,
      onRecordHistory: context?.onRecordHistory,
      onNodeSelect: context?.onNodeSelect,
      onAnnotationSelect: context?.onAnnotationSelect,
      onToolChange: context?.onToolChange,
      onOpenNodePanel: context?.onOpenNodePanel,
      onPanelAction: context?.onPanelAction,
    };
  }

  return {
    element: document.createElement('div'),

    init(parameters: GroupPanelPartInitParameters): void {
      params = resolvePanelParams(params, parameters);
      container = this.element;
      container.style.height = '100%';
      container.style.width = '100%';
      container.style.overflow = 'hidden';
      container.classList.add('dockview-panel-content');

      // Safeguard: ensure params has required properties
      if (!params || !params.type) {
        console.error('Panel params missing or invalid:', params);
        container.innerHTML = `<div style="padding: 16px; color: var(--status-error);">Invalid panel configuration</div>`;
        return;
      }

      const entry = componentRegistry.get(params.type);
      if (!entry) {
        console.error(`Unknown panel type: ${params.type}`);
        container.innerHTML = `<div style="padding: 16px; color: var(--status-error);">Unknown panel type: ${params.type}</div>`;
        return;
      }

      if (!entry.lazy) {
        instance = mount(entry.component, { target: container, props: buildProps(parameters) });
        return;
      }

      // Lazy entry: show a lightweight placeholder immediately (the load
      // is a real multi-MB fetch, not instant), swap in the real
      // component once it resolves.
      container.innerHTML = `<div style="padding: 16px; color: var(--text-subtle);">Loading ${entry.defaultTitle}…</div>`;
      entry
        .loader()
        .then((mod) => {
          if (disposed || !container) return;
          container.innerHTML = '';
          instance = mount(mod.default, { target: container, props: buildProps(parameters) });
        })
        .catch((err) => {
          console.error(`Failed to load panel component for type ${params.type}:`, err);
          if (disposed || !container) return;
          container.innerHTML = `<div style="padding: 16px; color: var(--status-error);">Failed to load ${entry.defaultTitle}: ${String(err)}</div>`;
        });
    },

    update(_event: GroupPanelPartInitParameters): void {
      // Updates are handled via reactive stores/context instead
    },

    dispose(): void {
      disposed = true;
      if (instance && container) {
        unmount(instance);
        instance = null;
      }
    }
  };
}
