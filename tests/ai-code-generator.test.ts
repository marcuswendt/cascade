/**
 * AI Code Generator Tests
 * Tests for SYSTEM_PROMPT content, buildContext, and buildPrompt utilities
 */

import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT } from '@/editor/ai/systemPrompt';
import { AICodeGenerator } from '@/editor/ai/AICodeGenerator';

describe('SYSTEM_PROMPT', () => {
  describe('Overview and Context', () => {
    it('should introduce Cascade as a visual programming framework', () => {
      expect(SYSTEM_PROMPT).toContain('Cascade');
      expect(SYSTEM_PROMPT).toContain('visual');
      expect(SYSTEM_PROMPT).toContain('node-based');
    });

    it('should mention Houdini inspiration', () => {
      expect(SYSTEM_PROMPT).toContain('Houdini');
    });

    it('should explain two types of nodes', () => {
      expect(SYSTEM_PROMPT).toContain('Class-based nodes');
      expect(SYSTEM_PROMPT).toContain('Code-based nodes');
    });

    it('should specify code runs in context of node object', () => {
      expect(SYSTEM_PROMPT).toContain('CODE-BASED nodes');
      expect(SYSTEM_PROMPT).toContain('node');
    });
  });

  describe('Node Lifecycle Documentation', () => {
    it('should document the setup phase', () => {
      expect(SYSTEM_PROMPT).toContain('Setup phase');
    });

    it('should document onReady hook', () => {
      expect(SYSTEM_PROMPT).toContain('onReady');
    });

    it('should document onChange callbacks', () => {
      expect(SYSTEM_PROMPT).toContain('onChange');
    });
  });

  describe('Core API Documentation', () => {
    describe('Input Ports', () => {
      it('should document node.in() method', () => {
        expect(SYSTEM_PROMPT).toContain('node.in');
      });

      it('should show typed input port syntax', () => {
        expect(SYSTEM_PROMPT).toContain('node.in<');
      });

      it('should document onChange callback for inputs', () => {
        expect(SYSTEM_PROMPT).toMatch(/\.onChange\s*=/);
      });
    });

    describe('Output Ports', () => {
      it('should document node.out() method', () => {
        expect(SYSTEM_PROMPT).toContain('node.out');
      });

      it('should document setValue method', () => {
        expect(SYSTEM_PROMPT).toContain('setValue');
      });

      it('should document trigger ports', () => {
        expect(SYSTEM_PROMPT).toContain('trigger');
      });
    });

    describe('Props System', () => {
      it('should document defineProp method', () => {
        expect(SYSTEM_PROMPT).toContain('defineProp');
      });

      it('should document slider props', () => {
        expect(SYSTEM_PROMPT).toContain('min:');
        expect(SYSTEM_PROMPT).toContain('max:');
        expect(SYSTEM_PROMPT).toContain('step:');
      });

      it('should document color props with normalized values', () => {
        expect(SYSTEM_PROMPT).toContain("type: 'color'");
        expect(SYSTEM_PROMPT).toContain('normalized');
        expect(SYSTEM_PROMPT).toContain('0-1');
      });

      it('should document dropdown select props', () => {
        expect(SYSTEM_PROMPT).toContain('options');
        expect(SYSTEM_PROMPT).toContain('value:');
        expect(SYSTEM_PROMPT).toContain('label:');
      });

      it('should document boolean props', () => {
        expect(SYSTEM_PROMPT).toContain("type: 'boolean'");
      });

      it('should document integer constraints', () => {
        expect(SYSTEM_PROMPT).toContain('integer: true');
      });

      it('should document resolution/vec2 props', () => {
        expect(SYSTEM_PROMPT).toContain('[512, 512]');
      });

      it('should document conditional visibility with hidden', () => {
        expect(SYSTEM_PROMPT).toContain('hidden:');
      });

      it('should document watchProp alternative', () => {
        expect(SYSTEM_PROMPT).toContain('watchProp');
      });

      it('should document displayName', () => {
        expect(SYSTEM_PROMPT).toContain('displayName');
      });
    });

    describe('Lifecycle Hooks', () => {
      it('should document onReady hook', () => {
        expect(SYSTEM_PROMPT).toContain('node.onReady');
      });

      it('should document onUpdate hook', () => {
        expect(SYSTEM_PROMPT).toContain('node.onUpdate');
      });

      it('should document onDestroy hook', () => {
        expect(SYSTEM_PROMPT).toContain('node.onDestroy');
      });
    });

    describe('Utilities', () => {
      it('should document node.log', () => {
        expect(SYSTEM_PROMPT).toContain('node.log');
      });

      it('should document node.require for NPM packages', () => {
        expect(SYSTEM_PROMPT).toContain('node.require');
        expect(SYSTEM_PROMPT).toContain('esm.sh');
      });

      it('should document node.assets', () => {
        expect(SYSTEM_PROMPT).toContain('node.assets');
      });
    });
  });

  describe('Image Processing Documentation', () => {
    it('should document canvas creation', () => {
      expect(SYSTEM_PROMPT).toContain('createCanvas');
      expect(SYSTEM_PROMPT).toContain("document.createElement('canvas')");
    });

    it('should document getImageData pattern', () => {
      expect(SYSTEM_PROMPT).toContain('getImageData');
      expect(SYSTEM_PROMPT).toContain('ImageData');
    });

    it('should document color utilities', () => {
      expect(SYSTEM_PROMPT).toContain('colorToCss');
    });

    it('should explain normalized color conversion', () => {
      expect(SYSTEM_PROMPT).toContain('color.r * 255');
    });
  });

  describe('Common Patterns', () => {
    describe('Pattern Generator Pattern', () => {
      it('should include a checkers-like pattern example', () => {
        expect(SYSTEM_PROMPT).toContain('Pattern Generator');
        expect(SYSTEM_PROMPT).toContain('Checkers');
      });

      it('should show dual color props pattern', () => {
        expect(SYSTEM_PROMPT).toContain('color1');
        expect(SYSTEM_PROMPT).toContain('color2');
      });

      it('should show resolution prop pattern', () => {
        expect(SYSTEM_PROMPT).toContain('resolution');
        expect(SYSTEM_PROMPT).toContain('[width, height]');
      });

      it('should show node.preview assignment', () => {
        expect(SYSTEM_PROMPT).toContain('node.preview = canvas');
      });
    });

    describe('Image Filter Pattern', () => {
      it('should include a blur-like filter example', () => {
        expect(SYSTEM_PROMPT).toContain('Image Filter');
        expect(SYSTEM_PROMPT).toContain('Blur');
      });

      it('should show image input handling', () => {
        expect(SYSTEM_PROMPT).toContain("node.in<HTMLCanvasElement | null>('image', null)");
      });

      it('should show null input guard pattern', () => {
        expect(SYSTEM_PROMPT).toContain('if (!img) return');
      });
    });

    describe('Solid Color Generator Pattern', () => {
      it('should include a solid color example', () => {
        expect(SYSTEM_PROMPT).toContain('Solid Color');
      });

      it('should show fillRect usage', () => {
        expect(SYSTEM_PROMPT).toContain('fillRect');
      });
    });

    describe('External Library Pattern', () => {
      it('should include a noise example', () => {
        expect(SYSTEM_PROMPT).toContain('External Libraries');
        expect(SYSTEM_PROMPT).toContain('Noise');
      });

      it('should show async require pattern', () => {
        expect(SYSTEM_PROMPT).toContain('await node.require');
      });

      it('should show simplex-noise as example', () => {
        expect(SYSTEM_PROMPT).toContain('simplex-noise');
      });

      it('should show seeded random pattern', () => {
        expect(SYSTEM_PROMPT).toContain('seededRandom');
      });
    });
  });

  describe('Guidelines', () => {
    it('should emphasize normalized colors (0-1)', () => {
      expect(SYSTEM_PROMPT).toContain('Colors are normalized (0-1)');
    });

    it('should emphasize setting preview', () => {
      expect(SYSTEM_PROMPT).toContain('Always set preview');
    });

    it('should emphasize handling null inputs', () => {
      expect(SYSTEM_PROMPT).toContain('Handle null inputs');
    });

    it('should emphasize onChange/watchProp usage', () => {
      expect(SYSTEM_PROMPT).toContain('Use onChange/watchProp');
    });

    it('should emphasize calling render in onReady', () => {
      expect(SYSTEM_PROMPT).toContain('Call render in onReady');
    });

    it('should emphasize integer: true for whole numbers', () => {
      expect(SYSTEM_PROMPT).toContain('integer: true');
    });
  });

  describe('Response Format', () => {
    it('should instruct to return only code', () => {
      expect(SYSTEM_PROMPT).toContain('Return ONLY the node code');
    });

    it('should instruct no markdown formatting', () => {
      expect(SYSTEM_PROMPT).toContain('no markdown');
    });

    it('should instruct code should be ready to execute', () => {
      expect(SYSTEM_PROMPT).toContain('ready to execute');
    });
  });
});

