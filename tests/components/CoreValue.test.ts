// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import CoreValue from '@/editor/components/CoreValue.svelte';
import { CORE_TYPES } from '@/types/coreTypes';

describe('CoreValue', () => {
  it('renders a slider and numeric input for a bounded scalar parameter', async () => {
    const onChange = vi.fn();
    const { getByRole, getByLabelText } = render(CoreValue, {
      props: {
        type: 'float',
        value: 0.3,
        port: { options: { min: 0, max: 1, step: 0.01 } },
        onChange,
      },
    });

    expect(getByRole('slider')).toBeTruthy();
    await fireEvent.input(getByRole('slider'), { target: { value: '0.65' } });
    expect(onChange).toHaveBeenCalledWith(0.65);
    expect(getByLabelText('float value')).toBeTruthy();
  });

  it('renders declared parameter choices as a select', async () => {
    const onChange = vi.fn();
    const { getByRole } = render(CoreValue, {
      props: {
        type: 'string',
        value: 'off',
        port: {
          name: 'engine',
          options: {
            choices: [
              { value: 'off', label: 'Off' },
              { value: 'magnific', label: 'Magnific API' },
              { value: 'local', label: 'Local diffusion' },
            ],
          },
        },
        onChange,
      },
    });

    await fireEvent.change(getByRole('combobox'), { target: { value: 'magnific' } });
    expect(onChange).toHaveBeenCalledWith('magnific');
  });

  it('applies a declared range to every component of a vector', async () => {
    // The convention is one `vec2` rather than two floats, and until the
    // contract admitted a range on a vector that convention cost the control
    // its clamp: two floats bounded at -1..1 became a vec2 bounded at nothing.
    const onChange = vi.fn();
    const { getByLabelText } = render(CoreValue, {
      props: {
        type: 'vec2',
        value: [0, 0],
        port: { options: { min: -1, max: 1, step: 0.005 } },
        onChange,
      },
    });

    const x = getByLabelText('X') as HTMLInputElement;
    expect(x.min).toBe('-1');
    expect(x.max).toBe('1');
    expect(x.step).toBe('0.005');

    await fireEvent.change(x, { target: { value: '4' } });
    expect(onChange).toHaveBeenCalledWith([1, 0]);
  });

  it('rounds an integer vector after clamping it', async () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(CoreValue, {
      props: {
        type: 'vec2i',
        value: [0, 0],
        port: { options: { min: 16, max: 4096, step: 64 } },
        onChange,
      },
    });

    await fireEvent.change(getByLabelText('Y'), { target: { value: '9000.7' } });
    expect(onChange).toHaveBeenCalledWith([0, 4096]);
  });

  it('leaves an unbounded vector unclamped', async () => {
    // A range is a declaration, not a default. Inventing one would imply
    // limits the node never stated — the same reason a slider needs both ends.
    const onChange = vi.fn();
    const { getByLabelText } = render(CoreValue, {
      props: { type: 'vec2', value: [0, 0], onChange },
    });

    const x = getByLabelText('X') as HTMLInputElement;
    expect(x.min).toBe('');
    await fireEvent.change(x, { target: { value: '9999' } });
    expect(onChange).toHaveBeenCalledWith([9999, 0]);
  });

  it('edits vector components through the shared editor', async () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(CoreValue, {
      props: { type: 'vec3', value: [1, 2, 3], onChange },
    });

    await fireEvent.change(getByLabelText('X'), { target: { value: '4.5' } });
    expect(onChange).toHaveBeenCalledWith([4.5, 2, 3]);
  });

  it('validates structured edits before committing', async () => {
    const onChange = vi.fn();
    const { getByLabelText, getByText } = render(CoreValue, {
      props: { type: 'object', value: { count: 1 }, onChange },
    });
    const editor = getByLabelText('object JSON');

    await fireEvent.input(editor, { target: { value: '{bad json' } });
    await fireEvent.blur(editor);
    expect(getByText('Invalid JSON')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();

    await fireEvent.input(editor, { target: { value: '{"count":2}' } });
    await fireEvent.blur(editor);
    expect(onChange).toHaveBeenCalledWith({ count: 2 });
  });

  it('keeps output values read-only while exposing their structure', () => {
    const { queryByRole, getByText } = render(CoreValue, {
      props: { type: 'array', value: [{ id: 1 }], readOnly: true },
    });

    expect(queryByRole('textbox')).toBeNull();
    expect(getByText('1 items')).toBeTruthy();
  });

  it('edits the portable descriptor behind an image preview', async () => {
    const onChange = vi.fn();
    const image = { path: 'out/test.png', size: [10, 10], channels: 'rgba', depth: 'u8', space: 'srgb' };
    const { getByLabelText } = render(CoreValue, { props: { type: 'image', value: image, onChange } });
    const editor = getByLabelText('image JSON');

    await fireEvent.input(editor, { target: { value: JSON.stringify({ ...image, path: 'out/next.png' }) } });
    await fireEvent.blur(editor);
    expect(onChange).toHaveBeenCalledWith({ ...image, path: 'out/next.png' });
  });

  it('has a read-only presentation for every core type', () => {
    const values: Record<string, any> = {
      float: 1.5, int: 2, bool: true, string: 'hello',
      vec2: [1, 2], vec3: [1, 2, 3], vec4: [1, 2, 3, 4],
      vec2i: [1, 2], vec3i: [1, 2, 3], vec4i: [1, 2, 3, 4],
      mat2: [1, 0, 0, 1], mat3: [1, 0, 0, 0, 1, 0, 0, 0, 1], mat4: new Array(16).fill(0),
      image: { path: 'out/test.png', size: [10, 10], channels: 'rgba', depth: 'u8', space: 'srgb' },
      texture: { size: [10, 10], format: 'rgba8unorm' },
      points: [[0, 0], [1, 1]], lines: [[[0, 0], [1, 1]]],
      polyline: { points: [[0, 0], [1, 1]] },
      mesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] },
      rects: [[0, 0, 1, 1]], color: [1, 0, 0, 1], asset: 'assets/test.svg',
      array: [1], object: { ok: true }, any: { inferred: true },
    };

    for (const type of CORE_TYPES) {
      const { container, unmount } = render(CoreValue, { props: { type, value: values[type], readOnly: true } });
      expect(container.querySelector('.core-value')).toBeTruthy();
      unmount();
    }
  });
});
