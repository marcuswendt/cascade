import type { NodeExecutionContext } from "@cascade/contracts";

import type { imageDefinition } from "./definitions.js";
import { imageReference, output, readPlanar } from "./io.js";
import { resample } from "./planar.js";

/**
 * `cascade.image.Image` (labelled File): a project image, or the image wired
 * into it, at its own size, within a maximum, or at a fixed size.
 */
export async function executeImage(context: NodeExecutionContext<typeof imageDefinition>): Promise<void> {
  const { props } = context;
  const source = await readPlanar(context, imageReference(context.inputs.image) ?? imageReference(props.file));
  if (!source) return;
  if (props.resolutionMode === "original") {
    await output(context, source);
    return;
  }
  if (props.resolutionMode === "max") {
    const [maxWidth, maxHeight] = props.maxResolution;
    const aspect = source.width / source.height;
    let width = source.width;
    let height = source.height;
    if (width > maxWidth) {
      width = maxWidth;
      height = maxWidth / aspect;
    }
    if (height > maxHeight) {
      height = maxHeight;
      width = maxHeight * aspect;
    }
    width = Math.round(width);
    height = Math.round(height);
    await output(context, width !== source.width || height !== source.height ? resample(source, width, height) : source);
    return;
  }
  const [width, height] = props.fixedResolution;
  await output(context, resample(source, width, height));
}
