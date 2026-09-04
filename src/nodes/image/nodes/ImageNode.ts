/**
 * ImageNode - loads an image file or accepts image input
 * Converts to ImageBuffer for the processing pipeline
 */

import { ImageNodeBase, ImageBuffer, type ImageInput } from '../ImageNodeBase';
import type { Graph } from '@/nodes/Graph';
import type { InputPort, OutputPort } from '@/types/node.types';

type ImageInputValue = HTMLCanvasElement | HTMLImageElement | ImageBuffer | string | null;

export class ImageNode extends ImageNodeBase {
  private imageInput!: InputPort<ImageInputValue>;
  private output!: OutputPort<ImageBuffer>;

  constructor(id: string, graph: Graph) {
    super(id, 'File', graph);
  }

  protected setup(): void {
    this.imageInput = this.in<ImageInputValue>('image', null);

    this.addParm('file', {
      value: '',
      type: 'image',
      params: {
        accept: 'image/*'
      },
      displayName: 'File',
      onChange: () => {
        if (this.props.file.value && !this.imageInput.value) {
          this.requestCook();
        }
      }
    });

    this.addParm('resolutionMode', {
      value: 'original',
      params: {
        options: [
          { value: 'original', label: 'Original' },
          { value: 'max', label: 'Max Resolution' },
          { value: 'fixed', label: 'Fixed Resolution' }
        ]
      },
      displayName: 'Resolution Mode',
      onChange: () => {
        if (this.props.file.value || this.imageInput.value) {
          this.requestCook();
        }
      }
    });

    this.addParm('maxResolution', {
      value: [2048, 2048],
      params: {
        min: [1, 1],
        max: [4096, 4096]
      },
      displayName: 'Max Resolution',
      hidden: () => this.props.resolutionMode.value !== 'max',
      onChange: () => {
        if ((this.props.file.value || this.imageInput.value) && this.props.resolutionMode.value === 'max') {
          this.requestCook();
        }
      }
    });

    this.addParm('fixedResolution', {
      value: [512, 512],
      params: {
        min: [1, 1],
        max: [4096, 4096]
      },
      displayName: 'Fixed Resolution',
      hidden: () => this.props.resolutionMode.value !== 'fixed',
      onChange: () => {
        if ((this.props.file.value || this.imageInput.value) && this.props.resolutionMode.value === 'fixed') {
          this.requestCook();
        }
      }
    });

    this.output = this.out('image');

    this.imageInput.onChange = () => this.requestCook();

    this.onReady = () => {
      if (this.props.file.value || this.imageInput.value) {
        this.requestCook();
      }
    };
  }

  protected async render(): Promise<void> {
    let sourceBuffer: ImageBuffer | null = null;

    // First check input port
    if (this.imageInput.value) {
      if (this.imageInput.value instanceof ImageBuffer) {
        sourceBuffer = this.imageInput.value;
      } else if (this.imageInput.value instanceof HTMLImageElement ||
                 this.imageInput.value instanceof HTMLCanvasElement) {
        sourceBuffer = ImageBuffer.fromCanvas(this.imageInput.value);
      } else if (typeof this.imageInput.value === 'string') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = this.imageInput.value as string;
        });
        sourceBuffer = ImageBuffer.fromCanvas(img);
      }
    } else if (this.props.file.value) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = this.props.file.value;
      });
      sourceBuffer = ImageBuffer.fromCanvas(img);
    }

    if (!sourceBuffer) {
      return;
    }

    try {
      const mode = this.props.resolutionMode.value;
      let outputBuffer: ImageBuffer;

      if (mode === 'original') {
        outputBuffer = sourceBuffer;
      } else if (mode === 'max') {
        const [maxWidth, maxHeight] = this.props.maxResolution.value;
        const aspectRatio = sourceBuffer.width / sourceBuffer.height;
        let newWidth = sourceBuffer.width;
        let newHeight = sourceBuffer.height;

        if (newWidth > maxWidth) {
          newWidth = maxWidth;
          newHeight = maxWidth / aspectRatio;
        }
        if (newHeight > maxHeight) {
          newHeight = maxHeight;
          newWidth = maxHeight * aspectRatio;
        }

        newWidth = Math.round(newWidth);
        newHeight = Math.round(newHeight);

        if (newWidth !== sourceBuffer.width || newHeight !== sourceBuffer.height) {
          outputBuffer = this.resizeBuffer(sourceBuffer, newWidth, newHeight);
        } else {
          outputBuffer = sourceBuffer;
        }
      } else {
        const [width, height] = this.props.fixedResolution.value;
        outputBuffer = this.resizeBuffer(sourceBuffer, width, height);
      }

      this.setOutput(this.output, outputBuffer);
    } catch (error) {
      this.error = error as Error;
      console.error('Failed to process image:', error);
    }
  }

  private resizeBuffer(source: ImageBuffer, newWidth: number, newHeight: number): ImageBuffer {
    const result = ImageBuffer.rgba(newWidth, newHeight);
    const scaleX = source.width / newWidth;
    const scaleY = source.height / newHeight;

    for (let c = 0; c < Math.min(source.channelCount, 4); c++) {
      const dstChannel = result.channels[c];

      for (let y = 0; y < newHeight; y++) {
        for (let x = 0; x < newWidth; x++) {
          const srcX = x * scaleX;
          const srcY = y * scaleY;
          dstChannel[y * newWidth + x] = source.sample(srcX, srcY, c);
        }
      }
    }

    if (source.channelCount < 4) {
      result.fill(3, 1);
    }

    return result;
  }
}
