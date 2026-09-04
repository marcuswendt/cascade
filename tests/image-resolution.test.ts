/**
 * ImageNodeBase Resolution Control Tests
 * Tests for resolution utilities: resolveOutputSize, resizeToFit, prepareInputs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { ImageNodeBase, ImageBuffer, type ResolutionMode, type FitMode, type ImageInput } from '@/nodes/image/ImageNodeBase';

describe('ImageBuffer dimensions', () => {
  it.each([
    [0, 1],
    [-1, 1],
    [1.5, 1],
    [Number.NaN, 1],
    [1, Number.POSITIVE_INFINITY],
  ])('rejects invalid dimensions %s x %s', (width, height) => {
    expect(() => ImageBuffer.rgba(width, height)).toThrow(/positive safe integers/);
  });
});

// Concrete test implementation of ImageNodeBase to access protected methods
class TestImageNodeBase extends ImageNodeBase {
  constructor(id: string, graph: Graph) {
    super(id, 'TestImage', graph);
  }

  protected setup(): void {
    this.out('image');
  }

  protected render(): void {
    // No-op for tests
  }

  // Expose protected methods for testing
  public testResolveOutputSize(
    mode: ResolutionMode,
    inputs: (ImageBuffer | null)[],
    customSize?: [number, number]
  ) {
    return this.resolveOutputSize(mode, inputs, customSize);
  }

  public testResizeToFit(
    source: ImageBuffer,
    targetWidth: number,
    targetHeight: number,
    fitMode: FitMode = 'fill'
  ) {
    return this.resizeToFit(source, targetWidth, targetHeight, fitMode);
  }

  public testPrepareInputs(
    inputs: ImageInput[],
    resolutionMode: ResolutionMode = 'input',
    fitMode: FitMode = 'fill',
    customSize?: [number, number]
  ) {
    return this.prepareInputs(inputs, resolutionMode, fitMode, customSize);
  }
}

describe('ImageNodeBase Resolution Utilities', () => {
  let graph: Graph;
  let node: TestImageNodeBase;

  beforeEach(() => {
    graph = new Graph();
    node = new TestImageNodeBase('testNode', graph);
    graph.addElement(node);
  });

  describe('resolveOutputSize()', () => {
    it('should return first input size for "input" mode', () => {
      const buf1 = ImageBuffer.rgba(800, 600);
      const buf2 = ImageBuffer.rgba(400, 300);

      const result = node.testResolveOutputSize('input', [buf1, buf2]);

      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
    });

    it('should return first input size for "input1" mode', () => {
      const buf1 = ImageBuffer.rgba(1920, 1080);
      const buf2 = ImageBuffer.rgba(640, 480);

      const result = node.testResolveOutputSize('input1', [buf1, buf2]);

      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
    });

    it('should return second input size for "input2" mode', () => {
      const buf1 = ImageBuffer.rgba(800, 600);
      const buf2 = ImageBuffer.rgba(1024, 768);

      const result = node.testResolveOutputSize('input2', [buf1, buf2]);

      expect(result.width).toBe(1024);
      expect(result.height).toBe(768);
    });

    it('should fallback to first input when second is null for "input2" mode', () => {
      const buf1 = ImageBuffer.rgba(800, 600);

      const result = node.testResolveOutputSize('input2', [buf1, null]);

      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
    });

    it('should return largest input for "largest" mode', () => {
      const small = ImageBuffer.rgba(100, 100);    // 10,000 pixels
      const large = ImageBuffer.rgba(500, 400);    // 200,000 pixels
      const medium = ImageBuffer.rgba(200, 300);   // 60,000 pixels

      const result = node.testResolveOutputSize('largest', [small, large, medium]);

      expect(result.width).toBe(500);
      expect(result.height).toBe(400);
    });

    it('should return smallest input for "smallest" mode', () => {
      const small = ImageBuffer.rgba(100, 100);    // 10,000 pixels
      const large = ImageBuffer.rgba(500, 400);    // 200,000 pixels
      const medium = ImageBuffer.rgba(200, 300);   // 60,000 pixels

      const result = node.testResolveOutputSize('smallest', [small, large, medium]);

      expect(result.width).toBe(100);
      expect(result.height).toBe(100);
    });

    it('should return custom size for "custom" mode', () => {
      const buf1 = ImageBuffer.rgba(800, 600);

      const result = node.testResolveOutputSize('custom', [buf1], [1280, 720]);

      expect(result.width).toBe(1280);
      expect(result.height).toBe(720);
    });

    it('should return default 512x512 when no valid inputs', () => {
      const result = node.testResolveOutputSize('input', [null, null]);

      expect(result.width).toBe(512);
      expect(result.height).toBe(512);
    });
  });

  describe('resizeToFit()', () => {
    it('should return source unchanged if dimensions match', () => {
      const source = ImageBuffer.rgba(100, 100);

      const result = node.testResizeToFit(source, 100, 100, 'fill');

      // Should return the same buffer (no copy needed)
      expect(result).toBe(source);
    });

    describe('fill mode (crop to fill)', () => {
      it('should resize wider source to fill target', () => {
        // Source is 200x100 (2:1 aspect), target is 100x100 (1:1)
        // Should crop sides and scale
        const source = ImageBuffer.rgba(200, 100);
        source.fill(0, 0.5); // Fill red channel with 0.5

        const result = node.testResizeToFit(source, 100, 100, 'fill');

        expect(result.width).toBe(100);
        expect(result.height).toBe(100);
      });

      it('should resize taller source to fill target', () => {
        // Source is 100x200 (1:2 aspect), target is 100x100 (1:1)
        // Should crop top/bottom and scale
        const source = ImageBuffer.rgba(100, 200);

        const result = node.testResizeToFit(source, 100, 100, 'fill');

        expect(result.width).toBe(100);
        expect(result.height).toBe(100);
      });
    });

    describe('fit mode (letterbox)', () => {
      it('should fit wider source within target with letterboxing', () => {
        // Source is 200x100 (2:1), target is 100x100 (1:1)
        // Should fit horizontally and letterbox vertically
        const source = ImageBuffer.rgba(200, 100);
        source.fill(0, 1.0); // Red
        source.fill(1, 0.0);
        source.fill(2, 0.0);
        source.fill(3, 1.0);

        const result = node.testResizeToFit(source, 100, 100, 'fit');

        expect(result.width).toBe(100);
        expect(result.height).toBe(100);

        // Top row should be black (letterbox area)
        expect(result.channels[0][0]).toBe(0); // R
        expect(result.channels[1][0]).toBe(0); // G
        expect(result.channels[2][0]).toBe(0); // B

        // Middle should have the image content
        const middleY = 50;
        const middleIdx = middleY * 100 + 50;
        expect(result.channels[0][middleIdx]).toBeGreaterThan(0); // Has content
      });

      it('should fit taller source within target with pillarboxing', () => {
        // Source is 100x200 (1:2), target is 100x100 (1:1)
        // Should fit vertically and pillarbox horizontally
        const source = ImageBuffer.rgba(100, 200);
        source.fill(0, 0.0);
        source.fill(1, 1.0); // Green
        source.fill(2, 0.0);
        source.fill(3, 1.0);

        const result = node.testResizeToFit(source, 100, 100, 'fit');

        expect(result.width).toBe(100);
        expect(result.height).toBe(100);

        // Left column should be black (pillarbox area)
        expect(result.channels[0][0]).toBe(0);
        expect(result.channels[1][0]).toBe(0);
        expect(result.channels[2][0]).toBe(0);
      });
    });

    describe('stretch mode', () => {
      it('should stretch source to exact target dimensions', () => {
        const source = ImageBuffer.rgba(50, 100);

        const result = node.testResizeToFit(source, 200, 50, 'stretch');

        expect(result.width).toBe(200);
        expect(result.height).toBe(50);
      });
    });

    describe('native mode (no scale)', () => {
      it('should center smaller source in larger target', () => {
        // Source is 50x50, target is 100x100
        // Should center source and fill edges with black
        const source = ImageBuffer.rgba(50, 50);
        source.fill(0, 1.0); // Red
        source.fill(1, 0.0);
        source.fill(2, 0.0);
        source.fill(3, 1.0);

        const result = node.testResizeToFit(source, 100, 100, 'native');

        expect(result.width).toBe(100);
        expect(result.height).toBe(100);

        // Top-left corner should be black (outside source area)
        expect(result.channels[0][0]).toBe(0);

        // Center should be red (from source)
        const centerIdx = 50 * 100 + 50;
        expect(result.channels[0][centerIdx]).toBe(1.0);
      });

      it('should crop larger source centered in smaller target', () => {
        // Source is 200x200, target is 100x100
        // Should show center portion of source
        const source = ImageBuffer.rgba(200, 200);

        const result = node.testResizeToFit(source, 100, 100, 'native');

        expect(result.width).toBe(100);
        expect(result.height).toBe(100);
      });
    });
  });

  describe('prepareInputs()', () => {
    it('should convert all inputs to ImageBuffers', () => {
      const buf1 = ImageBuffer.rgba(100, 100);
      const buf2 = ImageBuffer.rgba(200, 200);

      const { buffers } = node.testPrepareInputs([buf1, buf2]);

      expect(buffers[0]).toBeInstanceOf(ImageBuffer);
      expect(buffers[1]).toBeInstanceOf(ImageBuffer);
    });

    it('should handle null inputs gracefully', () => {
      const buf1 = ImageBuffer.rgba(100, 100);

      const { buffers } = node.testPrepareInputs([buf1, null]);

      expect(buffers[0]).toBeInstanceOf(ImageBuffer);
      expect(buffers[1]).toBeNull();
    });

    it('should resize all inputs to match output resolution', () => {
      const buf1 = ImageBuffer.rgba(800, 600);
      const buf2 = ImageBuffer.rgba(400, 300);

      // Using 'input1' mode, so output is 800x600
      const { buffers, width, height } = node.testPrepareInputs(
        [buf1, buf2],
        'input1',
        'fill'
      );

      expect(width).toBe(800);
      expect(height).toBe(600);
      expect(buffers[0]!.width).toBe(800);
      expect(buffers[0]!.height).toBe(600);
      expect(buffers[1]!.width).toBe(800);
      expect(buffers[1]!.height).toBe(600);
    });

    it('should not resize buffers that already match output', () => {
      const buf1 = ImageBuffer.rgba(100, 100);
      const buf2 = ImageBuffer.rgba(100, 100);

      const { buffers } = node.testPrepareInputs([buf1, buf2], 'input1', 'fill');

      // Should return the original buffers (no resize needed)
      expect(buffers[0]).toBe(buf1);
      expect(buffers[1]).toBe(buf2);
    });

    it('should use custom resolution when specified', () => {
      const buf1 = ImageBuffer.rgba(100, 100);
      const buf2 = ImageBuffer.rgba(200, 200);

      const { buffers, width, height } = node.testPrepareInputs(
        [buf1, buf2],
        'custom',
        'fill',
        [512, 256]
      );

      expect(width).toBe(512);
      expect(height).toBe(256);
      expect(buffers[0]!.width).toBe(512);
      expect(buffers[0]!.height).toBe(256);
      expect(buffers[1]!.width).toBe(512);
      expect(buffers[1]!.height).toBe(256);
    });
  });
});
