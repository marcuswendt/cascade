/**
 * The image library in Studio: `cascade.image.*`, the runtime's definition-v1
 * built-ins (packages/runtime/src/builtins/image), through the one adapter.
 *
 * They get the asset capability with `keepImage`, so an image passes from
 * node to node as pixels held in the page (../definition/studioImages.ts)
 * rather than as a file each cook writes and the next one fetches.
 */
import { imageNodeRegistrations } from '../../../packages/runtime/src/builtins/image/index.js';
import { studioImageAssetCapability } from '../definition/browserCapabilities.js';
import { registerDefinitionNodes } from '../definition/DefinitionNode.js';

registerDefinitionNodes(imageNodeRegistrations, { assets: studioImageAssetCapability });

export { imageLibrary } from './library.js';
