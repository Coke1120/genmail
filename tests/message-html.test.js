import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from 'htmlparser2';
import { sanitizeMessageHTML as sanitize } from '../server/message-html.js';
import { cleanStyle } from '../server/footer.js';

const MAX_BYTES = 512 * 1024;

test('reader preserves basic email formatting, footer styles and bounded layout', () => {
  const input = '<h1>中文 &amp; team</h1><blockquote><pre><code>&lt;b&gt;</code></pre></blockquote>'
    + '<table style="border-collapse:collapse;width:100%;max-width:600px" width="600"><thead><tr><th colspan="2">Title</th></tr></thead>'
    + '<tbody><tr><td style="color:#225533;font-weight:bold;padding:8px;text-align:right">Hello<br><b>B</b><strong>S</strong><em>E</em><i>I</i><u>U</u><s>S</s></td></tr></tbody>'
    + '<tfoot><tr><td>Footer</td></tr></tfoot></table><ul><li>One</li></ul><ol><li>Two</li></ol><hr>';
  assert.equal(sanitize(input), input);
  assert.equal(cleanStyle('color:red;position:fixed;font-size:12px'), 'color:red;font-size:12px');
  assert.equal(sanitize('<p style="color:red;position:fixed;font-size:12px">Hi</p>'), '<p style="color:red;font-size:12px">Hi</p>');
});

