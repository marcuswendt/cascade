/**
 * Node Type Utilities Tests
 * Tests for node type path conversions, stdlib detection, and custom node compilation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  typeToPackagePath,
  packagePathToType,
  isStandardLibraryNode,
  getLibraryIdFromType,
  registerNodeClasses,
  getNodeClass,
  registerNodeSource,
  getNodeSource,
  compileCustomNode
} from '@/utils/nodeTypeUtils';

describe('packagePathToType', () => {
  it('should extract type name from full package path', () => {
    expect(packagePathToType('cascade.lens.Color')).toBe('Color');
  });

  it('should extract type from cascade.core path', () => {
    expect(packagePathToType('cascade.core.Timer')).toBe('Timer');
  });

  it('should return short type as-is', () => {
    expect(packagePathToType('MyCustomNode')).toBe('MyCustomNode');
  });

  it('should handle deeply nested paths', () => {
    expect(packagePathToType('cascade.lens.filters.Blur')).toBe('Blur');
  });

  it('should handle single segment', () => {
    expect(packagePathToType('Node')).toBe('Node');
  });
});

describe('typeToPackagePath', () => {
  it('should return already-dotted paths unchanged', () => {
    expect(typeToPackagePath('cascade.lens.Color')).toBe('cascade.lens.Color');
  });

  it('should return custom node type unchanged when not in registry', () => {
    // Without registering, unknown types are returned as-is
    expect(typeToPackagePath('UnknownCustomNode')).toBe('UnknownCustomNode');
  });

  it('should return short type unchanged when no registry match', () => {
    expect(typeToPackagePath('RandomNode')).toBe('RandomNode');
  });
});

describe('isStandardLibraryNode', () => {
  it('should return true for cascade.lens nodes', () => {
    expect(isStandardLibraryNode('cascade.lens.Color')).toBe(true);
    expect(isStandardLibraryNode('cascade.lens.Blur')).toBe(true);
  });

  it('should return true for cascade.core nodes', () => {
    expect(isStandardLibraryNode('cascade.core.Timer')).toBe(true);
    expect(isStandardLibraryNode('cascade.core.Switch')).toBe(true);
  });

  it('should return false for custom nodes (no dots)', () => {
    expect(isStandardLibraryNode('MyCustomNode')).toBe(false);
  });

  it('should return false for non-cascade package paths', () => {
    expect(isStandardLibraryNode('other.library.Node')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isStandardLibraryNode('')).toBe(false);
  });
});

describe('getLibraryIdFromType', () => {
  it('should extract lens from cascade.lens.Color', () => {
    expect(getLibraryIdFromType('cascade.lens.Color')).toBe('lens');
  });

  it('should extract core from cascade.core.Timer', () => {
    expect(getLibraryIdFromType('cascade.core.Timer')).toBe('core');
  });

  it('should return null for short types', () => {
    expect(getLibraryIdFromType('MyNode')).toBe(null);
  });

  it('should return null for non-cascade paths', () => {
    expect(getLibraryIdFromType('other.library.Node')).toBe(null);
  });

  it('should handle cascade paths with only two segments', () => {
    // cascade.something only has one level after cascade
    expect(getLibraryIdFromType('cascade.something')).toBe('something');
  });
});

describe('node class registry', () => {
  // Mock node class for testing
  class MockNodeClass {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
  }

  beforeEach(() => {
    // Register a test library
    registerNodeClasses('test', {
      TestNode: MockNodeClass as any,
      AnotherNode: MockNodeClass as any
    });
  });

  describe('registerNodeClasses', () => {
    it('should register classes that can be retrieved', () => {
      const NodeClass = getNodeClass('cascade.test.TestNode');
      expect(NodeClass).toBe(MockNodeClass);
    });
  });

  describe('getNodeClass', () => {
    it('should return registered class by full path', () => {
      const NodeClass = getNodeClass('cascade.test.TestNode');
      expect(NodeClass).toBe(MockNodeClass);
    });

    it('should return null for unregistered types', () => {
      expect(getNodeClass('cascade.test.NonExistent')).toBe(null);
    });

    it('should return null for short types (no library ID)', () => {
      expect(getNodeClass('TestNode')).toBe(null);
    });

    it('should return null for unknown libraries', () => {
      expect(getNodeClass('cascade.unknown.Node')).toBe(null);
    });
  });

  describe('typeToPackagePath with registry', () => {
    it('should convert short type to full path when registered', () => {
      // After registering, typeToPackagePath should find the type
      const path = typeToPackagePath('TestNode');
      expect(path).toBe('cascade.test.TestNode');
    });
  });
});

describe('node source registry', () => {
  beforeEach(() => {
    // Register test source code
    registerNodeSource('TestType', 'const x = 1;');
    registerNodeSource('cascade.lens.Color', 'const color = "red";');
  });

  describe('registerNodeSource', () => {
    it('should register source that can be retrieved', () => {
      registerNodeSource('MySource', 'console.log("test")');
      expect(getNodeSource('MySource')).toBe('console.log("test")');
    });
  });

  describe('getNodeSource', () => {
    it('should return registered source by type', () => {
      expect(getNodeSource('TestType')).toBe('const x = 1;');
    });

    it('should return registered source by package path', () => {
      expect(getNodeSource('cascade.lens.Color')).toBe('const color = "red";');
    });

    it('should return null for unregistered types', () => {
      expect(getNodeSource('NonExistent')).toBe(null);
    });

    it('should find source registered with short type via package path lookup', () => {
      // Register with short type
      registerNodeSource('ShortColor', 'const shortColor = true;');
      // Looking up by full path should find it via packagePathToType fallback
      expect(getNodeSource('cascade.lens.ShortColor')).toBe('const shortColor = true;');
    });
  });
});

describe('compileCustomNode', () => {
  it('should compile simple synchronous code', () => {
    const fn = compileCustomNode('node.x = 42;');
    expect(typeof fn).toBe('function');
  });

  it('should compile async code', () => {
    const fn = compileCustomNode('await Promise.resolve(); node.x = 42;');
    expect(typeof fn).toBe('function');
  });

  it('should execute and modify node object', async () => {
    const fn = compileCustomNode('node.testValue = "hello";');
    const mockNode: any = {};
    const mockGraph: any = {};

    await fn(mockNode, mockGraph);
    expect(mockNode.testValue).toBe('hello');
  });

  it('should have access to graph parameter', async () => {
    const fn = compileCustomNode('node.graphRef = graph;');
    const mockNode: any = {};
    const mockGraph: any = { id: 'test-graph' };

    await fn(mockNode, mockGraph);
    expect(mockNode.graphRef).toBe(mockGraph);
  });

  it('should support async/await', async () => {
    const fn = compileCustomNode(`
      const result = await Promise.resolve(42);
      node.asyncResult = result;
    `);
    const mockNode: any = {};
    const mockGraph: any = {};

    await fn(mockNode, mockGraph);
    expect(mockNode.asyncResult).toBe(42);
  });

  it('should throw on syntax errors', () => {
    expect(() => compileCustomNode('invalid javascript {')).toThrow();
  });

  it('should allow accessing node methods', async () => {
    const fn = compileCustomNode('node.result = node.getValue();');
    const mockNode: any = {
      getValue: () => 'test-value'
    };
    const mockGraph: any = {};

    await fn(mockNode, mockGraph);
    expect(mockNode.result).toBe('test-value');
  });

  it('should handle errors in executed code', async () => {
    const fn = compileCustomNode('throw new Error("test error");');
    const mockNode: any = {};
    const mockGraph: any = {};

    await expect(fn(mockNode, mockGraph)).rejects.toThrow('test error');
  });
});
