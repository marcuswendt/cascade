/**
 * Studio paints the viewed node before it cooks anything else.
 *
 * The scheduler already cooks the watched node's upstream first in a pass
 * (`CookScheduler.viewerFirst`), but it runs straight on into the rest of the
 * pass without giving the browser a frame. Measured 2026-11-07 on field-logo
 * (hue slider, Viewer on hue): hue was cooked and saved at 51 ms, its picture
 * arrived at 124 ms, and then watercolor — downstream, not on screen — held the
 * main thread for ~300 ms, so the slider painted at 459 ms.
 *
 * This is the Studio half of the ordering, kept here rather than in the
 * scheduler (which the CLI and tests share and the image-node port rewrites).
 * It wraps the scheduler's one-node step for a Studio graph:
 *
 *   - after a watched node cooks, the next node outside the watched closure
 *     waits until the Viewer has shown the new output (its image has loaded,
 *     then a frame), capped so a Viewer that never reloads costs little;
 *   - while a parameter control is held (a range slider pressed, a number
 *     field scrubbing), nodes outside the watched closure do not start at all:
 *     the pass parks on the first of them and each new input supersedes it, so
 *     a drag cooks only what is on screen and the rest cooks on release.
 *
 * A node that waited and was invalidated meanwhile is not cooked: it is handed
 * back stale (or queued), which the scheduler already treats as superseded
 * and picks up in its next pass. With nothing watched — CLI, tests, cook-all —
 * nothing changes.
 */
import type { Graph } from '@/nodes/Graph';
import type { Node } from '@/nodes/Node';

/** The scheduler members this wraps; private in its type, stable in shape. */
interface SchedulerStep {
  executeInteractive(node: Node): Promise<void>;
  invalidatedDuringRun: boolean;
}

/** Whether a parameter control is held, and a way to hear it change. */
export interface ParameterGesture {
  held(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface ViewedFirstOptions {
  /** Resolves once the Viewer has shown the watched node's newest output. */
  viewerPainted?: () => Promise<void>;
  gesture?: ParameterGesture;
}

/** The class `scrub.ts` puts on <html> while a number field scrubs. */
const SCRUB_ROOT_CLASS = 'cascade-scrubbing';
/** How long a downstream node waits for the Viewer's picture at most. */
const PAINT_WAIT_MS = 300;

/** One frame, or 100 ms where frames do not run (a hidden tab). */
function nextFrame(): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 100);
    if (typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * The Viewer re-points its <img data-cascade-src> at the new cook and the
 * browser can only paint it between tasks, so wait for that image's load
 * (or error), then a frame. No Viewer image on screen: a frame is enough.
 */
export function viewerImagePainted(doc: Document = document, timeoutMs = PAINT_WAIT_MS): Promise<void> {
  if (!doc.querySelector('img[data-cascade-src]')) return nextFrame();
  return new Promise<void>(resolve => {
    const done = () => {
      clearTimeout(timer);
      doc.removeEventListener('load', onEvent, true);
      doc.removeEventListener('error', onEvent, true);
      void nextFrame().then(resolve);
    };
    const onEvent = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'IMG' && target.hasAttribute('data-cascade-src')) done();
    };
    const timer = setTimeout(done, timeoutMs);
    doc.addEventListener('load', onEvent, true);
    doc.addEventListener('error', onEvent, true);
  });
}

/**
 * Held while a range slider is pressed or a number field scrubs. Read from
 * events on the window and the class `scrub.ts` sets, so the controls
 * themselves need nothing.
 */
