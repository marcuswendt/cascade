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
  value: { r: 1.0, g: 1.0, b: 1.0 },
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
    // Convert color object to CSS string
    const color = node.props.color.value;
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    const a = color.a !== undefined ? color.a : 1.0;
    ctx.fillStyle = a < 1.0 ? 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')' : 'rgb(' + r + ',' + g + ',' + b + ')';
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
    return nodeTemplate`// Image node - loads an image file or accepts image input
const imageInput = node.in('image', null);

node.defineProp('file', {
  value: '',
  type: 'image',
  params: {
    accept: 'image/*'
  },
  displayName: 'File',
  onChange: async (prop) => {
    if (prop.value && !imageInput.value) {
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
    if ((node.props.file.value || imageInput.value)) {
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
    if ((node.props.file.value || imageInput.value) && node.props.resolutionMode.value === 'max') {
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
    if ((node.props.file.value || imageInput.value) && node.props.resolutionMode.value === 'fixed') {
      await render();
    }
  }
});

const output = node.out('image');

async function render() {
  let img = null;
  
  // First check input port (from annotation or other node)
  if (imageInput.value) {
    if (imageInput.value instanceof HTMLImageElement) {
      img = imageInput.value;
    } else if (imageInput.value instanceof HTMLCanvasElement) {
      // Convert canvas to image
      img = new Image();
      img.src = imageInput.value.toDataURL();
      await new Promise((resolve, reject) => {
        img!.onload = resolve;
        img!.onerror = reject;
      });
    } else if (typeof imageInput.value === 'string') {
      // String might be an image path
      img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img!.onload = resolve;
        img!.onerror = reject;
        img!.src = imageInput.value;
      });
    }
  } else if (node.props.file.value) {
    // Fall back to file prop
    img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img!.onload = resolve;
      img!.onerror = reject;
      img!.src = node.props.file.value;
    });
  }
  
  if (!img) {
    return;
  }
  
  try {
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
    console.error('Failed to process image:', error);
  }
}

// Watch for input changes
imageInput.onChange = () => {
  render().catch(err => {
    console.error('Image render error in input onChange:', err);
  });
};

node.onReady = async () => {
  if (node.props.file.value || imageInput.value) {
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
  // Execute upstream nodes for any missing inputs
  const upstreamPromises = [];
  
  // Check image1 input
  if (!image1.value) {
    image1.connections.forEach(conn => {
      const upstreamNode = graph.getNode(conn.from.nodeId);
      if (upstreamNode) {
        upstreamPromises.push(
          graph.execute(upstreamNode).catch(err => {
            console.warn('Failed to execute upstream node for image1:', err);
          })
        );
      }
    });
  }
  
  // Check image2 input
  if (!image2.value) {
    image2.connections.forEach(conn => {
      const upstreamNode = graph.getNode(conn.from.nodeId);
      if (upstreamNode) {
        upstreamPromises.push(
          graph.execute(upstreamNode).catch(err => {
            console.warn('Failed to execute upstream node for image2:', err);
          })
        );
      }
    });
  }
  
  // Wait for all upstream nodes to finish executing
  if (upstreamPromises.length > 0) {
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
  value: { r: 1.0, g: 1.0, b: 1.0 },
  type: 'color',
  displayName: 'Color 1',
  onChange: render
});

node.defineProp('color2', {
  value: { r: 0.0, g: 0.0, b: 0.0 },
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
  
  // Convert color objects to CSS strings
  function colorToCss(color) {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    const a = color.a !== undefined ? color.a : 1.0;
    return a < 1.0 ? 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')' : 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  
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
      ctx.fillStyle = isEven % 2 === 0 ? colorToCss(color1) : colorToCss(color2);
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
  
  if (type === 'NormalMap') {
    return nodeTemplate`// Normal Map node - computes normal map from height map (red channel)
const image = node.in('image', null);

node.defineProp('scale', {
  value: 1.0,
  params: {
    min: 0.0,
    max: 10.0,
    step: 0.1
  },
  displayName: 'Scale',
  onChange: render
});

node.defineProp('flipX', {
  value: false,
  type: 'boolean',
  displayName: 'Flip X',
  onChange: render
});