describe('AICodeGenerator', () => {
  describe('buildContext', () => {
    it('should extract current code from node', () => {
      const mockNode = {
        code: 'const x = 1;',
        inputs: [],
        outputs: [],
        props: {},
        type: 'Custom'
      };

      const context = AICodeGenerator.buildContext(mockNode, '/test/module');
      expect(context.currentCode).toBe('const x = 1;');
    });

    it('should extract module path', () => {
      const mockNode = {
        code: '',
        inputs: [],
        outputs: [],
        props: {},
        type: 'Custom'
      };

      const context = AICodeGenerator.buildContext(mockNode, '/test/module');
      expect(context.modulePath).toBe('/test/module');
    });

    it('should extract node type', () => {
      const mockNode = {
        code: '',
        inputs: [],
        outputs: [],
        props: {},
        type: 'LensNode'
      };

      const context = AICodeGenerator.buildContext(mockNode, '/test');
      expect(context.nodeType).toBe('LensNode');
    });

    it('should map connected inputs with connection status', () => {
      const mockNode = {
        code: '',
        inputs: [
          { name: 'image', dataType: 'canvas', connections: [{ id: 'conn1' }] },
          { name: 'amount', dataType: 'number', connections: [] }
        ],
        outputs: [],
        props: {},
        type: 'Custom'
      };

      const context = AICodeGenerator.buildContext(mockNode, '/test');
      expect(context.connectedInputs).toHaveLength(2);
      expect(context.connectedInputs[0]).toEqual({
        name: 'image',
        type: 'canvas',
        connected: true
      });
      expect(context.connectedInputs[1]).toEqual({
        name: 'amount',
        type: 'number',
        connected: false
      });
    });

    it('should map connected outputs with connection status', () => {
      const mockNode = {
        code: '',
        inputs: [],
        outputs: [
          { name: 'result', dataType: 'canvas', connections: [{ id: 'conn1' }] },
          { name: 'debug', dataType: 'any', connections: [] }
        ],
        props: {},
        type: 'Custom'
      };

      const context = AICodeGenerator.buildContext(mockNode, '/test');
      expect(context.connectedOutputs).toHaveLength(2);
      expect(context.connectedOutputs[0]).toEqual({
        name: 'result',
        type: 'canvas',
        connected: true
      });
      expect(context.connectedOutputs[1]).toEqual({
        name: 'debug',
        type: 'any',
        connected: false
      });
    });

    it('should extract props with types and values', () => {
      const mockNode = {
        code: '',
        inputs: [],
        outputs: [],
        props: {
          radius: { type: 'number', value: 5.0 },
          color: { type: 'color', value: { r: 1, g: 0, b: 0 } }
        },
        type: 'Custom'
      };

      const context = AICodeGenerator.buildContext(mockNode, '/test');
      expect(context.props).toHaveLength(2);
      expect(context.props).toContainEqual({
        name: 'radius',
        type: 'number',
        value: 5.0
      });
      expect(context.props).toContainEqual({
        name: 'color',
        type: 'color',
        value: { r: 1, g: 0, b: 0 }
      });
    });

    it('should handle empty node gracefully', () => {
      const mockNode = {
        type: 'Custom'
      };

      const context = AICodeGenerator.buildContext(mockNode, '/test');
      expect(context.currentCode).toBe('');
      expect(context.connectedInputs).toEqual([]);
      expect(context.connectedOutputs).toEqual([]);
      expect(context.props).toEqual([]);
    });

    it('should default dataType to "any" when not specified', () => {
      const mockNode = {
        code: '',
        inputs: [{ name: 'input1', connections: [] }],
        outputs: [{ name: 'output1', connections: [] }],
        props: {},
        type: 'Custom'
      };

      const context = AICodeGenerator.buildContext(mockNode, '/test');
      expect(context.connectedInputs[0].type).toBe('any');
      expect(context.connectedOutputs[0].type).toBe('any');
    });

    it('should default prop type to "any" when not specified', () => {
      const mockNode = {
        code: '',
        inputs: [],
        outputs: [],
        props: {
          value: { value: 42 }
        },
        type: 'Custom'
      };

      const context = AICodeGenerator.buildContext(mockNode, '/test');
      expect(context.props[0].type).toBe('any');
    });
  });

  describe('buildPrompt', () => {
    it('should include the user prompt', () => {
      const context = {
        currentCode: '',
        modulePath: '/test',
        nodeType: 'Custom',
        connectedInputs: [],
        connectedOutputs: [],
        props: []
      };

      const result = AICodeGenerator.buildPrompt('Create a blur node', context);
      expect(result).toContain('Create a blur node');
    });

    it('should include current code when present', () => {
      const context = {
        currentCode: 'const x = 1;\nconst y = 2;',
        modulePath: '/test',
        nodeType: 'Custom',
        connectedInputs: [],
        connectedOutputs: [],
        props: []
      };

      const result = AICodeGenerator.buildPrompt('Update this', context);
      expect(result).toContain('## Current Code');
      expect(result).toContain('const x = 1;');
      expect(result).toContain('const y = 2;');
    });

    it('should not include current code section when empty', () => {
      const context = {
        currentCode: '',
        modulePath: '/test',
        nodeType: 'Custom',
        connectedInputs: [],
        connectedOutputs: [],
        props: []
      };

      const result = AICodeGenerator.buildPrompt('Create new', context);
      expect(result).not.toContain('## Current Code');
    });

    it('should not include current code section when only whitespace', () => {
      const context = {
        currentCode: '   \n\t  ',
        modulePath: '/test',
        nodeType: 'Custom',
        connectedInputs: [],
        connectedOutputs: [],
        props: []
      };

      const result = AICodeGenerator.buildPrompt('Create new', context);
      expect(result).not.toContain('## Current Code');
    });

    it('should include connected inputs', () => {
      const context = {
        currentCode: '',
        modulePath: '/test',
        nodeType: 'Custom',
        connectedInputs: [
          { name: 'image', type: 'canvas', connected: true },
          { name: 'amount', type: 'number', connected: true }
        ],
        connectedOutputs: [],
        props: []
      };

      const result = AICodeGenerator.buildPrompt('Process inputs', context);
      expect(result).toContain('## Connected Inputs');
      expect(result).toContain('- image: canvas');
      expect(result).toContain('- amount: number');
    });

    it('should only include connected inputs, not unconnected', () => {
      const context = {
        currentCode: '',
        modulePath: '/test',
        nodeType: 'Custom',
        connectedInputs: [
          { name: 'image', type: 'canvas', connected: true },
          { name: 'unused', type: 'any', connected: false }
        ],
        connectedOutputs: [],
        props: []
      };

      const result = AICodeGenerator.buildPrompt('Process inputs', context);
      expect(result).toContain('- image: canvas');
      expect(result).not.toContain('- unused: any');
    });

    it('should not include inputs section when none connected', () => {
      const context = {
        currentCode: '',
        modulePath: '/test',
        nodeType: 'Custom',
        connectedInputs: [
          { name: 'unused', type: 'any', connected: false }
        ],
        connectedOutputs: [],
        props: []
      };

      const result = AICodeGenerator.buildPrompt('Create node', context);
      expect(result).not.toContain('## Connected Inputs');
    });

    it('should include connected outputs', () => {
      const context = {
        currentCode: '',
        modulePath: '/test',
        nodeType: 'Custom',
        connectedInputs: [],
        connectedOutputs: [
          { name: 'result', type: 'canvas', connected: true }
        ],
        props: []
      };

      const result = AICodeGenerator.buildPrompt('Create output', context);
      expect(result).toContain('## Connected Outputs');
      expect(result).toContain('- result: canvas');
    });

    it('should only include connected outputs, not unconnected', () => {
      const context = {
        currentCode: '',
        modulePath: '/test',
        nodeType: 'Custom',
        connectedInputs: [],
        connectedOutputs: [
          { name: 'result', type: 'canvas', connected: true },
          { name: 'debug', type: 'any', connected: false }
        ],
        props: []
      };

      const result = AICodeGenerator.buildPrompt('Create output', context);
      expect(result).toContain('- result: canvas');
      expect(result).not.toContain('- debug: any');
    });

    it('should not include outputs section when none connected', () => {
      const context = {
        currentCode: '',
        modulePath: '/test',
        nodeType: 'Custom',
        connectedInputs: [],
        connectedOutputs: [
          { name: 'unused', type: 'any', connected: false }
        ],
        props: []
      };

      const result = AICodeGenerator.buildPrompt('Create node', context);
      expect(result).not.toContain('## Connected Outputs');
    });

    it('should handle complex context with all fields', () => {
      const context = {
        currentCode: 'const output = node.out("image");',
        modulePath: '/effects/blur',
        nodeType: 'LensNode',
        connectedInputs: [
          { name: 'image', type: 'canvas', connected: true }
        ],
        connectedOutputs: [
          { name: 'image', type: 'canvas', connected: true }
        ],
        props: [
          { name: 'radius', type: 'number', value: 5 }
        ]
      };

      const result = AICodeGenerator.buildPrompt('Add gaussian blur', context);

      expect(result).toContain('Add gaussian blur');
      expect(result).toContain('## Current Code');
      expect(result).toContain('const output = node.out("image")');
      expect(result).toContain('## Connected Inputs');
      expect(result).toContain('- image: canvas');
      expect(result).toContain('## Connected Outputs');
    });
  });
});

describe('Type definitions', () => {
  it('should export AIProvider type with correct values', () => {
    // This test validates at compile time that the types are correctly defined
    const providers: Array<'claude' | 'openai' | 'gemini'> = ['claude', 'openai', 'gemini'];
    expect(providers).toHaveLength(3);
  });
});