test('active content, network CSS, event attributes, IDs, classes and mutation-XSS carriers are removed', () => {
  const input = '<!doctype html><html><head><base href="https://evil.invalid"><link rel="stylesheet" href="https://evil.invalid"><style>@import url(https://evil.invalid)</style></head><body>'
    + '<div id="location" class="overlay" onclick="alert(1)" data-x="bad" contenteditable autofocus>'
    + '<script>secret()</script><iframe srcdoc="&lt;script&gt;bad()&lt;/script&gt;">hidden</iframe><object data="https://evil.invalid">hidden</object>'
    + '<embed src="https://evil.invalid"><form action="https://evil.invalid"><input name="pw"><button>hidden</button></form>'
    + '<svg><a xlink:href="javascript:bad()">hidden</a><foreignObject><p onclick="bad()">hidden</p></foreignObject></svg>'
    + '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=x onerror=bad()&gt;"></table></mtext></math>'
    + '<template><img src="https://evil.invalid"></template><noscript><img src=x onerror=bad()></noscript>'
    + '<audio src="https://evil.invalid"></audio><video poster="https://evil.invalid"><source src="https://evil.invalid"></video>'
    + '<p style="color:red;background:url(https://evil.invalid);width:expression(bad());position:fixed;display:none;behavior:url(x);--x:red;constructor:bad">Readable</p>'
    + '<!--[if mso]><img src=x onerror=bad()><![endif]--></div></body></html>';
  const output = sanitize(input);
  assert.match(output, /Readable/);
  assert.doesNotMatch(output, /evil\.invalid|hidden|secret\(\)|onclick|onerror|srcdoc|class=|id=|expression|url\(/);
  const allowed = new Set('p div span br hr b strong em i u s a table tbody thead tfoot tr td th ul ol li h1 h2 h3 h4 h5 h6 blockquote pre code img'.split(' '));
  const stack = [...parseDocument(output).children];
  while (stack.length) {
    const node = stack.pop();
    if (node.name) {
      assert.ok(allowed.has(node.name), node.name);
      for (const attr of Object.keys(node.attribs)) assert.ok(['style', 'href', 'rel', 'target', 'src', 'alt', 'width', 'height', 'colspan', 'rowspan'].includes(attr), attr);
    }
    stack.push(...node.children || []);
  }
  assert.equal(sanitize(output), output);
});

test('links require absolute approved schemes with no credentials or control characters', () => {
  for (const href of ['https://example.test/path?a=1&amp;b=2', 'https://example.test/%E6%96%87', 'http://example.test', 'mailto:person@example.test', 'tel:+85212345678']) {
    const output = sanitize(`<a href="${href}" target="_self" rel="opener" ping="https://evil.invalid">Go</a>`);
    assert.match(output, / href=/, href);
    assert.match(output, /rel="noreferrer noopener" target="_blank"/);
    assert.doesNotMatch(output, /ping=|_self|rel="opener"/);
  }
  for (const href of ['javascript:alert(1)', 'jav&#x61;script:alert(1)', 'java&#10;script:alert(1)', 'data:text/html,bad', 'file:///etc/passwd', 'ftp://example.test', '//example.test', '/relative', '#fragment', 'https://user:pw@example.test', 'https://@example.test', 'https:example.test', 'https:/example.test', 'https:\\example.test', ' https://example.test', 'https://example.test/&#0;', 'https://example.test/\u0085', 'https://example.test/%0a', 'mailto:person@example.test?body=%0d%0a', 'tel:', 'mailto://host']) {
    assert.doesNotMatch(sanitize(`<a href="${href}">Go</a>`), /href=/, href);
  }
});

test('images retain only HTTPS sources, alt text and bounded dimensions for client consent', () => {
  assert.equal(sanitize('<img src="https://example.test/image.png" alt="A &amp; B" width="640" height="480" srcset="https://evil.invalid/x 2x" onerror="bad()" loading="eager">'),
    '<img src="https://example.test/image.png" alt="A &amp; B" height="480" width="640">');
  for (const src of ['http://example.test/a.png', '//example.test/a.png', '/a.png', 'cid:attachment', 'data:image/svg+xml,bad', 'file:///a.png', 'https://u:p@example.test/a.png', 'https://example.test/a.svg', 'https://example.test/a.SVGZ?x=1', 'https://example.test/a.%73vg', 'https://example.test/%00.png']) {
    assert.equal(sanitize(`<img src="${src}" alt="Fallback" width="99999" height="-1">`), '<img alt="Fallback">', src);
  }
  assert.equal(sanitize('<img alt="&quot;&gt;&lt;script&gt;" width="2048" height="2049" style="background-image:url(https://evil.invalid);width:9999px;max-width:101%">'), '<img alt="&quot;&gt;&lt;script&gt;" width="2048">');
  assert.match(sanitize('<img src="https://example.test/%E6%96%87.png" alt="文">'), /src=/);
});

test('malformed and double-encoded markup remains inert and stable', () => {
  for (const input of ['<p><b>broken</p></b><img src=x onerror=bad()>', '<a href="javascript:bad()" href="https://example.test">x</a>', '<p>&amp;lt;script&amp;gt; &lt;script&gt; " \'</p>', '<svg><style><img src=x onerror=bad()></style></svg><p>OK</p>', '<math><annotation-xml encoding="text/html"><img src=x onerror=bad()></annotation-xml></math>']) {
    const output = sanitize(input);
    assert.doesNotMatch(output, /<script|<svg|<math|onerror=|javascript:/);
    assert.equal(sanitize(output), output);
  }
});

test('oversized, complex and non-string inputs fail closed without interrupting import', () => {
  assert.equal(sanitize('x'.repeat(MAX_BYTES)).length, MAX_BYTES);
  assert.equal(sanitize('<br>'.repeat(12000)), '<br>'.repeat(12000));
  assert.equal(sanitize('<div>'.repeat(60) + 'ok' + '</div>'.repeat(60)), '<div>'.repeat(60) + 'ok' + '</div>'.repeat(60));
  for (const input of [null, undefined, 1, {}, [], 'x'.repeat(MAX_BYTES + 1), '中'.repeat(Math.ceil(MAX_BYTES / 3)), '&'.repeat(110000), '<br>'.repeat(12001), '<div>'.repeat(61) + 'deep' + '</div>'.repeat(61), '<template>' + '<br>'.repeat(12001) + '</template>', '<!--x-->'.repeat(12001)]) {
    assert.equal(sanitize(input), '');
  }
});
