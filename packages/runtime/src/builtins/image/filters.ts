import type { NodeExecutionContext } from "@cascade/contracts";

import type {
  blurDefinition,
  compositeDefinition,
  normalMapDefinition,
  resizeDefinition,
  transformDefinition,
} from "./definitions.js";
import { output, readPlanar } from "./io.js";
import { Planar, resample, resizeToFit, resolveOutputSize, type FitMode, type ResolutionMode } from "./planar.js";

/**
 * `cascade.image.Blur`, `NormalMap`, `Resize`, `Transform` and `Composite`:
 * the class library's pixel loops, unchanged. An unwired input leaves the
 * output unset, as the class nodes did.
 */

// ---------------------------------------------------------------- Blur

/** Box radii for an n-pass approximation of a Gaussian of this sigma. */
function boxesForGauss(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes.map((s) => (s - 1) / 2);
}

/** One box pass, horizontal then vertical, sliding sums: O(1) a pixel. */
function boxBlurPass(data: Float32Array, w: number, h: number, r: number, wrap: boolean): void {
  if (r < 1) return;
  const temp = new Float32Array(w * h);
  const ri = Math.floor(r);
  const invDiameter = 1 / (ri * 2 + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -ri; i <= ri; i++) {
      const px = wrap ? ((i % w) + w) % w : Math.max(0, Math.min(w - 1, i));
      sum += data[row + px]!;
    }
    temp[row] = sum * invDiameter;
    for (let x = 1; x < w; x++) {
      const removeX = wrap ? (((x - ri - 1) % w) + w) % w : Math.max(0, x - ri - 1);
      const addX = wrap ? (((x + ri) % w) + w) % w : Math.min(w - 1, x + ri);
      sum -= data[row + removeX]!;
      sum += data[row + addX]!;
      temp[row + x] = sum * invDiameter;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -ri; i <= ri; i++) {
      const py = wrap ? ((i % h) + h) % h : Math.max(0, Math.min(h - 1, i));
      sum += temp[py * w + x]!;
    }
    data[x] = sum * invDiameter;
    for (let y = 1; y < h; y++) {
      const removeY = wrap ? (((y - ri - 1) % h) + h) % h : Math.max(0, y - ri - 1);
      const addY = wrap ? (((y + ri) % h) + h) % h : Math.min(h - 1, y + ri);
      sum -= temp[removeY * w + x]!;
      sum += temp[addY * w + x]!;
      data[y * w + x] = sum * invDiameter;
    }
  }
}

function boxBlur(source: Planar, radius: number, wrapEdges: boolean): Planar {
  if (radius <= 0) return source.clone();
  const boxes = boxesForGauss(radius, 3);
  const result = source.emptyClone();
  for (let c = 0; c < source.channelCount; c++) {
    const channel = new Float32Array(source.channels[c]!);
    for (const box of boxes) boxBlurPass(channel, source.width, source.height, box, wrapEdges);
    result.channels[c]!.set(channel);
  }
  return result;
}

function gaussianBlur(source: Planar, radius: number, wrapEdges: boolean): Planar {
  if (radius <= 0) return source.clone();
  const { width, height } = source;
  const result = source.emptyClone();
  const kernelSize = Math.ceil(radius * 3) * 2 + 1;
  const kernel = new Float32Array(kernelSize);
  const sigma = radius / 3;
  const twoSigmaSq = 2 * sigma * sigma;
  const half = (kernelSize - 1) >> 1;
  let sum = 0;
  for (let i = 0; i < kernelSize; i++) {
    const x = i - half;
    const value = Math.exp(-(x * x) / twoSigmaSq);
    kernel[i] = value;
    sum += value;
  }
  const invSum = 1 / sum;
  for (let i = 0; i < kernelSize; i++) kernel[i]! *= invSum;
  const wrapX = wrapEdges
    ? (coord: number) => ((coord % width) + width) % width
    : (coord: number) => (coord < 0 ? 0 : coord >= width ? width - 1 : coord);
  const wrapY = wrapEdges
    ? (coord: number) => ((coord % height) + height) % height
    : (coord: number) => (coord < 0 ? 0 : coord >= height ? height - 1 : coord);
  for (let c = 0; c < source.channelCount; c++) {
    const src = source.channels[c]!;
    const dst = result.channels[c]!;
    const temp = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        let acc = 0;
        for (let k = 0; k < kernelSize; k++) acc += src[row + wrapX(x + k - half)]! * kernel[k]!;
        temp[row + x] = acc;
      }
    }
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        let acc = 0;
        for (let k = 0; k < kernelSize; k++) acc += temp[wrapY(y + k - half) * width + x]! * kernel[k]!;
        dst[y * width + x] = acc;
      }
    }
  }
  return result;
}

