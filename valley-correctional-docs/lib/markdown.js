'use strict';

const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');
const { icon } = require('./icons');

marked.setOptions({ gfm: true, breaks: false });

const CALLOUT_TYPES = {
  note: { label: 'Note', icon: 'info' },
  info: { label: 'Info', icon: 'info' },
  tip: { label: 'Tip', icon: 'check' },
  success: { label: 'Success', icon: 'check' },
  warning: { label: 'Warning', icon: 'warning' },
  danger: { label: 'Danger', icon: 'danger' },
  important: { label: 'Important', icon: 'warning' },
};

// Convert `:::type Optional title` … `:::` blocks into styled HTML.
// Supported: callout types (note/tip/warning/…), plus `details`/`accordion`
// which render as native collapsible <details> elements. The inner body is
// rendered as markdown. Blocks may not be nested.
function preprocessBlocks(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const m = /^:::\s*([a-zA-Z]+)\s*(.*)$/.exec(lines[i]);
    const type = m ? m[1].toLowerCase() : '';
    const isCallout = m && CALLOUT_TYPES[type];
    const isDetails = m && (type === 'details' || type === 'accordion');
    if (isCallout || isDetails) {
      const title = m[2].trim();
      const body = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // skip closing :::
      const inner = marked.parse(body.join('\n'));
      out.push(''); // blank lines so marked treats output as raw HTML
      if (isDetails) {
        out.push(
          `<details class="accordion"><summary>${sanitizeText(title || 'Details')}</summary>` +
            `<div class="accordion-body">${inner}</div></details>`
        );
      } else {
        const meta = CALLOUT_TYPES[type];
        out.push(
          `<div class="callout callout-${type}">` +
            `<div class="callout-head"><span class="callout-icon ic ic-${meta.icon}"></span>` +
            `<span class="callout-title">${sanitizeText(title || meta.label)}</span></div>` +
            `<div class="callout-body">${inner}</div></div>`
        );
      }
      out.push('');
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join('\n');
}

function sanitizeText(s) {
  return String(s).replace(/[<>&"]/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]
  ));
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

const SANITIZE_OPTS = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li',
    'blockquote', 'code', 'pre', 'strong', 'em', 'b', 'i', 'del', 's',
    'hr', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img',
    'div', 'span', 'section', 'sup', 'sub', 'kbd', 'figure', 'figcaption',
    'details', 'summary',
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel', 'title', 'class'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    th: ['align', 'colspan', 'rowspan'],
    td: ['align', 'colspan', 'rowspan'],
    // Content is authored by trusted staff, so allow class/id on any element
    // (needed for card grids, callouts, signature blocks, etc.).
    '*': ['class', 'id'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  transformTags: {
    a: (tagName, attribs) => {
      if (attribs.href && /^https?:\/\//i.test(attribs.href)) {
        attribs.target = '_blank';
        attribs.rel = 'noopener noreferrer';
      }
      return { tagName, attribs };
    },
  },
};

// Decode the handful of HTML entities sanitize-html introduces, so heading
// text and anchor slugs stay clean (e.g. "Rules & Conduct" doesn't become
// "rules-amp-conduct" and break section jumps).
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'");
}

// Inject id attributes into h2/h3 headings and collect a table of contents.
function addHeadingIds(html) {
  const toc = [];
  const used = new Set();
  const withIds = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (full, level, inner) => {
    const text = decodeEntities(inner.replace(/<[^>]+>/g, '')).trim();
    let id = slugify(text) || 'section';
    let base = id;
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    toc.push({ level: Number(level), text, id });
    return `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${inner}</h${level}>`;
  });
  return { html: withIds, toc };
}

/**
 * Render trusted (staff-authored) markdown to safe HTML + a heading TOC.
 * @returns {{ html: string, toc: Array<{level:number,text:string,id:string}> }}
 */
// Wrap tables so they scroll horizontally inside a rounded, bordered card.
function wrapTables(html) {
  return html.replace(/<table>([\s\S]*?)<\/table>/g,
    '<div class="table-wrap"><div><table>$1</table></div></div>');
}

// Inline icon shortcode: :i[name]: -> a masked icon span.
function expandIconShortcodes(md) {
  return String(md).replace(/:i\[([a-z0-9-]+)\]:/g, (_, name) => icon(name));
}

function render(markdown) {
  const pre = expandIconShortcodes(preprocessBlocks(markdown || ''));
  const raw = marked.parse(pre);
  const clean = sanitizeHtml(raw, SANITIZE_OPTS);
  const { html, toc } = addHeadingIds(clean);
  return { html: wrapTables(html), toc };
}

// Plain-text excerpt for the search index (strips markdown/html).
function toPlainText(markdown) {
  const raw = marked.parse(String(markdown || ''));
  return sanitizeHtml(raw, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { render, toPlainText, slugify };
