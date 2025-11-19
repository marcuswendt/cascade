/**
 * Utilities for handling node type names and package paths
 */

import { nodeLibraries } from '@/editor/nodeTemplates';
import { getLensNodeTemplate } from '@/nodes/lens';

/**
 * Convert a short type name to a full package path
 * e.g., "Color" -> "cascade.lens.Color", "Timer" -> "cascade.core.Timer"
 */
export function typeToPackagePath(type: string): string {
  // Check if it's already a package path
  if (type.includes('.')) {
    return type;
  }
  
  // Find which library contains this node type
  for (const library of nodeLibraries) {
    for (const category of library.categories) {
      for (const node of category.nodes) {
        if (node.type === type) {
          // Return full package path: cascade.{libraryId}.{type}
          return `cascade.${library.id}.${type}`;
        }
      }
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
 * Get node template code for a given type
 * Returns null if no template is available
 */
export function getNodeTemplateCode(type: string): string | null {
  // Extract library and node type from package path
  const libraryId = getLibraryIdFromType(type);
  const nodeType = packagePathToType(type);
  
  if (libraryId === 'lens') {
    return getLensNodeTemplate(nodeType);
  }
  
  // Add other library template loaders here as needed
  // if (libraryId === 'core') {
  //   return getCoreNodeTemplate(nodeType);
  // }
  
  return null;
}

