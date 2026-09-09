// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import CustomNodeDialog from '@/editor/CustomNodeDialog.svelte';
import ColorRampEditor from '@/editor/components/ColorRampEditor.svelte';

describe('keyboard UI interactions', () => {
  it('closes a dialog when Escape starts from a focused inner control', async () => {
    const closed = vi.fn();
    const view = render(CustomNodeDialog, {
      props: { open: true },
      events: { close: closed },
    } as never);
    const nameInput = view.getByRole('textbox', { name: 'Node Name' });
    nameInput.focus();

    await fireEvent.keyDown(nameInput, { key: 'Escape' });

    expect(closed).toHaveBeenCalledOnce();
  });

  it('closes the color ramp picker when Escape starts inside the picker', async () => {
    const context = new Proxy<Record<string, unknown>>({
      clearRect: vi.fn(),
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4), width, height,
      }),
      putImageData: vi.fn(),
    }, {
      get(target, property: string) {
        if (!(property in target)) target[property] = vi.fn();
        return target[property];
      },
    });
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as never);
    const view = render(ColorRampEditor, {
      props: {
        id: 'ramp',
        prop: {
          type: 'ramp',
          value: [
            { position: 0, color: '#000000', interpolation: 'linear' },
            { position: 1, color: '#ffffff', interpolation: 'linear' },
          ],
        },
        onValueChange: vi.fn(),
      },
    } as never);

    await fireEvent.click(view.getAllByRole('button', { name: /Edit color stop/ })[0]);
    const picker = view.getByRole('dialog', { name: 'Edit color stop' });
    await fireEvent.keyDown(picker.querySelector('input') ?? picker, { key: 'Escape' });

    expect(view.queryByRole('dialog', { name: 'Edit color stop' })).toBeNull();
    getContext.mockRestore();
  });

});
