/**
 * The exported editor on a phone: the preview's pinch, pan and double-tap, the
 * bottom sheet's drag and snap points, and sharing a file instead of
 * downloading it. Pure math is exported separately so it can be tested without
 * a browser.
 */

export interface ZoomState {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export const FIT: ZoomState = { scale: 1, x: 0, y: 0 };
const MAX_SCALE = 8;

interface Point { readonly x: number; readonly y: number }

/**
 * The transform for a pinch that started at `from` (two fingers, a midpoint and
 * a distance) with the picture at `start`, now at `to`. The point under the
 * fingers stays under them, and moving both fingers pans.
 */
export function pinch(start: ZoomState, from: { mid: Point; distance: number }, to: { mid: Point; distance: number }): ZoomState {
  const scale = clamp(start.scale * (to.distance / Math.max(1, from.distance)), 1, MAX_SCALE);
  const ratio = scale / start.scale;
  return {
    scale,
    x: to.mid.x - (from.mid.x - start.x) * ratio,
    y: to.mid.y - (from.mid.y - start.y) * ratio,
  };
}

/** Keep a zoomed picture covering its box: no pulling an edge into the middle. */
export function bound(state: ZoomState, width: number, height: number): ZoomState {
  if (state.scale <= 1.001) return FIT;
  const minX = width - width * state.scale;
  const minY = height - height * state.scale;
  return { scale: state.scale, x: clamp(state.x, minX, 0), y: clamp(state.y, minY, 0) };
}

/** Zoom in around a point (a double-tap on a picture at fit). */
export function zoomAt(point: Point, scale: number): ZoomState {
  return { scale, x: point.x - point.x * scale, y: point.y - point.y * scale };
}

/**
 * The snap point a released sheet settles on: the nearest one, unless the
 * finger was flicked, in which case the next one in that direction.
 * `velocity` is in px/ms, positive when the sheet is growing.
 */
export function settle(height: number, velocity: number, snaps: readonly number[]): number {
  const sorted = [...snaps].sort((a, b) => a - b);
  if (Math.abs(velocity) > 0.5) {
    if (velocity > 0) return sorted.find((snap) => snap > height + 1) ?? sorted[sorted.length - 1]!;
    return [...sorted].reverse().find((snap) => snap < height - 1) ?? sorted[0]!;
  }
  return sorted.reduce((best, snap) => (Math.abs(snap - height) < Math.abs(best - height) ? snap : best), sorted[0]!);
}

/** A step for a numeric stepper: the declared one, else a hundredth of the range, else 1. */
export function stepOf(step: number | undefined, min: number | undefined, max: number | undefined, integer: boolean): number {
  if (step !== undefined && step > 0) return step;
  if (integer) return 1;
  if (min !== undefined && max !== undefined && max > min) return niceStep((max - min) / 100);
  return 1;
}

function niceStep(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  const fraction = value / power;
  return (fraction < 1.5 ? 1 : fraction < 3.5 ? 2 : fraction < 7.5 ? 5 : 10) * power;
}

/** One stepper press: add a step, stay in range, and drop float noise. */
export function stepValue(value: number, direction: 1 | -1, step: number, min?: number, max?: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 2);
  const next = Number((value + direction * step).toFixed(Math.min(10, decimals)));
  return clamp(next, min ?? -Infinity, max ?? Infinity);
}

