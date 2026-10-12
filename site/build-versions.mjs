// Renders the "Versions" section of site/index.html from CHANGELOG.md.
// Run before every deploy: node site/build-versions.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const changelog = readFileSync(here('../CHANGELOG.md'), 'utf8');
const pagePath = here('./index.html');
const START = '<!-- versions:start -->';
const END = '<!-- versions:end -->';
const MAX = 4;
// Hand-written highlights for releases whose changelog entries are too technical
// to summarise automatically. New releases need no entry here.
const overrides = JSON.parse(readFileSync(here('./versions-highlights.json'), 'utf8'));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

// Split into versions, then into sections of bullets.
const versions = [];
let v = null, section = '', item = null;
const flush = () => { if (item && v) v.items.push(item); item = null; };
for (const line of changelog.split('\n')) {
  const h2 = line.match(/^## (\d+\.\d+\.\d+)(?:\s+—\s+(\S+))?/);
  if (h2) { flush(); v = { version: h2[1], date: h2[2] ?? '', items: [] }; versions.push(v); section = ''; continue; }
  if (line.startsWith('## ')) { flush(); v = null; continue; }
  if (!v) continue;
  const h3 = line.match(/^### (.+)/);
  if (h3) { flush(); section = h3[1].trim(); continue; }
  if (line.startsWith('- ')) { flush(); item = { section, text: line.slice(2) }; continue; }
  if (item && /^\s+\S/.test(line)) item.text += ' ' + line.trim();
  else if (item && line.trim() === '') flush();
}
flush();

// Fixes rank last; the rest keep the changelog's own order, which leads with what matters.
const rank = (s) => (/^fixed$/i.test(s) ? 2 : /^changed$/i.test(s) ? 1 : 0);

function firstSentence(t) {
  return (t.match(/^.+?[.!?](?=\s+[A-Z`(]|$)/) ?? [t])[0].trim();
}

function summary(text, section) {
  const bold = text.match(/^\*\*(.+?)\*\*\s*(.*)$/);
  let s;
  if (bold && /[.:]$/.test(bold[1].trim())) {
    s = bold[1].trim().replace(/:$/, '.');
    // A bare title ("Bundle ports.") says little; add the sentence that explains it.
    if (s.split(/\s+/).length <= 4 && bold[2]) s += ' ' + firstSentence(bold[2].replace(/\*\*/g, ''));
  } else {
    s = firstSentence(text.replace(/\*\*/g, ''));
  }
  s = s.replace(/\s*\(\d+\.\d+\.\d+\)/g, '').replace(/\s+—\s+/g, ': ').replace(/—/g, ', ');
  if (/^removed$/i.test(section)) s = 'Removed: ' + s.charAt(0).toLowerCase() + s.slice(1);
  if (s.length > 220) s = s.slice(0, s.lastIndexOf(' ', 215)).replace(/[,;:]$/, '') + '…';
  return s;
}

function pick(items) {
  const sorted = items.map((it, i) => ({ ...it, i })).sort((a, b) => rank(a.section) - rank(b.section) || a.i - b.i);
  const main = sorted.filter((it) => rank(it.section) < 2);
  const chosen = main.length >= 2 ? main.slice(0, MAX) : sorted.slice(0, MAX);
  return chosen.map((it) => summary(it.text, it.section));
}

const fmtDate = (d) => {
  if (!d) return '';
  const t = new Date(d + 'T00:00:00Z');
  return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

const html = [
  START,
  '  <h2>Versions</h2>',
  '  <p>Notable changes, newest first. Every release, in full, is in the <a href="https://github.com/marcuswendt/cascade/blob/main/CHANGELOG.md">changelog</a> and on <a href="https://github.com/marcuswendt/cascade/releases">GitHub releases</a>.</p>',
  '  <dl class="versions">',
  ...versions.filter((x) => x.items.length).flatMap((x) => [
    `    <dt>${x.version}${x.date ? ` <span>${fmtDate(x.date)}</span>` : ''}</dt>`,
    `    <dd><ul>${(overrides[x.version] ?? pick(x.items)).map((s) => `<li>${inline(s)}</li>`).join('')}</ul></dd>`,
  ]),
  '  </dl>',
  END,
].join('\n');

const page = readFileSync(pagePath, 'utf8');
const a = page.indexOf(START), b = page.indexOf(END);
if (a < 0 || b < 0) throw new Error('versions markers missing from site/index.html');
const latest = versions[0]?.version;
const next = (page.slice(0, a) + html + page.slice(b + END.length))
  .replace(/Current release: \d+\.\d+\.\d+/, `Current release: ${latest}`);
writeFileSync(pagePath, next);
console.log(`versions: ${versions.length} releases rendered`);
