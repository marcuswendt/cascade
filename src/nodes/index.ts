/**
 * Nodes Package - Node graph data model
 *
 * Base classes for the node system:
 * - Node: Base class all nodes extend
 * - Graph: Container for nodes and connections
 * - Annotations: Canvas overlays (text, image, group, line)
 *
 * Node packages (core/, image/, etc.) define specific node types.
 * For runtime/engine features, see src/engine/.
 * For UI components, see src/editor/.
 */

// Base classes
export { Node } from './Node.js';
export { Graph, GRAPH_FORMAT_VERSION, type CanvasAnnotation } from './Graph.js';

// Annotations
export { Annotation } from './annotations/Annotation.js';
export { TextAnnotation } from './annotations/Text.js';
export { ImageAnnotation } from './annotations/Image.js';
export { GroupAnnotation } from './annotations/Group.js';
export { LineAnnotation } from './annotations/Line.js';
export { PolylineAnnotation } from './annotations/Polyline.js';
