import {
  createDockview,
  Orientation,
  type DockviewApi,
  type SerializedDockview,
  type AddPanelOptions,
  type IDockviewPanel,
  type DockviewComponentOptions,
  type DockviewActivePanelChangeEvent,
  type IHeaderActionsRenderer
} from 'dockview';
import type { CascadePanelParams, PanelType } from './types';
import { createSvelteRenderer, togglePanelLock, panelLockStore, sharedContextStore } from './renderer';
import { get } from 'svelte/store';
import { writable } from 'svelte/store';
import type { ProjectPanelMeta } from '../projectPanels';

const STORAGE_KEY = 'cascade-dockview-layout';
type ResizeAxis = 'width' | 'height';
type MinimizedGroup = { size: number; minimum: number; axis: ResizeAxis };

export function activePanelId(event: DockviewActivePanelChangeEvent): string | null {
  return event.panel?.id ?? null;
}

export function groupResizeAxis(grid: SerializedDockview['grid'], groupId: string): ResizeAxis | null {
  const visit = (node: any, axis: ResizeAxis): ResizeAxis | null => {
    if (node?.type === 'leaf') return node.data?.id === groupId ? axis : null;
    if (node?.type !== 'branch' || !Array.isArray(node.data)) return null;
    const childAxis = axis === 'width' ? 'height' : 'width';
    for (const child of node.data) {
      const match = visit(child, childAxis);
      if (match) return match;
    }
    return null;
  };

  const rootAxis = grid.orientation === Orientation.HORIZONTAL ? 'width' : 'height';
  return visit(grid.root, rootAxis);
}

// Panel types available for creation
export const BUILT_IN_PANEL_TYPES: { type: PanelType; label: string; icon: string }[] = [
  { type: 'graph', label: 'Graph', icon: '⬡' },
  { type: 'viewer', label: 'Viewer', icon: '👁' },
  { type: 'inspector', label: 'Inspector', icon: '⚙' },
  { type: 'info', label: 'Node Info', icon: 'ℹ' },
  { type: 'log', label: 'Log', icon: '📋' },
];
export const panelTypes = writable([...BUILT_IN_PANEL_TYPES]);

export function setProjectPanelTypes(panels: ProjectPanelMeta[]): void {
  panelTypes.set([
    ...BUILT_IN_PANEL_TYPES,
    ...panels.map(panel => ({ type: `project:${panel.name}` as PanelType, label: panel.title, icon: panel.icon ?? '▣' })),
  ]);
}

class DockviewStore {
  // Svelte 5 runes for reactive state
  private _api = $state<DockviewApi | null>(null);
  private _activePanel = $state<string | null>(null);
  private _panels = $state<Map<string, CascadePanelParams>>(new Map());
  private _isReady = $state(false);
  private _minimizedGroups = $state<Map<string, MinimizedGroup>>(new Map());

  // Getters
  get api() { return this._api; }
  get activePanel() { return this._activePanel; }
  get panels() { return this._panels; }
  get isReady() { return this._isReady; }
  get minimizedGroups() { return this._minimizedGroups; }

  // Callback for when add panel button is clicked (set by container)
  onAddPanelClick: ((groupId: string, position: { x: number; y: number }) => void) | null = null;

