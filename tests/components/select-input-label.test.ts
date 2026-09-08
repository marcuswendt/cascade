// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import SelectInput from '@/editor/components/SelectInput.svelte';

/**
 * The Inspector puts a `<label for=...>` beside every parameter and passes the
 * same id to the control. SelectInput declared that id and never applied it, so
 * for every select-shaped parameter the label pointed at nothing: clicking it
 * did not reach the control and a screen reader read no association.
 *
 * `svelte-check` called it an unused export, and the suggested fix — `export
 * const` — would have silenced the warning and kept the bug. This is the test
 * that would have caught it, and it fails against the previous version.
 */
describe('SelectInput', () => {
  const prop = {
    name: 'mode',
    value: 'solid',
    params: { options: [{ value: 'solid', label: 'Solid' }, { value: 'outline', label: 'Outline' }] },
  } as any;

  it('applies the id it is given, so a label can point at it', () => {
    const { container } = render(SelectInput, {
      props: { prop, id: 'prop-node1-mode-main', onValueChange: vi.fn() },
    });

    const button = container.querySelector('button.select-button');
    expect(button?.id).toBe('prop-node1-mode-main');
    // The association a screen reader actually follows.
    const label = document.createElement('label');
    label.setAttribute('for', 'prop-node1-mode-main');
    document.body.append(label, container);
    expect(document.getElementById(label.getAttribute('for')!)).toBe(button);
  });

  it('renders without an id, because not every caller has one', () => {
    const { container } = render(SelectInput, {
      props: { prop, onValueChange: vi.fn() },
    });

    const button = container.querySelector('button.select-button');
    expect(button).toBeTruthy();
    expect(button?.getAttribute('id')).toBeNull();
  });
});
