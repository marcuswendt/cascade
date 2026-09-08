// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import AgentPanel from '@/editor/panels/AgentPanel.svelte';

/**
 * The drop half of dragging a node or a parameter into the agent console.
 *
 * What this file can and cannot prove: jsdom performs no native HTML5 drag, so
 * nothing here shows that a browser starts one or routes it to this panel —
 * that was checked in Chrome over CDP instead. These are the decisions the
 * handlers make once the events arrive: which drags the console claims, whether
 * the affordance survives the drag, and where the text lands.
 */

/** jsdom has no DataTransfer, and fireEvent will not invent one. */
function fakeDataTransfer(types: string[] = ['text/plain'], text = 'TRANSFORM/tx') {
  const store = new Map<string, string>([['text/plain', text]]);
  return {
    types,
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: (format: string, value: string) => void store.set(format, value),
    getData: (format: string) => store.get(format) ?? '',
  };
}

function mount() {
  const view = render(AgentPanel, {
    props: { panelId: 'agent', panelParams: {} as never },
  });
  const console_ = view.container.querySelector('.console') as HTMLElement;
  expect(console_).toBeTruthy();
  // jsdom lays nothing out, so the box the leave handler compares against has
  // to be stated. 100..400 on both axes.
  console_.getBoundingClientRect = () =>
    ({ left: 100, right: 400, top: 100, bottom: 400, x: 100, y: 100, width: 300, height: 300 }) as DOMRect;
  return { view, console_ };
}

afterEach(() => vi.restoreAllMocks());

describe('the agent console as a drop target', () => {
  it('claims a text drag and asks for a copy', async () => {
    const { console_ } = mount();
    const dataTransfer = fakeDataTransfer();
    const event = new Event('dragover', { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer, clientX: 200, clientY: 200 });
    console_.dispatchEvent(event);
    await tick();
    expect(event.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe('copy');
    expect(console_.classList.contains('drop-active')).toBe(true);
  });

  it('leaves a file drag alone, so a file dropped on the panel is not eaten', async () => {
    const { console_ } = mount();
    const event = new Event('dragover', { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer: fakeDataTransfer(['Files', 'text/plain']) });
    console_.dispatchEvent(event);
    await tick();
    expect(event.defaultPrevented).toBe(false);
    expect(console_.classList.contains('drop-active')).toBe(false);
  });

  it('keeps the highlight while the drag crosses its own children', async () => {
    // `dragleave` bubbles, so the bar/transcript/composer boundaries each raise
    // one at the console while the pointer is still inside it. Clearing on
    // those made a working drop look refused all the way to the prompt.
    const { console_ } = mount();
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    Object.assign(over, { dataTransfer: fakeDataTransfer() });
    console_.dispatchEvent(over);
    await tick();
    expect(console_.classList.contains('drop-active')).toBe(true);

    const leave = new Event('dragleave', { bubbles: true });
    Object.assign(leave, { clientX: 250, clientY: 250 });
    console_.dispatchEvent(leave);
    await tick();
    expect(console_.classList.contains('drop-active')).toBe(true);
  });

  it('drops the highlight when the pointer really leaves', async () => {
    const { console_ } = mount();
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    Object.assign(over, { dataTransfer: fakeDataTransfer() });
    console_.dispatchEvent(over);
    await tick();

    const leave = new Event('dragleave', { bubbles: true });
    Object.assign(leave, { clientX: 20, clientY: 20 });
    console_.dispatchEvent(leave);
    await tick();
    expect(console_.classList.contains('drop-active')).toBe(false);
  });

  it('inserts the dropped path into the prompt at the caret', async () => {
    const { view, console_ } = mount();
    const input = view.container.querySelector('.composer textarea') as HTMLTextAreaElement;
    await fireEvent.input(input, { target: { value: 'scale ' } });
    input.setSelectionRange(6, 6);

    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(drop, { dataTransfer: fakeDataTransfer(['text/plain'], 'TRANSFORM/tx') });
    console_.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(input.value).toBe('scale TRANSFORM/tx');
  });

  it('spaces the path off a word already typed', async () => {
    const { view, console_ } = mount();
    const input = view.container.querySelector('.composer textarea') as HTMLTextAreaElement;
    await fireEvent.input(input, { target: { value: 'scale' } });
    input.setSelectionRange(5, 5);

    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(drop, { dataTransfer: fakeDataTransfer(['text/plain'], 'TRANSFORM/tx') });
    console_.dispatchEvent(drop);
    await new Promise((r) => setTimeout(r, 0));
    expect(input.value).toBe('scale TRANSFORM/tx');
  });
});
