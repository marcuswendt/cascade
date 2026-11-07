import type { Library } from '@/types/library.types';

/** The node picker's entry for `cascade.assert.*`. */
export const assertLibrary: Library = {
  id: 'assert',
  label: 'Assert',
  icon: 'ShieldCheck',
  categories: [
    {
      id: 'check',
      label: 'Check',
      nodes: [
        { name: 'Assert Not Blank', icon: 'ShieldCheck', description: 'Fail when an image is one flat colour or fully transparent', type: 'NotBlank' },
        { name: 'Assert Range', icon: 'ShieldCheck', description: 'Fail unless a number is in [min, max]', type: 'Range' },
        { name: 'Assert Equals', icon: 'ShieldCheck', description: 'Fail unless a value equals the expected one', type: 'Equals' },
        { name: 'Assert True', icon: 'ShieldCheck', description: 'Fail unless a condition is true', type: 'True' }
      ]
    }
  ]
};
