import type { Library } from '@/types/library.types';

/**
 * Core library definition
 * Utility nodes for data routing, network organization, and manipulation
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
    },
    {
      id: 'network',
      label: 'Network',
      nodes: [
        { name: 'Subnet', icon: 'Folder', description: 'Network container for organizing nodes', type: 'Subnet' },
        { name: 'Input', icon: 'LogIn', description: 'External input to a subnet', type: 'Input' },
        { name: 'Output', icon: 'LogOut', description: 'Defines subnet output', type: 'Output' }
      ]
    }
  ]
};
