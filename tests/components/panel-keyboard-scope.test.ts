// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import { keyboardScope, ownsKeyboard } from '@/editor/panelScope';

/**
 * Panel shortcuts are bound on `window`, which is the only way to catch a key
 * while nothing inside a panel has focus, and the cost is that every listener
 * hears every key. The graph canvas zoomed on a bare `+` regardless of which
 * panel the pointer was over, and once the agent console claimed the cmd forms
 * as well, a single keystroke moved two panels.
 *
 * jsdom never reports `:hover`, so the hover branch cannot be tested here —
 * these cover the focus branch and the fallback, which are the two that decide
 * whether a key is swallowed or doubled.
 */
function scoped(name: string): HTMLElement {
  const el = document.createElement('div');
  el.dataset.panelScope = name;
  const input = document.createElement('textarea');
  el.appendChild(input);
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('panel keyboard scope', () => {
  it('is nobody when no panel is marked', () => {
    expect(keyboardScope()).toBeNull();
  });

  it('gives every panel the keys when nothing is hovered or focused', () => {
    // The fallback matters: without it, marking one panel with a scope would
    // disable every shortcut in Studio the moment the pointer sat in a gap.
    scoped('graph');
    scoped('agent');
    expect(ownsKeyboard('graph')).toBe(true);
    expect(ownsKeyboard('agent')).toBe(true);
  });

  it('follows focus into a panel, and excludes the others', () => {
    const graph = scoped('graph');
    const agent = scoped('agent');
    (agent.firstElementChild as HTMLTextAreaElement).focus();

    expect(keyboardScope()).toBe('agent');
    expect(ownsKeyboard('agent')).toBe(true);
    // The whole point: the graph must stand down rather than zoom as well.
    expect(ownsKeyboard('graph')).toBe(false);

    (graph.firstElementChild as HTMLTextAreaElement).focus();
    expect(ownsKeyboard('graph')).toBe(true);
    expect(ownsKeyboard('agent')).toBe(false);
  });

  it('resolves a nested scope to the inner one', () => {
    const outer = scoped('graph');
    const inner = document.createElement('div');
    inner.dataset.panelScope = 'agent';
    const field = document.createElement('textarea');
    inner.appendChild(field);
    outer.appendChild(inner);
    field.focus();
    expect(keyboardScope()).toBe('agent');
  });
});
