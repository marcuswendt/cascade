import type { Prop, PropControlType } from '@/types/node.types';

/**
 * Check if a number is an integer
 */
function isInteger(value: number): boolean {
  return Number.isInteger(value);
}

/**
 * Infer the control type from a prop's value and parameters
 */
export function inferPropControlType(prop: Prop): PropControlType {
  // If type is explicitly set, use it
  if (prop.type) {
    return prop.type;
  }
  
  const value = prop.value;
  const params = prop.params;
  const isInt = params?.integer === true || (params?.step === 1 && typeof value === 'number' && isInteger(value));
  
  // Check value type
  if (typeof value === 'number') {
    // If min/max are set, use slider
    if (params?.min !== undefined && params?.max !== undefined) {
      return isInt ? 'int' : 'slider';
    }
    return isInt ? 'int' : 'number';
  }
  
  if (typeof value === 'string') {
    // Check if it's a color (hex format)
    if (/^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(value)) {
      return 'color';
    }
    // Check if it's an image path or data URL
    if (params?.accept === 'image/*' || value.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) || value.startsWith('data:image/')) {
      return 'image';
    }
    // Check if it has options
    if (params?.options && params.options.length > 0) {
      return 'select';
    }
    // Check if multiline
    if (value.includes('\n') || value.length > 100) {
      return 'textarea';
    }
    return 'text';
  }
  
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  
  if (Array.isArray(value)) {
    // Check if it's a range (2-element array with min/max as single numbers, not arrays)
    if (value.length === 2 && 
        params?.min !== undefined && 
        params?.max !== undefined &&
        typeof params.min === 'number' && 
        typeof params.max === 'number') {
      return 'range';
    }
    // Determine vector type based on length and integer mode
    // Check if all values are integers (for arrays of numbers)
    const allIntegers = value.length > 0 && value.every(v => typeof v === 'number' && isInteger(v));
    // If integer is explicitly set, or step is 1, or all values are integers and look like resolution values (positive, reasonable range)
    const looksLikeResolution = allIntegers && value.every(v => v >= 1 && v <= 8192) && params?.min !== undefined && params?.max !== undefined;
    const arrayIsInt = params?.integer === true || (params?.step === 1 && allIntegers) || looksLikeResolution;
    if (value.length === 2) {
      return arrayIsInt ? 'vec2i' : 'vec2';
    } else if (value.length === 3) {
      return arrayIsInt ? 'vec3i' : 'vec3';
    }
    // Otherwise it's a generic vector
    return 'vector';
  }
  
  if (typeof value === 'function') {
    return 'button';
  }
  
  return 'text';
}