export async function executeBlur(context: NodeExecutionContext<typeof blurDefinition>): Promise<void> {
  const source = await readPlanar(context, context.inputs.image);
  if (!source) return;
  const { method, radius, wrapEdges } = context.props;
  await output(context, method === "gaussian" ? gaussianBlur(source, radius, wrapEdges) : boxBlur(source, radius, wrapEdges));
}

// ---------------------------------------------------------------- NormalMap

export async function executeNormalMap(context: NodeExecutionContext<typeof normalMapDefinition>): Promise<void> {
  const source = await readPlanar(context, context.inputs.image);
  if (!source) return;
  const { scale, flipX, flipY } = context.props;
  const { width, height } = source;
  const result = Planar.rgba(width, height);
  const heightMap = source.channels[0]!;
  const [rOut, gOut, bOut, aOut] = result.channels as [Float32Array, Float32Array, Float32Array, Float32Array];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const h00 = heightMap[idx]!;
      const h10 = heightMap[Math.min(x + 1, width - 1) + y * width]!;
      const h01 = heightMap[x + Math.min(y + 1, height - 1) * width]!;
      const dx = (h10 - h00) * scale;
      const dy = (h01 - h00) * scale;
      // normalize(-dx, -dy, 1), mapped from [-1, 1] to [0, 1].
      const nx = -(flipX ? -dx : dx);
      const ny = -(flipY ? -dy : dy);
      const nz = 1.0;
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
      rOut[idx] = (nx / length) * 0.5 + 0.5;
      gOut[idx] = (ny / length) * 0.5 + 0.5;
      bOut[idx] = (nz / length) * 0.5 + 0.5;
      aOut[idx] = 1.0;
    }
  }
  await output(context, result);
}

// ---------------------------------------------------------------- Resize

export async function executeResize(context: NodeExecutionContext<typeof resizeDefinition>): Promise<void> {
  const source = await readPlanar(context, context.inputs.image);
  if (!source) return;
  const { props } = context;
  const scaled = props.mode === "scale";
  const width = scaled ? Math.round(source.width * props.scale) : props.width;
  const height = scaled ? Math.round(source.height * props.scale) : props.height;
  await output(context, resample(source, width, height));
}

// ---------------------------------------------------------------- Transform

function pivotPoint(pivot: string, custom: readonly number[], width: number, height: number): [number, number] {
  switch (pivot) {
    case "top-left": return [0, 0];
    case "top-right": return [width, 0];
    case "bottom-left": return [0, height];
    case "bottom-right": return [width, height];
    case "custom": return [custom[0]! * width, custom[1]! * height];
    default: return [width / 2, height / 2];
  }
}

function wrapCoord(coord: number, size: number, mode: string): number {
  if (mode === "clamp") return Math.max(0, Math.min(size - 1, coord));
  if (mode === "repeat") {
    coord = coord % size;
    if (coord < 0) coord += size;
    return coord;
  }
  if (mode === "mirror") {
    const period = size * 2;
    coord = Math.abs(coord % period);
    if (coord >= size) coord = period - coord - 1;
    return Math.max(0, Math.min(size - 1, coord));
  }
  return coord; // transparent: checked before sampling
}

