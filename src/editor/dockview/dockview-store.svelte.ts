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
import { writable, type Writable } from 'svelte/store';
import { mount, unmount } from 'svelte';
import type { ProjectPanelMeta } from '../projectPanels';
import PanelIcon from '../components/PanelIcon.svelte';
import {
  FOLDED_SIZE,
  adoptOrphanFolds,
  deserializeFolds,
  fold as foldRecord,
  foldAxis,
  forget as forgetFold,
  serializeFolds,
  unfold as unfoldRecord,
  type FoldMap,
  type FoldRecord,
  type ResizeAxis as FoldAxis,
} from './fold';

const STORAGE_KEY = 'cascade-dockview-layout';
/**
 * The fold records live beside the layout rather than inside it.
 *
 * dockview's own `toJSON` already persists a folded group's *size* (8px), so
 * the choice is not whether folding survives a reload — it does, unavoidably —
 * but whether the size it should come back to survives with it. Not writing
 * this key is the destructive option: you would reload into a hairline group
 * with no memory of what it was. See adoptOrphanFolds for the case where the
 * layout still arrives without them.
 */
const FOLD_STORAGE_KEY = 'cascade-dockview-folds';
type ResizeAxis = FoldAxis;
type MinimizedGroup = FoldRecord;

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
  { type: 'inspector', label: 'Parameters', icon: '⚙' },
  { type: 'definition', label: 'Definition', icon: '❖' },
  { type: 'info', label: 'Node Info', icon: 'ℹ' },
  { type: 'log', label: 'Log', icon: '📋' },
  { type: 'timeline', label: 'Timeline', icon: '⏱' },
  { type: 'agent', label: 'Agent', icon: '✦' },
];
export const panelTypes = writable([...BUILT_IN_PANEL_TYPES]);

export function setProjectPanelTypes(panels: ProjectPanelMeta[]): void {
  panelTypes.set([
    ...BUILT_IN_PANEL_TYPES,
    ...panels.map(panel => ({ type: `project:${panel.name}` as PanelType, label: panel.title, icon: panel.icon ?? '▣' })),
  ]);
}

/**
 * Which groups are folded, and what each one unfolds to.
 *
 * A plain store rather than a rune, because the two things that read it are the
 * imperatively-built tab and header-action elements dockview asks us for — they
 * are outside any Svelte component and cannot see `$state`. One source of
 * truth: the class on the group element is derived from this, never set beside
 * it.
 */
export const foldedGroups: Writable<FoldMap> = writable(new Map());

export function isGroupFolded(groupId: string): boolean {
  return get(foldedGroups).has(groupId);
}

export function mountPanelTypeIcon(target: HTMLElement, type: PanelType): (() => void) | undefined {
  const icon = get(panelTypes).find(panel => panel.type === type)?.icon;
  if (!icon) return;
  // 12px, not 14: the tab strip is 20px now, and a 14px icon beside an
  // 11px label reads as the icon being the label.
  const instance = mount(PanelIcon, { target, props: { icon, size: 12 } });
  return () => { void unmount(instance); };
}

class DockviewStore {
  // Svelte 5 runes for reactive state
  private _api = $state<DockviewApi | null>(null);
  private _activePanel = $state<string | null>(null);
  private _panels = $state<Map<string, CascadePanelParams>>(new Map());
  private _isReady = $state(false);
  /** groupId -> the `.cascade-header-actions` element dockview asked us to
   *  build for that group. It is the only handle on a group's DOM that does not
   *  reach past dockview's public types (`IDockviewGroupPanel` deliberately
   *  does not expose `element`), and `closest('.dv-groupview')` from it gives
   *  the group root the folded class belongs on. */
  private _groupChrome = new Map<string, HTMLElement>();

  // Getters
  get api() { return this._api; }
  get activePanel() { return this._activePanel; }
  get panels() { return this._panels; }
  get isReady() { return this._isReady; }
  get minimizedGroups(): Map<string, MinimizedGroup> { return get(foldedGroups); }

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
        const el = document.createElement('div');
        el.className = 'cascade-header-actions';

