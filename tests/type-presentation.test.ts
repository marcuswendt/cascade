import { describe, expect, it } from 'vitest';
import {
  colorCss,
  geometryPresentation,
  inferCascadeType,
  mediaUrl,
  normalizeColorTuple,
  summarizeValue,
} from '@/editor/components/typePresentation';
import { coreGeometryView } from '@/utils/geometryView';

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

  it('presents the core geometry contract without legacy shape guesses', () => {
    const geometry = {
      kind: 'geometry',
      pointCount: 5,
      vertexCount: 4,
      primitiveCount: 1,
      point: {
        P: { storage: 'f64', size: 2, data: Float64Array.of(0, 0, 4, 0, 4, 2, 0, 2, 9, 9) },
      },
      vertex: {},
      primitive: {},
      detail: {},
      topology: {
        vertexPoints: Int32Array.of(0, 1, 2, 3),
        offsets: Int32Array.of(0, 4),
        kinds: Uint8Array.of(0),
        closed: Uint8Array.of(1),
      },
      pointGroups: {},
      primitiveGroups: {},
    };

    expect(inferCascadeType(geometry)).toBe('geometry');
    expect(summarizeValue(geometry, 'geometry')).toBe('5 points · 1 primitive');
    expect(geometryPresentation(geometry, 'geometry')).toMatchObject({
      points: [[9, 9]],
      paths: [[[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]]],
      bounds: { min: [0, 0], max: [9, 9] },
    });
  });

  it('bounds large geometry previews', () => {
    const pointCount = 10_000;
    const data = new Float64Array(pointCount * 2);
    for (let index = 0; index < pointCount; index += 1) {
      data[index * 2] = index;
      data[index * 2 + 1] = index % 17;
    }

    const presentation = geometryPresentation({
      kind: 'geometry',
      pointCount,
      primitiveCount: 0,
      point: { P: { storage: 'f64', size: 2, data } },
      topology: {
        vertexPoints: new Int32Array(0),
        offsets: Int32Array.of(0),
        kinds: new Uint8Array(0),
        closed: new Uint8Array(0),
      },
    }, 'geometry');

    expect(presentation.points).toHaveLength(1200);
    expect(presentation.bounds).toEqual({ min: [0, 0], max: [9999, 16] });
  });

  it('rejects unsafe geometry preview limits', () => {
    const geometry = {
      kind: 'geometry',
      pointCount: 0,
      primitiveCount: 0,
      point: { P: { storage: 'f64', size: 2, data: new Float64Array(0) } },
      topology: {
        vertexPoints: new Int32Array(0),
        offsets: Int32Array.of(0),
        kinds: new Uint8Array(0),
        closed: new Uint8Array(0),
      },
    };
    expect(coreGeometryView(geometry, Number.MAX_SAFE_INTEGER)).toBeNull();
  });
});
