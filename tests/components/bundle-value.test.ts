// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import CoreValue from '@/editor/components/CoreValue.svelte';
import { bundleFacts, bundleFieldRows, declaredBundleFields } from '@/editor/components/typePresentation';
import { typeColor } from '@/types/coreTypes';

const declared = {
  size_mm: 'vec2',
  dpi: { type: 'float', description: 'dots per inch' },
  preview: 'image',
};

const value = {
  size_mm: [382, 256],
  dpi: 300,
  extra: 'loose',
};

describe('bundle presentation', () => {
  it('lists declared fields in order, marks the unset one, then the extras', () => {
    expect(bundleFieldRows(value, declared).map(row => [row.name, row.type, row.present, row.declared])).toEqual([
      ['size_mm', 'vec2', true, true],
      ['dpi', 'float', true, true],
      ['preview', 'image', false, true],
      ['extra', 'string', true, false],
    ]);
  });

  it('writes one tooltip line per field with its value', () => {
    expect(bundleFacts(value, declared)).toEqual([
      'size_mm vec2 = [382, 256]',
      'dpi float = 300',
      'preview image',
      'extra string = loose',
    ]);
    expect(bundleFacts(undefined, null)).toEqual(['not cooked yet']);
  });

  it('reads the producer\'s declaration through a wired input', () => {
    const upstreamPort = { options: { bundleFields: declared } };
    const node = { graph: { getNode: () => ({ getPort: () => upstreamPort }) } };
    const input = { options: {}, connections: [{ from: { nodeId: 'format', portId: 'format_out_0' } }] };
    expect(declaredBundleFields(input, node)).toBe(declared);
  });

  it('shows the fields in the Inspector, each through its own renderer', () => {
    const { getByTestId, getByText } = render(CoreValue, {
      props: {
        type: 'bundle',
        value,
        port: { dataType: 'bundle', options: { schema: 'format', bundleFields: declared } },
        mode: 'inspect',
        readOnly: true,
      },
    });
    const bundle = getByTestId('bundle-value');
    expect(bundle.textContent).toContain('bundle · format · 4 fields');
    expect(getByText('size_mm')).toBeTruthy();
    expect(getByText('not set')).toBeTruthy();
    // Each field goes through CoreValue with its own type.
    const types = [...bundle.querySelectorAll('.core-value')].map(item => item.getAttribute('data-type'));
    expect(types).toEqual(['vec2', 'float', 'string']);
  });

  it('draws bundle ports and wires in the neutral colour', () => {
    expect(typeColor('bundle')).toBe(typeColor('any'));
  });
});
