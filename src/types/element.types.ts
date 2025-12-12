/**
 * Element type constants
 */
export const ElementType = {
  COMPUTATION: 'computation',
  IMAGE: 'image',
  TEXT: 'text',
  GROUP: 'group',
  LINE: 'line',
  POLYLINE: 'polyline',
} as const;

export type ElementTypeValue = typeof ElementType[keyof typeof ElementType];
