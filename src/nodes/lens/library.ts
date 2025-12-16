import type { Library } from '@/types/library.types';

/**
 * Lens library definition
 * A collection of nodes for image processing and generation
 */
export const lensLibrary: Library = {
  id: 'lens',
  label: 'Lens',
  icon: 'Palette',
  categories: [
    {
      id: 'create',
      label: 'Create',
      nodes: [
        { name: 'File', icon: 'FileImage', description: 'Load images from files', type: 'Image' },
        { name: 'Color', icon: 'Square', description: 'Create a solid color canvas', type: 'Color' },
        { name: 'Checkers', icon: 'Grid', description: 'Generate a checkerboard pattern', type: 'Checkers' },
        { name: 'Noise', icon: 'Cloud', description: 'Generate procedural noise patterns', type: 'Noise' },
        { name: 'Ramp', icon: 'Gradient', description: 'Generate color ramps', type: 'Ramp' },
        { name: 'Text', icon: 'Type', description: 'Render text with customizable font and style', type: 'Text' },
        { name: 'Prompt to Image', icon: 'Lightbulb', description: 'Generate images from text prompts using AI', type: 'Generate' }
      ]
    },
    {
      id: 'filter',
      label: 'Filter',
      nodes: [
        { name: 'Blur', icon: 'Droplets', description: 'Gaussian blur', type: 'Blur' },
        { name: 'Normal Map', icon: 'Box', description: 'Compute normal map from height map', type: 'NormalMap' },
        { name: 'Prompt to Edit', icon: 'Lightbulb', description: 'Edit images using AI prompts', type: 'Edit' }
      ]
    },
    {
      id: 'transform',
      label: 'Transform',
      nodes: [
        { name: 'Transform', icon: 'Move', description: '2D rotation, translation, and scaling', type: 'Transform' },
        { name: 'Resize', icon: 'Maximize2', description: 'Scale or resize an image', type: 'Resize' }
      ]
    },
    {
      id: 'composite',
      label: 'Composite',
      nodes: [
        { name: 'Composite', icon: 'Layers', description: 'Blend two images together', type: 'Composite' }
      ]
    }
  ]
};

