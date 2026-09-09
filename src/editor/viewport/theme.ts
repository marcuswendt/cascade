import type { Vec4 } from '@cascade/contracts';

/**
 * The viewport's colours, read from the theme rather than chosen here.
 *
 * Marcus, 2026-09-09: *"the 3d viewer has a different background color which is
 * confusing … use the same as the network panel."* It was `#16181c`, invented,
 * against the network panel's `--surface-void`.
 *
 * The background is the visible half of that mistake. **The stroke was the
 * worse half**: a hard-coded near-white default, and `theme.css` carries a
 * light mode where `--surface-void` is `#eef0f2` — so every unstyled geometry
 * would have been drawn white on near-white and the viewport would have looked
 * empty rather than wrong. A wrong colour gets reported; an invisible drawing
 * gets reported as a broken node.
 *
 * So nothing here holds a colour. Every value is read from the CSS custom
 * property the rest of Studio already uses, which means the viewport follows a
 * theme switch with no code and cannot drift from the panel beside it.
 *
 * Houdini's own viewport uses a subtle grey gradient and has light and dark
 * modes, which Marcus offered as the alternative — *"if a different color is
 * needed we can use a grey gradient"*. It is not needed: a gradient earns its
 * place in a scene view by suggesting a ground and a sky, and Cascade's default
 * view is a flat drawing seen face-on, where a vertical gradient reads as a
 * lighting effect on the artwork rather than as a horizon. The tokens are here
 * if that changes.
 */
export interface ViewportTheme {
  readonly background: Vec4;
  readonly stroke: Vec4;
  readonly grid: Vec4;
  readonly gridRuler: Vec4;
}

/**
 * Parsed from whatever `getComputedStyle` returns, which is a browser-normalised
 * `rgb()` or `rgba()` string for a colour and an empty string for a property
 * that does not exist.
 *
 * Hex is handled too, because the token values in `theme.css` are hex and a
 * caller may pass one directly rather than through the DOM.
 */
export function parseCssColour(text: string, fallback: Vec4): Vec4 {
  const value = text.trim();
  if (!value) return fallback;

  const functional = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (functional) {
    const parts = functional[1]
      .split(/[\s,/]+/)
      .filter((part) => part.length > 0)
      .map((part) => (part.endsWith('%') ? Number(part.slice(0, -1)) / 100 : Number(part)));
    if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return fallback;
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts[3] ?? 1];
  }

  const hex = /^#([0-9a-f]{3,8})$/i.exec(value);
  if (hex) {
    const digits = hex[1];
    // `#abc` and `#abcd` are shorthand for doubled digits.
    const expanded =
      digits.length <= 4
        ? [...digits].map((digit) => digit + digit).join('')
        : digits;
    if (expanded.length !== 6 && expanded.length !== 8) return fallback;
    const channel = (index: number) =>
      Number.parseInt(expanded.slice(index * 2, index * 2 + 2), 16) / 255;
    return [
      channel(0),
      channel(1),
      channel(2),
      expanded.length === 8 ? channel(3) : 1,
    ];
  }

  return fallback;
}

/** Dark-mode values, used only when the DOM has no answer — a test, a
 *  detached canvas, a host with no stylesheet loaded. */
const FALLBACK: ViewportTheme = {
  background: [0.039, 0.039, 0.039, 1],
  stroke: [0.878, 0.878, 0.878, 1],
  grid: [0.5, 0.5, 0.5, 0.16],
  gridRuler: [0.5, 0.5, 0.5, 0.3],
};

/**
 * Read the viewport's palette off an element.
 *
 * Takes the element rather than reading `document.documentElement`, so a
 * viewport inside a scoped theme gets that theme — and so this is callable in a
 * test without a document.
 */
export function viewportTheme(element: Element | null | undefined): ViewportTheme {
  if (!element || typeof getComputedStyle !== 'function') return FALLBACK;
  const style = getComputedStyle(element);
  const token = (name: string, fallback: Vec4) =>
    parseCssColour(style.getPropertyValue(name), fallback);
  const stroke = token('--text-primary', FALLBACK.stroke);
  return {
    // The network panel's own background, which is the whole point.
    background: token('--surface-void', FALLBACK.background),
    stroke,
    // The grid is the text colour at low alpha rather than a grey, so it stays
    // legible in both themes: a fixed grey is nearly invisible on one of them.
    grid: [stroke[0], stroke[1], stroke[2], 0.14],
    gridRuler: [stroke[0], stroke[1], stroke[2], 0.28],
  };
}
