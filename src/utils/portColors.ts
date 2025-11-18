import type { InputPort, OutputPort } from '@/types/node.types';

/**
 * Get the color for a port based on its data type and value
 * @param port - The input or output port
 * @returns Hex color string
 */
export function getPortColor(port: InputPort | OutputPort): string {
  // Trigger ports always use white for visibility
  if (port.portType === 'trigger') {
    return '#fff';
  }
  
  // Check if the value is an image (HTMLCanvasElement or HTMLImageElement)
  if (port.value instanceof HTMLCanvasElement || port.value instanceof HTMLImageElement) {
    return '#FFE87C'; // Medium yellow for images
  }
  
  // Check dataType
  switch (port.dataType) {
    case 'number':
      return '#87CEEB'; // Light blue (sky blue) for numbers/floats
    case 'string':
      return '#90EE90'; // Light green for strings
    case 'boolean':
      return '#FFB6C1'; // Light pink for booleans
    case 'color':
      return '#FF69B4'; // Hot pink for colors
    case 'array':
      return '#DDA0DD'; // Plum for arrays
    case 'object':
      return '#F0E68C'; // Khaki for objects
    case 'asset':
      return '#FFE87C'; // Medium yellow for assets (similar to images)
    case 'any':
    default:
      // For 'any' type, try to infer from value
      if (port.value !== null && port.value !== undefined) {
        if (typeof port.value === 'number') {
          return '#87CEEB'; // Light blue for numbers
        }
        if (typeof port.value === 'string') {
          return '#90EE90'; // Light green for strings
        }
        if (typeof port.value === 'boolean') {
          return '#FFB6C1'; // Light pink for booleans
        }
      }
      return '#888'; // Default gray
  }
}