node.defineProp('flipY', {
  value: false,
  type: 'boolean',
  displayName: 'Flip Y',
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

function getImageData(img, targetWidth, targetHeight) {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = targetWidth;
  tempCanvas.height = targetHeight;
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return null;
  
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
  
  tempCtx.drawImage(img, 0, 0, srcWidth, srcHeight, 0, 0, targetWidth, targetHeight);
  return tempCtx.getImageData(0, 0, targetWidth, targetHeight);
}

function computeNormalMap(imageData, scale, flipX, flipY) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const result = new ImageData(width, height);
  const resultData = result.data;
  
  // Extract red channel (height values)
  const heightMap = new Float32Array(width * height);
  for (let i = 0; i < data.length; i += 4) {
    const idx = i / 4;
    heightMap[idx] = data[i] / 255.0; // Red channel as height
  }
  
  // Compute gradients using finite differences
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      
      // Get neighboring heights with clamping
      const h00 = heightMap[idx]; // Current
      const h10 = heightMap[Math.min(x + 1, width - 1) + y * width]; // Right
      const h01 = heightMap[x + Math.min(y + 1, height - 1) * width]; // Down
      
      // Compute gradients (Sobel-like)
      const dx = (h10 - h00) * scale;
      const dy = (h01 - h00) * scale;
      
      // Apply flips
      const finalDx = flipX ? -dx : dx;
      const finalDy = flipY ? -dy : dy;
      
      // Compute normal vector
      // Normal = normalize(-dx, -dy, 1)
      const nx = -finalDx;
      const ny = -finalDy;
      const nz = 1.0;
      
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const normalizedX = nx / length;
      const normalizedY = ny / length;
      const normalizedZ = nz / length;
      
      // Map from [-1, 1] to [0, 1] for normal map format
      const r = (normalizedX * 0.5 + 0.5) * 255;
      const g = (normalizedY * 0.5 + 0.5) * 255;
      const b = (normalizedZ * 0.5 + 0.5) * 255;
      
      const resultIdx = idx * 4;
      resultData[resultIdx] = Math.round(Math.max(0, Math.min(255, r)));
      resultData[resultIdx + 1] = Math.round(Math.max(0, Math.min(255, g)));
      resultData[resultIdx + 2] = Math.round(Math.max(0, Math.min(255, b)));
      resultData[resultIdx + 3] = 255; // Alpha
    }
  }
  
  return result;
}

function render() {
  if (!image.value) {
    return;
  }
  
  const img = image.value;
  const { width, height } = getImageSize(img);
  
  if (width === 0 || height === 0) {
    return;
  }
  
  const imageData = getImageData(img, width, height);
  if (!imageData) {
    return;
  }
  
  const scale = node.props.scale.value;
  const flipX = node.props.flipX.value;
  const flipY = node.props.flipY.value;
  const normalData = computeNormalMap(imageData, scale, flipX, flipY);
  
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) return;
  
  ctx.putImageData(normalData, 0, 0);
  
  output.setValue(canvas);
  node.preview = canvas;
}

// Watch for input changes
image.onChange = render;

// Watch for prop changes
node.watchProp('scale', render);
node.watchProp('flipX', render);
node.watchProp('flipY', render);

// Initial render
node.onReady = () => {
  render();
};
`;
  }
  
  if (type === 'Ramp') {
    return nodeTemplate`// Ramp node - generates color ramps
node.defineProp('type', {
  value: 'horizontal',
  params: {
    options: [
      { value: 'horizontal', label: 'Horizontal' },
      { value: 'vertical', label: 'Vertical' },
      { value: 'radial', label: 'Radial' },
      { value: 'concentric', label: 'Concentric' }
    ]
  },
  displayName: 'Type',
  onChange: render
});

