import { parseDocument } from 'htmlparser2';
import { convert } from 'html-to-text';

function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }
const escapeHTML = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const allowed = new Set('p div span br hr strong b em i u s a table tbody thead tr td th ul ol li'.split(' '));
const blocked = new Set('script style iframe object embed svg math form input button textarea select template head'.split(' '));
const styles = {
  color: /^(#[a-f0-9]{3}(?:[a-f0-9]{3})?|black|white|gray|grey|navy|blue|green|red)$/i,
  'font-weight': /^(normal|bold|[4-7]00)$/,
  'font-style': /^(normal|italic)$/,
  'font-size': /^(?:[8-9]|[12][0-9]|3[0-2])px$/,
  'text-decoration': /^(none|underline|line-through)$/,
  'text-align': /^(left|center|right)$/,
  'border-collapse': /^collapse$/,
  padding: /^(?:0|[1-9]|1[0-9]|2[0-4])px$/,
};

export function cleanStyle(value = '') {
  return value.split(';').flatMap(declaration => {
    const [key, value, ...extra] = declaration.split(':').map(part => part.trim().toLowerCase());
    return !extra.length && Object.hasOwn(styles, key) && styles[key].test(value) ? [`${key}:${value}`] : [];
  }).join(';');
}

export function normalizeFooter(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Footer must be an object.');
  const { text = '', html = '' } = value;
  if (typeof text !== 'string' || text.length > 12000 || typeof html !== 'string' || html.length > 12000) invalid('Footer must be text of at most 12000 characters.');
  if (!html) return { text, html: '' };
  let nodes = 0;
  function render(node, depth = 0) {
    if (++nodes > 2000 || depth > 40) invalid('This HTML footer is too complex. Use a simpler signature.');
    if (node.type === 'text') return escapeHTML(node.data);
    const tag = node.name;
    if (blocked.has(tag)) return '';
    const children = (node.children || []).map(child => render(child, depth + 1)).join('');
    if (!allowed.has(tag)) return children;
    let attributes = '';
    const href = node.attribs?.href || '';
    if (tag === 'a' && !/[\u0000-\u0020\u007f]/.test(href)) {
      try {
        const url = new URL(href);
        if (['https:', 'mailto:', 'tel:'].includes(url.protocol) && !url.username && !url.password) attributes += ` href="${escapeHTML(href)}"`;
      } catch { /* Ignore unsafe or relative links. */ }
    }
    const style = cleanStyle(node.attribs?.style || '');
    if (style) attributes += ` style="${style}"`;
    return `<${tag}${attributes}>${['br', 'hr'].includes(tag) ? '' : children + `</${tag}>`}`;
  }
  const clean = render(parseDocument(html));
  const plain = convert(clean, { wordwrap: false, selectors: [{ selector: 'a', options: { hideLinkHrefIfSameAsText: true } }] });
  if (clean.length > 12000 || plain.length > 12000) invalid('The formatted footer exceeds 12000 characters.');
  return { text: plain, html: clean };
}

export function preferencesFooter({ signature = '', signatureFormat = 'plain' }) {
  if (!['plain', 'html'].includes(signatureFormat)) invalid('Choose plain text or HTML for your signature.');
  return normalizeFooter(signatureFormat === 'html' ? { html: signature } : { text: signature });
}

export function messageContent({ body, footer }) {
  const safe = normalizeFooter(footer);
  return {
    text: body + (safe.text ? '\n\n' + safe.text : ''),
    ...(safe.html ? { html: `<div>${escapeHTML(body).replace(/\r?\n/g, '<br>')}</div><br><div>${safe.html}</div>` } : {}),
  };
}
