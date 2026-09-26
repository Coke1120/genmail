import { useState } from 'react';

export function safeMailLink(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export function emailDocument(html, images = false) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src ${images ? 'https:' : "'none'"}; connect-src 'none'; frame-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><style>body{font:15px system-ui,sans-serif;color:#202720;background:white;margin:8px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}blockquote{margin-left:12px;padding-left:12px;border-left:2px solid #ddd}a{color:#236042}</style></head><body>${html}</body></html>`;
}
function openLink(event, value) {
  event.preventDefault();
  const url = safeMailLink(value);
  if (url && window.confirm(`Open this email link?\n\n${url}`)) window.open(url, '_blank', 'noopener,noreferrer');
}
export default function MessageBody({ message }) {
  const [plain, setPlain] = useState(false), [images, setImages] = useState(false), [height, setHeight] = useState(480);
  function loaded(event) {
    const frame = event.currentTarget, doc = frame.contentDocument;
    if (!doc) return;
    // Same-origin access is only for trusted outer UI; sandbox never permits email scripts.
    doc.addEventListener('click', event => { const link = event.target.closest?.('a'); if (link) openLink(event, link.getAttribute('href')); });
    setHeight(Math.max(180, Math.min(20000, (doc.body?.scrollHeight || 480) + 16)));
  }
  return <section aria-label="Email content">
    {message.bodyHtml && <><div className="email-display-controls"><label><input type="checkbox" checked={plain} onChange={event => setPlain(event.target.checked)} /> Plain text</label>{!plain && message.bodyHtml.includes('<img') && <button className="button secondary" onClick={() => {
      if (images || window.confirm('Load external images? Their servers may learn your IP address and that you opened this email. This choice applies only to this message.')) setImages(value => !value);
    }}>{images ? 'Hide external images' : 'Load external images…'}</button>}</div>{!plain && <><p className="message-privacy">{images ? 'External images enabled for this message.' : 'External images blocked. Scripts and forms are disabled.'}</p><iframe title="Formatted email" sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={emailDocument(message.bodyHtml, images)} onLoad={loaded} style={{ width: '100%', height, border: 0, background: 'white' }} /></>}</>}
    {(plain || !message.bodyHtml) && <div className="message-body">{(message.body || '').split(/(https?:\/\/[^\s<>"']+)/g).map((part, index) => /^https?:\/\//.test(part) && safeMailLink(part) ? <a key={index} href={part} title={part} rel="noreferrer noopener" onClick={event => openLink(event, part)}>{part}</a> : part)}</div>}
  </section>;
}