node.defineProp('points', {
  value: [
    { position: 0.0, color: { r: 0.0, g: 0.0, b: 0.0 }, interpolation: 'linear' },
    { position: 1.0, color: { r: 1.0, g: 1.0, b: 1.0 }, interpolation: 'linear' }
  ],
  type: 'colorramp',
  displayName: 'Ramp',
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

// Normalize color to object format (supports multiple input formats)
function normalizeColor(color) {
  // Already an object with r, g, b
  if (typeof color === 'object' && color !== null && 'r' in color && 'g' in color && 'b' in color) {
    // Check if normalized (<= 1.0) or integer (0-255)
    const isNormalized = color.r <= 1.0 && color.g <= 1.0 && color.b <= 1.0;
    return {
      r: isNormalized ? color.r : color.r / 255,
      g: isNormalized ? color.g : color.g / 255,
      b: isNormalized ? color.b : color.b / 255,
      a: color.a !== undefined 
        ? (isNormalized ? color.a : color.a / 255)
        : 1.0
    };
  }
  
  // Array input
  if (Array.isArray(color)) {
    const isNormalized = color.every(v => v <= 1.0);
    return {
      r: isNormalized ? color[0] : color[0] / 255,
      g: isNormalized ? color[1] : color[1] / 255,
      b: isNormalized ? color[2] : color[2] / 255,
      a: color[3] !== undefined 
        ? (isNormalized ? color[3] : color[3] / 255)
        : 1.0
    };
  }
  
  // String input (rgb(r,g,b) or #hex) - for backward compatibility
  if (typeof color === 'string') {
    const rgbMatch = color.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (rgbMatch) {
      return {
        r: parseInt(rgbMatch[1], 10) / 255,
        g: parseInt(rgbMatch[2], 10) / 255,
        b: parseInt(rgbMatch[3], 10) / 255,
        a: 1.0
      };
    }
    
    const hex = color.replace('#', '');
    if (hex.length === 3 || hex.length === 6) {
      const expanded = hex.length === 3 
        ? hex.split('').map(c => c + c).join('')
        : hex;
      const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(expanded);
      if (result) {
        return {
          r: parseInt(result[1], 16) / 255,
          g: parseInt(result[2], 16) / 255,
          b: parseInt(result[3], 16) / 255,
          a: 1.0
        };
      }
    }
  }
  
  // Fallback to black
  return { r: 0, g: 0, b: 0, a: 1.0 };
}

// Interpolate between two colors (both should be normalized 0-1)
function interpolateColor(color1, color2, t, interpolation) {
  if (interpolation === 'constant') {
    return t < 0.5 ? color1 : color2;
  } else if (interpolation === 'smooth') {
    // Smoothstep interpolation
    t = t * t * (3 - 2 * t);
  }
  // linear (default)
  
  return {
    r: color1.r + (color2.r - color1.r) * t,
    g: color1.g + (color2.g - color1.g) * t,
    b: color1.b + (color2.b - color1.b) * t
  };
}

// Get color at position from ramp points (returns normalized 0-1 color object)
function getColorAtPosition(points, position) {
  // Sort points by position
  const sortedPoints = [...points].sort((a, b) => a.position - b.position);
  
  // Clamp position
  position = Math.max(0, Math.min(1, position));
  
  // Find surrounding points
  let before = null;
  let after = null;
  
  for (let i = 0; i < sortedPoints.length; i++) {
    if (sortedPoints[i].position <= position) {
      before = sortedPoints[i];
    }
    if (sortedPoints[i].position >= position && !after) {
      after = sortedPoints[i];
      break;
    }
  }
  
  // Handle edge cases
  if (!before && after) {
    return normalizeColor(after.color);
  }
  if (before && !after) {
    return normalizeColor(before.color);
  }
  if (!before && !after) {
    return { r: 0, g: 0, b: 0 };
  }
  
  // If exact match
  if (before.position === position) {
    return normalizeColor(before.color);
  }
  if (after.position === position) {
    return normalizeColor(after.color);
  }
  
  // Interpolate
  const t = (position - before.position) / (after.position - before.position);
  const color1 = normalizeColor(before.color);
  const color2 = normalizeColor(after.color);
  const interpolation = after.interpolation || 'linear';
  
  return interpolateColor(color1, color2, t, interpolation);
}

function render() {
  const [width, height] = node.props.resolution.value;
  const rampType = node.props.type.value;
  const points = node.props.points.value || [];
  
  if (points.length === 0) {
    return;
  }
  
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) return;
  
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  const centerX = width / 2;
  const centerY = height / 2;
  const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let position = 0;
      
      if (rampType === 'horizontal') {
        position = x / width;
      } else if (rampType === 'vertical') {
        position = y / height;
      } else if (rampType === 'radial') {
        const dx = x - centerX;
        const dy = y - centerY;
        const angle = Math.atan2(dy, dx);
        position = (angle + Math.PI) / (2 * Math.PI);
      } else if (rampType === 'concentric') {
        const dx = x - centerX;
        const dy = y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        position = dist / maxDist;
      }
      
      const color = getColorAtPosition(points, position);
      const idx = (y * width + x) * 4;
      // Color is normalized (0-1), convert to 0-255
      data[idx] = Math.round(color.r * 255);
      data[idx + 1] = Math.round(color.g * 255);
      data[idx + 2] = Math.round(color.b * 255);
      data[idx + 3] = 255;
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  
  output.setValue(canvas);
  node.preview = canvas;
}

// Watch for prop changes
node.watchProp('type', render);
node.watchProp('points', render);
node.watchProp('resolution', render);

// Initial render
node.onReady = () => {
  render();
};
`;
  }
  
  if (type === 'SimplexNoise') {
    return nodeTemplate`// Simplex Noise node - generates Simplex noise pattern
node.defineProp('seed', {
  value: 0,
  params: {
    min: 0,
    max: 10000,
    step: 1,
    integer: true
  },
  displayName: 'Seed',
  onChange: render
});

node.defineProp('scale', {
  value: 0.01,
  params: {
    min: 0.001,
    max: 1.0,
    step: 0.001
  },
  displayName: 'Scale',
  onChange: render
});

node.defineProp('iterations', {
  value: 4,
  params: {
    min: 1,
    max: 8,
    step: 1,
    integer: true
  },
  displayName: 'Iterations',
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

let noise2D = null;
let currentSeed = null;

async function initNoise() {
  try {
    const simplexNoise = await node.require('simplex-noise');
    const { createNoise2D } = simplexNoise;
    const seed = node.props.seed.value;
    
    // Create a seeded random function
    let rng = seed;
    function seededRandom() {
      rng = (rng * 9301 + 49297) % 233280;
      return rng / 233280;
    }
    
    noise2D = createNoise2D(seededRandom);
    currentSeed = seed;
  } catch (error) {
    console.error('Failed to load simplex-noise:', error);
    node.error = error;
  }
}

function render() {
  if (!noise2D) {
    initNoise().then(() => {
      if (noise2D) {
        render();
      }
    });
    return;
  }
  
  const [width, height] = node.props.resolution.value;
  const scale = node.props.scale.value;
  const iterations = node.props.iterations.value;
  const seed = node.props.seed.value;
  
  // Recreate noise function with new seed if needed
  if (seed !== currentSeed) {
    initNoise().then(() => {
      if (noise2D) {
        render();
      }
    });
    return;
  }
  
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) return;
  
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  
  // Generate fractal noise (multiple octaves)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      let amplitude = 1;
      let frequency = scale;
      let maxValue = 0;
      
      // Sum multiple octaves
      for (let i = 0; i < iterations; i++) {
        const nx = x * frequency;
        const ny = y * frequency;
        const noiseValue = noise2D(nx, ny);
        value += noiseValue * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5; // Each octave has half the amplitude
        frequency *= 2; // Each octave doubles the frequency
      }
      
      // Normalize to [0, 1]
      value = (value / maxValue + 1) * 0.5;
      
      // Map to grayscale
      const gray = Math.round(value * 255);
      const idx = (y * width + x) * 4;
      data[idx] = gray;
      data[idx + 1] = gray;
      data[idx + 2] = gray;
      data[idx + 3] = 255;
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  
  output.setValue(canvas);
  node.preview = canvas;
}

// Watch for prop changes
node.watchProp('seed', () => {
  initNoise().then(() => {
    if (noise2D) {
      render();
    }
  });
});
node.watchProp('scale', render);
node.watchProp('iterations', render);
node.watchProp('resolution', render);

// Initial render
node.onReady = async () => {
  await initNoise();
  if (noise2D) {
    render();
  }
};
`;
  }
  
  if (type === 'Blur') {
    return nodeTemplate`// Blur node - applies Gaussian blur to an image
const image = node.in('image', null);

node.defineProp('radius', {
  value: 5.0,
  params: {
    min: 0.0,
    max: 100.0,
    step: 0.1
  },
  displayName: 'Radius',
  onChange: render
});

node.defineProp('wrapEdges', {
  value: false,
  type: 'boolean',
  displayName: 'Wrap Edges',
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

function getImageData(img, targetWidth, targetHeight) {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = targetWidth;
  tempCanvas.height = targetHeight;
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return null;
  
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
  
  tempCtx.drawImage(img, 0, 0, srcWidth, srcHeight, 0, 0, targetWidth, targetHeight);
  return tempCtx.getImageData(0, 0, targetWidth, targetHeight);
}

function gaussianBlur(imageData, radius, wrapEdges) {
  if (radius <= 0) {
    return imageData;
  }
  
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const result = new ImageData(width, height);
  const resultData = result.data;
  
  // Create Gaussian kernel
  const kernelSize = Math.ceil(radius * 3) * 2 + 1;
  const kernel = [];
  const sigma = radius / 3;
  const twoSigmaSq = 2 * sigma * sigma;
  let sum = 0;
  
  for (let i = 0; i < kernelSize; i++) {
    const x = i - Math.floor(kernelSize / 2);
    const value = Math.exp(-(x * x) / twoSigmaSq);
    kernel[i] = value;
    sum += value;
  }
  
  // Normalize kernel
  for (let i = 0; i < kernelSize; i++) {
    kernel[i] /= sum;
  }
  
  // Helper function to get pixel coordinate with edge handling
  function getCoord(coord, max, wrap) {
    if (wrap) {
      // Wrap around edges
      if (coord < 0) {
        return max + (coord % max);
      } else if (coord >= max) {
        return coord % max;
      }
      return coord;
    } else {
      // Clamp to edges
      return Math.max(0, Math.min(max - 1, coord));
    }
  }
  
  // Apply horizontal blur
  const tempData = new Uint8ClampedArray(data.length);
  const halfKernel = Math.floor(kernelSize / 2);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      
      for (let k = 0; k < kernelSize; k++) {
        const px = getCoord(x + k - halfKernel, width, wrapEdges);
        const idx = (y * width + px) * 4;
        const weight = kernel[k];
        r += data[idx] * weight;
        g += data[idx + 1] * weight;
        b += data[idx + 2] * weight;
        a += data[idx + 3] * weight;
      }
      
      const idx = (y * width + x) * 4;
      tempData[idx] = r;
      tempData[idx + 1] = g;
      tempData[idx + 2] = b;
      tempData[idx + 3] = a;
    }
  }
  
  // Apply vertical blur
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      
      for (let k = 0; k < kernelSize; k++) {
        const py = getCoord(y + k - halfKernel, height, wrapEdges);
        const idx = (py * width + x) * 4;
        const weight = kernel[k];
        r += tempData[idx] * weight;
        g += tempData[idx + 1] * weight;
        b += tempData[idx + 2] * weight;
        a += tempData[idx + 3] * weight;
      }
      
      const idx = (y * width + x) * 4;
      resultData[idx] = Math.round(r);
      resultData[idx + 1] = Math.round(g);
      resultData[idx + 2] = Math.round(b);
      resultData[idx + 3] = Math.round(a);
    }
  }
  
  return result;
}

function render() {
  if (!image.value) {
    return;
  }
  
  const img = image.value;
  const { width, height } = getImageSize(img);
  
  if (width === 0 || height === 0) {
    return;
  }
  
  const imageData = getImageData(img, width, height);
  if (!imageData) {
    return;
  }
  
  const radius = node.props.radius.value;
  const wrapEdges = node.props.wrapEdges.value;
  const blurredData = gaussianBlur(imageData, radius, wrapEdges);
  
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) return;
  
  ctx.putImageData(blurredData, 0, 0);
  
  output.setValue(canvas);
  node.preview = canvas;
}

// Watch for input changes
image.onChange = render;

// Watch for prop changes
node.watchProp('radius', render);
node.watchProp('wrapEdges', render);

// Initial render
node.onReady = () => {
  render();
};
`;
  }
  
  return null;
}