export async function executeTransform(context: NodeExecutionContext<typeof transformDefinition>): Promise<void> {
  const input = await readPlanar(context, context.inputs.image);
  if (!input) return;
  const { props } = context;
  const { width, height } = input;
  const [tx, ty] = props.translate;
  const rotation = (props.rotation * Math.PI) / 180;
  const sx = props.scale[0];
  const sy = props.uniformScale ? sx : props.scale[1];
  const [pivotX, pivotY] = pivotPoint(props.pivot, props.customPivot, width, height);
  const cosR = Math.cos(-rotation);
  const sinR = Math.sin(-rotation);
  const invSx = 1 / sx;
  const invSy = 1 / sy;
  const buffer = Planar.rgba(width, height);
  const channelCount = Math.min(input.channelCount, 4);
  const nearest = props.filter === "nearest";
  const wrap = props.wrap;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      // Destination to source: about the pivot, rotated and scaled back.
      const dx = x - pivotX - tx;
      const dy = y - pivotY - ty;
      const srcX = (dx * cosR - dy * sinR) * invSx + pivotX;
      const srcY = (dx * sinR + dy * cosR) * invSy + pivotY;
      if (wrap === "transparent" && (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height)) {
        for (let c = 0; c < 4; c++) buffer.channels[c]![idx] = 0;
        continue;
      }
      if (nearest) {
        const srcIdx = wrapCoord(Math.round(srcY), height, wrap) * width + wrapCoord(Math.round(srcX), width, wrap);
        for (let c = 0; c < channelCount; c++) buffer.channels[c]![idx] = input.channels[c]![srcIdx]!;
      } else {
        const x0 = Math.floor(srcX);
        const y0 = Math.floor(srcY);
        const fx = srcX - x0;
        const fy = srcY - y0;
        const wx0 = wrapCoord(x0, width, wrap);
        const wx1 = wrapCoord(x0 + 1, width, wrap);
        const wy0 = wrapCoord(y0, height, wrap);
        const wy1 = wrapCoord(y0 + 1, height, wrap);
        for (let c = 0; c < channelCount; c++) {
          const channel = input.channels[c]!;
          const v00 = channel[wy0 * width + wx0]!;
          const v10 = channel[wy0 * width + wx1]!;
          const v01 = channel[wy1 * width + wx0]!;
          const v11 = channel[wy1 * width + wx1]!;
          const v0 = v00 + (v10 - v00) * fx;
          const v1 = v01 + (v11 - v01) * fx;
          buffer.channels[c]![idx] = v0 + (v1 - v0) * fy;
        }
      }
      if (channelCount < 4) buffer.channels[3]![idx] = 1;
    }
  }
  await output(context, buffer);
}

// ---------------------------------------------------------------- Composite