export function pointerParameterGesture(win: Window = window): ParameterGesture & { dispose(): void } {
  const listeners = new Set<() => void>();
  const root = win.document.documentElement;
  let rangeHeld = false;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const onDown = (event: Event) => {
    const target = event.target as Element | null;
    if (target?.closest?.('input[type="range"]')) {
      rangeHeld = true;
      notify();
    }
  };
  const onUp = () => {
    if (!rangeHeld) return;
    rangeHeld = false;
    notify();
  };
  win.addEventListener('pointerdown', onDown, true);
  win.addEventListener('pointerup', onUp, true);
  win.addEventListener('pointercancel', onUp, true);
  win.addEventListener('blur', onUp);
  const observer = typeof MutationObserver === 'function' ? new MutationObserver(notify) : null;
  observer?.observe(root, { attributes: true, attributeFilter: ['class'] });
  return {
    held: () => rangeHeld || root.classList.contains(SCRUB_ROOT_CLASS),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      win.removeEventListener('pointerdown', onDown, true);
      win.removeEventListener('pointerup', onUp, true);
      win.removeEventListener('pointercancel', onUp, true);
      win.removeEventListener('blur', onUp);
      observer?.disconnect();
      listeners.clear();
    },
  };
}

/** What the watched nodes need: themselves and everything upstream. */
function watchedClosure(graph: Graph): Set<string> {
  const needed = new Set<string>();
  const visit = (id: string): void => {
    if (needed.has(id)) return;
    const node = graph.getNode(id);
    if (!node) return;
    needed.add(id);
    for (const input of node.inputs) {
      for (const connection of input.connections) visit(connection.from.nodeId);
    }
  };
  for (const id of graph.scheduler.watchedNodeIds) visit(id);
  return needed;
}

/** Install on a Studio graph; returns the uninstall. */
export function paintViewedFirst(graph: Graph, options: ViewedFirstOptions = {}): () => void {
  const scheduler = graph.scheduler as unknown as SchedulerStep;
  const original = scheduler.executeInteractive;
  const ownStep = Object.prototype.hasOwnProperty.call(scheduler, 'executeInteractive');
  const viewerPainted = options.viewerPainted ?? (() => viewerImagePainted());
  const gesture = options.gesture;
  /** A watched node cooked and the Viewer has not been given a frame since. */
  let owesPaint = false;

  /** Resolves when the pass has moved on without this node. */
  const overtaken = (node: Node): { promise: Promise<void>; stop: () => void } => {
    let stop = () => {};
    const promise = new Promise<void>(resolve => {
      const unsubscribe = graph.scheduler.subscribe(() => {
        if (node.cookState !== 'cooking' || scheduler.invalidatedDuringRun) resolve();
      });
      stop = unsubscribe;
    });
    return { promise, stop };
  };

  const released = (): Promise<void> => new Promise(resolve => {
    if (!gesture?.held()) return resolve();
    const unsubscribe = gesture.subscribe(() => {
      if (gesture.held()) return;
      unsubscribe();
      resolve();
    });
  });

  /** Wait for the Viewer and the hand; false when the node should not cook now. */
  const holdBack = async (node: Node): Promise<boolean> => {
    const watch = overtaken(node);
    try {
      let moved = false;
      void watch.promise.then(() => { moved = true; });
      if (owesPaint) {
        owesPaint = false;
        await Promise.race([viewerPainted(), watch.promise]);
      }
      while (!moved && gesture?.held()) await Promise.race([released(), watch.promise]);
    } finally {
      watch.stop();
    }
    if (node.cookState !== 'cooking') return false;
    if (scheduler.invalidatedDuringRun) {
      // Not cooked, still needed: the next pass picks queued nodes up.
      node.setCookState('queued');
      return false;
    }
    return true;
  };

  scheduler.executeInteractive = async function step(this: unknown, node: Node): Promise<void> {
    const closure = graph.scheduler.watchedNodeIds.size ? watchedClosure(graph) : null;
    if (!closure || closure.has(node.id)) {
      await original.call(scheduler, node);
      if (closure) owesPaint = true;
      return;
    }
    if ((owesPaint || gesture?.held()) && !(await holdBack(node))) return;
    await original.call(scheduler, node);
  };

  return () => {
    if (ownStep) scheduler.executeInteractive = original;
    else delete (scheduler as Partial<SchedulerStep>).executeInteractive;
  };
}
