/**
 * Canvas and Image utility functions for image library nodes
 */

/**
 * Create a new canvas element with specified dimensions
 */
export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Get resolution from an image element (canvas or image)
 */
export function getImageResolution(image: HTMLCanvasElement | HTMLImageElement): { width: number; height: number } {
  if (image instanceof HTMLCanvasElement) {
    return { width: image.width, height: image.height };
  } else if (image instanceof HTMLImageElement) {
    return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
  }
  return { width: 0, height: 0 };
}

/**
 * Convert image to canvas
 */
export function imageToCanvas(image: HTMLCanvasElement | HTMLImageElement): HTMLCanvasElement {
  if (image instanceof HTMLCanvasElement) {
    return image;
  }
  
  const canvas = createCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(image, 0, 0);
  }
  return canvas;
}

/**
 * Load an image from a file path or data URL
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

/**
 * Resize image with aspect ratio preservation
 */
export function resizeImageWithAspectRatio(
  image: HTMLCanvasElement | HTMLImageElement,
  maxWidth: number,
  maxHeight: number
): HTMLCanvasElement {
  const { width, height } = getImageResolution(image);
  const aspectRatio = width / height;
  
  let newWidth = width;
  let newHeight = height;
  
  if (width > maxWidth) {
    newWidth = maxWidth;
    newHeight = maxWidth / aspectRatio;
  }
  
  if (newHeight > maxHeight) {
    newHeight = maxHeight;
    newWidth = maxHeight * aspectRatio;
  }
  
  const canvas = createCanvas(Math.round(newWidth), Math.round(newHeight));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

/**
 * Resize image to fixed dimensions
 */
export function resizeImageToFixed(
  image: HTMLCanvasElement | HTMLImageElement,
  width: number,
  height: number
): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(image, 0, 0, width, height);
  }
  return canvas;
}

/**
 * Scale image by a factor
 */
export function scaleImage(
  image: HTMLCanvasElement | HTMLImageElement,
  scale: number
): HTMLCanvasElement {
  const { width, height } = getImageResolution(image);
  return resizeImageToFixed(image, Math.round(width * scale), Math.round(height * scale));
}

/**
 * Get blend mode string for canvas globalCompositeOperation
 */
export function getBlendMode(mode: string): GlobalCompositeOperation {
  const blendModes: Record<string, GlobalCompositeOperation> = {
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
    'add': 'lighter', // Canvas doesn't have 'add', use 'lighter' as approximation
    'subtract': 'difference' // Canvas doesn't have 'subtract', use 'difference' as approximation
  };
  
  return blendModes[mode] || 'source-over';
}

