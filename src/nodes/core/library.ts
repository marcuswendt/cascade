import type { Library } from '@/editor/nodeTemplates';

/**
 * Core library definition
 * Utility nodes for data routing and manipulation
 */
export const coreLibrary: Library = {
  id: 'core',
  label: 'Core',
  icon: 'Workflow',
  categories: [
    {
      id: 'routing',
      label: 'Routing',
      nodes: [
        { name: 'Select', icon: 'GitBranch', description: 'Select one of multiple inputs by index', type: 'Select' },
        { name: 'Merge', icon: 'GitMerge', description: 'Combine multiple inputs into an array', type: 'Merge' }
      ]
    }
  ]
};
