/**
 * NoiseNode - generates procedural noise patterns
 */

import { LensNode } from '../LensNode';
import type { Graph } from '@/nodes/Graph';
import type { OutputPort } from '@/types/node.types';

type Noise2DFunction = (x: number, y: number) => number;

export class NoiseNode extends LensNode {
  private output!: OutputPort<HTMLCanvasElement>;
  private noise2D: Noise2DFunction | null = null;
  private currentSeed: number | null = null;

  constructor(id: string, graph: Graph) {
    super(id, 'Noise', graph);
  }

  protected setup(): void {
    this.defineProp('seed', {
      value: 0,
      params: {
        min: 0,
        max: 10000,
        step: 1,
        integer: true
      },
      displayName: 'Seed',
      onChange: () => this.render()
    });

    this.defineProp('scale', {
      value: 0.01,
      params: {
        min: 0.001,
        max: 1.0,
        step: 0.001
      },
      displayName: 'Scale',
      onChange: () => this.render()
    });

    this.defineProp('iterations', {
      value: 4,
      params: {
        min: 1,
        max: 8,
        step: 1,
        integer: true
      },
      displayName: 'Iterations',
      onChange: () => this.render()
    });

    this.defineProp('resolution', {
      value: [512, 512],
      params: {
        min: [1, 1],
        max: [4096, 4096],
        integer: true
      },
      displayName: 'Resolution',
      onChange: () => this.render()
    });

    this.output = this.out('image');

    this.watchProp('seed', () => {
      this.initNoise().then(() => {
        if (this.noise2D) {
          this.render();
        }
      });
    });
    this.watchProp('scale', () => this.render());
    this.watchProp('iterations', () => this.render());
    this.watchProp('resolution', () => this.render());

    this.onReady = async () => {
      await this.initNoise();
      if (this.noise2D) {
        this.render();
      }
    };
  }

  private async initNoise(): Promise<void> {
    try {
      const simplexNoise = await this.require('simplex-noise');
      const { createNoise2D } = simplexNoise;
      const seed = this.props.seed.value;

      // Create a seeded random function
      let rng = seed;
      function seededRandom() {
        rng = (rng * 9301 + 49297) % 233280;
        return rng / 233280;
      }

      this.noise2D = createNoise2D(seededRandom);
      this.currentSeed = seed;
    } catch (error) {
      console.error('Failed to load simplex-noise:', error);
      this.error = error as Error;
    }
  }

  private render(): void {
    if (!this.noise2D) {
      this.initNoise().then(() => {
        if (this.noise2D) {
          this.render();
        }
      });
      return;
    }

    const [width, height] = this.props.resolution.value;
    const scale = this.props.scale.value;
    const iterations = this.props.iterations.value;
    const seed = this.props.seed.value;

    // Recreate noise function with new seed if needed
    if (seed !== this.currentSeed) {
      this.initNoise().then(() => {
        if (this.noise2D) {
          this.render();
        }
      });
      return;
    }

    const canvas = this.createCanvas(width, height);
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
          const noiseValue = this.noise2D!(nx, ny);
          value += noiseValue * amplitude;
          maxValue += amplitude;
          amplitude *= 0.5;
          frequency *= 2;
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
    this.setOutputAndPreview(this.output, canvas);
  }
}
