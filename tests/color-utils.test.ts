/**
 * Color Utilities Tests
 * Tests for color normalization, conversion, and detection functions
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeColor,
  colorToCss,
  colorToHex,
  isColorValue,
  hexToRgb,
  rgbToHex,
  isHexColor,
  isRgbColor,
  normalizeColorToRgb,
  type ColorObject
} from '@/utils/colorUtils';

describe('normalizeColor', () => {
  describe('object input', () => {
    it('should pass through already normalized colors (0-1 range)', () => {
      const result = normalizeColor({ r: 0.5, g: 0.5, b: 0.5 });
      expect(result).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1.0 });
    });

    it('should normalize integer colors (0-255 range)', () => {
      const result = normalizeColor({ r: 255, g: 128, b: 0 });
      expect(result.r).toBe(1);
      expect(result.g).toBeCloseTo(128 / 255, 5);
      expect(result.b).toBe(0);
      expect(result.a).toBe(1.0);
    });

    it('should preserve alpha when provided (normalized)', () => {
      const result = normalizeColor({ r: 0.5, g: 0.5, b: 0.5, a: 0.5 });
      expect(result.a).toBe(0.5);
    });

    it('should normalize alpha when in integer range', () => {
      const result = normalizeColor({ r: 255, g: 255, b: 255, a: 128 });
      expect(result.a).toBeCloseTo(128 / 255, 5);
    });

    it('should default alpha to 1.0 when not provided', () => {
      const result = normalizeColor({ r: 0.5, g: 0.5, b: 0.5 });
      expect(result.a).toBe(1.0);
    });

    it('should handle black color', () => {
      const result = normalizeColor({ r: 0, g: 0, b: 0 });
      expect(result).toEqual({ r: 0, g: 0, b: 0, a: 1.0 });
    });

    it('should handle white color', () => {
      const result = normalizeColor({ r: 1, g: 1, b: 1 });
      expect(result).toEqual({ r: 1, g: 1, b: 1, a: 1.0 });
    });
  });

  describe('array input', () => {
    it('should normalize RGB array (0-1 range)', () => {
      const result = normalizeColor([0.5, 0.25, 0.75]);
      expect(result).toEqual({ r: 0.5, g: 0.25, b: 0.75, a: 1.0 });
    });

    it('should normalize RGBA array (0-1 range)', () => {
      const result = normalizeColor([0.5, 0.25, 0.75, 0.5]);
      expect(result).toEqual({ r: 0.5, g: 0.25, b: 0.75, a: 0.5 });
    });

    it('should normalize RGB array (0-255 range)', () => {
      const result = normalizeColor([255, 128, 64]);
      expect(result.r).toBe(1);
      expect(result.g).toBeCloseTo(128 / 255, 5);
      expect(result.b).toBeCloseTo(64 / 255, 5);
      expect(result.a).toBe(1.0);
    });

    it('should normalize RGBA array (0-255 range)', () => {
      const result = normalizeColor([255, 128, 64, 128]);
      expect(result.a).toBeCloseTo(128 / 255, 5);
    });
  });

  describe('string input', () => {
    it('should parse 6-digit hex color', () => {
      const result = normalizeColor('#ff8040');
      expect(result.r).toBe(1);
      expect(result.g).toBeCloseTo(128 / 255, 5);
      expect(result.b).toBeCloseTo(64 / 255, 5);
      expect(result.a).toBe(1.0);
    });

    it('should parse 3-digit hex color', () => {
      const result = normalizeColor('#f80');
      expect(result.r).toBe(1);
      expect(result.g).toBeCloseTo(136 / 255, 5); // 88 -> 136
      expect(result.b).toBe(0);
    });

    it('should handle hex without # prefix', () => {
      const result = normalizeColor('ff0000');
      expect(result.r).toBe(1);
      expect(result.g).toBe(0);
      expect(result.b).toBe(0);
    });

    it('should parse uppercase hex', () => {
      const result = normalizeColor('#FFFFFF');
      expect(result).toEqual({ r: 1, g: 1, b: 1, a: 1.0 });
    });

    it('should parse mixed case hex', () => {
      const result = normalizeColor('#AbCdEf');
      expect(result.r).toBeCloseTo(171 / 255, 5);
      expect(result.g).toBeCloseTo(205 / 255, 5);
      expect(result.b).toBeCloseTo(239 / 255, 5);
    });

    it('should parse rgb() format', () => {
      const result = normalizeColor('rgb(255, 128, 64)');
      expect(result.r).toBe(1);
      expect(result.g).toBeCloseTo(128 / 255, 5);
      expect(result.b).toBeCloseTo(64 / 255, 5);
    });

    it('should parse rgb() format without spaces', () => {
      const result = normalizeColor('rgb(255,128,64)');
      expect(result.r).toBe(1);
      expect(result.g).toBeCloseTo(128 / 255, 5);
      expect(result.b).toBeCloseTo(64 / 255, 5);
    });
  });

  describe('invalid input', () => {
    it('should return black for invalid string', () => {
      const result = normalizeColor('invalid');
      expect(result).toEqual({ r: 0, g: 0, b: 0, a: 1.0 });
    });

    it('should return black for empty string', () => {
      const result = normalizeColor('');
      expect(result).toEqual({ r: 0, g: 0, b: 0, a: 1.0 });
    });

    it('should return black for invalid hex (wrong length)', () => {
      const result = normalizeColor('#ff');
      expect(result).toEqual({ r: 0, g: 0, b: 0, a: 1.0 });
    });
  });
});

describe('colorToCss', () => {
  it('should convert to rgb() for opaque colors', () => {
    const result = colorToCss({ r: 1, g: 0.5, b: 0, a: 1.0 });
    expect(result).toBe('rgb(255,128,0)');
  });

  it('should convert to rgba() for transparent colors', () => {
    const result = colorToCss({ r: 1, g: 0.5, b: 0, a: 0.5 });
    expect(result).toBe('rgba(255,128,0,0.5)');
  });

  it('should handle black', () => {
    const result = colorToCss({ r: 0, g: 0, b: 0, a: 1.0 });
    expect(result).toBe('rgb(0,0,0)');
  });

  it('should handle white', () => {
    const result = colorToCss({ r: 1, g: 1, b: 1, a: 1.0 });
    expect(result).toBe('rgb(255,255,255)');
  });

  it('should default alpha to 1.0 if undefined', () => {
    const result = colorToCss({ r: 1, g: 0, b: 0 } as ColorObject);
    expect(result).toBe('rgb(255,0,0)');
  });

  it('should round to nearest integer', () => {
    const result = colorToCss({ r: 0.501, g: 0.499, b: 0.5, a: 1.0 });
    expect(result).toBe('rgb(128,127,128)');
  });
});

describe('colorToHex', () => {
  it('should convert to uppercase hex', () => {
    const result = colorToHex({ r: 1, g: 0.5, b: 0, a: 1.0 });
    expect(result).toBe('#FF8000');
  });

  it('should handle black', () => {
    const result = colorToHex({ r: 0, g: 0, b: 0, a: 1.0 });
    expect(result).toBe('#000000');
  });

  it('should handle white', () => {
    const result = colorToHex({ r: 1, g: 1, b: 1, a: 1.0 });
    expect(result).toBe('#FFFFFF');
  });

  it('should pad single digit hex values', () => {
    const result = colorToHex({ r: 0, g: 1 / 255, b: 15 / 255, a: 1.0 });
    expect(result).toBe('#00010F');
  });
});

describe('isColorValue', () => {
  describe('object detection', () => {
    it('should detect color object with r, g, b', () => {
      expect(isColorValue({ r: 0.5, g: 0.5, b: 0.5 })).toBe(true);
    });

    it('should detect color object with r, g, b, a', () => {
      expect(isColorValue({ r: 0.5, g: 0.5, b: 0.5, a: 0.5 })).toBe(true);
    });

    it('should reject object without all rgb properties', () => {
      expect(isColorValue({ r: 0.5, g: 0.5 })).toBe(false);
    });

    it('should reject null', () => {
      expect(isColorValue(null)).toBe(false);
    });
  });

  describe('array detection', () => {
    it('should detect RGB array (3 numbers)', () => {
      expect(isColorValue([0.5, 0.5, 0.5])).toBe(true);
    });

    it('should detect RGBA array (4 numbers)', () => {
      expect(isColorValue([0.5, 0.5, 0.5, 0.5])).toBe(true);
    });

    it('should reject array with wrong length', () => {
      expect(isColorValue([0.5, 0.5])).toBe(false);
      expect(isColorValue([0.5, 0.5, 0.5, 0.5, 0.5])).toBe(false);
    });

    it('should reject array with non-numbers', () => {
      expect(isColorValue(['red', 'green', 'blue'])).toBe(false);
    });
  });

  describe('string detection', () => {
    it('should detect hex color', () => {
      expect(isColorValue('#ff0000')).toBe(true);
      expect(isColorValue('#f00')).toBe(true);
    });

    it('should detect rgb() color', () => {
      expect(isColorValue('rgb(255, 0, 0)')).toBe(true);
    });

    it('should reject invalid strings', () => {
      expect(isColorValue('red')).toBe(false);
      expect(isColorValue('hello')).toBe(false);
    });
  });

  describe('other types', () => {
    it('should reject numbers', () => {
      expect(isColorValue(123)).toBe(false);
    });

    it('should reject booleans', () => {
      expect(isColorValue(true)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(isColorValue(undefined)).toBe(false);
    });
  });
});

describe('legacy functions', () => {
  describe('hexToRgb', () => {
    it('should convert hex to rgb string', () => {
      const result = hexToRgb('#ff0000');
      expect(result).toBe('rgb(255,0,0)');
    });

    it('should handle 3-digit hex', () => {
      const result = hexToRgb('#f00');
      expect(result).toBe('rgb(255,0,0)');
    });
  });

  describe('rgbToHex', () => {
    it('should convert rgb string to hex', () => {
      const result = rgbToHex('rgb(255, 0, 0)');
      expect(result).toBe('#FF0000');
    });

    it('should convert rgb without spaces', () => {
      const result = rgbToHex('rgb(255,128,64)');
      expect(result).toBe('#FF8040');
    });
  });

  describe('isHexColor', () => {
    it('should detect valid 6-digit hex', () => {
      expect(isHexColor('#ff0000')).toBe(true);
      expect(isHexColor('ff0000')).toBe(true);
    });

    it('should detect valid 3-digit hex', () => {
      expect(isHexColor('#f00')).toBe(true);
      expect(isHexColor('f00')).toBe(true);
    });

    it('should reject invalid hex', () => {
      expect(isHexColor('#gg0000')).toBe(false);
      expect(isHexColor('rgb(255,0,0)')).toBe(false);
    });
  });

  describe('isRgbColor', () => {
    it('should detect valid rgb() format', () => {
      expect(isRgbColor('rgb(255, 0, 0)')).toBe(true);
      expect(isRgbColor('rgb(255,0,0)')).toBe(true);
    });

    it('should reject invalid formats', () => {
      expect(isRgbColor('#ff0000')).toBe(false);
      expect(isRgbColor('rgba(255,0,0,1)')).toBe(false);
    });
  });

  describe('normalizeColorToRgb', () => {
    it('should convert hex to rgb string', () => {
      const result = normalizeColorToRgb('#ff0000');
      expect(result).toBe('rgb(255,0,0)');
    });

    it('should pass through rgb strings', () => {
      const result = normalizeColorToRgb('rgb(255, 0, 0)');
      expect(result).toBe('rgb(255,0,0)');
    });
  });
});

describe('roundtrip conversions', () => {
  it('should preserve color through hex roundtrip', () => {
    const original = { r: 0.5, g: 0.25, b: 0.75, a: 1.0 };
    const hex = colorToHex(original);
    const restored = normalizeColor(hex);

    // Allow for rounding differences (1/255 tolerance)
    expect(restored.r).toBeCloseTo(original.r, 2);
    expect(restored.g).toBeCloseTo(original.g, 2);
    expect(restored.b).toBeCloseTo(original.b, 2);
  });

  it('should preserve color through css roundtrip', () => {
    const original = { r: 1, g: 0.5, b: 0.25, a: 1.0 };
    const css = colorToCss(original);
    const restored = normalizeColor(css);

    expect(restored.r).toBeCloseTo(original.r, 2);
    expect(restored.g).toBeCloseTo(original.g, 2);
    expect(restored.b).toBeCloseTo(original.b, 2);
  });
});
