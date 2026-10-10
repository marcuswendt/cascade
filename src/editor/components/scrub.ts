/**
 * Value scrubbing: drag left/right to change a number, Houdini-style.
 *
 * Marcus, 2026-10-10: *"i want these vec2 / vec3 parameters to offer sliders.
 * houdini has a middle mouse button that turns a number field into a slider
 * that you can drag left-right with the middle mouse."* A vector component had
 * no way to drag at all, only a text box.
 *
 * Three ways in, because a Mac trackpad has no middle button:
 *
 * - **middle-drag on any number field** — Houdini's gesture;
 * - **left-drag on a label** (the X/Y letters, a scalar's name) — Blender and
 *   Figma's; a click without movement still does what the label did before;
 * - **Option/Alt-left-drag on the field itself**; an Alt-click without
 *   movement still reaches the row (which keys the parameter).
 *
 * Shift is ten times coarser, Ctrl/Cmd ten times finer, read on every move so
 * the modifier can change mid-drag. Ctrl is a modifier only once the drag has
 * begun: Ctrl-click deletes a key here, and on a Mac it is also a right-click.
 *
 * Writes are coalesced to one per animation frame and the frame loop exists
 * only while a drag is moving, so this adds nothing to an idle Studio. The
 * caller's `setValue` goes through the same path a typed edit does; the cook
 * scheduler coalesces from there.
 */

export interface ScrubMeta {
  min?: number;
  max?: number;
  step?: number | string;
  integer?: boolean;
}

