/**
 * Utilities for handling node type names and package paths
 */

import type { Node } from '@/nodes/Node';
import type { Graph } from '@/nodes/Graph';

// Node function type - receives the node instance and graph
export type NodeFunction = (node: Node, graph: Graph) => void | Promise<void>;

// Type for class-based node constructors
export type NodeClass = new (id: string, graph: Graph) => Node;

// Class-based node registries (populated by library modules)
const nodeClassRegistries: Map<string, Record<string, NodeClass>> = new Map();

// Source code registry for stdlib nodes (populated by library modules)
const nodeSourceRegistry: Map<string, string> = new Map();

/**
 * Register source code for a node type
 * Called by library modules during initialization
 */
export function registerNodeSource(type: string, source: string): void {
  nodeSourceRegistry.set(type, source);
}

/**
 * Get source code for a node type
 * Returns null if no source is registered (custom nodes)
 */
export function getNodeSource(type: string): string | null {
  // Try full package path first
  if (nodeSourceRegistry.has(type)) {
    return nodeSourceRegistry.get(type) || null;
  }

  // Try short type name
  const shortType = packagePathToType(type);
  if (nodeSourceRegistry.has(shortType)) {
    return nodeSourceRegistry.get(shortType) || null;
  }

  return null;
}

/**
 * Register node classes from a library
 * Called by library modules during initialization
 */
export function registerNodeClasses(libraryId: string, classes: Record<string, NodeClass>): void {
  nodeClassRegistries.set(libraryId, classes);
}

/**
 * Convert a short type name to a full package path
 * e.g., "Color" -> "cascade.lens.Color", "Timer" -> "cascade.core.Timer"
 */
export function typeToPackagePath(type: string): string {
  // Check if it's already a package path
  if (type.includes('.')) {
    return type;
  }

  // Find which library contains this node type by checking registries
  for (const [libraryId, classes] of nodeClassRegistries) {
    if (type in classes) {
      return `cascade.${libraryId}.${type}`;
    }
  }

  // If not found in any library, assume it's a custom node
  // Return as-is (custom nodes don't have package paths)
  return type;
}

/**
 * Convert a full package path to a short type name
 * e.g., "cascade.lens.Color" -> "Color", "cascade.core.Timer" -> "Timer"
 */
export function packagePathToType(packagePath: string): string {
  // If it doesn't contain dots, it's already a short type
  if (!packagePath.includes('.')) {
    return packagePath;
  }

  // Extract the last part after the last dot
  const parts = packagePath.split('.');
  return parts[parts.length - 1];
}

/**
 * Check if a node type is from a standard library (has a package path)
 */
export function isStandardLibraryNode(type: string): boolean {
  return type.includes('.') && type.startsWith('cascade.');
}

/**
 * Get the library ID from a package path
 * e.g., "cascade.lens.Color" -> "lens"
 */
export function getLibraryIdFromType(type: string): string | null {
  if (!type.includes('.')) {
    return null;
  }

  const parts = type.split('.');
  if (parts.length >= 2 && parts[0] === 'cascade') {
    return parts[1];
  }

  return null;
}

/**
 * Get node class for a given type (class-based nodes)
 * Returns null if no class is available (custom nodes)
 */
export function getNodeClass(type: string): NodeClass | null {
  const libraryId = getLibraryIdFromType(type);
  const nodeType = packagePathToType(type);

  if (!libraryId) {
    return null;
  }

  const registry = nodeClassRegistries.get(libraryId);
  if (registry && registry[nodeType]) {
    return registry[nodeType];
  }

  return null;
}

/**
 * Compile a custom node from code string
 * Used for embedded and project nodes that aren't part of stdlib
 *
 * The compiled function receives the Computation instance as `node`
 * and can use all Node methods: in(), out(), defineProp(), etc.
 */
export function compileCustomNode(code: string): NodeFunction {
  const wrappedCode = `return (async function(node, graph) {\n${code}\n})(node, graph);`;
  const fn = new Function('node', 'graph', wrappedCode);
  return fn as NodeFunction;
}
