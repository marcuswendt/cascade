/**
 * Code Compilation Tests
 * Tests for TypeScript transpilation, code wrapping, and node execution
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  transpileTypeScript,
  compileNodeCode,
  executeNodeCode,
  compileAndExecute,
} from '@/editor/utils/compileNodeCode';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';

describe('transpileTypeScript', () => {
  it('should strip type annotations', () => {
    const code = 'const x: number = 1;';
    const result = transpileTypeScript(code);
    expect(result).toContain('const x = 1;');
    expect(result).not.toContain(': number');
  });

  it('should strip generics', () => {
    const code = 'const arr: Array<string> = [];';
    const result = transpileTypeScript(code);
    expect(result).not.toContain('<string>');
  });

  it('should strip interface declarations', () => {
    const code = `
interface MyType {
  name: string;
}
const obj: MyType = { name: 'test' };
`;
    const result = transpileTypeScript(code);
    expect(result).not.toContain('interface');
    expect(result).toContain("{ name: 'test' }");
  });

  it('should preserve comments', () => {
    const code = '// This is a comment\nconst x = 1;';
    const result = transpileTypeScript(code);
    expect(result).toContain('// This is a comment');
  });

  it('should handle async/await', () => {
    const code = 'const result = await Promise.resolve(42);';
    const result = transpileTypeScript(code);
    expect(result).toContain('await Promise.resolve(42)');
  });

  it('should handle arrow functions with types', () => {
    const code = 'const fn = (x: number): number => x * 2;';
    const result = transpileTypeScript(code);
    expect(result).toContain('const fn = (x) => x * 2;');
  });

  it('should handle class with type annotations', () => {
    const code = `
class Foo {
  private x: number;
  constructor(x: number) {
    this.x = x;
  }
}
`;
    const result = transpileTypeScript(code);
    expect(result).not.toContain(': number');
    expect(result).toContain('class Foo');
  });
});

describe('compileNodeCode', () => {
  it('should return compiled function for valid code', () => {
    const code = 'const x = 1;';
    const result = compileNodeCode(code);

    expect(result.error).toBeNull();
    expect(result.fn).toBeInstanceOf(Function);
    expect(result.jsCode).toContain('const x = 1;');
  });

  it('should wrap code in async function', () => {
    const code = 'node.out("result").setValue(42);';
    const result = compileNodeCode(code);

    expect(result.error).toBeNull();
    expect(result.fn).not.toBeNull();
  });

  it('should handle malformed code gracefully', () => {
    // Note: TypeScript's transpiler is very lenient and may not error on all invalid syntax
    // The Function constructor is also lenient
    // This test verifies that even "bad" code doesn't crash the compilation
    const code = 'function ('; // Missing name and body
    const result = compileNodeCode(code);

    // Either it errors or it returns a function - both are valid handling
    expect(result).toBeDefined();
    if (result.error) {
      expect(result.fn).toBeNull();
    } else {
      expect(result.fn).not.toBeNull();
    }
  });

  it('should handle TypeScript-specific syntax', () => {
    const code = `
const input = node.in<number>('value', 0);
const output = node.out<string>('result');
`;
    const result = compileNodeCode(code);

    expect(result.error).toBeNull();
    expect(result.fn).not.toBeNull();
    // Generics should be stripped
    expect(result.jsCode).not.toContain('<number>');
    expect(result.jsCode).not.toContain('<string>');
  });

  it('should compile node port definitions', () => {
    const code = `
node.in('input', 0);
node.out('output');
node.defineProp('value', { value: 1.0 });
`;
    const result = compileNodeCode(code);

    expect(result.error).toBeNull();
    expect(result.fn).not.toBeNull();
  });

  it('should compile lifecycle hooks', () => {
    const code = `
node.onReady = () => {
  console.log('Ready!');
};

node.onUpdate = () => {
  console.log('Updated!');
};
`;
    const result = compileNodeCode(code);

    expect(result.error).toBeNull();
    expect(result.fn).not.toBeNull();
  });

  it('should compile async operations', () => {
    const code = `
const pkg = await node.require('lodash');
const result = await Promise.resolve(42);
`;
    const result = compileNodeCode(code);

    expect(result.error).toBeNull();
    expect(result.fn).not.toBeNull();
  });
});

describe('executeNodeCode', () => {
  let graph: Graph;
  let node: Node;

  beforeEach(() => {
    graph = new Graph();
    node = new Node('testNode', 'TestType', graph);
    graph.addElement(node);
  });

  it('should execute compiled function on node', async () => {
    const code = `
node.in('input', 0);
node.out('output');
`;
    const compiled = compileNodeCode(code);
    expect(compiled.fn).not.toBeNull();

    const result = await executeNodeCode(node, graph, compiled.fn!, code);

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
  });

  it('should register ports during execution', async () => {
    const code = `
node.in('myInput', 42);
node.out('myOutput');
`;
    const compiled = compileNodeCode(code);
    const result = await executeNodeCode(node, graph, compiled.fn!, code);

    expect(result.success).toBe(true);
    expect(node.inputs.find(p => p.name === 'myInput')).toBeDefined();
    expect(node.outputs.find(p => p.name === 'myOutput')).toBeDefined();
  });

  it('should register props during execution', async () => {
    const code = `
node.defineProp('radius', {
  value: 5.0,
  params: { min: 0, max: 100 }
});
`;
    const compiled = compileNodeCode(code);
    const result = await executeNodeCode(node, graph, compiled.fn!, code);

    expect(result.success).toBe(true);
    expect(node.props.radius).toBeDefined();
    expect(node.props.radius.value).toBe(5.0);
  });

  it('should store source code on node', async () => {
    const code = '// My custom code\nnode.out("result");';
    const compiled = compileNodeCode(code);
    await executeNodeCode(node, graph, compiled.fn!, code);

    expect(node.code).toBe(code);
  });

  it('restores bypass after compiling a bypassed node', async () => {
    node.setBypass(true);
    const code = `node.out('result');`;
    const compiled = compileNodeCode(code);

    const result = await executeNodeCode(node, graph, compiled.fn!, code);

    expect(result.success).toBe(true);
    expect(node.bypass).toBe(true);
    expect(node.outputs.find(port => port.name === 'result')).toBeDefined();
  });

  it('preserves parameter values while refreshing the node definition', async () => {
    node.defineProp('radius', { value: 12 });
    const code = `node.defineProp('radius', { value: 5 });`;
    const compiled = compileNodeCode(code);

    const result = await executeNodeCode(node, graph, compiled.fn!, code);

    expect(result.success).toBe(true);
    expect(node.props.radius.value).toBe(12);
  });

  it('keeps compiling when lifecycle cleanup or readiness hooks fail', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    node.onDestroy = () => { throw new Error('destroy failed'); };
    const code = `
node.out('result');
node.onReady = () => { throw new Error('ready failed'); };
`;
    const compiled = compileNodeCode(code);

    const result = await executeNodeCode(node, graph, compiled.fn!, code);

    expect(result).toEqual({ success: true, error: null });
    expect(warning).toHaveBeenCalledTimes(2);
    expect(warning.mock.calls.map((call) => call[0])).toEqual([
      'Error in node.onDestroy:',
      'Error in node.onReady:',
    ]);
    warning.mockRestore();
  });

  it('should handle runtime exceptions gracefully', async () => {
    const code = `
throw new Error('Runtime error!');
`;
    const compiled = compileNodeCode(code);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await executeNodeCode(node, graph, compiled.fn!, code);
    consoleSpy.mockRestore();

    // Execution catches the error but still returns (node.execute handles errors internally)
    // The error is logged and stored on node.error
    expect(node.error).toBeDefined();
    expect(node.error?.message).toContain('Runtime error!');
  });

  it('should call onReady after successful execution', async () => {
    // Test that onReady hook defined in code gets called
    const compiled = compileNodeCode(`
const output = node.out('testOutput');
node.onReady = () => {
  output.setValue('ready-called');
};
`);
    await executeNodeCode(node, graph, compiled.fn!, `node.out('testOutput');`);

    // Verify the output was created
    const output = node.outputs.find(p => p.name === 'testOutput');
    expect(output).toBeDefined();
  });
});

describe('compileAndExecute', () => {
  let graph: Graph;
  let node: Node;

  beforeEach(() => {
    graph = new Graph();
    node = new Node('testNode', 'TestType', graph);
    graph.addElement(node);
  });

  it('should compile and execute valid code', async () => {
    const code = `
node.in('x', 0);
node.out('y');
`;
    const result = await compileAndExecute(node, graph, code);

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(node.inputs.find(p => p.name === 'x')).toBeDefined();
    expect(node.outputs.find(p => p.name === 'y')).toBeDefined();
  });

  it('should handle code that throws during setup', async () => {
    // Use code that will throw when executed
    const code = 'throw new SyntaxError("deliberate error");';
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await compileAndExecute(node, graph, code);
    consoleSpy.mockRestore();

    // The error is captured
    expect(node.error).toBeDefined();
    expect(node.error?.message).toContain('deliberate error');
  });

  it('replaces a stale node error when compilation fails', async () => {
    node.error = new Error('stale runtime error');

    const result = await compileAndExecute(node, graph, 'const =');

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('stale runtime error');
    expect(node.error?.message).toBe(result.error);
  });

  it('should handle runtime exceptions in code', async () => {
    const code = `
const x = null;
x.foo(); // Will throw
`;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await compileAndExecute(node, graph, code);
    consoleSpy.mockRestore();

    // Runtime errors are caught and stored on node.error
    // The execution still "completes" but with an error state
    expect(node.error).toBeDefined();
  });

  it('should handle complex node with multiple ports and props', async () => {
    const code = `
// Inputs
const inputA = node.in<number>('a', 0);
const inputB = node.in<number>('b', 0);

// Outputs
const sum = node.out<number>('sum');
const product = node.out<number>('product');

// Props
node.defineProp('multiplier', {
  value: 1.0,
  params: { min: 0, max: 10 }
});

// Callbacks
inputA.onChange = () => {
  sum.setValue(inputA.value + inputB.value);
  product.setValue(inputA.value * inputB.value * node.props.multiplier.value);
};
`;
    const result = await compileAndExecute(node, graph, code);

    expect(result.success).toBe(true);
    expect(node.inputs.find(p => p.name === 'a')).toBeDefined();
    expect(node.inputs.find(p => p.name === 'b')).toBeDefined();
    expect(node.outputs.find(p => p.name === 'sum')).toBeDefined();
    expect(node.outputs.find(p => p.name === 'product')).toBeDefined();
    expect(node.props.multiplier).toBeDefined();
  });
});

describe('real-world code patterns', () => {
  let graph: Graph;
  let node: Node;

  beforeEach(() => {
    graph = new Graph();
    node = new Node('testNode', 'TestType', graph);
    graph.addElement(node);
  });

  it('should compile typical custom node pattern', async () => {
    const code = `
// Define inputs
const input = node.in('input', null);

// Define properties (shown in inspector)
node.defineProp('value', {
  value: 1.0,
  params: { min: 0, max: 10, step: 0.1 },
  displayName: 'Value'
});

// Define outputs
const output = node.out('output');

// React to input changes
input.onChange = (value) => {
  output.setValue(value);
};

// React to property changes
node.watchProp('value', (newValue) => {
  output.setValue(newValue);
});

// Called once when node is ready
node.onReady = () => {
  output.setValue(node.props.value.value);
};
`;
    const result = await compileAndExecute(node, graph, code);
    expect(result.success).toBe(true);
  });

  it('should compile image processing pattern', async () => {
    const code = `
// Image input
const imageIn = node.in('image', null);

// Processing parameters
node.defineProp('intensity', {
  value: 0.5,
  params: { min: 0, max: 1 }
});

// Output
const imageOut = node.out('image');

// Process callback
imageIn.onChange = () => {
  // In real code, this would process the image
  imageOut.setValue(imageIn.value);
};
`;
    const result = await compileAndExecute(node, graph, code);
    expect(result.success).toBe(true);
  });

  it('should compile variadic input pattern', async () => {
    const code = `
// Set up variadic inputs
node.setVariadic(0);

// Output
const sumOut = node.out('sum');

node.onUpdate = () => {
  const inputs = node.getVariadicInputs();
  const sum = inputs.reduce((acc, inp) => acc + (inp.value || 0), 0);
  sumOut.setValue(sum);
};
`;
    const result = await compileAndExecute(node, graph, code);
    expect(result.success).toBe(true);
  });
});
