/**
 * Custom Pattern Composition Workflow Test
 *
 * Tests the complete workflow of:
 * 1. Creating a custom ImageNodeBase for pattern generation
 * 2. Compiling project-owned ZigZag pattern code
 * 3. Compositing the result with another pattern (Checkers)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Graph } from '@/nodes/Graph';
import { Node } from '@/nodes/Node';
import { compileNodeCode, compileAndExecute } from '@/editor/utils/compileNodeCode';

// Project-owned ZigZag pattern code.
const MOCK_ZIGZAG_CODE = `
// ZigZagPattern - Generates a zigzag/chevron pattern
// Procedural zigzag pattern

const output = node.out<HTMLCanvasElement>('image');

// Pattern colors
node.defineProp('color1', {
  value: { r: 1, g: 1, b: 1, a: 1 },
  type: 'color',
  displayName: 'Color 1'
});

node.defineProp('color2', {
  value: { r: 0, g: 0, b: 0, a: 1 },
  type: 'color',
  displayName: 'Color 2'
});

// Pattern configuration
node.defineProp('amplitude', {
  value: 32,
  type: 'slider',
  params: { min: 4, max: 256, step: 1 },
  displayName: 'Amplitude'
});

node.defineProp('frequency', {
  value: 8,
  type: 'slider',
  params: { min: 1, max: 64, step: 1, integer: true },
  displayName: 'Frequency'
});

node.defineProp('thickness', {
  value: 4,
  type: 'slider',
  params: { min: 1, max: 64, step: 1 },
  displayName: 'Line Thickness'
});

node.defineProp('angle', {
  value: 0,
  type: 'slider',
  params: { min: 0, max: 360, step: 1 },
  displayName: 'Angle'
});

// Resolution
node.defineProp('resolution', {
  value: [512, 512],
  params: {
    min: [1, 1],
    max: [4096, 4096],
    integer: true
  },
  displayName: 'Resolution'
});

// Helper to convert color to CSS
function colorToCss(color) {
  const r = Math.round((color.r || 0) * 255);
  const g = Math.round((color.g || 0) * 255);
  const b = Math.round((color.b || 0) * 255);
  const a = color.a !== undefined ? color.a : 1;
  return \`rgba(\${r}, \${g}, \${b}, \${a})\`;
}

// Render function
function render() {
  const [width, height] = node.props.resolution.value;
  const color1 = node.props.color1.value;
  const color2 = node.props.color2.value;
  const amplitude = node.props.amplitude.value;
  const frequency = node.props.frequency.value;
  const thickness = node.props.thickness.value;
  const angleDeg = node.props.angle.value;

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Fill background with color1
  ctx.fillStyle = colorToCss(color1);
  ctx.fillRect(0, 0, width, height);

  // Calculate zigzag parameters
  const wavelength = width / frequency;
  const angleRad = (angleDeg * Math.PI) / 180;

  // Save context for rotation
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(angleRad);
  ctx.translate(-width / 2, -height / 2);

  // Draw zigzag lines
  ctx.strokeStyle = colorToCss(color2);
  ctx.lineWidth = thickness;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Draw multiple rows of zigzags to cover the canvas
  const rowHeight = amplitude * 2;
  const startY = -height; // Start above visible area for rotation
  const endY = height * 2;

  for (let y = startY; y < endY; y += rowHeight) {
    ctx.beginPath();
    ctx.moveTo(-width, y);

    for (let x = -width; x <= width * 2; x += wavelength / 2) {
      const peakY = y + (Math.floor((x + width) / (wavelength / 2)) % 2 === 0 ? -amplitude : amplitude);
      ctx.lineTo(x, peakY);
    }

    ctx.stroke();
  }

  ctx.restore();

  // Set output and preview
  output.setValue(canvas);
  node.preview = canvas;
}

// React to property changes
node.watchProp('color1', render);
node.watchProp('color2', render);
node.watchProp('amplitude', render);
node.watchProp('frequency', render);
node.watchProp('thickness', render);
node.watchProp('angle', render);
node.watchProp('resolution', render);

// Initial render
node.onReady = render;
`;

// Mock Checkers pattern code (simplified version)
const MOCK_CHECKERS_CODE = `
const output = node.out<HTMLCanvasElement>('image');

node.defineProp('color1', {
  value: { r: 0.2, g: 0.6, b: 1, a: 1 },
  type: 'color',
  displayName: 'Color 1'
});

node.defineProp('color2', {
  value: { r: 1, g: 0.4, b: 0.2, a: 1 },
  type: 'color',
  displayName: 'Color 2'
});

node.defineProp('size', {
  value: 64,
  params: { min: 8, max: 256, step: 1 },
  displayName: 'Checker Size'
});

node.defineProp('resolution', {
  value: [512, 512],
  params: { min: [1, 1], max: [4096, 4096], integer: true },
  displayName: 'Resolution'
});

function colorToCss(color) {
  const r = Math.round((color.r || 0) * 255);
  const g = Math.round((color.g || 0) * 255);
  const b = Math.round((color.b || 0) * 255);
  return \`rgb(\${r}, \${g}, \${b})\`;
}

function render() {
  const [width, height] = node.props.resolution.value;
  const checkerSize = node.props.size.value;
  const color1 = node.props.color1.value;
  const color2 = node.props.color2.value;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  for (let y = 0; y < height; y += checkerSize) {
    for (let x = 0; x < width; x += checkerSize) {
      const isEven = Math.floor(x / checkerSize) + Math.floor(y / checkerSize);
      ctx.fillStyle = isEven % 2 === 0 ? colorToCss(color1) : colorToCss(color2);
      ctx.fillRect(x, y, checkerSize, checkerSize);
    }
  }

  output.setValue(canvas);
  node.preview = canvas;
}

node.watchProp('color1', render);
node.watchProp('color2', render);
node.watchProp('size', render);
node.watchProp('resolution', render);

node.onReady = render;
`;

// Mock Composite node code
const MOCK_COMPOSITE_CODE = `
const image1 = node.in<HTMLCanvasElement>('image1', null);
const image2 = node.in<HTMLCanvasElement>('image2', null);
const output = node.out<HTMLCanvasElement>('image');

node.defineProp('blendMode', {
  value: 'multiply',
  params: {
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'multiply', label: 'Multiply' },
      { value: 'screen', label: 'Screen' },
      { value: 'overlay', label: 'Overlay' },
      { value: 'difference', label: 'Difference' }
    ]
  },
  displayName: 'Blend Mode'
});

node.defineProp('opacity', {
  value: 0.5,
  params: { min: 0, max: 1, step: 0.01 },
  displayName: 'Opacity'
});

function render() {
  const img1 = image1.value;
  const img2 = image2.value;

  if (!img1 || !img2) {
    // Pass through whichever is available
    if (img1) { output.setValue(img1); node.preview = img1; }
    else if (img2) { output.setValue(img2); node.preview = img2; }
    return;
  }

  const width = img1.width;
  const height = img1.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Draw base image
  ctx.drawImage(img1, 0, 0);

  // Set blend mode
  const blendMode = node.props.blendMode.value;
  const modeMap = {
    'normal': 'source-over',
    'multiply': 'multiply',
    'screen': 'screen',
    'overlay': 'overlay',
    'difference': 'difference'
  };
  ctx.globalCompositeOperation = modeMap[blendMode] || 'source-over';
  ctx.globalAlpha = node.props.opacity.value;

  // Draw blend image
  ctx.drawImage(img2, 0, 0, width, height);

  // Reset
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  output.setValue(canvas);
  node.preview = canvas;
}

image1.onChange = render;
image2.onChange = render;
node.watchProp('blendMode', render);
node.watchProp('opacity', render);

node.onReady = render;
`;

describe('Custom Pattern Composition Workflow', () => {
  let graph: Graph;

  beforeEach(() => {
    graph = new Graph();
  });

  describe('Step 1: Create a custom ZigZag ImageNodeBase', () => {
    it('should compile project-owned ZigZag pattern code', async () => {
      // User creates a new custom ImageNodeBase
      const zigzagNode = new Node('local.zigzagpattern', 'local.zigzagpattern', graph);
      graph.addElement(zigzagNode);

      // Compile the project-owned code
      const compiled = compileNodeCode(MOCK_ZIGZAG_CODE);

      expect(compiled.error).toBeNull();
      expect(compiled.fn).not.toBeNull();
      expect(compiled.jsCode).toContain('zigzag');
    });

    it('should register all expected props for ZigZag pattern', async () => {
      const zigzagNode = new Node('local.zigzagpattern', 'local.zigzagpattern', graph);
      graph.addElement(zigzagNode);

      const result = await compileAndExecute(zigzagNode, graph, MOCK_ZIGZAG_CODE);

      expect(result.success).toBe(true);

      // Verify all props are registered
      expect(zigzagNode.props.color1).toBeDefined();
      expect(zigzagNode.props.color2).toBeDefined();
      expect(zigzagNode.props.amplitude).toBeDefined();
      expect(zigzagNode.props.frequency).toBeDefined();
      expect(zigzagNode.props.thickness).toBeDefined();
      expect(zigzagNode.props.angle).toBeDefined();
      expect(zigzagNode.props.resolution).toBeDefined();

      // Verify output port
      expect(zigzagNode.outputs.find(p => p.name === 'image')).toBeDefined();
    });

    it('should have correct default values', async () => {
      const zigzagNode = new Node('local.zigzagpattern', 'local.zigzagpattern', graph);
      graph.addElement(zigzagNode);

      await compileAndExecute(zigzagNode, graph, MOCK_ZIGZAG_CODE);

      expect(zigzagNode.props.amplitude.value).toBe(32);
      expect(zigzagNode.props.frequency.value).toBe(8);
      expect(zigzagNode.props.thickness.value).toBe(4);
      expect(zigzagNode.props.angle.value).toBe(0);
      expect(zigzagNode.props.resolution.value).toEqual([512, 512]);
    });
  });

  describe('Step 2: Create Checkers pattern node', () => {
    it('should compile Checkers pattern code', async () => {
      const checkersNode = new Node('local.checkers', 'local.checkers', graph);
      graph.addElement(checkersNode);

      const result = await compileAndExecute(checkersNode, graph, MOCK_CHECKERS_CODE);

      expect(result.success).toBe(true);
      expect(checkersNode.props.color1).toBeDefined();
      expect(checkersNode.props.color2).toBeDefined();
      expect(checkersNode.props.size).toBeDefined();
      expect(checkersNode.outputs.find(p => p.name === 'image')).toBeDefined();
    });
  });

  describe('Step 3: Create Composite node', () => {
    it('should compile Composite node code', async () => {
      const compositeNode = new Node('local.composite', 'local.composite', graph);
      graph.addElement(compositeNode);

      const result = await compileAndExecute(compositeNode, graph, MOCK_COMPOSITE_CODE);

      expect(result.success).toBe(true);

      // Verify inputs
      expect(compositeNode.inputs.find(p => p.name === 'image1')).toBeDefined();
      expect(compositeNode.inputs.find(p => p.name === 'image2')).toBeDefined();

      // Verify props
      expect(compositeNode.props.blendMode).toBeDefined();
      expect(compositeNode.props.opacity).toBeDefined();

      // Verify output
      expect(compositeNode.outputs.find(p => p.name === 'image')).toBeDefined();
    });
  });

  describe('Step 4: Wire the graph together', () => {
    it('should connect ZigZag and Checkers to Composite', async () => {
      // Create all three nodes
      const zigzagNode = new Node('zigzag', 'local.zigzagpattern', graph);
      const checkersNode = new Node('checkers', 'local.checkers', graph);
      const compositeNode = new Node('composite', 'local.composite', graph);

      graph.addElement(zigzagNode);
      graph.addElement(checkersNode);
      graph.addElement(compositeNode);

      // Compile all nodes
      await compileAndExecute(zigzagNode, graph, MOCK_ZIGZAG_CODE);
      await compileAndExecute(checkersNode, graph, MOCK_CHECKERS_CODE);
      await compileAndExecute(compositeNode, graph, MOCK_COMPOSITE_CODE);

      // Get ports
      const zigzagOut = zigzagNode.outputs.find(p => p.name === 'image')!;
      const checkersOut = checkersNode.outputs.find(p => p.name === 'image')!;
      const compositeIn1 = compositeNode.inputs.find(p => p.name === 'image1')!;
      const compositeIn2 = compositeNode.inputs.find(p => p.name === 'image2')!;

      // Connect: ZigZag -> Composite.image1
      const conn1 = graph.connect(zigzagOut, compositeIn1);
      expect(conn1).not.toBeNull();

      // Connect: Checkers -> Composite.image2
      const conn2 = graph.connect(checkersOut, compositeIn2);
      expect(conn2).not.toBeNull();

      // Verify connections
      expect(graph.connections.length).toBe(2);
      expect(compositeIn1.connections.length).toBe(1);
      expect(compositeIn2.connections.length).toBe(1);
    });

    it('should have correct graph topology', async () => {
      // Create nodes
      const zigzag = new Node('zigzag', 'local.zigzagpattern', graph);
      const checkers = new Node('checkers', 'local.checkers', graph);
      const composite = new Node('composite', 'local.composite', graph);

      graph.addElement(zigzag);
      graph.addElement(checkers);
      graph.addElement(composite);

      // Compile
      await compileAndExecute(zigzag, graph, MOCK_ZIGZAG_CODE);
      await compileAndExecute(checkers, graph, MOCK_CHECKERS_CODE);
      await compileAndExecute(composite, graph, MOCK_COMPOSITE_CODE);

      // Connect
      graph.connect(
        zigzag.outputs.find(p => p.name === 'image')!,
        composite.inputs.find(p => p.name === 'image1')!
      );
      graph.connect(
        checkers.outputs.find(p => p.name === 'image')!,
        composite.inputs.find(p => p.name === 'image2')!
      );

      // Verify graph structure
      expect(graph.nodes.length).toBe(3);
      expect(graph.connections.length).toBe(2);

      // ZigZag and Checkers are source nodes (no inputs connected)
      expect(zigzag.inputs.filter(p => p.connections.length > 0).length).toBe(0);
      expect(checkers.inputs.filter(p => p.connections.length > 0).length).toBe(0);

      // Composite has both inputs connected
      expect(composite.inputs.filter(p => p.connections.length > 0).length).toBe(2);
    });
  });

  describe('Full workflow simulation', () => {
    it('should complete the entire pattern composition workflow', async () => {
      // === STEP 1: User creates custom ZigZag node ===
      // User: "Create a new custom ImageNodeBase called ZigZagPattern"
      const zigzagNode = new Node('local.zigzagpattern', 'local.zigzagpattern', graph);
      graph.addElement(zigzagNode);

      // === STEP 2: User adds and compiles project-owned code ===
      const zigzagResult = await compileAndExecute(zigzagNode, graph, MOCK_ZIGZAG_CODE);
      expect(zigzagResult.success).toBe(true);

      // === STEP 3: User creates Checkers node from template ===
      const checkersNode = new Node('local.checkers', 'local.checkers', graph);
      graph.addElement(checkersNode);
      await compileAndExecute(checkersNode, graph, MOCK_CHECKERS_CODE);

      // === STEP 4: User creates Composite node ===
      const compositeNode = new Node('local.composite', 'local.composite', graph);
      graph.addElement(compositeNode);
      await compileAndExecute(compositeNode, graph, MOCK_COMPOSITE_CODE);

      // === STEP 5: User connects the nodes ===
      // ZigZag.image -> Composite.image1
      const conn1 = graph.connect(
        zigzagNode.outputs.find(p => p.name === 'image')!,
        compositeNode.inputs.find(p => p.name === 'image1')!
      );

      // Checkers.image -> Composite.image2
      const conn2 = graph.connect(
        checkersNode.outputs.find(p => p.name === 'image')!,
        compositeNode.inputs.find(p => p.name === 'image2')!
      );

      expect(conn1).not.toBeNull();
      expect(conn2).not.toBeNull();

      // === STEP 6: Verify final graph state ===
      expect(graph.nodes.length).toBe(3);
      expect(graph.connections.length).toBe(2);

      // ZigZag node is properly configured
      expect(zigzagNode.props.amplitude.value).toBe(32);
      expect(zigzagNode.props.frequency.value).toBe(8);

      // Checkers node is properly configured
      expect(checkersNode.props.size.value).toBe(64);

      // Composite node has blend settings
      expect(compositeNode.props.blendMode.value).toBe('multiply');
      expect(compositeNode.props.opacity.value).toBe(0.5);

      // All nodes have code stored
      expect(zigzagNode.code).toBe(MOCK_ZIGZAG_CODE);
      expect(checkersNode.code).toBe(MOCK_CHECKERS_CODE);
      expect(compositeNode.code).toBe(MOCK_COMPOSITE_CODE);
    });

    it('should allow modifying pattern parameters after creation', async () => {
      // Setup the graph
      const zigzag = new Node('zigzag', 'local.zigzagpattern', graph);
      graph.addElement(zigzag);
      await compileAndExecute(zigzag, graph, MOCK_ZIGZAG_CODE);

      // Modify parameters (as user would in Inspector)
      zigzag.updateProp('amplitude', 64);
      zigzag.updateProp('frequency', 16);
      zigzag.updateProp('angle', 45);
      zigzag.updateProp('color1', { r: 1, g: 0, b: 0, a: 1 });
      zigzag.updateProp('color2', { r: 0, g: 0, b: 1, a: 1 });

      // Verify changes
      expect(zigzag.props.amplitude.value).toBe(64);
      expect(zigzag.props.frequency.value).toBe(16);
      expect(zigzag.props.angle.value).toBe(45);
      expect(zigzag.props.color1.value).toEqual({ r: 1, g: 0, b: 0, a: 1 });
      expect(zigzag.props.color2.value).toEqual({ r: 0, g: 0, b: 1, a: 1 });

      // Node should be marked dirty after prop changes
      expect(zigzag.isDirty).toBe(true);
    });
  });
});
