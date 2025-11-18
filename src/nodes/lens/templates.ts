/**
 * Default code templates for Lens library nodes
 */

import type { NodeContext } from '@/types/node.types';

/**
 * Helper function to create node templates with proper typing.
 * The template string will be executed in a context where 'node' is available as NodeContext.
 */
function nodeTemplate(template: TemplateStringsArray, ...values: any[]): string {
  // In the template string, 'node' is available as NodeContext at runtime
  // This function just returns the string - TypeScript type checking happens here
  return String.raw(template, ...values);
}

// Declare node variable for template string type checking
declare const node: NodeContext;

export function getLensNodeTemplate(type: string): string | null {
  if (type === 'Color') {
    return nodeTemplate`// Color node - creates a solid color canvas
node.defineProp('color', {
  value: '#ffffff',
  type: 'color',
  displayName: 'Color'
});

node.defineProp('resolution', {
  value: [512, 512],
  params: {
    min: [1, 1],
    max: [4096, 4096],
    integer: true
  },
  displayName: 'Resolution'
});

const output = node.out('image');

function render() {
  const [width, height] = node.props.resolution.value;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = node.props.color.value;
    ctx.fillRect(0, 0, width, height);
  }
  output.setValue(canvas);
  node.preview = canvas;
}

// Watch for prop changes
node.watchProp('color', render);
node.watchProp('resolution', render);

// Initial render
node.onReady = () => {
  render();
};
`;
  }
  
  if (type === 'Image') {
    return nodeTemplate`// Image node - loads an image file
node.defineProp('file', {
  value: '',
  type: 'image',
  params: {
    accept: 'image/*'
  },
  displayName: 'File',
  onChange: async (prop) => {
    if (prop.value) {
      await render();
    }
  }
});

node.defineProp('resolutionMode', {
  value: 'original',
  params: {
    options: [
      { value: 'original', label: 'Original' },
      { value: 'max', label: 'Max Resolution' },
      { value: 'fixed', label: 'Fixed Resolution' }
    ]
  },
  displayName: 'Resolution Mode',
  onChange: async () => {
    if (node.props.file.value) {
      await render();
    }
  }
});

node.defineProp('maxResolution', {
  value: [2048, 2048],
  params: {
    min: [1, 1],
    max: [4096, 4096]
  },
  displayName: 'Max Resolution',
  hidden: () => node.props.resolutionMode.value !== 'max',
  onChange: async () => {
    if (node.props.file.value && node.props.resolutionMode.value === 'max') {
      await render();
    }
  }
});

node.defineProp('fixedResolution', {
  value: [512, 512],
  params: {
    min: [1, 1],
    max: [4096, 4096]
  },
  displayName: 'Fixed Resolution',
  hidden: () => node.props.resolutionMode.value !== 'fixed',
  onChange: async () => {
    if (node.props.file.value && node.props.resolutionMode.value === 'fixed') {
      await render();
    }
  }
});

const output = node.out('image');

async function render() {
  if (!node.props.file.value) {
    return;
  }
  
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = node.props.file.value;
    });
    
    const mode = node.props.resolutionMode.value;
    let result;
    
    if (mode === 'original') {
      output.setValue(img);
      node.preview = img;
    } else if (mode === 'max') {
      const [maxWidth, maxHeight] = node.props.maxResolution.value;
      const aspectRatio = img.naturalWidth / img.naturalHeight;
      let newWidth = img.naturalWidth;
      let newHeight = img.naturalHeight;
      
      if (newWidth > maxWidth) {
        newWidth = maxWidth;
        newHeight = maxWidth / aspectRatio;
      }
      if (newHeight > maxHeight) {
        newHeight = maxHeight;
        newWidth = maxHeight * aspectRatio;
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(newWidth);
      canvas.height = Math.round(newHeight);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      output.setValue(canvas);
      node.preview = canvas;
    } else if (mode === 'fixed') {
      const [width, height] = node.props.fixedResolution.value;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
      }
      output.setValue(canvas);
      node.preview = canvas;
    }
  } catch (error) {
    node.error = error;
    console.error('Failed to load image:', error);
  }
}

node.onReady = async () => {
  if (node.props.file.value) {
    await render();
  }
};
`;
  }
  
  if (type === 'Composite') {
    return nodeTemplate`// Composite node - blends two images together
const image1 = node.in('image1', null);
const image2 = node.in('image2', null);

node.defineProp('blendMode', {
  value: 'multiply',
  params: {
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'multiply', label: 'Multiply' },
      { value: 'screen', label: 'Screen' },
      { value: 'overlay', label: 'Overlay' },
      { value: 'darken', label: 'Darken' },
      { value: 'lighten', label: 'Lighten' },
      { value: 'color-dodge', label: 'Color Dodge' },
      { value: 'color-burn', label: 'Color Burn' },
      { value: 'hard-light', label: 'Hard Light' },
      { value: 'soft-light', label: 'Soft Light' },
      { value: 'difference', label: 'Difference' },
      { value: 'exclusion', label: 'Exclusion' },
      { value: 'add', label: 'Add' },
      { value: 'subtract', label: 'Subtract' },
      { value: 'divide', label: 'Divide' },
      { value: 'pin-light', label: 'Pin Light' },
      { value: 'vivid-light', label: 'Vivid Light' },
      { value: 'linear-dodge', label: 'Linear Dodge' },
      { value: 'linear-burn', label: 'Linear Burn' }
    ]
  },
  displayName: 'Blend Mode',
  onChange: () => {
    render().catch(err => {
      console.error('Composite render error in blendMode onChange:', err);
    });
  }
});

node.defineProp('opacity', {
  value: 1.0,
  params: {
    min: 0.0,
    max: 1.0,
    step: 0.01
  },
  displayName: 'Opacity',
  onChange: () => {
    render().catch(err => {
      console.error('Composite render error in opacity onChange:', err);
    });
  }
});

const output = node.out('image');

function getImageSize(img) {
  if (img instanceof HTMLCanvasElement) {
    return { width: img.width, height: img.height };
  } else if (img instanceof HTMLImageElement) {
    return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
  }
  return { width: 0, height: 0 };
}

function getImageData(img, targetWidth, targetHeight) {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = targetWidth;
  tempCanvas.height = targetHeight;
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return null;
  
  // Get source dimensions
  let srcWidth, srcHeight;
  if (img instanceof HTMLCanvasElement) {
    srcWidth = img.width;
    srcHeight = img.height;
  } else if (img instanceof HTMLImageElement) {
    srcWidth = img.naturalWidth || img.width;
    srcHeight = img.naturalHeight || img.height;
  } else {
    return null;
  }
  
  // Draw and scale image to target size
  tempCtx.drawImage(img, 0, 0, srcWidth, srcHeight, 0, 0, targetWidth, targetHeight);
  return tempCtx.getImageData(0, 0, targetWidth, targetHeight);
}

function blendPixels(base, blend, mode, opacity) {
  const result = new Uint8ClampedArray(base.length);
  
  for (let i = 0; i < base.length; i += 4) {
    const r1 = base[i] / 255;
    const g1 = base[i + 1] / 255;
    const b1 = base[i + 2] / 255;
    const a1 = base[i + 3] / 255;
    
    const r2 = blend[i] / 255;
    const g2 = blend[i + 1] / 255;
    const b2 = blend[i + 2] / 255;
    const a2 = blend[i + 3] / 255;
    
    let r, g, b;
    
    switch (mode) {
      case 'normal':
        r = r2;
        g = g2;
        b = b2;
        break;
      case 'multiply':
        r = r1 * r2;
        g = g1 * g2;
        b = b1 * b2;
        break;
      case 'screen':
        r = 1 - (1 - r1) * (1 - r2);
        g = 1 - (1 - g1) * (1 - g2);
        b = 1 - (1 - b1) * (1 - b2);
        break;
      case 'overlay':
        r = r1 < 0.5 ? 2 * r1 * r2 : 1 - 2 * (1 - r1) * (1 - r2);
        g = g1 < 0.5 ? 2 * g1 * g2 : 1 - 2 * (1 - g1) * (1 - g2);
        b = b1 < 0.5 ? 2 * b1 * b2 : 1 - 2 * (1 - b1) * (1 - b2);
        break;
      case 'darken':
        r = Math.min(r1, r2);
        g = Math.min(g1, g2);
        b = Math.min(b1, b2);
        break;
      case 'lighten':
        r = Math.max(r1, r2);
        g = Math.max(g1, g2);
        b = Math.max(b1, b2);
        break;
      case 'color-dodge':
        r = r2 === 1 ? 1 : Math.min(1, r1 / (1 - r2));
        g = g2 === 1 ? 1 : Math.min(1, g1 / (1 - g2));
        b = b2 === 1 ? 1 : Math.min(1, b1 / (1 - b2));
        break;
      case 'color-burn':
        r = r2 === 0 ? 0 : Math.max(0, 1 - (1 - r1) / r2);
        g = g2 === 0 ? 0 : Math.max(0, 1 - (1 - g1) / g2);
        b = b2 === 0 ? 0 : Math.max(0, 1 - (1 - b1) / b2);
        break;
      case 'hard-light':
        r = r2 < 0.5 ? 2 * r1 * r2 : 1 - 2 * (1 - r1) * (1 - r2);
        g = g2 < 0.5 ? 2 * g1 * g2 : 1 - 2 * (1 - g1) * (1 - g2);
        b = b2 < 0.5 ? 2 * b1 * b2 : 1 - 2 * (1 - b1) * (1 - b2);
        break;
      case 'soft-light':
        r = r2 < 0.5 
          ? r1 - (1 - 2 * r2) * r1 * (1 - r1)
          : r1 + (2 * r2 - 1) * (Math.sqrt(r1) - r1);
        g = g2 < 0.5 
          ? g1 - (1 - 2 * g2) * g1 * (1 - g1)
          : g1 + (2 * g2 - 1) * (Math.sqrt(g1) - g1);
        b = b2 < 0.5 
          ? b1 - (1 - 2 * b2) * b1 * (1 - b1)
          : b1 + (2 * b2 - 1) * (Math.sqrt(b1) - b1);
        break;
      case 'difference':
        r = Math.abs(r1 - r2);
        g = Math.abs(g1 - g2);
        b = Math.abs(b1 - b2);
        break;
      case 'exclusion':
        r = r1 + r2 - 2 * r1 * r2;
        g = g1 + g2 - 2 * g1 * g2;
        b = b1 + b2 - 2 * b1 * b2;
        break;
      case 'add':
        r = Math.min(1, r1 + r2);
        g = Math.min(1, g1 + g2);
        b = Math.min(1, b1 + b2);
        break;
      case 'subtract':
        r = Math.max(0, r1 - r2);
        g = Math.max(0, g1 - g2);
        b = Math.max(0, b1 - b2);
        break;
      case 'divide':
        r = r2 === 0 ? 1 : Math.min(1, r1 / r2);
        g = g2 === 0 ? 1 : Math.min(1, g1 / g2);
        b = b2 === 0 ? 1 : Math.min(1, b1 / b2);
        break;
      case 'pin-light':
        r = r2 < 0.5 ? Math.min(r1, 2 * r2) : Math.max(r1, 2 * (r2 - 0.5));
        g = g2 < 0.5 ? Math.min(g1, 2 * g2) : Math.max(g1, 2 * (g2 - 0.5));
        b = b2 < 0.5 ? Math.min(b1, 2 * b2) : Math.max(b1, 2 * (b2 - 0.5));
        break;
      case 'vivid-light':
        r = r2 < 0.5 
          ? (r2 === 0 ? 0 : 1 - (1 - r1) / (2 * r2))
          : (r2 === 1 ? 1 : r1 / (2 * (1 - r2)));
        g = g2 < 0.5 
          ? (g2 === 0 ? 0 : 1 - (1 - g1) / (2 * g2))
          : (g2 === 1 ? 1 : g1 / (2 * (1 - g2)));
        b = b2 < 0.5 
          ? (b2 === 0 ? 0 : 1 - (1 - b1) / (2 * b2))
          : (b2 === 1 ? 1 : b1 / (2 * (1 - b2)));
        break;
      case 'linear-dodge':
        r = Math.min(1, r1 + r2);
        g = Math.min(1, g1 + g2);
        b = Math.min(1, b1 + b2);
        break;
      case 'linear-burn':
        r = Math.max(0, r1 + r2 - 1);
        g = Math.max(0, g1 + g2 - 1);
        b = Math.max(0, b1 + b2 - 1);
        break;
      default:
        r = r2;
        g = g2;
        b = b2;
    }
    
    // Apply opacity
    const finalR = r1 + (r - r1) * opacity * a2;
    const finalG = g1 + (g - g1) * opacity * a2;
    const finalB = b1 + (b - b1) * opacity * a2;
    const finalA = a1 + (a2 - a1) * opacity;
    
    result[i] = Math.round(finalR * 255);
    result[i + 1] = Math.round(finalG * 255);
    result[i + 2] = Math.round(finalB * 255);
    result[i + 3] = Math.round(finalA * 255);
  }
  
  return result;
}

function getBlendMode(mode) {
  // Modes that can use native canvas operations (faster)
  const nativeModes = {
    'normal': 'source-over',
    'multiply': 'multiply',
    'screen': 'screen',
    'overlay': 'overlay',
    'darken': 'darken',
    'lighten': 'lighten',
    'color-dodge': 'color-dodge',
    'color-burn': 'color-burn',
    'hard-light': 'hard-light',
    'soft-light': 'soft-light',
    'difference': 'difference',
    'exclusion': 'exclusion'
  };
  return nativeModes[mode] || null;
}

async function render() {
  // If inputs are missing, execute upstream nodes to ensure they render first
  if (!image1.value || !image2.value) {
    // Execute upstream nodes first to ensure inputs are ready
    // The framework handles execution state checking and cycle detection internally
    const upstreamPromises = [];
    node.inputs.forEach(input => {
      input.connections.forEach(conn => {
        const upstreamNode = graph.getNode(conn.from.nodeId);
        if (upstreamNode) {
          // Use graph.executeUpstream() which handles everything internally
          upstreamPromises.push(
            graph.executeUpstream(upstreamNode).catch(err => {
              // Handle errors gracefully (e.g., cycles)
              console.warn('Failed to execute upstream node:', err);
            })
          );
        }
      });
    });
    // Wait for all upstream nodes to finish executing
    await Promise.all(upstreamPromises);
  }
  
  // Check again after executing upstream
  if (!image1.value || !image2.value) {
    return;
  }
  
  const img1 = image1.value;
  const img2 = image2.value;
  
  // Use image1 resolution
  const { width, height } = getImageSize(img1);
  
  if (width === 0 || height === 0) {
    return;
  }
  
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) return;
  
  const blendMode = node.props.blendMode.value;
  const opacity = node.props.opacity.value;
  const nativeMode = getBlendMode(blendMode);
  
  try {
    // Use native canvas operations for supported modes when opacity is 1.0
    if (nativeMode && opacity === 1.0) {
      // Draw first image (scaled to target size)
      ctx.drawImage(img1, 0, 0, width, height);
      
      // Set blend mode and draw second image (scaled to match)
      ctx.globalCompositeOperation = nativeMode;
      ctx.drawImage(img2, 0, 0, width, height);
      
      // Reset composite operation
      ctx.globalCompositeOperation = 'source-over';
    } else {
      // Use manual pixel blending for unsupported modes or when opacity < 1.0
      const baseData = getImageData(img1, width, height);
      const blendData = getImageData(img2, width, height);
      
      if (!baseData || !blendData) {
        // Fallback: just draw image1 if blending fails
        ctx.drawImage(img1, 0, 0, width, height);
        output.setValue(canvas);
        node.preview = canvas;
        return;
      }
      
      const resultData = blendPixels(baseData.data, blendData.data, blendMode, opacity);
      const resultImageData = new ImageData(resultData, width, height);
      
      ctx.putImageData(resultImageData, 0, 0);
    }
    
    output.setValue(canvas);
    node.preview = canvas;
  } catch (error) {
    console.error('Composite render error:', error);
    node.error = error;
  }
}

// Watch for input changes - render when either input changes
image1.onChange = () => {
  render().catch(err => {
    console.error('Composite render error in image1 onChange:', err);
  });
};
image2.onChange = () => {
  render().catch(err => {
    console.error('Composite render error in image2 onChange:', err);
  });
};

// Initial render attempt
node.onReady = () => {
  // Trigger upstream execution and render
  render().catch(err => {
    console.error('Composite render error in onReady:', err);
  });
};
`;
  }
  
  if (type === 'Checkers') {
    return nodeTemplate`// Checkers node - generates a checkerboard pattern
node.defineProp('color1', {
  value: '#ffffff',
  type: 'color',
  displayName: 'Color 1',
  onChange: render
});

node.defineProp('color2', {
  value: '#000000',
  type: 'color',
  displayName: 'Color 2',
  onChange: render
});

node.defineProp('mode', {
  value: 'size',
  params: {
    options: [
      { value: 'size', label: 'Size' },
      { value: 'divisions', label: 'Divisions' }
    ]
  },
  displayName: 'Mode',
  onChange: render
});

node.defineProp('size', {
  value: 32,
  params: {
    min: 1,
    max: 512,
    step: 0.1
  },
  displayName: 'Size',
  hidden: () => node.props.mode.value !== 'size',
  onChange: render
});

node.defineProp('divisions', {
  value: 16,
  params: {
    min: 1,
    max: 512,
    step: 1,
    integer: true
  },
  displayName: 'Divisions',
  hidden: () => node.props.mode.value !== 'divisions',
  onChange: render
});

node.defineProp('resolution', {
  value: [512, 512],
  params: {
    min: [1, 1],
    max: [4096, 4096],
    integer: true
  },
  displayName: 'Resolution',
  onChange: render
});

const output = node.out('image');

function render() {
  const [width, height] = node.props.resolution.value;
  const mode = node.props.mode.value;
  const color1 = node.props.color1.value;
  const color2 = node.props.color2.value;
  
  // Calculate checker size based on mode
  let checkerSize;
  if (mode === 'size') {
    checkerSize = node.props.size.value;
  } else {
    // divisions mode: divide width by divisions
    checkerSize = width / node.props.divisions.value;
  }
  
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) return;
  
  // Draw checkerboard pattern
  for (let y = 0; y < height; y += checkerSize) {
    for (let x = 0; x < width; x += checkerSize) {
      const isEven = Math.floor(x / checkerSize) + Math.floor(y / checkerSize);
      ctx.fillStyle = isEven % 2 === 0 ? color1 : color2;
      ctx.fillRect(x, y, checkerSize, checkerSize);
    }
  }
  
  output.setValue(canvas);
  node.preview = canvas;
}

node.onReady = () => {
  render();
};
`;
  }
  
  if (type === 'Resize') {
    return nodeTemplate`// Resize node - scales or resizes an image
const image = node.in('image', null);

node.defineProp('mode', {
  value: 'scale',
  params: {
    options: [
      { value: 'scale', label: 'Scale' },
      { value: 'fixed', label: 'Fixed' }
    ]
  },
  displayName: 'Mode',
  onChange: render
});

node.defineProp('scale', {
  value: 1.0,
  params: {
    min: 0.1,
    max: 10.0,
    step: 0.1
  },
  displayName: 'Scale',
  hidden: () => node.props.mode.value !== 'scale',
  onChange: render
});

node.defineProp('width', {
  value: 512,
  params: {
    min: 1,
    max: 4096,
    step: 1
  },
  displayName: 'Width',
  hidden: () => node.props.mode.value !== 'fixed',
  onChange: render
});

node.defineProp('height', {
  value: 512,
  params: {
    min: 1,
    max: 4096,
    step: 1
  },
  displayName: 'Height',
  hidden: () => node.props.mode.value !== 'fixed',
  onChange: render
});

const output = node.out('image');

function getImageSize(img) {
  if (img instanceof HTMLCanvasElement) {
    return { width: img.width, height: img.height };
  } else if (img instanceof HTMLImageElement) {
    return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
  }
  return { width: 0, height: 0 };
}

function render() {
  if (!image.value) {
    return;
  }
  
  const img = image.value;
  const { width: srcWidth, height: srcHeight } = getImageSize(img);
  
  if (srcWidth === 0 || srcHeight === 0) {
    return;
  }
  
  let newWidth, newHeight;
  
  if (node.props.mode.value === 'scale') {
    const scale = node.props.scale.value;
    newWidth = Math.round(srcWidth * scale);
    newHeight = Math.round(srcHeight * scale);
  } else {
    newWidth = node.props.width.value;
    newHeight = node.props.height.value;
  }
  
  const canvas = document.createElement('canvas');
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) return;
  
  ctx.drawImage(img, 0, 0, newWidth, newHeight);
  
  output.setValue(canvas);
  node.preview = canvas;
}

// Watch for input changes
image.onChange = render;

node.onReady = () => {
  render();
};
`;
  }
  
  return null;
}

