import DOMPurify from 'dompurify';
import { Marked } from 'marked';

const markdown = new Marked({
  breaks: true,
  gfm: true
});

export function renderMarkdown(source: string | null | undefined): string {
  if (!source) return '';

  const html = markdown.parse(source, { async: false });
  return DOMPurify.sanitize(html);
}
