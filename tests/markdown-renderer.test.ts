// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '@/editor/utils/renderMarkdown';

describe('renderMarkdown', () => {
  it('removes script elements', () => {
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

    expect(html).toContain('<a>unsafe</a>');
    expect(html).not.toContain('javascript:');
  });

  it('preserves ordinary Markdown formatting', () => {
    const html = renderMarkdown('**Bold**\n\n- one\n- two');

    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<li>two</li>');
  });
});
