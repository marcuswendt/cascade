/**
 * ImageNode - loads an image file or accepts image input
 */

import { LensNode, type ImageInput } from '../LensNode';
import type { Graph } from '@/nodes/Graph';
import type { InputPort, OutputPort } from '@/types/node.types';

type ImageInputValue = HTMLCanvasElement | HTMLImageElement | string | null;

export class ImageNode extends LensNode {
  private imageInput!: InputPort<ImageInputValue>;
  private output!: OutputPort<ImageInput>;

  constructor(id: string, graph: Graph) {
    super(id, 'Image', graph);
  }

  protected setup(): void {
    this.imageInput = this.in<ImageInputValue>('image', null);

    this.defineProp('file', {
      value: '',
      type: 'image',
      params: {
        accept: 'image/*'
      },
      displayName: 'File',
      onChange: async () => {
        if (this.props.file.value && !this.imageInput.value) {
          await this.render();
        }
      }
    });

    this.defineProp('resolutionMode', {
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
        if (this.props.file.value || this.imageInput.value) {
          await this.render();
        }
      }
    });

    this.defineProp('maxResolution', {
      value: [2048, 2048],
      params: {
        min: [1, 1],
        max: [4096, 4096]
      },
      displayName: 'Max Resolution',
      hidden: () => this.props.resolutionMode.value !== 'max',
      onChange: async () => {
        if ((this.props.file.value || this.imageInput.value) && this.props.resolutionMode.value === 'max') {
          await this.render();
        }
      }
    });

    this.defineProp('fixedResolution', {
      value: [512, 512],
      params: {
        min: [1, 1],
        max: [4096, 4096]
      },
      displayName: 'Fixed Resolution',
      hidden: () => this.props.resolutionMode.value !== 'fixed',
      onChange: async () => {
        if ((this.props.file.value || this.imageInput.value) && this.props.resolutionMode.value === 'fixed') {
          await this.render();
        }
      }
    });

    this.output = this.out('image');

    this.imageInput.onChange = () => {
      this.render().catch(err => {
        console.error('Image render error in input onChange:', err);
      });
    };

    this.onReady = async () => {
      if (this.props.file.value || this.imageInput.value) {
        await this.render();
      }
    };
  }

  private async render(): Promise<void> {
    let img: HTMLImageElement | null = null;

    // First check input port (from annotation or other node)
    if (this.imageInput.value) {
      if (this.imageInput.value instanceof HTMLImageElement) {
        img = this.imageInput.value;
      } else if (this.imageInput.value instanceof HTMLCanvasElement) {
        // Convert canvas to image
        img = new Image();
        img.src = this.imageInput.value.toDataURL();
        await new Promise<void>((resolve, reject) => {
          img!.onload = () => resolve();
          img!.onerror = reject;
        });
      } else if (typeof this.imageInput.value === 'string') {
        // String might be an image path
        img = new Image();
        img.crossOrigin = 'anonymous';
        const srcPath = this.imageInput.value;
        await new Promise<void>((resolve, reject) => {
          img!.onload = () => resolve();
          img!.onerror = reject;
          img!.src = srcPath;
        });
      }
    } else if (this.props.file.value) {
      // Fall back to file prop
      img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img!.onload = () => resolve();
        img!.onerror = reject;
        img!.src = this.props.file.value;
      });
    }

    if (!img) {
      return;
    }

    try {
      const mode = this.props.resolutionMode.value;

      if (mode === 'original') {
        this.output.setValue(img);
        this.preview = img;
      } else if (mode === 'max') {
        const [maxWidth, maxHeight] = this.props.maxResolution.value;
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

        const canvas = this.createCanvas(Math.round(newWidth), Math.round(newHeight));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
        this.setOutputAndPreview(this.output, canvas);
      } else if (mode === 'fixed') {
        const [width, height] = this.props.fixedResolution.value;
        const canvas = this.createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
        }
        this.setOutputAndPreview(this.output, canvas);
      }
    } catch (error) {
      this.error = error as Error;
      console.error('Failed to process image:', error);
    }
  }
}
