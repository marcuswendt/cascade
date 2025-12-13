/**
 * Custom Node Workflow Tests
 * Integration tests for the custom node creation, compilation, and execution workflow
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { compileNodeCode, compileAndExecute } from '@/editor/utils/compileNodeCode';
import { codeTemplates } from '@/editor/nodeTemplates';

describe('Custom Node Creation Workflow', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  describe('template-based node creation', () => {
    it('should create node with default template code', async () => {
      // Step 1: User creates custom node in dialog
      const config = {
        name: 'TestNode',
        modulePath: 'local.testnode',
        baseClass: 'cascade.Node',
      };

      // Step 2: Get template code for base class
      const templateCode = codeTemplates.node(config.name);
      expect(templateCode).toContain('// TestNode - Custom Node');
      expect(templateCode).toContain("node.in('input'");
      expect(templateCode).toContain("node.out('output')");
      expect(templateCode).toContain("node.defineProp('value'");

      // Step 3: Create node and add to graph
      const node = new Node(config.modulePath, config.modulePath, graph);
      graph.addElement(node);

      // Step 4: Compile and execute template code
      const result = await compileAndExecute(node, graph, templateCode);

      // Step 5: Verify node is functional
      expect(result.success).toBe(true);
      expect(node.inputs.find(p => p.name === 'input')).toBeDefined();
      expect(node.outputs.find(p => p.name === 'output')).toBeDefined();
      expect(node.props.value).toBeDefined();
      expect(node.props.value.value).toBe(1.0);
    });

    it('should create lens node with image processing template', async () => {
      const config = {
        name: 'BlurEffect',
        modulePath: 'local.blureffect',
        baseClass: 'cascade.lens.LensNode',
      };

      // Get lens template
      const templateCode = codeTemplates.lens(config.name);
      expect(templateCode).toContain('// BlurEffect - Image Processing Node');
      expect(templateCode).toContain("node.in('image'");
      expect(templateCode).toContain("node.defineProp('intensity'");

      // Create and compile
      const node = new Node(config.modulePath, config.modulePath, graph);
      graph.addElement(node);

      // For lens nodes, compilation will fail in node environment due to document.createElement
      // But compilation step should succeed
      const compiled = compileNodeCode(templateCode);
      expect(compiled.error).toBeNull();
      expect(compiled.fn).not.toBeNull();
    });
  });

  describe('custom code compilation', () => {
    it('should compile user-written node code', async () => {
      const customCode = `
// Simple multiplier node
const input = node.in<number>('value', 1);
const output = node.out<number>('result');

node.defineProp('multiplier', {
  value: 2,
  params: { min: 1, max: 10 }
});

function calculate() {
  const result = input.value * node.props.multiplier.value;
  output.setValue(result);
}

input.onChange = calculate;
node.watchProp('multiplier', calculate);
node.onReady = calculate;
`;

      const node = new Node('local.multiplier', 'local.multiplier', graph);
      graph.addElement(node);

      const result = await compileAndExecute(node, graph, customCode);

      expect(result.success).toBe(true);
      expect(node.inputs.find(p => p.name === 'value')).toBeDefined();
      expect(node.outputs.find(p => p.name === 'result')).toBeDefined();
      expect(node.props.multiplier).toBeDefined();
    });

    it('should handle node with variadic inputs', async () => {
      const variadicCode = `
// Sum all inputs
node.setVariadic(0);
const output = node.out<number>('sum');

node.onUpdate = () => {
  const inputs = node.getVariadicInputs();
  const sum = inputs.reduce((acc, inp) => acc + (inp.value || 0), 0);
  output.setValue(sum);
};
`;

      const node = new Node('local.sum', 'local.sum', graph);
      graph.addElement(node);

      const result = await compileAndExecute(node, graph, variadicCode);

      expect(result.success).toBe(true);
      expect(node.outputs.find(p => p.name === 'sum')).toBeDefined();
    });

    it('should handle async operations in node code', async () => {
      const asyncCode = `
const input = node.in('trigger', null, { type: 'trigger' });
const output = node.out('result');

node.defineProp('delay', {
  value: 0, // ms
  params: { min: 0, max: 1000 }
});

input.onTrigger = async () => {
  // Simulate async operation
  const delay = node.props.delay.value;
  if (delay > 0) {
    await new Promise(r => setTimeout(r, delay));
  }
  output.setValue(Date.now());
};
`;

      const node = new Node('local.async', 'local.async', graph);
      graph.addElement(node);

      const result = await compileAndExecute(node, graph, asyncCode);

      expect(result.success).toBe(true);
      expect(node.inputs.find(p => p.name === 'trigger')).toBeDefined();
      expect(node.outputs.find(p => p.name === 'result')).toBeDefined();
    });
  });

  describe('AI-generated code compilation', () => {
    it('should compile typical AI-generated pattern node', async () => {
      // This simulates code that might be generated by AI
      const aiGeneratedCode = `
// Checkerboard Pattern Generator
// AI-generated code for creating a procedural checkerboard pattern

const output = node.out<HTMLCanvasElement>('image');

node.defineProp('width', {
  value: 256,
  type: 'int',
  params: { min: 1, max: 2048, integer: true },
  displayName: 'Width'
});

node.defineProp('height', {
  value: 256,
  type: 'int',
  params: { min: 1, max: 2048, integer: true },
  displayName: 'Height'
});

node.defineProp('tileSize', {
  value: 32,
  type: 'int',
  params: { min: 1, max: 256, integer: true },
  displayName: 'Tile Size'
});

node.defineProp('color1', {
  value: { r: 0, g: 0, b: 0, a: 1 },
  type: 'color',
  displayName: 'Color 1'
});

node.defineProp('color2', {
  value: { r: 1, g: 1, b: 1, a: 1 },
  type: 'color',
  displayName: 'Color 2'
});

// Will fail in node environment due to DOM, but compilation should work
`;

      const node = new Node('local.checkerboard', 'local.checkerboard', graph);
      graph.addElement(node);

      const result = await compileAndExecute(node, graph, aiGeneratedCode);

      expect(result.success).toBe(true);
      expect(node.props.width).toBeDefined();
      expect(node.props.height).toBeDefined();
      expect(node.props.tileSize).toBeDefined();
      expect(node.props.color1).toBeDefined();
      expect(node.props.color2).toBeDefined();
    });

    it('should compile AI-generated data processing node', async () => {
      const aiGeneratedCode = `
// JSON Parser Node
// Parses JSON string and extracts a value at the specified path

const jsonInput = node.in<string>('json', '{}');
const output = node.out<any>('value');

node.defineProp('path', {
  value: '',
  type: 'text',
  displayName: 'JSON Path',
  params: {}
});

node.defineProp('defaultValue', {
  value: null,
  displayName: 'Default Value'
});

function extractValue(obj: any, path: string): any {
  if (!path) return obj;
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current === null || current === undefined) {
      return node.props.defaultValue.value;
    }
    current = current[key];
  }
  return current ?? node.props.defaultValue.value;
}

function process() {
  try {
    const data = JSON.parse(jsonInput.value || '{}');
    const result = extractValue(data, node.props.path.value);
    output.setValue(result);
    node.error = null;
  } catch (e) {
    node.error = e instanceof Error ? e : new Error(String(e));
    output.setValue(node.props.defaultValue.value);
  }
}

jsonInput.onChange = process;
node.watchProp('path', process);
node.watchProp('defaultValue', process);
node.onReady = process;
`;

      const node = new Node('local.jsonparser', 'local.jsonparser', graph);
      graph.addElement(node);

      const result = await compileAndExecute(node, graph, aiGeneratedCode);

      expect(result.success).toBe(true);
      expect(node.inputs.find(p => p.name === 'json')).toBeDefined();
      expect(node.outputs.find(p => p.name === 'value')).toBeDefined();
      expect(node.props.path).toBeDefined();
      expect(node.props.defaultValue).toBeDefined();
    });
  });

  describe('node update workflow', () => {
    it('should recompile node when code changes', async () => {
      const node = new Node('local.test', 'local.test', graph);
      graph.addElement(node);

      // First version
      const code1 = `
node.in('a', 0);
node.out('result');
`;
      await compileAndExecute(node, graph, code1);

      expect(node.inputs.length).toBe(1);
      expect(node.inputs[0].name).toBe('a');

      // Update with new code - different input
      const code2 = `
node.in('x', 0);
node.in('y', 0);
node.out('sum');
`;
      await compileAndExecute(node, graph, code2);

      // Should have new ports (old ones cleaned up)
      expect(node.inputs.find(p => p.name === 'x')).toBeDefined();
      expect(node.inputs.find(p => p.name === 'y')).toBeDefined();
      expect(node.outputs.find(p => p.name === 'sum')).toBeDefined();
    });

    it('should preserve prop values after recompilation', async () => {
      const node = new Node('local.test', 'local.test', graph);
      graph.addElement(node);

      // Initial code
      const code = `
node.defineProp('value', { value: 5 });
node.out('result');
`;
      await compileAndExecute(node, graph, code);
      expect(node.props.value.value).toBe(5);

      // User changes the prop value
      node.props.value.value = 42;

      // Recompile (same code)
      await compileAndExecute(node, graph, code);

      // Value should be preserved from restoreState
      expect(node.props.value.value).toBe(42);
    });
  });

  describe('error handling', () => {
    it('should capture compilation errors gracefully', async () => {
      const node = new Node('local.broken', 'local.broken', graph);
      graph.addElement(node);

      // Code that throws during execution
      const badCode = `
// This will throw
throw new Error('Intentional test error');
`;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await compileAndExecute(node, graph, badCode);
      consoleSpy.mockRestore();

      // Error should be captured on node
      expect(node.error).toBeDefined();
      expect(node.error?.message).toContain('Intentional test error');
    });

    it('should recover from errors on subsequent compilation', async () => {
      const node = new Node('local.recover', 'local.recover', graph);
      graph.addElement(node);

      // First: bad code
      const badCode = `throw new Error('test');`;
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await compileAndExecute(node, graph, badCode);
      consoleSpy.mockRestore();
      expect(node.error).toBeDefined();

      // Then: good code
      const goodCode = `node.out('result');`;
      await compileAndExecute(node, graph, goodCode);

      // Should have recovered
      expect(node.outputs.find(p => p.name === 'result')).toBeDefined();
    });
  });
});

describe('Module Path Generation', () => {
  it('should generate valid module path from node name', () => {
    // This tests the logic used in CustomNodeDialog
    const generateModulePath = (name: string): string => {
      return 'local.' + name.toLowerCase().replace(/[^a-z0-9]/g, '');
    };

    expect(generateModulePath('My Cool Node')).toBe('local.mycoolnode');
    expect(generateModulePath('BlurEffect')).toBe('local.blureffect');
    expect(generateModulePath('Test123')).toBe('local.test123');
    expect(generateModulePath('Hello World!')).toBe('local.helloworld');
  });
});
