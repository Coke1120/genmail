import { parseDocument } from 'htmlparser2';
import { cleanStyle } from './footer.js';

const MAX_BYTES = 512 * 1024;
const allowed = new Set('p div span br hr b strong em i u s a table tbody thead tfoot tr td th ul ol li h1 h2 h3 h4 h5 h6 blockquote pre code img'.split(' '));
const blocked = new Set('script style head title base link meta form input button textarea select option iframe frame frameset object embed applet svg math template noscript noembed noframes plaintext xmp audio video source track portal'.split(' '));
const wrappers = new Set(['html', 'head', 'body']);
const escapeHTML = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function safeURL(value, image = false) {
  if (/[\u0000-\u0020\u007f-\u009f\ufffd\\]/u.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)|%c2%[89][0-9a-f]|%(?![0-9a-f]{2})/i.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (/^https?:\/\//i.test(value)) {
      if (!url.hostname || value.split('/')[2].includes('@')) return false;
      return !image || (url.protocol === 'https:' && !/\.svgz?(?:\/|$)/i.test(decodeURIComponent(url.pathname)));
    }
    return !image && /^(mailto|tel):[^/]/i.test(value) && ['mailto:', 'tel:'].includes(url.protocol);
  } catch { return false; }
}

function dimension(value, max = 2048) {
  return /^[1-9][0-9]{0,3}$/.test(value) && Number(value) <= max;
}

function messageStyle(value) {
  const widths = value.split(';').flatMap(entry => {
    const [key, size, ...extra] = entry.split(':').map(part => part.trim().toLowerCase());
    if (extra.length || !['width', 'max-width'].includes(key)) return [];
    const match = /^([1-9][0-9]{0,3})(px|%)$/.exec(size);
    return match && dimension(match[1], match[2] === '%' ? 100 : 2048) ? [`${key}:${size}`] : [];
  });
  return [cleanStyle(value), ...widths].filter(Boolean).join(';');
}

// Reader only: callers retain plain body for fallback and AI. HTTPS images require
// a client CSP of img-src 'none' until the user opts in for this message.
export function sanitizeMessageHTML(input) {
  if (typeof input !== 'string' || input.length > MAX_BYTES || Buffer.byteLength(input, 'utf8') > MAX_BYTES) return '';
  try {
    // ponytail: conservatively count tag-like text too; use a tokenizer budget if
    // that ever limits compatibility. The actual DOM is checked below as well.
    let openingTags = 0;
    for (const _ of input.matchAll(/<[a-z]/gi)) if (++openingTags > 12000) return '';
    const document = parseDocument(input);
    const stack = document.children.map(node => [node, 0]);
    let nodes = 0;
    while (stack.length) {
      const [node, parentDepth] = stack.pop();
      const wrapper = wrappers.has(node.name);
      const depth = parentDepth + (node.name && !wrapper ? 1 : 0);
      if ((!wrapper && ++nodes > 12000) || depth > 60) return '';
      for (const child of node.children || []) stack.push([child, depth]);
    }
    const output = [];
    let bytes = 0;
    const append = text => {
      bytes += Buffer.byteLength(text, 'utf8');
      if (bytes > MAX_BYTES) throw new Error('HTML output limit');
      output.push(text);
    };
    function render(node) {
      if (node.type === 'text') { append(escapeHTML(node.data)); return; }
      const tag = node.name;
      if (blocked.has(tag)) return;
      if (!allowed.has(tag)) {
        for (const child of node.children || []) render(child);
        return;
      }
      const attrs = node.attribs || {};
      let attributes = '';
      const attr = (key, value) => { attributes += ` ${key}="${escapeHTML(value)}"`; };
      const style = messageStyle(attrs.style || '');
      if (style) attr('style', style);
      if (tag === 'a') {
        if (safeURL(attrs.href || '')) attr('href', attrs.href);
        attr('rel', 'noreferrer noopener');
        attr('target', '_blank');
      }
      if (tag === 'img') {
        if (safeURL(attrs.src || '', true)) attr('src', attrs.src);
        if (attrs.alt !== undefined) attr('alt', attrs.alt);
        if (dimension(attrs.height || '')) attr('height', attrs.height);
      }
      if (['img', 'table', 'td', 'th'].includes(tag) && dimension(attrs.width || '')) attr('width', attrs.width);
      if (['td', 'th'].includes(tag)) {
        for (const key of ['colspan', 'rowspan']) if (dimension(attrs[key] || '', 100)) attr(key, attrs[key]);
      }
      append(`<${tag}${attributes}>`);
      if (!['br', 'hr', 'img'].includes(tag)) {
        for (const child of node.children || []) render(child);
        append(`</${tag}>`);
      }
    }
    render(document);
    return output.join('');
  } catch { return ''; }
}
