import { recipients } from '../server/recipients.js';

function mailboxes(input = '') {
  const value = String(input ?? '');
  if (/[\r\n\0]/.test(value)) return [value];
  if (!value.trim()) return [];
  // ponytail: normalize simple mailbox lists; keep unsupported syntax for review until an RFC group-address editor is needed.
  const tokens = []; let token = '', quoted = false, escaped = false, angle = false;
  for (const character of value) {
    if (escaped) escaped = false;
    else if (quoted && character === '\\') escaped = true;
    else if (character === '"') quoted = !quoted;
    else if (!quoted) {
      if (character === '<') { if (angle) return [value.trim()]; angle = true; }
      else if (character === '>') { if (!angle) return [value.trim()]; angle = false; }
      else if (!angle && /[():]/.test(character)) return [value.trim()];
      else if (!angle && /[,;]/.test(character)) { tokens.push(token); token = ''; continue; }
    }
    token += character;
  }
  if (quoted || escaped || angle) return [value.trim()];
  tokens.push(token);
  try {
    return tokens.map(token => {
      let address = token.trim();
      if (address.includes('<')) {
        const match = address.match(/^([^<>]*)<([^<>]*)>\s*$/);
        if (!match || match[1].includes('@')) throw Error('Malformed mailbox');
        address = match[2].trim();
      }
      if (/[,;]/.test(address)) throw Error('Malformed mailbox');
      return recipients({ to: address }).to;
    });
  } catch { return [value.trim()]; }
}

export function replyDraft(message, { all = false, body = '' } = {}) {
  const seen = new Set(all ? [message.accountId === 'demo' ? 'alex@genmail.example' : (message.accountId || '').toLowerCase()] : []);
  const unique = fields => fields.flatMap(field => mailboxes(message[field])).filter(address => {
    const key = address.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true;
  }).join(', ');
  const to = all ? unique(message.folder === 'sent' ? ['to'] : ['fromEmail', 'to']) : mailboxes(message[message.folder === 'sent' ? 'to' : 'fromEmail']).join(', ');
  return { accountId: message.accountId, to, cc: all ? unique(['cc']) : '', bcc: '', subject: /^re:/i.test(message.subject || '') ? message.subject : `Re: ${message.subject || ''}`, body, replyToId: message.id };
}

export function forwardDraft(message) {
  const name = message.fromName || '', email = message.fromEmail || '';
  const from = !name || name === email ? email : !email ? name : `${name} <${email}>`;
  const headers = [['From', from], ['Date', message.date], ['Subject', message.subject], ['To', message.to], ['Cc', message.cc]]
    .filter(([, value]) => value).map(([label, value]) => `${label}: ${String(value).replace(/[\r\n]+/g, ' ')}`);
  const quoted = [...headers, '', message.body || ''].join('\n').replace(/\r\n?/g, '\n').split('\n').map(line => `> ${line}`).join('\n');
  return { accountId: message.accountId, forwarding: true, to: '', cc: '', bcc: '', subject: /^fwd?:/i.test(message.subject || '') ? message.subject : `Fwd: ${message.subject || ''}`, body: `\n\n---------- Forwarded message ----------\n${quoted}` };
}

// A provider draft is a read-only snapshot; start a new, owner-bound local draft.
export function copyProviderDraft(message) {
  return { accountId: message.accountId, sourceDraft: true,
    to: mailboxes(message.to).join(', '), cc: mailboxes(message.cc).join(', '), bcc: mailboxes(message.bcc).join(', '),
    subject: message.subject || '', body: message.body || '' };
}
