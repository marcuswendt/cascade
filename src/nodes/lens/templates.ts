/**
 * Default code templates for Lens library nodes
 */

export function getLensNodeTemplate(type: string): string | null {
  if (type === 'Color') {
    return `// Color node - creates a solid color canvas
node.defineProp('color', {
  value: '#ffffff',
  type: 'color',
  displayName: 'Color'
});

node.defineProp('resolution', {
  value: [512, 512],
  params: {
    min: [1, 1],
    max: [4096, 4096]
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
    return `// Image node - loads an image file
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
    return `// Composite node - blends two images together
const image1 = node.in('image1', null);
const image2 = node.in('image2', null);

node.defineProp('blendMode', {
  value: 'normal',
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
      { value: 'subtract', label: 'Subtract' }
    ]
  },
  displayName: 'Blend Mode',
  onChange: render
});

const output = node.out('image');

function getBlendMode(mode) {
  const modes = {
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
    'exclusion': 'exclusion',
    'add': 'lighter',
    'subtract': 'difference'
  };
  return modes[mode] || 'source-over';
}

function getImageSize(img) {
  if (img instanceof HTMLCanvasElement) {
    return { width: img.width, height: img.height };
  } else if (img instanceof HTMLImageElement) {
    return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
  }
  return { width: 0, height: 0 };
}

function render() {
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
  
  // Draw first image
  ctx.drawImage(img1, 0, 0, width, height);
  
  // Apply blend mode and draw second image
  ctx.globalCompositeOperation = getBlendMode(node.props.blendMode.value);
  ctx.drawImage(img2, 0, 0, width, height);
  
  output.setValue(canvas);
  node.preview = canvas;
}

// Watch for input changes
image1.onChange = render;
image2.onChange = render;

node.onReady = () => {
  render();
};
`;
  }
  
  if (type === 'Checkers') {
    return `// Checkers node - generates a checkerboard pattern
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

node.defineProp('size', {
  value: 32,
  params: {
    min: 1,
    max: 512,
    step: 1
  },
  displayName: 'Size',
  onChange: render
});

node.defineProp('resolution', {
  value: [512, 512],
  params: {
    min: [1, 1],
    max: [4096, 4096]
  },
  displayName: 'Resolution',
  onChange: render
});

const output = node.out('image');

function render() {
  const [width, height] = node.props.resolution.value;
  const size = node.props.size.value;
  const color1 = node.props.color1.value;
  const color2 = node.props.color2.value;
  
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) return;
  
  // Draw checkerboard pattern
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      const isEven = Math.floor(x / size) + Math.floor(y / size);
      ctx.fillStyle = isEven % 2 === 0 ? color1 : color2;
      ctx.fillRect(x, y, size, size);
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
    return `// Resize node - scales or resizes an image
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

