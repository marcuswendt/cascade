import type { Prop, PropControlType } from '@/types/node.types';

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
  
  // Check value type
  if (typeof value === 'number') {
    // If min/max are set, use slider
    if (params?.min !== undefined && params?.max !== undefined) {
      return 'slider';
    }
    return 'number';
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
    // Check if it's a range (2-element array with min/max)
    if (value.length === 2 && params?.min !== undefined && params?.max !== undefined) {
      return 'range';
    }
    // Otherwise it's a vector
    return 'vector';
  }
  
  if (typeof value === 'function') {
    return 'button';
  }
  
  return 'text';
}

