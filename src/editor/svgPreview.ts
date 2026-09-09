/**
 * An SVG document is a picture, not a wall of source.
 *
 * Marcus, 2026-09-09, opening `particle-type` in Studio and selecting the node
 * that exports the drawing: *"i see now ... the viewer doesnt support
 * geometry!"* The screenshot showed nine hundred lines of `<path d="M …">`.
 *
 * The Viewer was behaving correctly — `SvgExport`'s output is a `string`, and a
 * string is shown as text. What was missing is that **an SVG document is the
 * one string worth looking at rather than reading.** So it becomes a data URL
 * and rides the image path that already exists, which gets it the same pan,
 * zoom, Fit and 1:1 as every other stage. Exactly the argument
 * `geometryRaster` makes for drawing geometry to an image rather than building
 * a second viewport.
 */

/**
 * Whether this string is an SVG document, cheaply and without a parser.
 *
 * Sniffed rather than parsed because this runs on every output of every
 * selected node: a `DOMParser` pass over a megabyte of paths to answer a
 * question about the first thirty characters is the wrong shape. The test is
 * deliberately strict — an `<svg` opening tag near the start — because
 * mistaking prose for a document would replace a readable string with a broken
 * image, which is a worse failure than the one being fixed.
 */
export function looksLikeSvg(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  // A big document is common and a big non-document is not, so only the head
  // is examined.
  const head = value.slice(0, 400).trimStart();
  if (!head) return false;
  const body = head.startsWith('<?xml') || head.startsWith('<!DOCTYPE')
    ? head.slice(head.indexOf('>') + 1).trimStart()
    : head;
  return /^<svg[\s>]/i.test(body);
}

/**
 * A data URL for an SVG string.
 *
 * `encodeURIComponent` rather than `btoa`, because `btoa` throws on any
 * character above U+00FF and an SVG can legitimately carry a `<text>` element
 * with anything in it — a label in German, a Japanese caption. The percent
 * encoding is longer and cannot throw, and the browser decodes both identically.
 */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
