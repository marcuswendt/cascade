import type { NodeExecutionContext } from "@cascade/contracts";

import type { checkersDefinition, colorDefinition, noiseDefinition, rampDefinition } from "./definitions.js";
import { normalizeColor, output } from "./io.js";
import { Planar, type RGBA } from "./planar.js";
import { createNoise2D } from "./simplex.js";

/** `cascade.image.Color`, `Checkers`, `Noise` and `Ramp`: images from props alone. */

function size(resolution: readonly number[]): [number, number] {
  return [resolution[0]!, resolution[1]!];
}

export async function executeColor(context: NodeExecutionContext<typeof colorDefinition>): Promise<void> {
  const [width, height] = size(context.props.resolution);
  await output(context, Planar.solid(width, height, normalizeColor(context.props.color)));
}

export async function executeCheckers(context: NodeExecutionContext<typeof checkersDefinition>): Promise<void> {
  const { props } = context;
  const [width, height] = size(props.resolution);
  const color1 = normalizeColor(props.color1);
  const color2 = normalizeColor(props.color2);
  const checkerSize = props.mode === "size" ? props.size : width / props.divisions;
  let offsetX = 0;
  let offsetY = 0;
  if (props.centered) {
    // The centre of the image is the centre of a cell.
    offsetX = (width / 2) % checkerSize - checkerSize / 2;
    offsetY = (height / 2) % checkerSize - checkerSize / 2;
  }
  const buffer = Planar.rgba(width, height);
  const [r, g, b, a] = buffer.channels as [Float32Array, Float32Array, Float32Array, Float32Array];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const even = (Math.floor((x - offsetX) / checkerSize) + Math.floor((y - offsetY) / checkerSize)) % 2 === 0;
      const color = even ? color1 : color2;
      r[idx] = color.r;
      g[idx] = color.g;
      b[idx] = color.b;
      a[idx] = color.a;
    }
  }
  await output(context, buffer);
}

export async function executeNoise(context: NodeExecutionContext<typeof noiseDefinition>): Promise<void> {
  const { props } = context;
  const [width, height] = size(props.resolution);
  // The class node's LCG, so a seed draws the noise it always drew.
  let rng = props.seed;
  const noise2D = createNoise2D(() => {
    rng = (rng * 9301 + 49297) % 233280;
    return rng / 233280;
  });
  const buffer = Planar.grayscale(width, height);
  const gray = buffer.channels[0]!;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      let amplitude = 1;
      let frequency = props.scale;
      let maxValue = 0;
      for (let i = 0; i < props.iterations; i++) {
        value += noise2D(x * frequency, y * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
      }
      gray[y * width + x] = (value / maxValue + 1) * 0.5;
    }
  }
  await output(context, buffer);
}

interface RampPoint {
  readonly position: number;
  readonly color: unknown;
  readonly interpolation?: string;
}

function interpolateColor(color1: RGBA, color2: RGBA, t: number, interpolation: string): RGBA {
  if (interpolation === "constant") return t < 0.5 ? color1 : color2;
  if (interpolation === "smooth") t = t * t * (3 - 2 * t);
  return {
    r: color1.r + (color2.r - color1.r) * t,
    g: color1.g + (color2.g - color1.g) * t,
    b: color1.b + (color2.b - color1.b) * t,
    a: (color1.a ?? 1) + ((color2.a ?? 1) - (color1.a ?? 1)) * t,
  };
}

function colorAt(points: readonly RampPoint[], position: number): RGBA {
  const sorted = [...points].sort((a, b) => a.position - b.position);
  position = Math.max(0, Math.min(1, position));
  let before: RampPoint | null = null;
  let after: RampPoint | null = null;
  for (const point of sorted) {
    if (point.position <= position) before = point;
    if (point.position >= position && !after) {
      after = point;
      break;
    }
  }
  if (!before && after) return normalizeColor(after.color);
  if (before && !after) return normalizeColor(before.color);
  if (!before || !after) return { r: 0, g: 0, b: 0, a: 1 };
  if (before.position === position) return normalizeColor(before.color);
  if (after.position === position) return normalizeColor(after.color);
  const t = (position - before.position) / (after.position - before.position);
  return interpolateColor(normalizeColor(before.color), normalizeColor(after.color), t, after.interpolation || "linear");
}

export async function executeRamp(context: NodeExecutionContext<typeof rampDefinition>): Promise<void> {
  const { props } = context;
  const [width, height] = size(props.resolution);
  const points = (props.points ?? []) as readonly RampPoint[];
  if (points.length === 0) return;
  const buffer = Planar.rgba(width, height);
  const [r, g, b, a] = buffer.channels as [Float32Array, Float32Array, Float32Array, Float32Array];
  const centerX = width / 2;
  const centerY = height / 2;
  const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let position = 0;
      if (props.type === "horizontal") {
        position = x / width;
      } else if (props.type === "vertical") {
        position = y / height;
      } else if (props.type === "radial") {
        position = (Math.atan2(y - centerY, x - centerX) + Math.PI) / (2 * Math.PI);
      } else if (props.type === "concentric") {
        const dx = x - centerX;
        const dy = y - centerY;
        position = Math.sqrt(dx * dx + dy * dy) / maxDist;
      }
      const color = colorAt(points, position);
      const idx = y * width + x;
      r[idx] = color.r;
      g[idx] = color.g;
      b[idx] = color.b;
      a[idx] = color.a ?? 1;
    }
  }
  await output(context, buffer);
}