  /**
   * Initialize Dockview in a container element
   */
  initialize(container: HTMLElement): void {
    const self = this;

    const options: DockviewComponentOptions = {
      createComponent: (componentOptions) => {
        const params: CascadePanelParams = {
          id: componentOptions.id,
          type: componentOptions.name as PanelType,
          title: componentOptions.name.charAt(0).toUpperCase() + componentOptions.name.slice(1),
        };
        return createSvelteRenderer(params);
      },
      createRightHeaderActionComponent: (_group): IHeaderActionsRenderer => {
        return {
          element: (() => {
            const el = document.createElement('div');
            el.className = 'cascade-header-actions';

            // Add panel button
            const addBtn = document.createElement('button');
            addBtn.className = 'cascade-add-panel-btn';
            addBtn.innerHTML = '+';
            addBtn.title = 'Add panel';
            addBtn.onclick = (e) => {
              e.stopPropagation();
              const rect = addBtn.getBoundingClientRect();
              const groupId = _group.id;
              if (self.onAddPanelClick) {
                self.onAddPanelClick(groupId, { x: rect.left, y: rect.bottom });
              }
            };
            el.appendChild(addBtn);

            return el;
          })(),
          init: () => {},
          dispose: () => {}
        };
      },
      createTabComponent: (_options) => {
        const element = document.createElement('div');
        element.className = 'cascade-tab';

        // Lock button (only shown for viewer/inspector)
        const lockBtn = document.createElement('button');
        lockBtn.className = 'cascade-tab-lock';
        lockBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
        lockBtn.title = 'Lock to current node';
        lockBtn.style.display = 'none';
        element.appendChild(lockBtn);

        const titleSpan = document.createElement('span');
        titleSpan.className = 'cascade-tab-title';
        element.appendChild(titleSpan);

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'cascade-tab-close';
        closeBtn.innerHTML = '×';
        closeBtn.title = 'Close';
        element.appendChild(closeBtn);

        let panelApi: any = null;
        let panelId: string = '';
        let panelType: string = '';
        let unsubscribeLock: (() => void) | null = null;
        let unsubscribeContext: (() => void) | null = null;

        const updateLockButton = () => {
          const locks = get(panelLockStore);
          const lockState = locks.get(panelId);
          const context = get(sharedContextStore);
          const hasSelection = !!(context?.selectedNode || context?.selectedAnnotation);

          if (lockState?.isLocked) {
            lockBtn.classList.add('locked');
            lockBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
            lockBtn.title = 'Unlock (follow selection)';
            lockBtn.disabled = false;
          } else {
            lockBtn.classList.remove('locked');
            lockBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 5-5 5 5 0 0 1 5 5v4"/><line x1="17" y1="7" x2="21" y2="3"/></svg>`;
            lockBtn.title = hasSelection ? 'Lock to current node' : 'Lock to empty view';
            lockBtn.disabled = false;
          }
        };

        return {
          element,
          init: (params) => {
            panelApi = params.api;
            panelId = params.api.id;

            // Get panel type from params
            const panelParams = params.params as CascadePanelParams;
            panelType = panelParams?.type || '';

            // Show lock button for viewer and inspector panels
            if (panelType === 'viewer' || panelType === 'inspector') {
              lockBtn.style.display = 'flex';

              // Subscribe to lock store changes
              unsubscribeLock = panelLockStore.subscribe(() => {
                updateLockButton();
              });

              // Subscribe to context changes to enable/disable lock button
              unsubscribeContext = sharedContextStore.subscribe(() => {
                updateLockButton();
              });

              // Lock button handler
              lockBtn.onclick = (e) => {
                e.stopPropagation();
                togglePanelLock(panelId);
              };

              updateLockButton();
            }

            // Set initial title
            titleSpan.textContent = panelApi.title || 'Untitled';

            // Update title when it changes
            panelApi.onDidTitleChange(() => {
              titleSpan.textContent = panelApi.title || 'Untitled';
            });

            // Double-click on title to toggle minimize - get group at click time
            titleSpan.ondblclick = (e) => {
              e.stopPropagation();
              const currentGroup = panelApi?.group;
              if (currentGroup?.id) {
                self.toggleMinimizeGroup(currentGroup.id);
              }
            };

            // Close button handler
            closeBtn.onclick = (e) => {
              e.stopPropagation();
              panelApi.close();
            };
          },
          dispose: () => {
            panelApi = null;
            if (unsubscribeLock) unsubscribeLock();
            if (unsubscribeContext) unsubscribeContext();
          }
        };
      },
      disableFloatingGroups: true,
      defaultTabComponent: 'cascadeTab',
    };

    const api = createDockview(container, options);

    this._api = api;

    // Track active panel changes
    api.onDidActivePanelChange((event) => {
      this._activePanel = activePanelId(event);
    });

    // Track panel additions/removals
    api.onDidAddPanel((panel: IDockviewPanel) => {
      const params = panel.params as CascadePanelParams;
      if (params) {
        this._panels = new Map(this._panels).set(panel.id, params);
      }
    });

    api.onDidRemovePanel((panel: IDockviewPanel) => {
      const newPanels = new Map(this._panels);
      newPanels.delete(panel.id);
      this._panels = newPanels;
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
    position?: 'left' | 'right' | 'above' | 'below' | 'within';
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

    const addOptions: AddPanelOptions<CascadePanelParams> = {
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
   * Check if a panel exists
   */
  hasPanel(panelId: string): boolean {
    return this._panels.has(panelId);
  }

  /**
   * Add a new panel of a given type to a specific group
   */
  addPanelToGroup(type: PanelType, groupId: string): void {
    if (!this._api) return;

    // Generate unique ID
    const projectPanelName = type.startsWith('project:') ? type.slice('project:'.length) : undefined;
    const id = projectPanelName ? type : `${type}-${Date.now()}`;
    if (projectPanelName && this._panels.has(id)) {
      this.focusPanel(id);
      return;
    }
    const entry = get(panelTypes).find(panel => panel.type === type);
    const title = entry?.label ?? type.charAt(0).toUpperCase() + type.slice(1);

    // Find the group and get a reference panel
    const group = this._api.getGroup(groupId);
    if (!group) return;

    // Get any panel in the group to use as reference
    const panels = group.panels;
    const refPanel = panels.length > 0 ? panels[0] : null;

    this.addPanel({
      id,
      type,
      title,
      position: 'within',
      referencePanel: refPanel?.id,
      params: projectPanelName ? { projectPanelName } : undefined,
    });
  }

  openProjectPanel(name: string, sourceNodeId?: string): void {
    const type = `project:${name}` as PanelType;
    const id = sourceNodeId ? `${type}:${sourceNodeId}` : type;
    if (this._panels.has(id)) {
      this.focusPanel(id);
      return;
    }
    const reference = this._activePanel || [...this._panels.keys()][0];
    this.addPanel({
      id,
      type,
      title: get(panelTypes).find(panel => panel.type === type)?.label ?? name,
      position: reference ? 'within' : undefined,
      referencePanel: reference,
      params: { projectPanelName: name, sourceNodeId },
    });
  }

  /**
   * Check if any panel is maximized
   */
  isActivePanelMaximized(): boolean {
    if (!this._api) return false;
    return (this._api as any).hasMaximizedGroup?.() ?? false;
  }

  /**
   * Toggle maximize for the active panel's group using dockview's built-in API
   */
  toggleMaximizeActivePanel(): void {
    if (!this._api) return;

    if (this._api.hasMaximizedGroup()) {
      this._api.exitMaximizedGroup();
    } else {
      const activePanel = this._api.getPanel(this._activePanel || '');
      if (activePanel) {
        this._api.maximizeGroup(activePanel);
      }
    }
  }

  /**
   * Toggle minimize/restore for a group
   */
  toggleMinimizeGroup(groupId: string): void {
    if (!this._api) return;

    const group = this._api.getGroup(groupId);
    if (!group) return;

    const isMinimized = this._minimizedGroups.has(groupId);
    const savedData = this._minimizedGroups.get(groupId);

    const axis = groupResizeAxis(this._api.toJSON().grid, groupId);
    if (!axis) return;

    if (isMinimized && savedData) {
      group.api.setConstraints(savedData.axis === 'width'
        ? { minimumWidth: savedData.minimum }
        : { minimumHeight: savedData.minimum });
      group.api.setSize({ [savedData.axis]: savedData.size });
      const newMinimized = new Map(this._minimizedGroups);
      newMinimized.delete(groupId);
      this._minimizedGroups = newMinimized;
    } else {
      const newMinimized = new Map(this._minimizedGroups);
      newMinimized.set(groupId, {
        size: group[axis] || 200,
        minimum: axis === 'width' ? group.minimumWidth : group.minimumHeight,
        axis,
      });
      this._minimizedGroups = newMinimized;

      group.api.setConstraints(axis === 'width' ? { minimumWidth: 35 } : { minimumHeight: 35 });
      group.api.setSize({ [axis]: 35 });
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
      position: 'within',
      referencePanel: 'graph-main',
      params: { nodeId }
    });
  }

  /**
   * Filter out code panels from a layout (both panels object and grid views)
   * Code panels don't preserve their nodeId params when serialized and should
   * be opened on-demand when user double-clicks a node
   */
  private filterCodePanelsFromLayout(layout: SerializedDockview): void {
    const available = new Set(get(panelTypes).map(panel => panel.type));
    // Filter panels object
    if (layout.panels) {
      const filteredPanels: Record<string, any> = {};
      for (const [id, panel] of Object.entries(layout.panels as Record<string, any>)) {
        const component = (panel as any)?.contentComponent;
        if (!id.startsWith('code-') && (!String(component).startsWith('project:') || available.has(component))) {
          filteredPanels[id] = panel;
        }
      }
      layout.panels = filteredPanels;
    }

    // Filter grid views recursively
    if (layout.grid?.root) {
      this.filterCodePanelsFromGridNode(layout.grid.root, new Set(Object.keys(layout.panels ?? {})));
    }
  }

  /**
   * Recursively filter code panel IDs from grid node views
   */
  private filterCodePanelsFromGridNode(node: any, availableIds?: Set<string>): void {
    if (!node) return;

    if (node.type === 'leaf' && node.data?.views) {
      // Filter out code panel IDs from views array
      node.data.views = node.data.views.filter((viewId: string) => !viewId.startsWith('code-') && (!availableIds || availableIds.has(viewId)));
      // Update activeView if it was a code panel
      if (node.data.activeView?.startsWith('code-')) {
        node.data.activeView = node.data.views[0] || null;
      }
    } else if (node.type === 'branch' && node.data) {
      // Recurse into branch children
      for (const child of node.data) {
        this.filterCodePanelsFromGridNode(child, availableIds);
      }
    }
  }

  /**
   * Save current layout to localStorage
   */
  saveLayout(): void {
    if (!this._api) return;
    try {
      const layout = this._api.toJSON();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch (error) {
      console.warn('Failed to save layout:', error);
    }
  }

  /**
   * Load layout from localStorage or use default
   */
  loadLayout(layout?: SerializedDockview): void {
    if (!this._api) return;

    let layoutToLoad = layout;
    let isFromStorage = false;

    if (!layoutToLoad) {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          layoutToLoad = JSON.parse(saved);
          isFromStorage = true;

          // Remove code panels from saved layout - they don't preserve nodeId params
          // and should be opened on-demand when user double-clicks a node
          if (layoutToLoad) {
            this.filterCodePanelsFromLayout(layoutToLoad);
          }
        }
      } catch (error) {
        console.warn('Failed to parse saved layout:', error);
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    if (!layoutToLoad) {
      layoutToLoad = this.getDefaultLayout();
    }

    try {
      this._api.fromJSON(layoutToLoad);
    } catch (error) {
      console.warn('Failed to load layout:', error);

      // If the saved layout failed, clear it and try default
      if (isFromStorage) {
        localStorage.removeItem(STORAGE_KEY);
        try {
          this._api.fromJSON(this.getDefaultLayout());
        } catch (defaultError) {
          console.error('Failed to load default layout:', defaultError);
          // As a last resort, manually create panels
          this.createDefaultPanels();
        }
      } else {
        // Default layout failed, try creating panels manually
        console.error('Default layout failed, creating panels manually');
        this.createDefaultPanels();
      }
    }
  }

  /**
   * Create default panels manually as a fallback
   */
  private createDefaultPanels(): void {
    if (!this._api) return;

    try {
      // Add panels one by one
      this._api.addPanel({
        id: 'graph-main',
        component: 'graph',
        title: 'Graph',
        params: { id: 'graph-main', type: 'graph', title: 'Graph' }
      });

      this._api.addPanel({
        id: 'viewer-main',
        component: 'viewer',
        title: 'Viewer',
        position: { referencePanel: 'graph-main', direction: 'right' },
        params: { id: 'viewer-main', type: 'viewer', title: 'Viewer' }
      });

      this._api.addPanel({
        id: 'log-main',
        component: 'log',
        title: 'Log',
        position: { referencePanel: 'viewer-main', direction: 'below' },
        params: { id: 'log-main', type: 'log', title: 'Log' }
      });

      this._api.addPanel({
        id: 'inspector-main',
        component: 'inspector',
        title: 'Inspector',
        position: { referencePanel: 'viewer-main', direction: 'right' },
        params: { id: 'inspector-main', type: 'inspector', title: 'Inspector' }
      });
    } catch (error) {
      console.error('Failed to create default panels:', error);
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
   * Default layout configuration - matches the original WindowManager layout
   */
  private getDefaultLayout(): SerializedDockview {
    return {
      grid: {
        root: {
          type: 'branch',
          data: [
            // Left column: Graph (50%)
            {
              type: 'leaf',
              data: {
                views: ['graph-main'],
                activeView: 'graph-main',
                id: 'group-graph'
              },
              size: 500
            },
            // Middle column: Viewer + Log
            {
              type: 'branch',
              data: [
                {
                  type: 'leaf',
                  data: {
                    views: ['viewer-main'],
                    activeView: 'viewer-main',
                    id: 'group-viewer'
                  },
                  size: 600
                },
                {
                  type: 'leaf',
                  data: {
                    views: ['log-main'],
                    activeView: 'log-main',
                    id: 'group-log'
                  },
                  size: 200
                }
              ],
              size: 250
            },
            // Right column: Inspector (25%)
            {
              type: 'leaf',
              data: {
                views: ['inspector-main'],
                activeView: 'inspector-main',
                id: 'group-inspector'
              },
              size: 250
            }
          ]
        },
        width: 1000,
        height: 800,
        orientation: Orientation.HORIZONTAL
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
    this._api?.dispose();
    this._api = null;
    this._activePanel = null;
    this._isReady = false;
    this._panels = new Map();
    this._minimizedGroups = new Map();
  }
}

// Singleton instance
export const dockviewStore = new DockviewStore();
