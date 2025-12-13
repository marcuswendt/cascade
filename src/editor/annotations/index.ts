/**
 * Annotation UI Components Registry
 *
 * Maps annotation class names to their Svelte UI components.
 * This enables polymorphic rendering without string literal checks.
 */

import TextAnnotationUI from './TextAnnotationUI.svelte';
import ImageAnnotationUI from './ImageAnnotationUI.svelte';
import GroupAnnotationUI from './GroupAnnotationUI.svelte';
import LineAnnotationUI from './LineAnnotationUI.svelte';
import PolylineAnnotationUI from './PolylineAnnotationUI.svelte';

import type { ComponentType, SvelteComponent } from 'svelte';

// Registry maps annotation type names to UI components
// Uses annotation.type (e.g., 'Text') rather than constructor.name
// Includes both PascalCase and lowercase for compatibility
export const annotationRegistry: Map<string, ComponentType<SvelteComponent>> = new Map([
  ['Text', TextAnnotationUI],
  ['text', TextAnnotationUI],
  ['Image', ImageAnnotationUI],
  ['image', ImageAnnotationUI],
  ['Group', GroupAnnotationUI],
  ['group', GroupAnnotationUI],
  ['Line', LineAnnotationUI],
  ['line', LineAnnotationUI],
  ['Polyline', PolylineAnnotationUI],
  ['polyline', PolylineAnnotationUI],
]);

// Re-export components for direct import if needed
export {
  TextAnnotationUI,
  ImageAnnotationUI,
  GroupAnnotationUI,
  LineAnnotationUI,
  PolylineAnnotationUI,
};
