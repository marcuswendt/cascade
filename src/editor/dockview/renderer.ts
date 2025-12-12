import type {
  IContentRenderer,
  GroupPanelPartInitParameters
} from 'dockview-core';
import { mount, unmount, type Component } from 'svelte';
import { writable, get, type Writable } from 'svelte/store';
import type { CascadePanelParams, PanelContext } from './types';
import type { Node } from '@/core/engine/Node';

// Registry of panel components
export interface PanelComponentEntry {
  component: Component<any>;
  defaultTitle: string;
}

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
  componentRegistry.set(type, { component, defaultTitle });
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

      // Get current shared context
      const context = getSharedContext();

      // Mount Svelte 5 component
      instance = mount(entry.component, {
        target: container,
        props: {
          panelId: params.id,
          panelParams: params,
          panelApi: parameters.api,
          containerApi: parameters.containerApi,
          // Pass shared context props
          graph: context?.graph,
          selectedNode: context?.selectedNode,
          selectedAnnotation: context?.selectedAnnotation,
          activeTool: context?.activeTool || 'select',
          presentationMode: context?.presentationMode || false,
          onRecordHistory: context?.onRecordHistory,
          onNodeSelect: context?.onNodeSelect,
          onAnnotationSelect: context?.onAnnotationSelect,
          onToolChange: context?.onToolChange,
          onOpenNodePanel: context?.onOpenNodePanel
        }
      });
    },

    update(_event: GroupPanelPartInitParameters): void {
      // Updates are handled via reactive stores/context instead
    },

    dispose(): void {
      if (instance && container) {
        unmount(instance);
        instance = null;
      }
    }
  };
}
