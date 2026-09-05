import { geoNodeRegistrations } from '../../../packages/runtime/src/builtins/geo/index.js';
import { browserAssetCapability } from '../definition/browserCapabilities.js';
import { registerDefinitionNodes } from '../definition/DefinitionNode.js';

registerDefinitionNodes(geoNodeRegistrations, { assets: browserAssetCapability });

export { geoLibrary } from './library.js';
