import type { InputPort, OutputPort, DataType } from '@/types/node.types';
import { ImageBuffer } from '@/nodes/image/ImageBuffer';
import { TYPE_COLORS, typeColor, isImageRef } from '@/types/coreTypes';

/**
 * The type families under the names the older untyped code asks for.
 *
 * This used to be a second hardcoded palette beside `TYPE_COLORS`, with
 * different values for the same idea — `number` was `#4A9EFF` here and `float`
 * was `#4A9EFF` there, and nothing kept them in step. Two vocabularies for one
 * concept is the fault this codebase keeps paying for, so there is now one:
 * these are aliases onto the same theme tokens.
 *
 * `trigger` and `inactive` have no entry in `TYPE_COLORS` because they are not
 * types. A trigger carries no value, and an inactive wire is a state of a
 * connection.
 */
export const DATA_TYPE_COLORS: Record<string, string> = {
  number: TYPE_COLORS.float,
  image: TYPE_COLORS.image,
  asset: TYPE_COLORS.asset,
  geometry: TYPE_COLORS.points,
  array: TYPE_COLORS.array,
  object: TYPE_COLORS.object,
  string: TYPE_COLORS.string,
  boolean: TYPE_COLORS.bool,
  color: TYPE_COLORS.color,
  any: TYPE_COLORS.any,
  trigger: 'var(--type-trigger)',
  inactive: 'var(--wire-inactive)',
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
  // gets a colour from its namespace so `archive.*` reads as one family.
  if (port.dataType && port.dataType !== 'any') {
    return typeColor(port.dataType);
  }

  // An image reference is recognisable by shape even on an untyped port, which
  // is what keeps a node written before the descriptor existed readable.
  if (isImageRef(port.value)) {
    return TYPE_COLORS.image;
  }

  // Only `any` reaches here. Infer enough to keep old untyped nodes readable.
  if (typeof port.value === 'number') return DATA_TYPE_COLORS.number;
  if (typeof port.value === 'string') return DATA_TYPE_COLORS.string;
  if (typeof port.value === 'boolean') return DATA_TYPE_COLORS.boolean;
  if (Array.isArray(port.value)) return DATA_TYPE_COLORS.array;
  if (port.value !== null && typeof port.value === 'object') return DATA_TYPE_COLORS.object;
  return DATA_TYPE_COLORS.any;
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
