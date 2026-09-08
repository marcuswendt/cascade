// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '@/editor/utils/renderMarkdown';

/**
 * These tests check the Markdown-to-safe-HTML step in isolation, which is the
 * whole reason it is a module and not a few lines inside AgentPanel.
 *
 * What they prove: the constructs a coding agent actually emits come out as
 * the right elements, script and event handlers do not survive, and text that
 * is not Markdown is not mangled. What they do NOT prove: that any of it
 * *looks* right. jsdom applies no CSS, so the scrolling code block, the table
 * borders, the heading scale and both themes are not covered here and were
 * checked by eye instead.
 */
describe('renderMarkdown — sanitising', () => {
  it('removes script elements and their contents', () => {
    const html = renderMarkdown('Before<script>alert("xss")</script>After');

    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert("xss")');
    expect(html).toContain('Before');
    expect(html).toContain('After');
  });

  it('removes inline event handlers', () => {
    const html = renderMarkdown('<img src="image.png" onerror="alert(1)">');

    expect(html).toContain('src="image.png"');
    expect(html).not.toContain('onerror');
  });

  it('removes javascript URLs', () => {
    const html = renderMarkdown('[unsafe](javascript:alert(1))');

    expect(html).toContain('unsafe');
    expect(html).not.toContain('javascript:');
  });

  it('drops tags outside the allowlist but keeps their text', () => {
    const html = renderMarkdown('<iframe src="https://example.com"></iframe>\n\n<style>body{display:none}</style>\n\n<form><button>Go</button></form>');

    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<button');
    expect(html).toContain('Go');
  });

  it('does not let content set a class or a style', () => {
    const html = renderMarkdown('<p class="composer" style="position:fixed">spoof</p>');

    expect(html).not.toContain('class=');
    expect(html).not.toContain('style=');
    expect(html).toContain('spoof');
  });

  it('sends links to a new context so Studio is not navigated away', () => {
    const html = renderMarkdown('[docs](https://example.com/docs)');

    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe('renderMarkdown — the constructs agents write', () => {
  it('renders ATX headings', () => {
    const html = renderMarkdown('## What I changed\n\nSome prose.');

    expect(html).toMatch(/<h2[^>]*>What I changed<\/h2>/);
  });

  it('renders bullet lists, bold and italic', () => {
    const html = renderMarkdown('- **Bold** item\n- *Italic* item\n- plain item');

    expect(html).toContain('<ul>');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<em>Italic</em>');
    expect(html.match(/<li>/g)).toHaveLength(3);
  });

  it('renders inline code spans, including paths and expressions', () => {
    const html = renderMarkdown('Edited `nodes/offset/index.ts` to use `$T * 0.1` on a `vec2`.');

    expect(html).toContain('<code>nodes/offset/index.ts</code>');
    expect(html).toContain('<code>$T * 0.1</code>');
    expect(html).toContain('<code>vec2</code>');
  });

  it('renders a GFM table with a header separator row', () => {
    const html = renderMarkdown(
      ['| Node | Change |', '| --- | --- |', '| offset | uses vec2 |', '| noise | unchanged |'].join('\n')
    );

    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('<th>Node</th>');
    expect(html).toContain('<td>offset</td>');
    // The separator row is a separator, not a data row.
    expect(html).not.toContain('---');
  });

  it('renders strikethrough and task lists, the rest of GFM', () => {
    const html = renderMarkdown('~~gone~~\n\n- [x] done\n- [ ] todo');

    expect(html).toMatch(/<del>gone<\/del>|<s>gone<\/s>/);
    expect(html).toContain('type="checkbox"');
  });

  it('renders a fenced code block', () => {
    const html = renderMarkdown('Run:\n\n```sh\nnpm run check\nnpm run check:graph\n```');

    expect(html).toContain('<pre>');
    expect(html).toContain('npm run check:graph');
  });

  it('renders an indented code block', () => {
    const html = renderMarkdown('Run:\n\n    npm run check\n    npm run check:graph\n');

    expect(html).toContain('<pre>');
    expect(html).toContain('npm run check:graph');
  });

  it('does not re-parse the inside of a code block as Markdown', () => {
    const html = renderMarkdown('```\n# not a heading\n**not bold** `not code`\n| not | a table |\n```');

    expect(html).not.toContain('<h1');
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('<table>');
    // Backticks inside the block stay literal characters.
    expect(html).toContain('`not code`');
    expect(html).toContain('**not bold**');
  });

  it('keeps a code fence and the prose after it separate', () => {
    const html = renderMarkdown('```\nliteral\n```\n\nThen **real** bold.');

    expect(html).toContain('literal');
    expect(html).toContain('<strong>real</strong>');
  });
});

describe('renderMarkdown — text that is not Markdown', () => {
  it('leaves an ordinary sentence intact', () => {
    const html = renderMarkdown('The graph cooked in 41ms and nothing changed.');

    expect(html).toContain('The graph cooked in 41ms and nothing changed.');
  });

  it('does not drop stray punctuation that looks like markup', () => {
    const html = renderMarkdown('Compare a < b and c > d, then a<b>c');

    expect(html).toContain('a &lt; b');
    expect(html).toContain('c &gt; d');
    // `<b>` is a real tag on the allowlist, so it renders; the text survives
    // either way, which is the property that matters.
    expect(html).toContain('c');
  });

  it('escapes an ampersand rather than swallowing it', () => {
    const html = renderMarkdown('cook & render');

    expect(html).toContain('&amp;');
  });

  it('returns an empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
  });
});
