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

  it('scales the transcript and the prompt, and not the toolbar', () => {
    // A bar that grew with the type size would shove the transcript around on
    // every zoom step, which is the opposite of what reading larger is for.
    expect(ruleBody('.transcript {')).toMatch(/font-size:\s*calc\(12px \* var\(--agent-zoom/);
    expect(ruleBody('.composer textarea {')).toMatch(/font-size:\s*calc\(12px \* var\(--agent-zoom/);
    expect(ruleBody('.bar {')).not.toMatch(/--agent-zoom/);
  });
});
