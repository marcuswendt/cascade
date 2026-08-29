import type {
  IContentRenderer,
  GroupPanelPartInitParameters
} from 'dockview-core';
import { mount, unmount, type Component } from 'svelte';
import { writable, get, type Writable } from 'svelte/store';
import type { CascadePanelParams, PanelContext } from './types';
import type { Node } from '@/nodes/Node';

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
  lockedNode: Node | null;
  lockedAnnotationId: string | null;
}

export const panelLockStore: Writable<Map<string, PanelLockState>> = writable(new Map());

export function togglePanelLock(panelId: string): void {
  const context = get(sharedContextStore);
  panelLockStore.update(locks => {
    const newLocks = new Map(locks);
    const current = newLocks.get(panelId);

    if (current?.isLocked) {
      // Unlock
      newLocks.delete(panelId);
    } else {
      // Lock to current selection
      if (context?.selectedNode || context?.selectedAnnotation) {
        newLocks.set(panelId, {
          isLocked: true,
          lockedNode: context.selectedNode,
          lockedAnnotationId: context.selectedAnnotation
        });
      }
    }
    return newLocks;
  });
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

/**
 * Creates a Dockview-compatible renderer that mounts Svelte 5 components
 */
export function createSvelteRenderer(
  params: CascadePanelParams
): IContentRenderer {
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
      container = this.element;
      container.style.height = '100%';
      container.style.width = '100%';
      container.style.overflow = 'hidden';
      container.classList.add('dockview-panel-content');

      // Safeguard: ensure params has required properties
      if (!params || !params.type) {
        console.error('Panel params missing or invalid:', params);
        container.innerHTML = `<div style="padding: 16px; color: #ff6b6b;">Invalid panel configuration</div>`;
        return;
      }

      const entry = componentRegistry.get(params.type);
      if (!entry) {
        console.error(`Unknown panel type: ${params.type}`);
        container.innerHTML = `<div style="padding: 16px; color: #ff6b6b;">Unknown panel type: ${params.type}</div>`;
        return;
      }

      if (!entry.lazy) {
        instance = mount(entry.component, { target: container, props: buildProps(parameters) });
        return;
      }

      // Lazy entry: show a lightweight placeholder immediately (the load
      // is a real multi-MB fetch, not instant), swap in the real
      // component once it resolves.
      container.innerHTML = `<div style="padding: 16px; color: #888;">Loading ${entry.defaultTitle}…</div>`;
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
          container.innerHTML = `<div style="padding: 16px; color: #ff6b6b;">Failed to load ${entry.defaultTitle}: ${String(err)}</div>`;
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
