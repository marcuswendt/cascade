import type { InputPort, OutputPort, DataType } from '@/types/node.types';
import { ImageBuffer } from '@/nodes/lens/ImageBuffer';
import { TYPE_COLORS, typeColor, isImageRef } from '@/types/coreTypes';

/**
 * Color palette for data types
 * - number = blue
 * - image/asset = yellow
 * - geometry = green
 * - arrays = red
 * - objects = orange
 * - trigger = white
 * - inactive = grey
 */
export const DATA_TYPE_COLORS: Record<string, string> = {
  number: '#4A9EFF',      // Blue for numbers
  image: '#FFD700',       // Yellow/gold for images
  asset: '#FFD700',       // Yellow for assets (same as images)
  geometry: '#4ADE80',    // Green for geometry
  array: '#F87171',       // Red for arrays
  object: '#FB923C',      // Orange for objects
  string: '#A78BFA',      // Purple for strings
  boolean: '#F472B6',     // Pink for booleans
  color: '#EC4899',       // Magenta for color values
  trigger: '#FFFFFF',     // White for triggers
  any: '#9CA3AF',         // Gray for any/unknown
  inactive: '#4B5563',    // Dark gray for inactive connections
};

/**
 * Get the color for a port based on its data type and value
 * @param port - The input or output port
 * @returns Hex color string
 */
export function getPortColor(port: InputPort | OutputPort): string {
  // Trigger ports always use white for visibility
  if (port.portType === 'trigger') {
    return DATA_TYPE_COLORS.trigger;
  }

  // Check if the value is an image (ImageBuffer, HTMLCanvasElement, HTMLImageElement, OffscreenCanvas)
  if (port.value instanceof ImageBuffer ||
      port.value instanceof HTMLCanvasElement ||
      port.value instanceof HTMLImageElement ||
      port.value instanceof OffscreenCanvas) {
    return DATA_TYPE_COLORS.image;
  }

  // A declared core type answers this outright — including the vectors,
  // matrices, geometry and image types, and any namespaced project type, which
  // gets a colour from its namespace so `observatory.*` reads as one family.
  if (port.dataType && port.dataType !== 'any') {
    return typeColor(port.dataType);
  }

  // An image reference is recognisable by shape even on an untyped port, which
  // is what keeps a node written before the descriptor existed readable.
  if (isImageRef(port.value)) {
    return TYPE_COLORS.image;
  }

  // Check dataType
  switch (port.dataType) {
    case 'number':
      return DATA_TYPE_COLORS.number;
    case 'string':
      return DATA_TYPE_COLORS.string;
    case 'boolean':
      return DATA_TYPE_COLORS.boolean;
    case 'color':
      return DATA_TYPE_COLORS.color;
    case 'array':
      return DATA_TYPE_COLORS.array;
    case 'object':
      return DATA_TYPE_COLORS.object;
    case 'asset':
      return DATA_TYPE_COLORS.asset;
    case 'any':
    default:
      // For 'any' type, try to infer from value
      if (port.value !== null && port.value !== undefined) {
        if (typeof port.value === 'number') {
          return DATA_TYPE_COLORS.number;
        }
        if (typeof port.value === 'string') {
          return DATA_TYPE_COLORS.string;
        }
        if (typeof port.value === 'boolean') {
          return DATA_TYPE_COLORS.boolean;
        }
        if (Array.isArray(port.value)) {
          return DATA_TYPE_COLORS.array;
        }
        if (port.value instanceof ImageBuffer ||
            port.value instanceof HTMLCanvasElement ||
            port.value instanceof HTMLImageElement ||
            port.value instanceof OffscreenCanvas) {
          return DATA_TYPE_COLORS.image;
        }
        if (typeof port.value === 'object') {
          return DATA_TYPE_COLORS.object;
        }
      }
      return DATA_TYPE_COLORS.any;
  }
}

/**
 * Get color for a connection/wire based on the source port
 * @param port - The source output port
 * @param isActive - Whether the connection is active (used for switch nodes etc.)
 * @returns Hex color string
 */
export function getConnectionColor(port: OutputPort | null, isActive: boolean = true): string {
  if (!isActive) {
    return DATA_TYPE_COLORS.inactive;
  }
  if (!port) {
    return DATA_TYPE_COLORS.any;
  }
  return getPortColor(port);
}

