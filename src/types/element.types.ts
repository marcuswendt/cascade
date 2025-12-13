/**
 * Known annotation type names
 */
export const AnnotationTypes = ['Text', 'Image', 'Group', 'Line', 'Polyline'] as const;
export type AnnotationType = typeof AnnotationTypes[number];
