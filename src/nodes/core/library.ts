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
        { name: 'Switch', icon: 'GitBranch', description: 'Switch between multiple inputs by index', type: 'Switch' },
        { name: 'Merge', icon: 'GitMerge', description: 'Combine multiple inputs into an array', type: 'Merge' },
        { name: 'Null', icon: 'Circle', description: 'Pass an input through unchanged', type: 'Null' }
      ]
    },
    {
      id: 'utility',
      label: 'Utility',
      nodes: [
        { name: 'Random', icon: 'Dice5', description: 'Generate a deterministic value from a seed', type: 'Random' },
        { name: 'Remap', icon: 'ArrowRightLeft', description: 'Map a number from one range into another', type: 'Remap' },
        { name: 'Select', icon: 'ListFilter', description: 'Pick an item from an array by index', type: 'Select' },
        { name: 'Freeze', icon: 'Snowflake', description: 'Capture and lock a value', type: 'Freeze' }
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
