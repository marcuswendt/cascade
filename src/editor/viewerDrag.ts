/**
 * Show-in-viewer: drag a node out of the Graph panel and drop it on a Viewer
 * to pin that viewer to it.
 *
 * A node drag inside the graph still moves the node. Once the pointer leaves
 * the graph panel the drag turns into a show-in-viewer drag: the canvas drag
 * is ended with the node back where it started (nothing committed), and a
 * small ghost carrying the node's name follows the pointer. Cmd-drag on a node
 * starts the show-in-viewer drag at once, without moving it.
 *
 * Drop targets are any element carrying `data-viewer-drop="<panelId>"` — the
 * Viewer panel body and its tab.
 *
 * This module never reaches into Canvas state. It ends Canvas's own drag the
 * way Canvas already understands: a mousemove back to the press point (delta
 * zero, so Canvas puts every dragged item back itself) and a mouseup there.
 */
import type { Graph } from '@/nodes/Graph';
import type { Node } from '@/nodes/Node';
import { lockPanelToNode } from './dockview/renderer';

/** Pixels of travel before Cmd-drag commits to show-in-viewer. */
const CMD_DRAG_THRESHOLD = 4;
export const DROP_TARGET_CLASS = 'cascade-viewer-drop-target';

/** "Viewer · render-composite". The lock itself is the tab's lock icon. */
export function viewerTitle(nodeId: string | null, annotationLabel: string | null = null): string {
  const shown = nodeId ?? annotationLabel;
  return shown ? `Viewer · ${shown}` : 'Viewer';
}

/** True when a press on `target` is a press on a node body, not on a port,
 *  button or field inside it (those start connections or edit values). */
export function nodeBodyUnder(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest('[data-port-id], button, input, textarea, select, [contenteditable="true"]')) return null;
  const node = target.closest('.node[data-node-id]');
  return node instanceof HTMLElement ? node : null;
}

export function viewerDropTargetAt(x: number, y: number, doc: Document = document): HTMLElement | null {
  const hit = doc.elementFromPoint(x, y);
  const target = hit?.closest('[data-viewer-drop]');
  return target instanceof HTMLElement ? target : null;
}

function outside(rect: DOMRect, x: number, y: number): boolean {
  return x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom;
}

export interface ShowInViewerOptions {
  /** The Graph panel: leaving it is what turns a move into a show-in-viewer. */
  panel: HTMLElement;
  getGraph: () => Graph | undefined;
  /** Called after a drop pinned a viewer. */
  onDrop?: (panelId: string, node: Node) => void;
}

type Press = {
  nodeId: string;
  x: number;
  y: number;
  cmd: boolean;
  /** The canvas element the press landed in, to hand Canvas its drag end. */
  canvas: HTMLElement | null;
};

/**
 * Attach the gesture to a Graph panel. Returns the detach function.
 */
