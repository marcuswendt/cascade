/**
 * Keeps a fixed-position popup inside the window.
 *
 * Menus in Studio are anchored to the button that opened them, and several of
 * those buttons sit at the right edge of their container — the panel group's
 * add button most of all. Anchoring alone put the menu off-screen there, which
 * reads as the button being broken rather than as a layout problem.
 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * Slides the popup back inside the viewport rather than flipping it, so it
 * stays visually attached to its button. A popup larger than the viewport is
 * pinned to the top-left margin, since there is no placement that fits and
 * losing the first entries is worse than losing the last.
 */
export function clampToViewport(anchor: Point, size: Size, viewport: Size, margin = 8): Point {
  return {
    x: Math.max(margin, Math.min(anchor.x, viewport.width - size.width - margin)),
    y: Math.max(margin, Math.min(anchor.y, viewport.height - size.height - margin)),
  };
}
