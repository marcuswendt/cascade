/**
 * An SVG document is a picture, not a wall of source.
 *
 * Marcus's screenshot on 2026-09-09 showed the Viewer displaying nine hundred
 * lines of `<path d="M …">` — correct behaviour for a `string` output, and
 * useless. The sniff is what turns that one string into the image path that
 * already exists.
 */
import { describe, expect, it } from 'vitest';

import { looksLikeSvg, svgDataUrl } from '@/editor/svgPreview';

describe('looksLikeSvg', () => {
  it('accepts a document', () => {
    expect(looksLikeSvg('<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>')).toBe(true);
  });

  it('accepts leading whitespace, an XML declaration and a doctype', () => {
    expect(looksLikeSvg('\n  <svg viewBox="0 0 1 1"></svg>')).toBe(true);
    expect(looksLikeSvg('<?xml version="1.0"?>\n<svg></svg>')).toBe(true);
    expect(looksLikeSvg('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg></svg>')).toBe(true);
  });

  /**
   * Strict on purpose. Mistaking prose for a document would replace a readable
   * string with a broken image, which is a worse failure than the one being
   * fixed — so anything that merely mentions svg is refused.
   */
  it('refuses anything that is not a document', () => {
    for (const value of [
      '', '   ', 'an svg is a vector format', 'svg', '<svgish/>',
      '<html><svg/></html>', '{"kind":"geometry"}', 42, null, undefined,
      { kind: 'geometry' },
    ]) {
      expect(looksLikeSvg(value), JSON.stringify(value) ?? 'undefined').toBe(false);
    }
  });

  /** `<svg` must be followed by whitespace or the close, so `<svgish>` is not
   *  a document. */
  it('requires a real tag boundary', () => {
    expect(looksLikeSvg('<svg>')).toBe(true);
    expect(looksLikeSvg('<svg\n  width="10">')).toBe(true);
    expect(looksLikeSvg('<svgroup>')).toBe(false);
  });

  /** Only the head is examined, because this runs on every output of every
   *  selected node and a megabyte of paths says nothing the first line did not. */
  it('decides from the head of a large document', () => {
    const big = `<svg xmlns="http://www.w3.org/2000/svg">${'<path d="M 0 0 L 1 1"/>'.repeat(50_000)}</svg>`;
    expect(looksLikeSvg(big)).toBe(true);
  });
});

describe('svgDataUrl', () => {
  it('encodes a document', () => {
    const url = svgDataUrl('<svg><path d="M 0 0"/></svg>');
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(url.split(',')[1]!)).toBe('<svg><path d="M 0 0"/></svg>');
  });

  /**
   * The reason it is percent encoding and not base64: `btoa` throws on any
   * character above U+00FF, and an SVG can legitimately carry a `<text>`
   * element with anything in it.
   */
  it('survives characters btoa would throw on', () => {
    const svg = '<svg><text>Größe · 日本語 · —</text></svg>';
    const url = svgDataUrl(svg);
    expect(decodeURIComponent(url.split(',')[1]!)).toBe(svg);
  });

  it('encodes the characters a URL cannot carry raw', () => {
    const url = svgDataUrl('<svg width="1" height="1"/>');
    expect(url).not.toContain('"');
    expect(url).not.toContain('<');
  });
});
