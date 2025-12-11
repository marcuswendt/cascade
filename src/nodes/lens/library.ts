import type { Library } from '@/editor/nodeTemplates';

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
      id: 'generators',
      label: 'Generators',
      nodes: [
        { name: 'Color', icon: 'Square', description: 'Create a solid color canvas', type: 'Color' },
        { name: 'Checkers', icon: 'Grid', description: 'Generate a checkerboard pattern', type: 'Checkers' },
        { name: 'Noise', icon: 'Cloud', description: 'Generate procedural noise patterns', type: 'Noise' },
        { name: 'Ramp', icon: 'Gradient', description: 'Generate color ramps', type: 'Ramp' }
      ]
    },
    {
      id: 'filters',
      label: 'Filters',
      nodes: [
        { name: 'Blur', icon: 'Droplets', description: 'Gaussian blur', type: 'Blur' },
        { name: 'Normal Map', icon: 'Layers', description: 'Compute normal map from height map', type: 'NormalMap' },
        { name: 'Brightness', icon: 'Sun', description: 'Adjust brightness', type: 'Brightness' },
        { name: 'Contrast', icon: 'Sliders', description: 'Adjust contrast', type: 'Contrast' }
      ]
    },
    // Single-entry categories moved to main menu (flattened)
    {
      id: 'image',
      label: 'Image',
      nodes: [
        { name: 'Image', icon: 'Camera', description: 'Load images from assets', type: 'Image' }
      ]
    },
    {
      id: 'composite',
      label: 'Composite',
      nodes: [
        { name: 'Composite', icon: 'Layers', description: 'Blend two images together', type: 'Composite' }
      ]
    },
    {
      id: 'resize',
      label: 'Resize',
      nodes: [
        { name: 'Resize', icon: 'Maximize2', description: 'Scale or resize an image', type: 'Resize' }
      ]
    }
  ]
};

