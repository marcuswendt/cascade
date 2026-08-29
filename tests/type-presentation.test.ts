import { describe, expect, it } from 'vitest';
import {
  colorCss,
  geometryPresentation,
  inferCascadeType,
  mediaUrl,
  normalizeColorTuple,
  summarizeValue,
} from '@/editor/components/typePresentation';

describe('core type presentation', () => {
  it('infers portable core values without inventing project types', () => {
    expect(inferCascadeType(3)).toBe('int');
    expect(inferCascadeType(3.5)).toBe('float');
    expect(inferCascadeType([1, 2, 3])).toBe('vec3');
    expect(inferCascadeType({ path: 'out/a.png', size: [40, 30], channels: 'rgba', depth: 'u8', space: 'srgb' })).toBe('image');
    expect(inferCascadeType({ hello: 'world' })).toBe('object');
  });

  it('creates safe media URLs for Python-authored project files', () => {
    expect(mediaUrl('./renders/my image.png', { width: 320 })).toBe('/api/media/renders/my%20image.png?w=320');
    expect(mediaUrl('https://example.test/image.png', { width: 320 })).toBe('https://example.test/image.png');
  });

  it('normalizes color tuples from JS objects and hex strings', () => {
    expect(normalizeColorTuple({ r: 1, g: 0.5, b: 0, a: 0.25 })).toEqual([1, 0.5, 0, 0.25]);
    expect(normalizeColorTuple('#336699')).toEqual([0.2, 0.4, 0.6, 1]);
    expect(colorCss([1, 0.5, 0, 0.25])).toBe('rgba(255, 128, 0, 0.25)');
  });

  it('summarizes portable image and texture descriptors', () => {
    expect(summarizeValue({ path: 'out/a.png', size: [40, 30], channels: 'rgba', depth: 'u8', space: 'srgb' }, 'image'))
      .toBe('40×30 · rgba · u8 · srgb');
    expect(summarizeValue({ size: [1920, 1080], format: 'rgba8unorm' }, 'texture'))
      .toBe('1920×1080 · rgba8unorm · browser session');
  });

  it('derives bounded geometry statistics and preview coordinates', () => {
    const presentation = geometryPresentation(
      { positions: [0, 0, 0, 10, 0, 0, 10, 20, 0], indices: [0, 1, 2] },
      'mesh',
    );

    expect(presentation.countLabel).toBe('3 vertices · 1 triangle');
    expect(presentation.bounds).toEqual({ min: [0, 0], max: [10, 20] });
    expect(presentation.paths[0]).toEqual([[0, 0], [10, 0], [10, 20], [0, 0]]);
  });
});
