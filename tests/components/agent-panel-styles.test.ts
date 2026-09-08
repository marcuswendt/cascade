import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A source-level guard, in the same idiom as the slider test, for a mistake
 * that has no runtime symptom a test could catch: the panel's chrome shares one
 * CSS rule between the agent picker, the bar buttons and the send button, and
 * giving the send button its square sizing inside that shared rule sized all
 * three. The picker clipped to a single letter and Reset overflowed its box.
 *
 * jsdom applies no stylesheet, so rendering the component proves nothing here.
 * Reading the rule is the only check available.
 */
const source = readFileSync('src/editor/panels/AgentPanel.svelte', 'utf-8');

/** The body of the first CSS rule whose selector list matches. */
function ruleBody(selector: string): string {
  const at = source.indexOf(selector);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  const open = source.indexOf('{', at);
  const close = source.indexOf('}', open);
  return source.slice(open + 1, close);
}

describe('agent panel chrome', () => {
  it('keeps the square sizing off the shared bar rule', () => {
    const shared = ruleBody('.bar select,\n  .bar button,\n  .send {');
    expect(shared).not.toMatch(/width:\s*\d/);
    expect(shared).not.toMatch(/height:\s*\d/);
    // The shared rule is for the shared look only.
    expect(shared).toMatch(/background:/);
  });

  it('gives the send button its own square rule', () => {
    // Searched from past the shared rule's closing brace — its own selector
    // list ends in `.send {`, so a naive search finds the shared rule again.
    const sharedAt = source.indexOf('.bar select,');
    const afterShared = source.indexOf('}', source.indexOf('{', sharedAt));
    const at = source.indexOf('.send {', afterShared);
    const body = source.slice(source.indexOf('{', at) + 1, source.indexOf('}', at));
    expect(body).toMatch(/width:\s*30px/);
    expect(body).toMatch(/height:\s*30px/);
  });

  /** Every rule from `.entry.markdown` to the end of the stylesheet. */
  function markdownBlock(): string {
    const at = source.indexOf('.entry.markdown {');
    expect(at, 'no markdown rules').toBeGreaterThan(-1);
    return source.slice(at, source.lastIndexOf('</style>'));
  }

  it('sets no font size in px on rendered markdown, so the zoom still reaches it', () => {
    // The transcript scales with `calc(12px * var(--agent-zoom))`. A px size
    // anywhere inside would pin that content at one size, and it is exactly
    // the content people enlarge.
    expect(markdownBlock()).not.toMatch(/font-size:\s*[\d.]+px/);
  });

  it('uses theme variables and no literal colours in rendered markdown', () => {
    // The panel is read light and dark.
    const block = markdownBlock();
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/\brgba?\(/);
    expect(block).toMatch(/var\(--text-bright\)/);
    expect(block).toMatch(/var\(--surface-raised\)/);
  });

  it('scrolls wide code and tables inside their own box', () => {
    // A docked agent panel is narrow, so a long shell line or a five-column
    // table is the common case. Widening the panel would push the composer
    // off screen.
    expect(ruleBody('.entry.markdown :global(pre) {')).toMatch(/overflow-x:\s*auto/);
    const table = ruleBody('.entry.markdown :global(table) {');
    expect(table).toMatch(/overflow-x:\s*auto/);
    expect(table).toMatch(/max-width:\s*100%/);
    // The cells are what force the overflow. Measured in Chrome: with
    // wrapping cells the table shrank to the panel width rather than
    // scrolling, and `.entry`'s break-word then split a header mid-word.
    const cells = ruleBody('.entry.markdown :global(th),\n  .entry.markdown :global(td) {');
    expect(cells).toMatch(/white-space:\s*nowrap/);
    expect(cells).toMatch(/word-break:\s*normal/);
  });

  it('drops the literal branch\'s pre-wrap on rendered markdown', () => {
    // `.entry` sets pre-wrap for the unrendered kinds; on top of block margins
    // it doubles every blank line.
    expect(ruleBody('.entry.markdown {')).toMatch(/white-space:\s*normal/);
    expect(ruleBody('.entry.markdown :global(pre) {')).toMatch(/white-space:\s*pre/);
  });

  it('scales the transcript and the prompt, and not the toolbar', () => {
    // A bar that grew with the type size would shove the transcript around on
    // every zoom step, which is the opposite of what reading larger is for.
    expect(ruleBody('.transcript {')).toMatch(/font-size:\s*calc\(12px \* var\(--agent-zoom/);
    expect(ruleBody('.composer textarea {')).toMatch(/font-size:\s*calc\(12px \* var\(--agent-zoom/);
    expect(ruleBody('.bar {')).not.toMatch(/--agent-zoom/);
  });
});