export function attachShowInViewerDrag(options: ShowInViewerOptions): () => void {
  const { panel, getGraph } = options;
  const doc = panel.ownerDocument;
  const win = doc.defaultView ?? window;

  let press: Press | null = null;
  let active: { node: Node; ghost: HTMLElement } | null = null;
  let hovered: HTMLElement[] = [];
  /** Set while handing Canvas its synthetic drag end, which our own window
   *  listeners would otherwise read as the user's release. */
  let synthesizing = false;

  function setHovered(panelId: string | null) {
    const next = panelId
      ? Array.from(doc.querySelectorAll<HTMLElement>('[data-viewer-drop]')).filter(el => el.dataset.viewerDrop === panelId)
      : [];
    if (next.length === hovered.length && next.every((el, i) => el === hovered[i])) return;
    for (const el of hovered) el.classList.remove(DROP_TARGET_CLASS);
    for (const el of next) el.classList.add(DROP_TARGET_CLASS);
    hovered = next;
  }

  function moveGhost(ghost: HTMLElement, x: number, y: number) {
    ghost.style.transform = `translate(${x + 12}px, ${y + 10}px)`;
  }

  /** End Canvas's own node drag with nothing moved. */
  function endCanvasDrag(p: Press) {
    const target = p.canvas;
    if (!target?.isConnected) return;
    const init = { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0 };
    synthesizing = true;
    try {
      target.dispatchEvent(new MouseEvent('mousemove', { ...init, buttons: 1 }));
      target.dispatchEvent(new MouseEvent('mouseup', init));
    } finally {
      synthesizing = false;
    }
  }

  function begin(p: Press, x: number, y: number): boolean {
    const node = getGraph()?.getNode(p.nodeId);
    if (!node) return false;
    endCanvasDrag(p);
    const ghost = doc.createElement('div');
    ghost.className = 'cascade-viewer-drag-ghost';
    ghost.textContent = node.id;
    Object.assign(ghost.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      zIndex: '10000',
      pointerEvents: 'none',
      padding: '3px 8px',
      borderRadius: '4px',
      font: '11px/1.4 var(--font-mono, ui-monospace, monospace)',
      color: 'var(--text-primary)',
      background: 'var(--surface-raised, var(--surface-active))',
      border: '1px solid var(--accent)',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
      whiteSpace: 'nowrap',
    } satisfies Partial<CSSStyleDeclaration>);
    moveGhost(ghost, x, y);
    doc.body.appendChild(ghost);
    doc.body.style.cursor = 'copy';
    active = { node, ghost };
    return true;
  }

  function finish() {
    active?.ghost.remove();
    if (active) doc.body.style.cursor = '';
    active = null;
    press = null;
    setHovered(null);
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0 || e.altKey) return;
    const nodeEl = nodeBodyUnder(e.target);
    const nodeId = nodeEl?.dataset.nodeId;
    if (!nodeEl || !nodeId) return;
    const canvas = nodeEl.closest('.canvas');
    press = {
      nodeId,
      x: e.clientX,
      y: e.clientY,
      cmd: e.metaKey,
      canvas: canvas instanceof HTMLElement ? canvas : null,
    };
  }

  function onMouseMove(e: MouseEvent) {
    if (!press || synthesizing) return;
    if (!active) {
      if ((e.buttons & 1) === 0) {
        press = null;
        return;
      }
      const left = outside(panel.getBoundingClientRect(), e.clientX, e.clientY);
      const cmdGo = press.cmd && Math.hypot(e.clientX - press.x, e.clientY - press.y) > CMD_DRAG_THRESHOLD;
      if (!left && !cmdGo) return;
      if (!begin(press, e.clientX, e.clientY)) {
        press = null;
        return;
      }
    }
    // While carrying the ghost, the canvas must not see the move.
    e.stopPropagation();
    moveGhost(active!.ghost, e.clientX, e.clientY);
    setHovered(viewerDropTargetAt(e.clientX, e.clientY, doc)?.dataset.viewerDrop ?? null);
  }

  function onMouseUp(e: MouseEvent) {
    if (synthesizing) return;
    if (!active) {
      press = null;
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    const panelId = viewerDropTargetAt(e.clientX, e.clientY, doc)?.dataset.viewerDrop;
    const { node } = active;
    finish();
    if (panelId) {
      lockPanelToNode(panelId, node, getGraph());
      options.onDrop?.(panelId, node);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (active && e.key === 'Escape') {
      e.stopPropagation();
      finish();
    }
  }

  // Capture on the panel sees the press before the node's own handler
  // (which stops propagation); capture on the window sees every move and
  // release, wherever the pointer has gone.
  panel.addEventListener('mousedown', onMouseDown, true);
  win.addEventListener('mousemove', onMouseMove, true);
  win.addEventListener('mouseup', onMouseUp, true);
  win.addEventListener('keydown', onKeyDown, true);
  return () => {
    finish();
    panel.removeEventListener('mousedown', onMouseDown, true);
    win.removeEventListener('mousemove', onMouseMove, true);
    win.removeEventListener('mouseup', onMouseUp, true);
    win.removeEventListener('keydown', onKeyDown, true);
  };
}
