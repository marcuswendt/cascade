/**
 * Which panel owns the keyboard right now.
 *
 * Studio's panels bind their shortcuts on `window`, which is the only way to
 * catch a key while nothing inside the panel has focus. The cost is that every
 * such listener hears every key: the graph canvas zoomed on a bare `+` no
 * matter which panel you were pointing at, and once the agent console took the
 * cmd forms as well, one keystroke moved two panels.
 *
 * So a panel marks its root with `data-panel-scope="<name>"` and asks whether
 * it owns the keyboard before acting. Ownership is the pointer first and the
 * focus second, in that order, because a panel you are pointing at is the one
 * you mean — you have not necessarily clicked it, and requiring a click to
 * zoom what is under the cursor is the behaviour nobody expects.
 *
 * Hover is read with `matches(':hover')` rather than by tracking pointer
 * events, so there is no state to keep in sync and no listener to leak.
 */

/** Depth from the document root — used to pick the innermost hovered scope. */
function depth(element: Element): number {
  let n = 0;
  let at: Element | null = element;
  while ((at = at.parentElement)) n += 1;
  return n;
}

/**
 * The scope element that owns the keyboard, or null when the pointer is over
 * nothing scoped and focus is outside every scope.
 */
export function keyboardScopeElement(doc: Document = document): HTMLElement | null {
  const scopes = Array.from(doc.querySelectorAll<HTMLElement>('[data-panel-scope]'));
  if (scopes.length === 0) return null;

  // Nested scopes both match `:hover`, so the innermost wins.
  const hovered = scopes.filter(scope => scope.matches(':hover'));
  if (hovered.length > 0) {
    return hovered.reduce((deepest, scope) => (depth(scope) > depth(deepest) ? scope : deepest));
  }

  const active = doc.activeElement;
  if (active instanceof HTMLElement) {
    const owner = active.closest<HTMLElement>('[data-panel-scope]');
    if (owner) return owner;
  }
  return null;
}

/** The name of the owning scope, e.g. `'graph'` or `'agent'`. */
export function keyboardScope(doc: Document = document): string | null {
  return keyboardScopeElement(doc)?.dataset.panelScope ?? null;
}

/**
 * Whether `name` owns the keyboard. A null owner means nothing is hovered and
 * focus is loose, and in that case the answer is **yes** — otherwise marking
 * one panel with a scope would silently disable every shortcut in the app the
 * moment the pointer sat over a gap between panels.
 */
export function ownsKeyboard(name: string, doc: Document = document): boolean {
  const owner = keyboardScope(doc);
  return owner === null || owner === name;
}
