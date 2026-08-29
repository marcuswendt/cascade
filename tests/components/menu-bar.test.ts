// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import MenuBar from '@/editor/MenuBar.svelte';

describe('MenuBar', () => {
  it('exposes browser file actions and project settings', async () => {
    const { getByRole, getByText } = render(MenuBar, {
      props: { documentName: 'Artwork' },
    });

    await fireEvent.click(getByRole('button', { name: 'File' }));

    expect(getByText('⌥N')).toBeTruthy();
    expect(getByText('⌥O')).toBeTruthy();
    expect(getByText('⌥S')).toBeTruthy();

    expect(getByRole('button', { name: /Project Settings/ })).toBeTruthy();
  });
});
