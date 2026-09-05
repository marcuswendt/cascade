import { geoNodeDefinitions } from '../../../packages/runtime/src/builtins/geo/definitions.js';
import type { Library } from '../../types/library.types.js';

export const geoLibrary: Library = {
  id: 'geo',
  label: 'Geometry',
  icon: 'Shapes',
  categories: [{
    id: 'geometry',
    label: 'Geometry',
    nodes: geoNodeDefinitions.map(([moduleId, definition]) => ({
      name: definition.label ?? moduleId.split('.').pop()!,
      icon: definition.icon ?? 'Shapes',
      description: definition.description ?? '',
      type: moduleId,
    })),
  }],
};
