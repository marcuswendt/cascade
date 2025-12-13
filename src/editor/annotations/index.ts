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

// Registry maps annotation constructor names to UI components
export const annotationRegistry: Map<string, ComponentType<SvelteComponent>> = new Map([
  ['TextAnnotation', TextAnnotationUI],
  ['ImageAnnotation', ImageAnnotationUI],
  ['GroupAnnotation', GroupAnnotationUI],
  ['LineAnnotation', LineAnnotationUI],
  ['PolylineAnnotation', PolylineAnnotationUI],
]);

// Re-export components for direct import if needed
export {
  TextAnnotationUI,
  ImageAnnotationUI,
  GroupAnnotationUI,
  LineAnnotationUI,
  PolylineAnnotationUI,
};
