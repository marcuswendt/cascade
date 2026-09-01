/**
 * Core Nodes Tests
 * Tests for Switch, Merge, Input, Output nodes
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { SwitchNode } from '@/nodes/core/nodes/SwitchNode';
import { MergeNode } from '@/nodes/core/nodes/MergeNode';
import { InputNode } from '@/nodes/core/nodes/InputNode';
import { OutputNode } from '@/nodes/core/nodes/OutputNode';
import { SubnetNode } from '@/nodes/core/nodes/SubnetNode';
import { RandomNode } from '@/nodes/core/nodes/RandomNode';
import { RemapNode } from '@/nodes/core/nodes/RemapNode';
import { NullNode } from '@/nodes/core/nodes/NullNode';
import { randomRegistration } from '../packages/runtime/src/builtins/core/random';
import { remapRegistration } from '../packages/runtime/src/builtins/core/remap';

describe('SwitchNode', () => {
  let graph: Graph;
  let switchNode: SwitchNode;

  beforeEach(() => {
    graph = new Graph();
    switchNode = new SwitchNode('switch1', graph);
    graph.addElement(switchNode);
  });

  it('should create with correct type', () => {
    expect(switchNode.type).toBe('Switch');
  });

  it('should be variadic (accept multiple inputs)', () => {
    expect(switchNode.variadic).toBe(true);
  });

  it('should have index prop defaulting to 0', () => {
    expect(switchNode.props.index).toBeDefined();
    expect(switchNode.props.index.value).toBe(0);
  });

  it('should have output port', () => {
    expect(switchNode.outputs).toHaveLength(1);
    expect(switchNode.outputs[0].name).toBe('output');
  });

  it('should select first input by default', () => {
    // Create source nodes
    const source1 = new Node('source1', 'Test', graph);
    const source2 = new Node('source2', 'Test', graph);
    graph.addElement(source1);
    graph.addElement(source2);

    source1.out('output', 'param');
    source2.out('output', 'param');
    source1.outputs[0].setValue('value1');
    source2.outputs[0].setValue('value2');

    // Connect to switch variadic inputs
    const input1 = switchNode.in('input_0', null);
    const input2 = switchNode.in('input_1', null);
    graph.connect(source1.outputs[0], input1);
    graph.connect(source2.outputs[0], input2);

    // With index=0, should select first input
    expect(switchNode.props.index.value).toBe(0);
  });

  it('should switch to different input when index changes', () => {
    switchNode.parm('index')?.set(1);
    expect(switchNode.props.index.value).toBe(1);
  });
});

describe('MergeNode', () => {
  let graph: Graph;
  let mergeNode: MergeNode;

  beforeEach(() => {
    graph = new Graph();
    mergeNode = new MergeNode('merge1', graph);
    graph.addElement(mergeNode);
  });

  it('should create with correct type', () => {
    expect(mergeNode.type).toBe('Merge');
  });

  it('should be variadic (accept multiple inputs)', () => {
    expect(mergeNode.variadic).toBe(true);
  });

  it('should have append prop defaulting to false', () => {
    expect(mergeNode.props.append).toBeDefined();
    expect(mergeNode.props.append.value).toBe(false);
  });

  it('should have output port', () => {
    expect(mergeNode.outputs).toHaveLength(1);
    expect(mergeNode.outputs[0].name).toBe('output');
  });

  it('should toggle append mode', () => {
    mergeNode.parm('append')?.set(true);
    expect(mergeNode.props.append.value).toBe(true);
  });
});

describe('InputNode', () => {
  let graph: Graph;
  let inputNode: InputNode;

  beforeEach(() => {
    graph = new Graph();
    inputNode = new InputNode('input1', graph);
    graph.addElement(inputNode);
  });

  it('should create with correct type', () => {
    expect(inputNode.type).toBe('Input');
  });

  it('should have inputIndex prop defaulting to 0', () => {
    expect(inputNode.props.inputIndex).toBeDefined();
    expect(inputNode.props.inputIndex.value).toBe(0);
  });

  it('should have inputName prop', () => {
    expect(inputNode.props.inputName).toBeDefined();
    expect(inputNode.props.inputName.value).toBe('');
  });

  it('should persist a typed public input contract', () => {
    expect(inputNode.props.dataType.value).toBe('any');
    inputNode.parm('dataType')?.set('image');
    expect(inputNode.outputs[0].dataType).toBe('image');
  });

  it('should have output port', () => {
    expect(inputNode.outputs).toHaveLength(1);
    expect(inputNode.outputs[0].name).toBe('output');
  });

  it('should expose inputIndex getter', () => {
    expect(inputNode.inputIndex).toBe(0);
    inputNode.parm('inputIndex')?.set(2);
    expect(inputNode.inputIndex).toBe(2);
  });

  it('should expose inputName getter', () => {
    expect(inputNode.inputName).toBe('');
    inputNode.parm('inputName')?.set('myInput');
    expect(inputNode.inputName).toBe('myInput');
  });
});

describe('OutputNode', () => {
  let graph: Graph;
  let outputNode: OutputNode;

  beforeEach(() => {
    graph = new Graph();
    outputNode = new OutputNode('output1', graph);
    graph.addElement(outputNode);
  });

  it('should create with correct type', () => {
    expect(outputNode.type).toBe('Output');
  });

  it('should have outputIndex prop defaulting to 0', () => {
    expect(outputNode.props.outputIndex).toBeDefined();
    expect(outputNode.props.outputIndex.value).toBe(0);
  });

  it('should persist a named typed public output contract', () => {
    expect(outputNode.props.outputName.value).toBe('');
    expect(outputNode.props.dataType.value).toBe('any');
    outputNode.parm('outputName')?.set('preview');
    outputNode.parm('dataType')?.set('image');
    expect(outputNode.outputName).toBe('preview');
    expect(outputNode.inputs[0].dataType).toBe('image');
  });

  it('should have input port', () => {
    expect(outputNode.inputs).toHaveLength(1);
    expect(outputNode.inputs[0].name).toBe('input');
  });

  it('should expose outputIndex getter', () => {
    expect(outputNode.outputIndex).toBe(0);
    outputNode.parm('outputIndex')?.set(1);
    expect(outputNode.outputIndex).toBe(1);
  });
});

describe('Subnet with Input/Output nodes', () => {
  let graph: Graph;
  let subnet: SubnetNode;

  beforeEach(() => {
    graph = new Graph();
    subnet = new SubnetNode('subnet1', graph);
    graph.addElement(subnet);
  });

  it('should use Output node as outputNode when present', () => {
    const outputNode = new OutputNode('out1', graph);
    subnet.addChild(outputNode);

    expect(subnet.outputNode()).toBe(outputNode);
  });

  it('should prefer Output node over cook node', () => {
    const regularNode = new Node('regular1', 'Test', graph);
    const outputNode = new OutputNode('out1', graph);

    subnet.addChild(regularNode);
    subnet.addChild(outputNode);

    regularNode.setCook(true);

    // Output node should take priority
    expect(subnet.outputNode()).toBe(outputNode);
  });

  it('should contain Input nodes as children', () => {
    const inputNode = new InputNode('in1', graph);
    subnet.addChild(inputNode);

    expect(subnet.children()).toContain(inputNode);
    expect(inputNode.parent).toBe(subnet);
  });

  it('should find indirect inputs', () => {
    const inputNode1 = new InputNode('in1', graph);
    const inputNode2 = new InputNode('in2', graph);
    const regularNode = new Node('regular1', 'Test', graph);

    subnet.addChild(inputNode1);
    subnet.addChild(inputNode2);
    subnet.addChild(regularNode);

    const indirectInputs = subnet.indirectInputs();
    expect(indirectInputs).toHaveLength(2);
    expect(indirectInputs).toContain(inputNode1);
    expect(indirectInputs).toContain(inputNode2);
  });
});

describe('Core node metadata', () => {
  it('Switch should have correct metadata', () => {
    const graph = new Graph();
    const node = new SwitchNode('s', graph);
    expect(node.type).toBe('Switch');
  });

  it('Merge should have correct metadata', () => {
    const graph = new Graph();
    const node = new MergeNode('m', graph);
    expect(node.type).toBe('Merge');
  });

  it('Input should have correct metadata', () => {
    const graph = new Graph();
    const node = new InputNode('i', graph);
    expect(node.type).toBe('Input');
  });

  it('Output should have correct metadata', () => {
    const graph = new Graph();
    const node = new OutputNode('o', graph);
    expect(node.type).toBe('Output');
  });

  it('Subnet should have correct metadata', () => {
    const graph = new Graph();
    const node = new SubnetNode('s', graph);
    expect(node.type).toBe('Subnet');
  });
});

describe('Core nodes in headless environments', () => {
  it('passes values without requiring browser element constructors', async () => {
    const graph = new Graph();
    const parent = new Node('parent', 'Test', graph);
    const input = new InputNode('input', graph);
    const output = new OutputNode('output', graph);
    const switchNode = new SwitchNode('switch', graph);
    graph.addElement(parent);
    graph.addElement(input);
    input.parent = parent;
    graph.addElement(output);
    graph.addElement(switchNode);

    parent.in('value', { answer: 42 }).value = { answer: 42 };
    switchNode.in('input_0', null).value = 'selected';
    output.inputs[0].value = 'result';

    await input.execute();
    await switchNode.execute();
    await output.execute();

    expect(input.outputs[0].value).toEqual({ answer: 42 });
    expect(switchNode.outputs[0].value).toBe('selected');
    expect(input.error).toBeNull();
    expect(switchNode.error).toBeNull();
    expect(output.error).toBeNull();
  });
});

describe('Deterministic value nodes', () => {
  it('keeps Studio adapters aligned with runtime-owned interfaces', () => {
    const graph = new Graph();
    const random = new RandomNode('random', graph);
    const remap = new RemapNode('remap', graph);

    expect(random.inputs.map(({ name }) => name)).toEqual(Object.keys(randomRegistration.definition.inputs));
    expect(random.outputs.map(({ name }) => name)).toEqual(Object.keys(randomRegistration.definition.outputs));
    expect(remap.inputs.map(({ name }) => name)).toEqual(Object.keys(remapRegistration.definition.inputs));
    expect(remap.outputs.map(({ name }) => name)).toEqual(Object.keys(remapRegistration.definition.outputs));
    expect(remap.props.clamp.value).toBe(remapRegistration.definition.props.clamp.default);
  });

  it('returns the same random value for the same explicit seed', async () => {
    const graph = new Graph();
    const random = new RandomNode('random', graph);
    graph.addElement(random);
    random.inputs[0].value = 42;

    await random.execute();
    const first = random.outputs[0].value;
    await random.execute();

    expect(random.outputs[0].value).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
  });

  it('remaps and optionally clamps values', async () => {
    const graph = new Graph();
    const remap = new RemapNode('remap', graph);
    graph.addElement(remap);
    const [value, inMin, inMax, outMin, outMax] = remap.inputs;
    value.value = 15;
    inMin.value = 0;
    inMax.value = 10;
    outMin.value = 100;
    outMax.value = 200;

    await remap.execute();
    expect(remap.outputs[0].value).toBe(250);
    remap.parm('clamp')?.set(true);
    await remap.execute();
    expect(remap.outputs[0].value).toBe(200);
  });
});
describe('NullNode', () => {
  it('passes its input through unchanged', () => {
    const graph = new Graph();
    const node = new NullNode('null', graph);
    graph.addElement(node);
    const value = { nested: ['data'] };
    node.inputs[0].onChange?.(value);
    node.inputs[0].value = value;
    node.onUpdate?.();
    expect(node.outputs[0].value).toBe(value);
  });
});