/** Which tenth of the range a value is in, so a slider can tick as it crosses one. */
export function notch(value: number, min: number, max: number): number {
  return max > min ? Math.round(((value - min) / (max - min)) * 10) : 0;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pinch, pan and double-tap on `surface`, moving `layer`. `enabled` is read on
 * every gesture, so the same element works on a desktop where it does nothing.
 */
export function attachZoom(surface: HTMLElement, layer: HTMLElement, enabled: () => boolean): { reset(): void } {
  let state: ZoomState = FIT;
  const pointers = new Map<number, Point>();
  let gesture: { start: ZoomState; mid: Point; distance: number } | undefined;
  let lastTap = { time: 0, x: 0, y: 0 };
  let moved = false;
  const apply = (next: ZoomState, animate = false) => {
    const box = surface.getBoundingClientRect();
    state = bound(next, box.width, box.height);
    layer.style.transition = animate ? 'transform 180ms ease-out' : '';
    layer.style.transform = state.scale === 1 ? '' : `translate(${state.x}px,${state.y}px) scale(${state.scale})`;
  };
  const local = (event: PointerEvent): Point => {
    const box = surface.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const begin = () => {
    const points = [...pointers.values()];
    if (points.length >= 2) {
      const [a, b] = points as [Point, Point];
      gesture = { start: state, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y) };
    } else if (points.length === 1) {
      gesture = { start: state, mid: points[0]!, distance: 0 };
    } else gesture = undefined;
  };
  surface.addEventListener('pointerdown', (event) => {
    if (!enabled()) return;
    surface.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, local(event));
    moved = false;
    begin();
  });
  surface.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, local(event));
    const points = [...pointers.values()];
    if (points.length >= 2 && gesture.distance > 0) {
      const [a, b] = points as [Point, Point];
      moved = true;
      apply(pinch(gesture.start, gesture, { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y) }));
    } else if (points.length === 1 && gesture.start.scale > 1) {
      const point = points[0]!;
      if (Math.hypot(point.x - gesture.mid.x, point.y - gesture.mid.y) > 4) moved = true;
      apply({ ...gesture.start, x: gesture.start.x + point.x - gesture.mid.x, y: gesture.start.y + point.y - gesture.mid.y });
    }
  });
  const end = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    const point = local(event);
    pointers.delete(event.pointerId);
    begin();
    if (pointers.size || moved || event.type === 'pointercancel') return;
    const now = performance.now();
    if (now - lastTap.time < 320 && Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < 30) {
      apply(state.scale > 1 ? FIT : zoomAt(point, 2.5), true);
      lastTap = { time: 0, x: 0, y: 0 };
    } else lastTap = { time: now, x: point.x, y: point.y };
  };
  surface.addEventListener('pointerup', end);
  surface.addEventListener('pointercancel', end);
  // Safari's own page pinch, which touch-action alone does not always stop.
  surface.addEventListener('gesturestart', (event) => { if (enabled()) event.preventDefault(); });
  return { reset: () => apply(FIT) };
}

/**
 * Drag `grip` to resize the sheet between `snaps()` heights; tap it to step
 * through them. `onHeight` is called on every frame and on settling.
 */
export function attachSheet(grip: HTMLElement, options: {
  enabled(): boolean;
  height(): number;
  snaps(): readonly number[];
  onHeight(height: number, settled: boolean): void;
}): void {
  let drag: { id: number; y: number; height: number; time: number; velocity: number; last: number; moved: boolean } | undefined;
  grip.addEventListener('pointerdown', (event) => {
    if (!options.enabled()) return;
    if ((event.target as HTMLElement | null)?.closest?.('input,select,textarea,button')) return;
    grip.setPointerCapture?.(event.pointerId);
    drag = { id: event.pointerId, y: event.clientY, height: options.height(), time: performance.now(), velocity: 0, last: event.clientY, moved: false };
  });
  grip.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const now = performance.now();
    const dt = Math.max(1, now - drag.time);
    drag.velocity = (drag.last - event.clientY) / dt;
    drag.time = now;
    drag.last = event.clientY;
    if (Math.abs(event.clientY - drag.y) > 4) drag.moved = true;
    const snaps = options.snaps();
    const height = clamp(drag.height + drag.y - event.clientY, Math.min(...snaps) - 24, Math.max(...snaps));
    options.onHeight(height, false);
  });
  const end = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    const snaps = [...options.snaps()].sort((a, b) => a - b);
    if (!drag.moved) {
      // A tap steps up, and from the top back down to the peek.
      const current = options.height();
      const next = snaps.find((snap) => snap > current + 1) ?? snaps[0]!;
      options.onHeight(next, true);
    } else options.onHeight(settle(options.height(), drag.velocity, snaps), true);
    drag = undefined;
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

/**
 * Hand a file to the phone's share sheet (Save to Files, Photos, AirDrop),
 * falling back to a download. Resolves to what happened. A share that needs a
 * fresh tap (the cook took too long for the browser's gesture window) returns
 * 'needs-tap' so the caller can offer a button.
 */
export async function shareFile(name: string, blob: Blob, fallback: () => void): Promise<'shared' | 'cancelled' | 'downloaded' | 'needs-tap'> {
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav && typeof nav.share === 'function' && typeof File !== 'undefined') {
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    if (nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: name });
        return 'shared';
      } catch (error) {
        const kind = (error as { name?: string } | null)?.name;
        if (kind === 'AbortError') return 'cancelled';
        if (kind === 'NotAllowedError') return 'needs-tap';
      }
    }
  }
  fallback();
  return 'downloaded';
}

/** A light tick where the platform has one (Android); nothing elsewhere. */
export function tick(): void {
  try { (globalThis.navigator as Navigator | undefined)?.vibrate?.(4); } catch { /* not allowed */ }
}