function blend(base: Planar, layer: Planar, mode: string, opacity: number): Planar {
  const { width, height } = base;
  const result = Planar.rgba(width, height);
  const [r1, g1, b1, a1] = (base.channelCount >= 4 ? base : base.toRGBA()).channels as Float32Array[];
  const [r2, g2, b2, a2] = (layer.channelCount >= 4 ? layer : layer.toRGBA()).channels as Float32Array[];
  const [rOut, gOut, bOut, aOut] = result.channels as Float32Array[];
  for (let i = 0; i < width * height; i++) {
    const baseR = r1![i]!, baseG = g1![i]!, baseB = b1![i]!, baseA = a1![i]!;
    const blendR = r2![i]!, blendG = g2![i]!, blendB = b2![i]!, blendA = a2![i]!;
    let r: number, g: number, b: number;
    switch (mode) {
      case "normal":
        r = blendR; g = blendG; b = blendB;
        break;
      case "multiply":
        r = baseR * blendR; g = baseG * blendG; b = baseB * blendB;
        break;
      case "screen":
        r = 1 - (1 - baseR) * (1 - blendR);
        g = 1 - (1 - baseG) * (1 - blendG);
        b = 1 - (1 - baseB) * (1 - blendB);
        break;
      case "overlay":
        r = baseR < 0.5 ? 2 * baseR * blendR : 1 - 2 * (1 - baseR) * (1 - blendR);
        g = baseG < 0.5 ? 2 * baseG * blendG : 1 - 2 * (1 - baseG) * (1 - blendG);
        b = baseB < 0.5 ? 2 * baseB * blendB : 1 - 2 * (1 - baseB) * (1 - blendB);
        break;
      case "darken":
        r = Math.min(baseR, blendR); g = Math.min(baseG, blendG); b = Math.min(baseB, blendB);
        break;
      case "lighten":
        r = Math.max(baseR, blendR); g = Math.max(baseG, blendG); b = Math.max(baseB, blendB);
        break;
      case "color-dodge":
        r = blendR === 1 ? 1 : Math.min(1, baseR / (1 - blendR));
        g = blendG === 1 ? 1 : Math.min(1, baseG / (1 - blendG));
        b = blendB === 1 ? 1 : Math.min(1, baseB / (1 - blendB));
        break;
      case "color-burn":
        r = blendR === 0 ? 0 : Math.max(0, 1 - (1 - baseR) / blendR);
        g = blendG === 0 ? 0 : Math.max(0, 1 - (1 - baseG) / blendG);
        b = blendB === 0 ? 0 : Math.max(0, 1 - (1 - baseB) / blendB);
        break;
      case "hard-light":
        r = blendR < 0.5 ? 2 * baseR * blendR : 1 - 2 * (1 - baseR) * (1 - blendR);
        g = blendG < 0.5 ? 2 * baseG * blendG : 1 - 2 * (1 - baseG) * (1 - blendG);
        b = blendB < 0.5 ? 2 * baseB * blendB : 1 - 2 * (1 - baseB) * (1 - blendB);
        break;
      case "soft-light":
        r = blendR < 0.5 ? baseR - (1 - 2 * blendR) * baseR * (1 - baseR) : baseR + (2 * blendR - 1) * (Math.sqrt(baseR) - baseR);
        g = blendG < 0.5 ? baseG - (1 - 2 * blendG) * baseG * (1 - baseG) : baseG + (2 * blendG - 1) * (Math.sqrt(baseG) - baseG);
        b = blendB < 0.5 ? baseB - (1 - 2 * blendB) * baseB * (1 - baseB) : baseB + (2 * blendB - 1) * (Math.sqrt(baseB) - baseB);
        break;
      case "difference":
        r = Math.abs(baseR - blendR); g = Math.abs(baseG - blendG); b = Math.abs(baseB - blendB);
        break;
      case "exclusion":
        r = baseR + blendR - 2 * baseR * blendR;
        g = baseG + blendG - 2 * baseG * blendG;
        b = baseB + blendB - 2 * baseB * blendB;
        break;
      case "add":
      case "linear-dodge":
        r = Math.min(1, baseR + blendR); g = Math.min(1, baseG + blendG); b = Math.min(1, baseB + blendB);
        break;
      case "subtract":
        r = Math.max(0, baseR - blendR); g = Math.max(0, baseG - blendG); b = Math.max(0, baseB - blendB);
        break;
      case "divide":
        r = blendR === 0 ? 1 : Math.min(1, baseR / blendR);
        g = blendG === 0 ? 1 : Math.min(1, baseG / blendG);
        b = blendB === 0 ? 1 : Math.min(1, baseB / blendB);
        break;
      case "pin-light":
        r = blendR < 0.5 ? Math.min(baseR, 2 * blendR) : Math.max(baseR, 2 * (blendR - 0.5));
        g = blendG < 0.5 ? Math.min(baseG, 2 * blendG) : Math.max(baseG, 2 * (blendG - 0.5));
        b = blendB < 0.5 ? Math.min(baseB, 2 * blendB) : Math.max(baseB, 2 * (blendB - 0.5));
        break;
      case "vivid-light":
        r = blendR < 0.5 ? (blendR === 0 ? 0 : 1 - (1 - baseR) / (2 * blendR)) : (blendR === 1 ? 1 : baseR / (2 * (1 - blendR)));
        g = blendG < 0.5 ? (blendG === 0 ? 0 : 1 - (1 - baseG) / (2 * blendG)) : (blendG === 1 ? 1 : baseG / (2 * (1 - blendG)));
        b = blendB < 0.5 ? (blendB === 0 ? 0 : 1 - (1 - baseB) / (2 * blendB)) : (blendB === 1 ? 1 : baseB / (2 * (1 - blendB)));
        break;
      case "linear-burn":
        r = Math.max(0, baseR + blendR - 1); g = Math.max(0, baseG + blendG - 1); b = Math.max(0, baseB + blendB - 1);
        break;
      default:
        r = blendR; g = blendG; b = blendB;
    }
    rOut![i] = baseR + (r - baseR) * opacity * blendA;
    gOut![i] = baseG + (g - baseG) * opacity * blendA;
    bOut![i] = baseB + (b - baseB) * opacity * blendA;
    aOut![i] = baseA + (blendA - baseA) * opacity;
  }
  return result;
}

export async function executeComposite(context: NodeExecutionContext<typeof compositeDefinition>): Promise<void> {
  const { props } = context;
  const inputs = [await readPlanar(context, context.inputs.image1), await readPlanar(context, context.inputs.image2)];
  const { width, height } = resolveOutputSize(
    props.outputResolution as ResolutionMode,
    inputs,
    props.customResolution as readonly [number, number],
  );
  const [base, layer] = inputs.map((buffer) => {
    if (!buffer || (buffer.width === width && buffer.height === height)) return buffer;
    return resizeToFit(buffer, width, height, props.fitMode as FitMode);
  });
  if (!base || !layer) return;
  await output(context, blend(base, layer, props.blendMode, props.opacity));
}
