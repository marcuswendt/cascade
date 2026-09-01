// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import NodePanel from '@/editor/NodePanel.svelte';
import { iconByModule, projectNodeModules } from '@/editor/stores/executionLocus';

describe('node selector search', () => {
  it('keeps multi-character search keys away from canvas shortcuts', async () => {
    projectNodeModules.set(['observatory-moment']);
    iconByModule.set({ 'observatory-moment': 'Aperture' });
    const canvasShortcut = vi.fn();
    window.addEventListener('keydown', canvasShortcut);
    const view = render(NodePanel, { props: { libraryId: 'all' } });
    const search = view.getByPlaceholderText('Type to search...') as HTMLInputElement;

    await fireEvent.input(search, { target: { value: 's' } });
    await fireEvent.keyDown(search, { key: 'w' });
    await fireEvent.input(search, { target: { value: 'sw' } });

    expect(canvasShortcut).not.toHaveBeenCalled();
    expect(view.getByRole('button', { name: /Switch/ })).toBeTruthy();
    await fireEvent.input(search, { target: { value: 'observatory' } });
    expect(view.getByRole('button', { name: /Observatory Moment/ })).toBeTruthy();
    window.removeEventListener('keydown', canvasShortcut);
    projectNodeModules.set([]);
    iconByModule.set({});
  });
});
