import type { NodeDefinition, NodeExecute } from "@cascade/contracts";

import type { DefinitionNodeRegistration } from "../../types.js";
import {
  blurDefinition,
  checkersDefinition,
  colorDefinition,
  compositeDefinition,
  contactSheetDefinition,
  imageDefinition,
  noiseDefinition,
  normalMapDefinition,
  rampDefinition,
  resizeDefinition,
  textDefinition,
  transformDefinition,
} from "./definitions.js";

/**
 * `cascade.image.*`: the image library, in every host.
 *
 * Eleven nodes were Studio classes over `ImageNodeBase` until 2026-11-07, when
 * Marcus decided to port them (round 1 decision 4); the twelfth, the contact
 * sheet, was the first definition-v1 node here. The declarations are literal
 * and small, because this list sits in Studio's first-paint bundle with every
 * other built-in; each body loads behind a dynamic import the first time a node
 * of that kind cooks, so Studio pays for a node's pixel loop only when a graph
 * uses it. (`cascade ladder` imports the contact sheet's layout and drawing
 * from `contactSheet.ts` directly, for the same reason.)
 */
export * from "./definitions.js";

function lazy<D extends NodeDefinition>(
  name: string,
  definition: D,
  load: () => Promise<NodeExecute<D>>,
): DefinitionNodeRegistration<D> {
  return { kind: "definition-v1", moduleId: `cascade.image.${name}`, definition, loadExecute: load };
}

export const contactSheetRegistration = lazy("ContactSheet", contactSheetDefinition, async () => (await import("./contactSheet.js")).executeContactSheet);
export const colorRegistration = lazy("Color", colorDefinition, async () => (await import("./generators.js")).executeColor);
export const checkersRegistration = lazy("Checkers", checkersDefinition, async () => (await import("./generators.js")).executeCheckers);
export const noiseRegistration = lazy("Noise", noiseDefinition, async () => (await import("./generators.js")).executeNoise);
export const rampRegistration = lazy("Ramp", rampDefinition, async () => (await import("./generators.js")).executeRamp);
export const textRegistration = lazy("Text", textDefinition, async () => (await import("./text.js")).executeText);
export const imageRegistration = lazy("Image", imageDefinition, async () => (await import("./file.js")).executeImage);
export const blurRegistration = lazy("Blur", blurDefinition, async () => (await import("./filters.js")).executeBlur);
export const normalMapRegistration = lazy("NormalMap", normalMapDefinition, async () => (await import("./filters.js")).executeNormalMap);
export const resizeRegistration = lazy("Resize", resizeDefinition, async () => (await import("./filters.js")).executeResize);
export const transformRegistration = lazy("Transform", transformDefinition, async () => (await import("./filters.js")).executeTransform);
export const compositeRegistration = lazy("Composite", compositeDefinition, async () => (await import("./filters.js")).executeComposite);

export const imageNodeRegistrations: readonly DefinitionNodeRegistration[] =
  Object.freeze([
    colorRegistration,
    checkersRegistration,
    noiseRegistration,
    rampRegistration,
    textRegistration,
    imageRegistration,
    blurRegistration,
    normalMapRegistration,
    resizeRegistration,
    transformRegistration,
    compositeRegistration,
    contactSheetRegistration,
  ] as DefinitionNodeRegistration[]);
