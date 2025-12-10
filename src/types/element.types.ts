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

/**
 * Type guard to check if an element is a computation
 */
export function isComputation(element: { type: string }): boolean {
  return element.type === ElementType.COMPUTATION;
}

/**
 * Type guard to check if an element is an annotation
 */
export function isAnnotation(element: { type: string }): boolean {
  return element.type !== ElementType.COMPUTATION;
}
