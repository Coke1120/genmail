import { AI_BEHAVIORS } from '../shared/features.js';

export function createWorkflowPlan(action, messages, { when, now = new Date() } = {}) {
  const feature = AI_BEHAVIORS.find(feature => feature.id === action && feature.mock);
  if (!feature) throw new Error('Unknown simulated workflow.');
  const mail = [...new Map(messages.map(message => [message.id, message])).values()];
  const selected = mail[0];
  if (feature.context === 'selected' && !selected) throw new Error('Select a permitted message for this workflow.');
  const plan = { title: `Simulated · ${feature.label}`, summary: 'Preview only. Applying saves changes inside Morrow; nothing is sent externally.', items: [], changes: [], records: {} };
  const subject = message => message.subject?.trim() || 'Subject not shared';
  const excerpt = message => message.body?.trim().replace(/\s+/g, ' ').slice(0, 260) || 'Body not shared';
  const item = (title, detail, message) => ({ title, detail, ...(message?.id ? { messageId: message.id } : {}) });
  const inbox = mail.filter(message => message.folder === 'inbox');
  const urgent = message => /\b(urgent|deadline|action required|review|confirm|approval)\b/i.test(`${message.subject || ''} ${message.body || ''}`);
  function date() {
    const value = new Date(when || now);
    if (!when) { value.setDate(value.getDate() + 1); value.setHours(9, 0, 0, 0); }
    if (!Number.isFinite(value.getTime())) throw new Error('Choose a valid reminder or meeting date.');
    return value.toISOString();
  }

  switch (action) {
    case 'triage': {
      // ponytail: keyword/unread heuristic for simulation; replace with reviewed model output for real ranking.
      const candidates = inbox.filter(message => !message.starred && (urgent(message) || (!message.read && message.category !== 'newsletters')));
      plan.items = candidates.map(message => item(subject(message), urgent(message) ? 'Sample priority: visible text mentions a review, decision, or deadline. Add a local star.' : 'Sample priority: an unread, non-newsletter message. Add a local star.', message));
      plan.changes = candidates.map(message => ({ messageId: message.id, patch: { starred: true } }));
      break;
    }
    case 'labels':
      for (const message of inbox) {
        const label = message.category === 'newsletters' ? 'Newsletter' : urgent(message) ? 'Follow up' : 'To review';
        if (message.labels?.includes(label)) continue;
        plan.items.push(item(subject(message), `Add the local label “${label}” using this sample rule.`, message));
        plan.changes.push({ messageId: message.id, patch: { labels: [...new Set([...(message.labels || []), label])] } });
      }
      break;
    case 'memory': {
      const contacts = [...new Map(mail.filter(message => message.fromEmail?.trim()).map(message => [message.fromEmail.trim().toLowerCase(), { name: message.fromName?.trim() || 'Unknown', email: message.fromEmail.trim() }])).values()];
      const writing = mail.filter(message => ['sent', 'drafts'].includes(message.folder) && message.body?.trim());
      const average = writing.length ? Math.round(writing.reduce((sum, message) => sum + message.body.trim().split(/\s+/).length, 0) / writing.length) : 0;
      const voice = writing.length ? `Visible outgoing writing averages ${average} words across ${writing.length} permitted message(s). ${writing.some(message => /^(hi|hello|dear|hey)\b/i.test(message.body.trim())) ? 'At least one starts with a greeting.' : 'No greeting pattern established.'} This is a sample observation, not a learned voice.` : 'Unknown — no permitted sent or draft writing is available.';
      const topics = [...new Set(mail.map(message => message.subject?.trim()).filter(Boolean))].slice(0, 3);
      const notes = `Simulated notes from permitted email only. ${topics.length ? `Visible subjects: ${topics.join('; ')}.` : 'Topics unknown because no subjects were shared.'} No external facts were added.`;
      plan.records.brain = { voice, contacts, notes };
      plan.items = [item('Writing observations', voice), item('Contacts from visible sender fields', contacts.length ? contacts.map(contact => `${contact.name} <${contact.email}>`).join('\n') : 'Unknown — no sender addresses were shared.'), item('Notes to save', notes)];
      break;
    }
    case 'research':
      plan.summary = 'Simulated research structure using this email only. No web lookup or verified person/company research has occurred.';
      plan.items = [
        item('Contact supplied in email', `${selected.fromName || 'Unknown'} · ${selected.fromEmail || 'Unknown'}`, selected),
        item('Supplied context · unverified', `${subject(selected)}\n${excerpt(selected)}`, selected),
        item('Role and company', 'Unknown. These details have not been verified; an email address alone does not establish them.'),
        item('Suggested research questions', 'Confirm their role, organization, goals, and the relevant project before relying on any assumptions.'),
      ];
      break;
    case 'meeting':
      plan.summary = 'Simulated preparation from the selected email. No calendar availability has been checked and no meeting is created.';
      plan.items = [
        item('Background', `${subject(selected)}\n${excerpt(selected)}`, selected),
        item('Proposed agenda', '1. Confirm the goal.\n2. Review the points in the email.\n3. Agree on owners and next steps.', selected),
        item('Questions to confirm', 'What needs a decision? Who should participate? Are there any explicit deadlines or missing materials?'),
      ];
      break;
    case 'followup': {
      const reminder = { title: `Follow up: ${subject(selected)}`, detail: 'Simulated local reminder. Review this email and decide whether a reply is needed; no email will be sent automatically.', when: date(), messageId: selected.id };
      plan.records.reminders = [reminder];
      plan.items = [item(reminder.title, `${reminder.detail}\nProposed time: ${reminder.when}`, selected)];
      break;
    }
    case 'schedule': {
      const event = { title: `Meeting proposal: ${subject(selected)}`, detail: 'Simulated local calendar proposal. Attendees and availability are unconfirmed; no invitations or external calendar entries will be created.', when: date(), messageId: selected.id };
      plan.records.events = [event];
      plan.items = [item(event.title, `${event.detail}\nProposed time: ${event.when}`, selected)];
      break;
    }
    case 'cleanup': {
      const candidates = inbox.filter(message => message.category === 'newsletters');
      plan.items = candidates.map(message => item(subject(message), 'Archive this newsletter locally. It remains available in Archive; the provider mailbox is unchanged.', message));
      plan.changes = candidates.map(message => ({ messageId: message.id, patch: { folder: 'archive' } }));
      break;
    }
    case 'unsubscribe': {
      const record = { title: `Unsubscribe review: ${subject(selected)}`, detail: 'Simulated request recorded locally only. You remain subscribed; no link is opened and no unsubscribe request is sent.', messageId: selected.id };
      plan.records.unsubscribed = [record];
      plan.items = [item(record.title, record.detail, selected)];
      break;
    }
    case 'attachments':
      plan.summary = 'Fictional attachment fixtures for a comparison demonstration. These files were not discovered in your email and are not real attachments.';
      plan.items = [
        item('Fictional fixture · sample-brief-v1.txt', 'SAMPLE CONTENT: Scope: one landing page. Review: visual design. Delivery: date unknown.'),
        item('Fictional fixture · sample-brief-v2.txt', 'SAMPLE CONTENT: Scope: one landing page. Review: visual design and accessibility. Delivery: date unknown.'),
        item('Illustrative comparison', 'The fictional second version adds an accessibility review. Scope is unchanged and neither sample supplies a delivery date. No files were fetched.'),
      ];
      break;
    case 'batchReplies': {
      const candidates = inbox.filter(message => message.category !== 'newsletters' && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(message.fromEmail || '')).slice(0, 5);
      plan.records.drafts = candidates.map(message => ({
        to: message.fromEmail.trim(),
        subject: /^re:/i.test(subject(message)) ? subject(message) : `Re: ${subject(message)}`,
        body: `Hi ${message.fromName?.trim() || 'there'},\n\nThanks for your email${message.subject?.trim() ? ` about “${message.subject.trim()}”` : ''}. I’ll review the details and get back to you.\n\nBest,`,
        replyToId: message.id,
      }));
      plan.items = plan.records.drafts.map(draft => item(`Draft to ${draft.to}`, `${draft.subject}\n\n${draft.body}`, { id: draft.replyToId }));
      plan.summary = 'Create up to five separate local draft replies. Review and edit each draft before deciding whether to send it; this workflow never sends email.';
      break;
    }
  }
  if (!plan.items.length) plan.items = [item('No matching messages', 'No local changes are proposed for the permitted messages.')];
  return plan;
}
