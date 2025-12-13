/**
 * NoiseNode - generates procedural noise patterns as ImageBuffer
 */

import { LensNode, ImageBuffer } from '../LensNode';
import type { Graph } from '@/nodes/Graph';
import type { OutputPort } from '@/types/node.types';

type Noise2DFunction = (x: number, y: number) => number;

export class NoiseNode extends LensNode {
  private output!: OutputPort<ImageBuffer>;
  private noise2D: Noise2DFunction | null = null;
  private currentSeed: number | null = null;

  constructor(id: string, graph: Graph) {
    super(id, 'Noise', graph);
  }

  protected setup(): void {
    this.addParm('seed', {
      value: 0,
      params: {
        min: 0,
        max: 10000,
        step: 1,
        integer: true
      },
      displayName: 'Seed',
      onChange: () => this.requestCook()
    });

    this.addParm('scale', {
      value: 0.01,
      params: {
        min: 0.001,
        max: 1.0,
        step: 0.001
      },
      displayName: 'Scale',
      onChange: () => this.requestCook()
    });

    this.addParm('iterations', {
      value: 4,
      params: {
        min: 1,
        max: 8,
        step: 1,
        integer: true
      },
      displayName: 'Iterations',
      onChange: () => this.requestCook()
    });

    this.addParm('resolution', {
      value: [512, 512],
      params: {
        min: [1, 1],
        max: [4096, 4096],
        integer: true
      },
      displayName: 'Resolution',
      onChange: () => this.requestCook()
    });

    this.output = this.out('image');

    this.watchProp('seed', () => {
      this.initNoise().then(() => {
        if (this.noise2D) {
          this.requestCook();
        }
      });
    });
    this.watchProp('scale', () => this.requestCook());
    this.watchProp('iterations', () => this.requestCook());
    this.watchProp('resolution', () => this.requestCook());

    this.onReady = async () => {
      await this.initNoise();
      if (this.noise2D) {
        this.requestCook();
      }
    };
  }

  private async initNoise(): Promise<void> {
    try {
      const simplexNoise = await this.require('simplex-noise');
      const { createNoise2D } = simplexNoise;
      const seed = this.props.seed.value;

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

  protected render(): void {
    if (!this.noise2D) {
      this.initNoise().then(() => {
        if (this.noise2D) {
          this.requestCook();
        }
      });
      return;
    }

    const [width, height] = this.props.resolution.value;
    const scale = this.props.scale.value;
    const iterations = this.props.iterations.value;
    const seed = this.props.seed.value;

    if (seed !== this.currentSeed) {
      this.initNoise().then(() => {
        if (this.noise2D) {
          this.requestCook();
        }
      });
      return;
    }

    // Create grayscale buffer (single channel for efficiency)
    const buffer = this.createGrayscale(width, height);
    const gray = buffer.r();

    // Generate fractal noise
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let value = 0;
        let amplitude = 1;
        let frequency = scale;
        let maxValue = 0;

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
        gray[y * width + x] = value;
      }
    }

    buffer.markDirty();
    this.setOutput(this.output, buffer);
  }
}