        // Fold button. Folded, the whole strip becomes this button (CSS
        // stretches the actions container across it) — a 8px-tall glyph is not
        // a target anyone can hit, but a 8px-tall strip several hundred pixels
        // wide is, so the affordance is the strip rather than the icon.
        const foldBtn = document.createElement('button');
        foldBtn.className = 'cascade-fold-btn';
        const setFoldIcon = (folded: boolean) => {
          foldBtn.classList.toggle('folded', folded);
          foldBtn.title = folded ? 'Unfold panel' : 'Fold panel to a strip';
          foldBtn.setAttribute('aria-label', foldBtn.title);
          foldBtn.setAttribute('aria-expanded', folded ? 'false' : 'true');
          foldBtn.innerHTML = folded
            ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>`
            : `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
        };
        setFoldIcon(false);
        foldBtn.onclick = (e) => {
          e.stopPropagation();
          self.toggleMinimizeGroup(_group.id);
        };
        el.appendChild(foldBtn);

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

        let unsubscribeFold: (() => void) | null = null;

        return {
          element: el,
          init: () => {
            self.registerGroupChrome(_group.id, el);
            unsubscribeFold = foldedGroups.subscribe((map) => setFoldIcon(map.has(_group.id)));
          },
          dispose: () => {
            unsubscribeFold?.();
            self.unregisterGroupChrome(_group.id);
          }
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

        const iconSpan = document.createElement('span');
        iconSpan.className = 'cascade-tab-icon';
        element.appendChild(iconSpan);
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
        let disposeIcon: (() => void) | undefined;

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
            disposeIcon = mountPanelTypeIcon(iconSpan, panelType as PanelType);
            if (!disposeIcon) iconSpan.remove();

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
            disposeIcon?.();
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
      // Focusing a folded panel has to unfold it. Otherwise ⌘5 and View >
      // Focus Agent do exactly what they claim — the panel becomes active —
      // and nothing appears, which reads as a dead menu item rather than as a
      // folded panel.
      this.unfoldGroupContainingPanel(panelId);
      panel.api.setActive();
    }
  }

  /**
   * Focus a built-in panel, creating it if it is not open.
   *
   * `focusPanel` alone returns silently when the panel does not exist, which
   * made View > Focus Agent do nothing at all — the Agent panel is not in most
   * saved layouts, so the menu item was inert for exactly the people who needed
   * it. Marcus's point, 2026-09-07: a Focus command should bring the panel up.
   *
   * `neighbour` is where it belongs when it has to be created: the agent
   * console beside the log, the definition beside the parameters, matching the
   * default layout. If that neighbour is gone too, dockview places it on its
   * own rather than refusing.
   */
  focusOrOpenPanel(
    panelId: string,
    type: PanelType,
    title: string,
    neighbour?: string,
    /** Where to put it beside that neighbour. 'within' (a tab in the same
     *  group) is right for the panels that share a column; the Timeline is a
     *  wide, short strip and belongs below the graph instead. */
    position: 'left' | 'right' | 'above' | 'below' | 'within' = 'within'
  ): void {
    if (!this._api) return;
    if (this._api.getPanel(panelId)) {
      this.focusPanel(panelId);
      return;
    }
    const reference = neighbour && this._api.getPanel(neighbour) ? neighbour : undefined;
    this.addPanel({
      id: panelId,
      type,
      title,
      position: reference ? position : undefined,
      referencePanel: reference,
    });
    this.focusPanel(panelId);
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

  /** The group's root element, for the folded class. Reached through the
   *  header-action element we built for it rather than through the group
   *  object, which does not expose its DOM on the public interface. */
  private groupElement(groupId: string): HTMLElement | null {
    const chrome = this._groupChrome.get(groupId);
    return (chrome?.closest('.dv-groupview') as HTMLElement | null) ?? null;
  }

  /** Called by the header-action renderer dockview builds per group. */
  registerGroupChrome(groupId: string, element: HTMLElement): void {
    this._groupChrome.set(groupId, element);
    // A group can be rebuilt (a reload, a drag that re-creates it) while
    // already folded, so the class has to be re-applied from the record.
    // dockview calls init() before the header is necessarily in the document,
    // and `closest` finds nothing from a detached node — so if the group root
    // is not reachable yet, try once more after the current task.
    const apply = () => this.applyFoldClass(groupId, isGroupFolded(groupId));
    apply();
    if (!this.groupElement(groupId)) queueMicrotask(apply);
  }

  unregisterGroupChrome(groupId: string): void {
    this._groupChrome.delete(groupId);
  }

  private applyFoldClass(groupId: string, folded: boolean): void {
    this.groupElement(groupId)?.classList.toggle('cascade-group-folded', folded);
  }

  /**
   * Fold a group down to a hairline strip, remembering the size it had.
   *
   * Idempotent: folding a folded group is a no-op rather than an overwrite,
   * which matters because two affordances reach this (the header button and a
   * double-click on the tab title) and the second one must not record 8px as
   * the size to come back to.
   */
  foldGroup(groupId: string): void {
    if (!this._api) return;
    if (isGroupFolded(groupId)) return;

    const group = this._api.getGroup(groupId);
    if (!group) return;

    // foldAxis, not the older groupResizeAxis beside it — see the note on
    // layoutGroupSizes in fold.ts. Folding writes a real size to a real group,
    // so the wrong axis here would shrink the panel in the wrong direction.
    const axis = foldAxis(this._api.toJSON().grid, groupId);
    if (!axis) return;

    foldedGroups.update((map) => foldRecord(map, groupId, {
      size: group[axis],
      minimum: axis === 'width' ? group.minimumWidth : group.minimumHeight,
      axis,
    }));

    group.api.setConstraints(axis === 'width' ? { minimumWidth: FOLDED_SIZE } : { minimumHeight: FOLDED_SIZE });
    group.api.setSize({ [axis]: FOLDED_SIZE });
    this.applyFoldClass(groupId, true);
    this.saveFolds();
    // Both keys in one go: the layout carries the strip size, the fold key
    // carries what it comes back to, and a reload between the two halves is
    // the case adoptOrphanFolds exists to survive. No reason to leave the gap
    // open for the 30s the auto-save takes.
    this.saveLayout();
  }

  /** Restore a folded group to the size it had. No-op if it was not folded. */
  unfoldGroup(groupId: string): void {
    if (!this._api) return;

    let restore: MinimizedGroup | null = null;
    foldedGroups.update((map) => {
      const result = unfoldRecord(map, groupId);
      restore = result.restore;
      return result.map;
    });
    if (!restore) return;
    const record: MinimizedGroup = restore;

    const group = this._api.getGroup(groupId);
    // The class comes off either way: a fold record whose group has gone is
    // still a record to clear, and leaving it would fold the next group to
    // inherit that id.
    this.applyFoldClass(groupId, false);
    if (group) {
      group.api.setConstraints(record.axis === 'width'
        ? { minimumWidth: record.minimum }
        : { minimumHeight: record.minimum });
      group.api.setSize({ [record.axis]: record.size });
    }
    this.saveFolds();
    this.saveLayout();
  }

  /**
   * Toggle minimize/restore for a group
   */
  toggleMinimizeGroup(groupId: string): void {
    if (isGroupFolded(groupId)) this.unfoldGroup(groupId);
    else this.foldGroup(groupId);
  }

  /** Unfold whichever group holds this panel, if it is folded. */
  private unfoldGroupContainingPanel(panelId: string): void {
    const groupId = this._api?.getPanel(panelId)?.group?.id;
    if (groupId && isGroupFolded(groupId)) this.unfoldGroup(groupId);
  }

  /** The escape hatch: bring every folded group back. */
  unfoldAllGroups(): void {
    for (const groupId of [...get(foldedGroups).keys()]) this.unfoldGroup(groupId);
  }

  private saveFolds(): void {
    try {
      const map = get(foldedGroups);
      if (map.size === 0) localStorage.removeItem(FOLD_STORAGE_KEY);
      else localStorage.setItem(FOLD_STORAGE_KEY, JSON.stringify(serializeFolds(map)));
    } catch (error) {
      console.warn('Failed to save folded groups:', error);
    }
  }

  /**
   * Re-apply the folded groups a layout arrived with.
   *
   * Runs after `fromJSON`, since the sizes are already in the layout — what
   * this restores is the *constraint* (so the strip does not spring back on the
   * next relayout) and the class (so the strip is visibly a control). Any group
   * that arrives at strip size without a record is adopted, which is the only
   * thing standing between a shared `.cascade` document and a panel nobody can
   * find. See adoptOrphanFolds.
   */
  private restoreFolds(layout: SerializedDockview): void {
    if (!this._api) return;
    let map: FoldMap = new Map();
    try {
      const saved = localStorage.getItem(FOLD_STORAGE_KEY);
      if (saved) map = deserializeFolds(JSON.parse(saved));
    } catch (error) {
      console.warn('Failed to parse folded groups:', error);
    }

    map = adoptOrphanFolds(layout.grid, map);

    // A record for a group this layout does not contain is dead weight, and
    // group ids are reused, so it would fold an unrelated panel later.
    const live = new Set(this._api.groups.map((group) => group.id));
    for (const groupId of [...map.keys()]) {
      if (!live.has(groupId)) map = forgetFold(map, groupId);
    }

    foldedGroups.set(map);

    for (const [groupId, record] of map) {
      const group = this._api.getGroup(groupId);
      if (!group) continue;
      group.api.setConstraints(record.axis === 'width'
        ? { minimumWidth: FOLDED_SIZE }
        : { minimumHeight: FOLDED_SIZE });
      group.api.setSize({ [record.axis]: FOLDED_SIZE });
      this.applyFoldClass(groupId, true);
    }
    this.saveFolds();
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
      this.restoreFolds(layoutToLoad);
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
        id: 'timeline-main',
        component: 'timeline',
        title: 'Timeline',
        position: { referencePanel: 'graph-main', direction: 'below' },
        params: { id: 'timeline-main', type: 'timeline', title: 'Timeline' }
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
        id: 'agent-main',
        component: 'agent',
        title: 'Agent',
        position: { referencePanel: 'log-main', direction: 'within' },
        params: { id: 'agent-main', type: 'agent', title: 'Agent' }
      });

      this._api.addPanel({
        id: 'inspector-main',
        component: 'inspector',
        title: 'Parameters',
        position: { referencePanel: 'viewer-main', direction: 'right' },
        params: { id: 'inspector-main', type: 'inspector', title: 'Parameters' }
      });

      this._api.addPanel({
        id: 'definition-main',
        component: 'definition',
        title: 'Definition',
        position: { referencePanel: 'inspector-main', direction: 'within' },
        params: { id: 'definition-main', type: 'definition', title: 'Definition' }
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
    // Folds go with the layout they described. Keeping them would re-fold
    // groups in a layout the user just asked to be given back to them, and
    // Reset Layout is the last recovery step there is.
    foldedGroups.set(new Map());
    this.saveFolds();
    this._api.clear();
    this._api.fromJSON(this.getDefaultLayout());
    this.saveLayout();
  }

  /**
   * Default Studio panel layout.
   */
  private getDefaultLayout(): SerializedDockview {
    return {
      grid: {
        root: {
          type: 'branch',
          data: [
            // Left column: Graph, with the Timeline as a wide, short strip
            // beneath it — the transport is read along the same axis as the
            // graph it drives, and it needs width far more than height.
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
                  size: 620
                },
                {
                  type: 'leaf',
                  data: {
                    views: ['timeline-main'],
                    activeView: 'timeline-main',
                    id: 'group-timeline'
                  },
                  size: 180
                }
              ],
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
                    // The console sits beside the Log, as a tab in the same
                    // group: it is read in the same glance as the cook output.
                    views: ['log-main', 'agent-main'],
                    activeView: 'log-main',
                    id: 'group-log'
                  },
                  size: 200
                }
              ],
              size: 250
            },
            // Right column: Parameters (25%)
            {
              type: 'leaf',
              data: {
                views: ['inspector-main', 'definition-main'],
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
          title: 'Parameters',
          params: {
            id: 'inspector-main',
            type: 'inspector',
            title: 'Parameters'
          }
        },
        'definition-main': {
          id: 'definition-main',
          contentComponent: 'definition',
          title: 'Definition',
          params: {
            id: 'definition-main',
            type: 'definition',
            title: 'Definition'
          }
        },
        'timeline-main': {
          id: 'timeline-main',
          contentComponent: 'timeline',
          title: 'Timeline',
          params: {
            id: 'timeline-main',
            type: 'timeline',
            title: 'Timeline'
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
        },
        'agent-main': {
          id: 'agent-main',
          contentComponent: 'agent',
          title: 'Agent',
          params: {
            id: 'agent-main',
            type: 'agent',
            title: 'Agent'
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
    this._groupChrome.clear();
  }
}

// Singleton instance
export const dockviewStore = new DockviewStore();
