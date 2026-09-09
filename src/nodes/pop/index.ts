import { popNodeRegistrations } from '../../../packages/runtime/src/builtins/pop/index.js';
import { registerDefinitionNodes } from '../definition/DefinitionNode.js';

// Registered with no capabilities: every POP node is `portable` and pure
// arithmetic over geometry, which is the property that lets the same node cook
// in Studio and under `cascade run --frames` with nothing swapped.
registerDefinitionNodes(popNodeRegistrations, {});

export { popLibrary } from './library.js';
