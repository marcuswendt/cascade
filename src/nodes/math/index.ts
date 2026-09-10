/**
 * The `cascade.math.*` nodes, registered for Studio.
 *
 * Same shape as `geo/index.ts` and `pop/index.ts`: the definitions live in
 * `packages/runtime` and reach the class-based graph through the one adapter.
 * No capabilities — arithmetic touches nothing outside itself.
 */
import { mathNodeRegistrations } from '../../../packages/runtime/src/builtins/math/index.js';
import { registerDefinitionNodes } from '../definition/DefinitionNode.js';

registerDefinitionNodes(mathNodeRegistrations, {});
