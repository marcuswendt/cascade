import DOMPurify from 'dompurify';
import { Marked } from 'marked';

/**
 * Markdown to HTML that is safe to hand to `{@html}`.
 *
 * Two consumers: text annotations on the canvas, and the agent console, where
 * a coding agent answers in Markdown and used to be shown its own asterisks
 * and pipes as literal text.
 *
 * The sanitiser is not optional and its allowlist is not the default one.
 * Agent output quotes code and file contents all day, so a reply can easily
 * *contain* `<script>` or an `onerror=` without anybody being attacked — and
 * the page it lands in also holds the user's project. So the rule is an
 * allowlist of the tags Markdown itself can produce, and nothing else: an
 * element we did not plan for cannot appear, whether or not we thought of the
 * attack it enables.
 *
 * `gfm` is on for tables, strikethrough and task lists, which is the flavour
 * every coding agent writes. `breaks` is on because agents wrap prose at a
 * column and mean it as one paragraph.
 */
const markdown = new Marked({
  breaks: true,
  gfm: true
});

/**
 * Everything a GFM document can render, and deliberately nothing structural:
 * no `iframe`, `form`, `object`, `style`, `svg` or `math`, all of which
 * DOMPurify's own default list would have let through in some form.
 *
 * `img` is here because `![alt](url)` is ordinary Markdown; DOMPurify checks
 * the URI scheme, so `javascript:` in an `src` or `href` is dropped and the
 * attribute disappears with it. `input` is here only for GFM task-list
 * checkboxes — harmless without the event-handler attributes, which are not
 * on the attribute list below and so cannot be set at all.
 */
const ALLOWED_TAGS = [
  'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'em', 'del', 's', 'b', 'i',
  'ul', 'ol', 'li',
  'blockquote',
  'pre', 'code',
  'a', 'img',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'input'
];

/**
 * The attribute list is the other half of the guarantee. It carries no `on*`
 * handler, no `style` and no `class`, so content cannot script itself, cannot
 * paint itself, and cannot borrow one of the panel's own class names to
 * impersonate part of the UI. `target`/`rel` are allowed because the hook
 * below sets them.
 */
const ALLOWED_ATTR = [
  'href', 'title',
  'src', 'alt',
  'align',
  'start',
  'type', 'checked', 'disabled',
  'target', 'rel'
];

/**
 * A link in agent output is a link to somewhere else. Followed in place it
 * would navigate Studio away and take the unsaved graph with it, so every
 * anchor is forced into a new context. `noopener` because the opened page must
 * not get a handle back on the Studio window.
 */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function renderMarkdown(source: string | null | undefined): string {
  if (!source) return '';

  const html = markdown.parse(source, { async: false });
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Keep the text of anything dropped out of the output. A stripped tag that
    // also silently ate the sentence around it is a worse failure than an
    // unrendered one.
    KEEP_CONTENT: true
  });
}