export interface ScrubModifiers {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/** How far the value moves per pixel, before modifiers. Fixed at drag start so
 *  the rate does not change under the hand as the value grows. */
export function scrubPerPixel(meta: ScrubMeta, startValue: number): number {
  const { min, max } = meta;
  const step = typeof meta.step === 'number' && meta.step > 0 ? meta.step : undefined;
  if (meta.integer) return Math.max(step ?? 1, 1) / 4;
  // A stated range: the whole of it across ~300 px, the width of the panel.
  if (Number.isFinite(min) && Number.isFinite(max) && (max as number) > (min as number)) {
    return ((max as number) - (min as number)) / 300;
  }
  if (step !== undefined) return step;
  // Nothing declared: one hundredth of the value's order of magnitude, never
  // slower than 0.01 so a value at or near zero can still leave it.
  const magnitude = Math.abs(startValue);
  const order = magnitude < 1 || !Number.isFinite(magnitude) ? 1 : 10 ** Math.floor(Math.log10(magnitude));
  return order * 0.01;
}

export function scrubMultiplier(mods: ScrubModifiers): number {
  let multiplier = 1;
  if (mods.shiftKey) multiplier *= 10;
  if (mods.ctrlKey || mods.metaKey) multiplier *= 0.1;
  return multiplier;
}

export function clampScrub(value: number, meta: ScrubMeta): number {
  let next = value;
  if (Number.isFinite(meta.min) && next < (meta.min as number)) next = meta.min as number;
  if (Number.isFinite(meta.max) && next > (meta.max as number)) next = meta.max as number;
  return next;
}

/** The value as it should be written: clamped, snapped for ints, and rounded to
 *  the precision the drag can actually express, so a field never shows
 *  0.30000000000000004. */
export function quantizeScrub(value: number, perPixel: number, meta: ScrubMeta): number {
  const clamped = clampScrub(value, meta);
  if (meta.integer) return Math.round(clamped);
  const decimals = Math.min(8, Math.max(0, Math.ceil(-Math.log10(perPixel)) + 1));
  return Number(clamped.toFixed(decimals));
}

/** One drag from a start value: pixels in, value out. Pure, so it is tested. */
export function createScrubState(startValue: number, meta: ScrubMeta) {
  const base = scrubPerPixel(meta, startValue);
  let raw = startValue;
  return {
    move(dx: number, mods: ScrubModifiers): number {
      const perPixel = base * scrubMultiplier(mods);
      // The running value is clamped too, so pushing past a limit does not
      // leave a dead zone to drag back through.
      raw = clampScrub(raw + dx * perPixel, meta);
      return quantizeScrub(raw, perPixel, meta);
    },
    get perPixel() { return base; },
  };
}

export interface ScrubOptions {
  getValue: () => number;
  setValue: (value: number) => void;
  meta?: () => ScrubMeta;
  /** A label: a plain left-drag scrubs. Otherwise the element is a field, and
   *  only middle-drag or Alt-left-drag do. */
  handle?: boolean;
  disabled?: () => boolean;
}

const THRESHOLD_PX = 3;
const ACTIVE_ROOT_CLASS = 'cascade-scrubbing';

/** A Svelte action, also callable by hand on an element supplied from outside. */
export function scrub(element: HTMLElement, initial: ScrubOptions) {
  let options = initial;
  if (options.handle) element.setAttribute('data-scrub-handle', '');

  let session: {
    button: number;
    active: boolean;
    travelled: number;
    lastX: number;
    start: number;
    state: ReturnType<typeof createScrubState> | null;
    pending: number | null;
    emitted: number;
    frame: number | null;
  } | null = null;

  const pointerLocked = () => typeof document !== 'undefined' && document.pointerLockElement === element;

  function emit(): void {
    if (!session || session.pending === null) return;
    const next = session.pending;
    session.pending = null;
    if (next === session.emitted) return;
    session.emitted = next;
    options.setValue(next);
  }

  function schedule(): void {
    if (!session || session.frame !== null) return;
    if (typeof requestAnimationFrame !== 'function') { emit(); return; }
    session.frame = requestAnimationFrame(() => {
      if (!session) return;
      session.frame = null;
      emit();
    });
  }

  function activate(): void {
    if (!session) return;
    session.active = true;
    session.start = Number(options.getValue()) || 0;
    session.emitted = session.start;
    session.state = createScrubState(session.start, options.meta?.() ?? {});
    element.setAttribute('data-scrubbing', '');
    document.documentElement.classList.add(ACTIVE_ROOT_CLASS);
    // Pointer lock so the drag is not stopped by the screen edge. Optional:
    // without it (refused, or jsdom) the window listeners still follow the
    // pointer, bounded by the screen.
    try {
      const result = (element as any).requestPointerLock?.();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch { /* fallback: unlocked drag */ }
  }

  function onMove(event: MouseEvent): void {
    if (!session) return;
    const dx = pointerLocked() || (event.movementX !== undefined && event.movementX !== 0)
      ? event.movementX
      : event.clientX - session.lastX;
    session.lastX = event.clientX;
    // Chromium can report one wild movementX right after the lock engages.
    if (Math.abs(dx) > 400) return;
    if (!session.active) {
      session.travelled += Math.abs(dx);
      if (session.travelled < THRESHOLD_PX) return;
      activate();
    }
    event.preventDefault();
    session.pending = session.state!.move(dx, event);
    schedule();
  }

  function swallowOnce(type: string): void {
    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      window.removeEventListener(type, swallow, true);
    };
    window.addEventListener(type, swallow, true);
    // A click only follows when press and release hit the same element; never
    // leave the trap armed for an unrelated later click.
    setTimeout(() => window.removeEventListener(type, swallow, true), 0);
  }

  function finish(cancel: boolean): void {
    if (!session) return;
    const ending = session;
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('contextmenu', onContextMenu, true);
    if (ending.frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(ending.frame);
    ending.frame = null;
    if (ending.active) {
      if (cancel) {
        ending.pending = null;
        if (ending.emitted !== ending.start) options.setValue(ending.start);
      } else {
        emit();
      }
      element.removeAttribute('data-scrubbing');
      document.documentElement.classList.remove(ACTIVE_ROOT_CLASS);
      if (pointerLocked()) document.exitPointerLock?.();
      swallowOnce(ending.button === 1 ? 'auxclick' : 'click');
    }
    session = null;
  }

  /** Capture phase on window, so the last value lands before the Inspector's
   *  own mouseup resets its once-per-gesture undo flag: one drag, one entry. */
  function onUp(event: MouseEvent): void {
    if (session && event.button === session.button) finish(false);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && session?.active) {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    }
  }

  const onBlur = () => finish(false);
  const onContextMenu = (event: Event) => {
    if (!session?.active) return;
    event.preventDefault();
    event.stopPropagation();
  };

  function onDown(event: MouseEvent): void {
    if (session || options.disabled?.()) return;
    const middle = event.button === 1;
    const left = event.button === 0 && !event.ctrlKey;
    const wanted = middle
      || (left && options.handle && !event.altKey)
      || (left && !options.handle && event.altKey);
    if (!wanted) return;
    // Stops middle-button autoscroll, text selection, the native drag of a
    // draggable label, and the field taking focus. A click with no movement
    // still arrives afterwards, so a label still focuses its field.
    event.preventDefault();
    session = {
      button: event.button,
      active: false,
      travelled: 0,
      lastX: event.clientX,
      start: 0,
      state: null,
      pending: null,
      emitted: 0,
      frame: null,
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('contextmenu', onContextMenu, true);
    // Houdini's gesture is immediate: a middle press is never a click.
    if (middle) activate();
  }

  /** Middle-click paste (Linux) and middle-click link opening. */
  function onAuxClick(event: MouseEvent): void {
    if (event.button === 1) event.preventDefault();
  }

  element.addEventListener('mousedown', onDown);
  element.addEventListener('auxclick', onAuxClick);

  return {
    update(next: ScrubOptions) {
      options = next;
      if (options.handle) element.setAttribute('data-scrub-handle', '');
      else element.removeAttribute('data-scrub-handle');
    },
    destroy() {
      finish(false);
      element.removeEventListener('mousedown', onDown);
      element.removeEventListener('auxclick', onAuxClick);
      element.removeAttribute('data-scrub-handle');
    },
  };
}
