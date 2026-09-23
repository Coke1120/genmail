import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFooter, preferencesFooter, messageContent } from '../server/footer.js';
import { updatePreferences } from '../server/policy.js';

test('HTML footers allow formatting and links, remove active content and resources, and remain canonical', () => {
  const footer = normalizeFooter({ html: '<div style="color:#225533;font-weight:bold;background:url(https://track.invalid);constructor:evil" onclick="bad()">Leo &amp; team<br><a href="https://example.com">Website</a><img src="https://track.invalid/pixel"><script>alert(1)</script><svg><a>hidden</a></svg><a href="jav&#97;script:alert(1)">Bad link</a><a href="file:///private/key">File</a></div>', text: 'Untrusted alternate text' });
  assert.match(footer.html, /color:#225533;font-weight:bold/);
  assert.match(footer.html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(footer.html, /onclick|background|constructor|img|script|svg|file:|track.invalid/);
  assert.match(footer.text, /Leo & team/);
  assert.match(footer.text, /https:\/\/example.com/);
  assert.doesNotMatch(footer.text, /Untrusted|hidden|alert/);
  assert.deepEqual(normalizeFooter(footer), footer);
  const mime = messageContent({ body: '<script>private & literal</script>\nNext line', footer });
  assert.equal(mime.text, '<script>private & literal</script>\nNext line\n\n' + footer.text);
  assert.match(mime.html, /&lt;script&gt;private &amp; literal&lt;\/script&gt;<br>Next line/);
  assert.deepEqual(messageContent({ body: 'Hello', footer: { text: 'Regards', html: '' } }), { text: 'Hello\n\nRegards' });
  assert.deepEqual(messageContent({ body: 'Legacy draft' }), { text: 'Legacy draft' });
});

test('footer inputs are bounded and preference formats are explicit', () => {
  for (const value of [null, [], { text: 1 }, { html: 1 }, { html: 'x'.repeat(12001) }, { html: '<div>'.repeat(45) + 'deep' + '</div>'.repeat(45) }]) assert.throws(() => normalizeFooter(value), { status: 400 });
  assert.throws(() => preferencesFooter({ signatureFormat: 'markdown' }), { status: 400 });
  const saved = updatePreferences({}, { signatureFormat: 'html', signature: '<b>Leo</b><img src="https://track.invalid">' });
  assert.equal(saved.signature, '<b>Leo</b>');
  assert.equal(preferencesFooter(saved).text, 'Leo');
  assert.deepEqual(preferencesFooter({ signature: '<b>Plain</b>' }), { text: '<b>Plain</b>', html: '' });
});
