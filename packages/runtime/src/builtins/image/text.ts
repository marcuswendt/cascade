import type { NodeExecutionContext } from "@cascade/contracts";

import type { textDefinition } from "./definitions.js";
import { colorToCss, normalizeColor, readPixelsFromCanvas, surface, writePixels, type ImageNodeContext } from "./io.js";

/**
 * `cascade.image.Text`: lines of text on a canvas, aligned to an anchor, with
 * tracking, rotation and opacity.
 *
 * Fonts follow `cascade/image`'s rules. `font` is a CSS family list and draws
 * with whatever faces the realm has (the page's or worker's in a browser,
 * Skia's system fonts headless), so the same family only matches across hosts
 * when both have the same face. A project font file (`.otf`, `.ttf`, `.woff`,
 * `.woff2`) is read through `assets` and registered with the realm, which
 * makes it match everywhere; a file that is not there falls back to
 * `sans-serif` rather than failing, since a licensed face an export does not
 * ship should still draw.
 */

const FONT_FILE = /\.(otf|ttf|woff2?)$/i;
const HOST_KEY = "__cascadeImageHost";

interface FontHost {
  readonly renderer: string;
  registerFont(family: string, bytes: Uint8Array, descriptors: Record<string, string>): void | Promise<void>;
}

interface FontGlobals {
  FontFace?: new (family: string, source: ArrayBuffer) => { load(): Promise<unknown> };
  fonts?: { add(face: unknown): unknown };
  document?: { fonts?: { add(face: unknown): unknown } };
}

// One registration per realm and font file contents; see `registerFont` in
// cascade/image, which this mirrors for a runtime that cannot import it.
const registered = new Set<string>();

function fingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${bytes.length}-${(hash >>> 0).toString(16)}`;
}

/** The family to draw with: `font` itself, or a registered face for a font file. */
async function fontFamily(context: ImageNodeContext, font: string): Promise<string> {
  const path = font.trim();
  if (!FONT_FILE.test(path)) return font;
  let bytes: Uint8Array;
  try {
    const assets = context.capabilities.assets;
    if (!assets) throw new Error("no assets");
    bytes = await assets.read({ path }, { signal: context.signal });
  } catch {
    return "sans-serif";
  }
  const family = `cascade-font-${fingerprint(bytes)}`;
  const globals = globalThis as FontGlobals & Record<string, unknown>;
  const host = globals[HOST_KEY] as FontHost | undefined;
  const fonts = host ? null : globals.fonts ?? globals.document?.fonts;
  const key = `${host ? `headless:${host.renderer}` : "browser"}:${family}`;
  if (registered.has(key)) return family;
  if (host && typeof host.registerFont === "function") {
    await host.registerFont(family, bytes, {});
  } else if (typeof globals.FontFace === "function" && fonts) {
    const face = new globals.FontFace(family, bytes.slice().buffer as ArrayBuffer);
    fonts.add(await face.load());
  } else {
    return "sans-serif";
  }
  registered.add(key);
  return family;
}

export async function executeText(context: NodeExecutionContext<typeof textDefinition>): Promise<void> {
  const { props } = context;
  const [width, height] = [props.resolution[0], props.resolution[1]];
  const color = normalizeColor(props.color);
  const background = normalizeColor(props.backgroundColor);
  const [offsetX, offsetY] = props.offset;
  const { fontSize, alignH, alignV, rotation, letterSpacing } = props;
  const family = await fontFamily(context, props.font);

  const { canvas, context: ctx } = surface(width, height);
  if (background.a > 0) {
    ctx.fillStyle = colorToCss(background);
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }
  ctx.save();
  ctx.globalAlpha = props.opacity;
  ctx.font = `${props.fontStyle} ${props.fontWeight} ${fontSize}px ${family}`;
  ctx.fillStyle = colorToCss(color);

  const lines = props.text.split("\n");
  const lineHeightPx = fontSize * props.lineHeight;
  const totalTextHeight = lines.length * lineHeightPx;
  let anchorX: number;
  let anchorY: number;
  switch (alignH) {
    case "left":
      ctx.textAlign = "left";
      anchorX = 0;
      break;
    case "right":
      ctx.textAlign = "right";
      anchorX = width;
      break;
    default:
      ctx.textAlign = "center";
      anchorX = width / 2;
  }
  switch (alignV) {
    case "top":
      anchorY = fontSize;
      break;
    case "bottom":
      anchorY = height - totalTextHeight + fontSize;
      break;
    default:
      anchorY = (height - totalTextHeight) / 2 + fontSize;
  }
  anchorX += offsetX;
  anchorY += offsetY;

  if (rotation !== 0) {
    const pivotY = anchorY - fontSize / 2 + totalTextHeight / 2;
    ctx.translate(anchorX, pivotY);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-anchorX, -pivotY);
  }

  if (letterSpacing !== 0) {
    // Tracking: one glyph at a time.
    ctx.textAlign = "left";
    lines.forEach((line, index) => {
      const y = anchorY + index * lineHeightPx;
      let lineWidth = 0;
      for (const char of line) lineWidth += ctx.measureText(char).width + letterSpacing;
      lineWidth -= letterSpacing;
      let x = alignH === "left" ? anchorX : alignH === "right" ? anchorX - lineWidth : anchorX - lineWidth / 2;
      for (const char of line) {
        ctx.fillText(char, x, y);
        x += ctx.measureText(char).width + letterSpacing;
      }
    });
  } else {
    lines.forEach((line, index) => ctx.fillText(line, anchorX, anchorY + index * lineHeightPx));
  }
  ctx.restore();

  context.outputs.image.set(await writePixels(context, readPixelsFromCanvas(canvas)));
}
