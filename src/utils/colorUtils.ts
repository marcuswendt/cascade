/**
 * Utilities for handling color formats in Cascade
 * Colors are stored internally as normalized float objects (0.0-1.0 range)
 */

export interface ColorObject {
  r: number;  // red channel (0.0-1.0)
  g: number;  // green channel (0.0-1.0)
  b: number;  // blue channel (0.0-1.0)
  a?: number; // alpha channel (0.0-1.0, defaults to 1.0)
}

/**
 * Color input can be in multiple formats:
 * - Object: { r, g, b, a? } (0.0-1.0 normalized or 0-255 integer)
 * - Array: [r, g, b, a?] (0.0-1.0 normalized or 0-255 integer)
 * - String: rgb(r,g,b) or #hex (for backward compatibility)
 */
export type ColorInput = ColorObject | number[] | string;

/**
 * Normalize a color value to internal format (normalized float object)
 */
export function normalizeColor(input: ColorInput): ColorObject {
  // Already a color object - check if normalized
  if (typeof input === 'object' && !Array.isArray(input) && 'r' in input && 'g' in input && 'b' in input) {
    const obj = input as ColorObject;
    // Check if values are normalized (<= 1.0) or integer (0-255)
    const isNormalized = obj.r <= 1.0 && obj.g <= 1.0 && obj.b <= 1.0;
    
    return {
      r: isNormalized ? obj.r : obj.r / 255,
      g: isNormalized ? obj.g : obj.g / 255,
      b: isNormalized ? obj.b : obj.b / 255,
      a: obj.a !== undefined 
        ? (isNormalized ? obj.a : obj.a / 255)
        : 1.0
    };
  }
  
  // Array input
  if (Array.isArray(input)) {
    const isNormalized = input.every(v => v <= 1.0);
    return {
      r: isNormalized ? input[0] : input[0] / 255,
      g: isNormalized ? input[1] : input[1] / 255,
      b: isNormalized ? input[2] : input[2] / 255,
      a: input[3] !== undefined 
        ? (isNormalized ? input[3] : input[3] / 255)
        : 1.0
    };
  }
  
  // String input (rgb(r,g,b) or #hex) - for backward compatibility
  if (typeof input === 'string') {
    // Try rgb format
    const rgbMatch = input.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (rgbMatch) {
      return {
        r: parseInt(rgbMatch[1], 10) / 255,
        g: parseInt(rgbMatch[2], 10) / 255,
        b: parseInt(rgbMatch[3], 10) / 255,
        a: 1.0
      };
    }
    
    // Try hex format
    const hex = input.replace('#', '');
    if (hex.length === 3 || hex.length === 6) {
      const expanded = hex.length === 3 
        ? hex.split('').map(c => c + c).join('')
        : hex;
      const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(expanded);
      if (result) {
        return {
          r: parseInt(result[1], 16) / 255,
          g: parseInt(result[2], 16) / 255,
          b: parseInt(result[3], 16) / 255,
          a: 1.0
        };
      }
    }
  }
  
  // Fallback to black
  return { r: 0, g: 0, b: 0, a: 1.0 };
}

/**
 * Convert color object to CSS string (for canvas operations)
 */
export function colorToCss(color: ColorObject): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = color.a !== undefined ? color.a : 1.0;
  
  if (a < 1.0) {
    return `rgba(${r},${g},${b},${a})`;
  }
  return `rgb(${r},${g},${b})`;
}

/**
 * Convert color object to hex string
 */
export function colorToHex(color: ColorObject): string {
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`.toUpperCase();
}

/**
 * Check if a value looks like a color (for detection during serialization)
 */
export function isColorValue(value: any): boolean {
  if (typeof value === 'string') {
    return value.startsWith('#') || value.startsWith('rgb(');
  }
  if (typeof value === 'object' && value !== null) {
    // Check if it's a color object
    if ('r' in value && 'g' in value && 'b' in value) {
      return true;
    }
    // Check if it's a color array
    if (Array.isArray(value) && (value.length === 3 || value.length === 4)) {
      return value.every(v => typeof v === 'number');
    }
  }
  return false;
}

/**
 * Legacy functions for backward compatibility (kept for ColorPicker)
 */
export function hexToRgb(hex: string): string {
  const color = normalizeColor(hex);
  return colorToCss(color);
}

export function rgbToHex(rgb: string): string {
  const color = normalizeColor(rgb);
  return colorToHex(color);
}

export function isHexColor(value: string): boolean {
  return /^#?[0-9a-fA-F]{3,6}$/.test(value);
}

export function isRgbColor(value: string): boolean {
  return /^rgb\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/.test(value);
}

export function normalizeColorToRgb(color: string): string {
  const normalized = normalizeColor(color);
  return colorToCss(normalized);
}
