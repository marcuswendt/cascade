import { popNodeDefinitions } from '../../../packages/runtime/src/builtins/pop/definitions.js';
import type { Library } from '../../types/library.types.js';

/** Its own library rather than a category inside Geometry, even though POP
 *  speaks the `geometry` type: the palette is how a person finds a node, and
 *  someone looking for a solver is not looking under shapes. */
export const popLibrary: Library = {
  id: 'pop',
  label: 'Particles',
  icon: 'Sparkles',
  categories: [{
    id: 'pop',
    label: 'Particles',
    nodes: popNodeDefinitions.map(([moduleId, definition]) => ({
      name: definition.label ?? moduleId.split('.').pop()!,
      icon: definition.icon ?? 'Sparkles',
      description: definition.description ?? '',
      type: moduleId,
    })),
  }],
};
