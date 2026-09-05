// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import CustomNodeDialog from '@/editor/CustomNodeDialog.svelte';
import GraphTabs from '@/editor/GraphTabs.svelte';
import Splitter from '@/editor/Splitter.svelte';
import Tabs from '@/editor/Tabs.svelte';
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

  it('selects a tab with the keyboard', async () => {
    const selected = vi.fn();
    const view = render(Tabs, {
      props: {
        tabs: [{ id: 'graph', type: 'graph', label: 'Graph', windowId: 'main' }],
        activeTabId: null,
      },
      events: { tabSelect: selected },
    } as never);

    await fireEvent.keyDown(view.getByRole('tab', { name: 'Graph' }), { key: 'Enter' });

    expect(selected).toHaveBeenCalledWith(expect.objectContaining({ detail: { tabId: 'graph' } }));
  });

  it('uses roving focus and keeps close actions outside tabs', async () => {
    const selected = vi.fn();
    const view = render(Tabs, {
      props: {
        tabs: [
          { id: 'one', type: 'editor', label: 'One', windowId: 'main' },
          { id: 'two', type: 'editor', label: 'Two', windowId: 'main' },
        ],
        activeTabId: 'one',
      },
      events: { tabSelect: selected },
    } as never);
    const [first, second] = view.getAllByRole('tab');

    expect(view.getByRole('tablist', { name: 'Open views' })).toBeTruthy();
    expect(first.getAttribute('tabindex')).toBe('0');
    expect(second.getAttribute('tabindex')).toBe('-1');
    expect(first.contains(view.getAllByRole('button', { name: 'Close tab' })[0])).toBe(false);

    first.focus();
    await fireEvent.keyDown(first, { key: 'ArrowRight' });

    expect(document.activeElement).toBe(second);
    expect(selected).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { tabId: 'two' } }));
  });

  it('includes the document and editor views in GraphTabs keyboard navigation', async () => {
    const selected = vi.fn();
    const view = render(GraphTabs, {
      props: {
        tabs: [
          { id: 'graph', type: 'graph', label: 'Graph', windowId: 'main' },
          { id: 'editor', type: 'editor', label: 'Editor', windowId: 'main' },
        ],
        activeTabId: 'graph',
        documentName: 'Sketch',
      },
      events: { tabSelect: selected },
    } as never);
    const [documentTab, editorTab] = view.getAllByRole('tab');

    expect(documentTab.textContent).toContain('Sketch');
    expect(documentTab.contains(view.getByRole('button', { name: 'Close tab' }))).toBe(false);
    await fireEvent.keyDown(documentTab, { key: 'ArrowRight' });

    expect(document.activeElement).toBe(editorTab);
    expect(selected).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { tabId: 'editor' } }));
  });

  it('resizes a splitter with arrow keys', async () => {
    const resized = vi.fn();
    const view = render(Splitter, {
      props: { splitterId: 'main', direction: 'vertical' },
      events: { resize: resized },
    } as never);

    const separator = view.getByRole('separator');
    expect(separator.hasAttribute('aria-valuemin')).toBe(false);
    expect(separator.hasAttribute('aria-valuemax')).toBe(false);
    expect(separator.hasAttribute('aria-valuenow')).toBe(false);

    await fireEvent.keyDown(separator, { key: 'ArrowRight' });

    expect(resized).toHaveBeenCalledWith(expect.objectContaining({
      detail: { splitterId: 'main', delta: 10, direction: 'vertical' },
    }));
  });
});
