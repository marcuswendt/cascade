/**
 * `cascade.assert.*` in Studio: the runtime's assertions through the one
 * adapter. A failed assertion is the node's error here, where under
 * `cascade run` it fails the run. `NotBlank` reads the image library's kept
 * pixels, or the asset's bytes, through the same capability.
 */
import { assertNodeRegistrations } from '../../../packages/runtime/src/builtins/assert/index.js';
import { browserAssetCapability } from '../definition/browserCapabilities.js';
import { registerDefinitionNodes } from '../definition/DefinitionNode.js';

registerDefinitionNodes(assertNodeRegistrations, { assets: browserAssetCapability });

export { assertLibrary } from './library.js';
