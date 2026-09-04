import type { Vec4 } from "./values.js";

/**
 * Colour is a four-component vector, always. Marcus ruled on that 2026-09-04:
 * *"colour should only be a 4 component vector; when a hex/string value is
 * needed we should use conversions with a .toHex and .toString methods."*
 *
 * So `Cd` is `vec4`, a `color` prop is `vec4`, and there is no second
 * representation anywhere in the system. Hex and CSS are *spellings* produced at
 * the edge by the code that has to emit text, which today is the SVG writer and
 * tomorrow is a canvas host or a project reading a palette out of JSON.
 *
 * ## Why a namespace object rather than methods on a colour
 *
 * `.toHex()` on a colour would need a colour to be an object, and a colour is a
 * `Vec4` — a plain readonly array of four numbers. That is not an accident of
 * this file: it is what makes a colour a value the graph can carry, serialize as
 * `[1, 0.5, 0, 1]`, store in a `vec4` port, and share with an attribute's flat
 * `Float64Array` without a conversion. Giving it methods means giving it a
 * prototype, and then a colour that survives a round trip through JSON is no
 * longer a colour. So the operations live beside the type instead of on it, the
 * way `Math` and `JSON` do, and `Color` is both the type and the namespace, the
 * way `Array` is.
 *
 * Components are unit-range `[0, 1]` for red, green, blue and alpha, in that
 * order. Everything here clamps rather than throwing on an out-of-range
 * component, because a colour arriving slightly outside the range is arithmetic
 * rather than an authoring error; a malformed hex *string* is an authoring error
 * and `fromHex` says so.
 */
export type Color = Vec4;

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function clamp(value: number): number {
  return !Number.isFinite(value) ? 0 : value < 0 ? 0 : value > 1 ? 1 : value;
}

function byte(value: number): number {
  return Math.round(clamp(value) * 255);
}

function pair(value: number): string {
  return byte(value).toString(16).padStart(2, "0");
}

/** `0.5` rather than `0.50000000000000001`, and `1` rather than `1.000`. */
function unit(value: number): string {
  return String(Number(clamp(value).toFixed(4)));
}

function expand(digits: string): readonly number[] {
  const wide =
    digits.length <= 4
      ? [...digits].map((digit) => `${digit}${digit}`)
      : (digits.match(/../g) ?? []);
  return wide.map((component) => Number.parseInt(component, 16) / 255);
}

export const Color = Object.freeze({
  /**
   * `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` to a colour. Alpha defaults to 1
   * when the string carries none. The three- and four-digit shorthands are
   * accepted because CSS accepts them and hand-written palettes use them;
   * anything else throws, since a colour that silently parses to black is the
   * failure this whole ruling exists to remove.
   */
  fromHex(value: string): Color {
    if (!HEX.test(value))
      throw new TypeError(
        `color/invalid-hex: ${value} is not #rgb, #rgba, #rrggbb or #rrggbbaa`,
      );
    const components = expand(value.slice(1));
    return [
      components[0]!,
      components[1]!,
      components[2]!,
      components[3] ?? 1,
    ] as const;
  },

  /** Whether `fromHex` would accept this string. */
  isHex(value: unknown): value is string {
    return typeof value === "string" && HEX.test(value);
  },

  /**
   * `#rrggbb`, or `#rrggbbaa` with `includeAlpha`. The default drops alpha
   * because eight-digit hex is CSS Color 4 and plotter and vector-editor
   * software of the kind this library exists to feed does not read it. Callers
   * that need the alpha to survive emit it as a separate opacity, which is what
   * the SVG writer does.
   */
  toHex(color: Color, includeAlpha = false): string {
    return `#${pair(color[0])}${pair(color[1])}${pair(color[2])}${
      includeAlpha ? pair(color[3]) : ""
    }`;
  },

  /**
   * A CSS colour: `rgb(255, 128, 0)`, or `rgba(255, 128, 0, 0.5)` when alpha is
   * below 1. The legacy comma forms rather than the modern space-separated
   * ones, for the same compatibility reason `toHex` drops alpha by default.
   */
  toString(color: Color): string {
    const channels = `${byte(color[0])}, ${byte(color[1])}, ${byte(color[2])}`;
    return clamp(color[3]) >= 1
      ? `rgb(${channels})`
      : `rgba(${channels}, ${unit(color[3])})`;
  },

  /** Alpha on its own, for a renderer that carries opacity separately. */
  alpha(color: Color): number {
    return clamp(color[3]);
  },

  /** The same colour at full alpha. */
  opaque(color: Color): Color {
    return [clamp(color[0]), clamp(color[1]), clamp(color[2]), 1] as const;
  },

  /**
   * Four unit components from anything indexable, clamping and defaulting a
   * missing alpha to 1. The reader for a `Cd` attribute's flat array, and the
   * one place that decides what an under-sized colour means.
   */
  fromComponents(
    components: ArrayLike<number>,
    offset = 0,
    size = 4,
  ): Color {
    const at = (component: number) =>
      component < size ? clamp(components[offset + component] ?? 0) : 0;
    return [at(0), at(1), at(2), size < 4 ? 1 : at(3)] as const;
  },
});
