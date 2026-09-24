export const AI_BEHAVIORS = [
  { id: 'summary', label: 'Email summaries', description: 'Extract the key points from an email.', context: 'selected' },
  { id: 'reply', label: 'Suggested replies', description: 'Draft a reply for you to review.', context: 'selected' },
  { id: 'ask', label: 'Ask your inbox', description: 'Answer questions using permitted messages.', context: 'mailbox' },
  { id: 'write', label: 'Write new emails', description: 'Turn your instructions into an editable draft.', context: 'none' },
  { id: 'rewrite', label: 'Rewrite drafts', description: 'Adjust the tone and clarity of your text.', context: 'draft' },
  { id: 'translate', label: 'Translate', description: 'Translate an email or draft into your chosen language.', context: 'selected' },
  { id: 'briefing', label: 'Inbox briefing', description: 'Create a P0–P4 digest of permitted mail, manually or on your saved schedule.', context: 'mailbox' },
  { id: 'triage', label: 'Prioritize important mail', description: 'Preview which messages deserve attention.', context: 'mailbox', mock: true },
  { id: 'labels', label: 'Smart labels', description: 'Preview and apply labels inside Morrow.', context: 'mailbox', mock: true },
  { id: 'memory', label: 'Email Brain', description: 'Preview writing-style and contact notes from permitted mail.', context: 'mailbox', mock: true },
  { id: 'research', label: 'People & company research', description: 'Preview a research brief using email context; no web lookup.', context: 'selected', mock: true },
  { id: 'meeting', label: 'Meeting preparation', description: 'Build a mock agenda and talking points from an email.', context: 'selected', mock: true },
  { id: 'skill', label: 'Custom email skills', description: 'Run your saved instructions on permitted emails.', context: 'mailbox' },
  { id: 'followup', label: 'Follow-up reminders', description: 'Create a local reminder from an email.', context: 'selected', mock: true },
  { id: 'schedule', label: 'Meeting scheduling', description: 'Preview a calendar event without inviting anyone.', context: 'selected', mock: true },
  { id: 'cleanup', label: 'Inbox cleanup', description: 'Preview newsletter archiving inside Morrow.', context: 'mailbox', mock: true },
  { id: 'unsubscribe', label: 'Unsubscribe assistant', description: 'Record a simulated unsubscribe request locally.', context: 'selected', mock: true },
  { id: 'attachments', label: 'Attachment discovery & comparison', description: 'Explore clearly labeled sample attachments; no real files are fetched.', context: 'selected', mock: true },
  { id: 'batchReplies', label: 'Batch personalized replies', description: 'Preview separate reply drafts; never sends a batch.', context: 'mailbox', mock: true },
];

export const DEFAULT_POLICY = {
  enabled: true,
  triggers: { onOpen: false, onReply: false, onArrival: false, scheduledSummary: false, inboxOnly: true, starredOnly: false },
  summarySchedule: { cadence: 'daily', time: '09:00', everyHours: 4, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
  behaviors: Object.fromEntries(AI_BEHAVIORS.map(feature => [feature.id, true])),
  folders: { inbox: true, sent: false, drafts: true, archive: false, trash: false },
  content: { subject: true, body: true, sender: true, contacts: true, calendar: true, attachments: false },
  maxMessages: 8,
};

export function matchesAITrigger(policy, trigger, message) {
  const action = { onOpen: 'summary', onReply: 'reply', onArrival: 'summary' }[trigger];
  return !!(action && policy.enabled && policy.triggers?.[trigger] && policy.behaviors[action] && message &&
    !['drafts', 'trash'].includes(message.folder) && policy.folders[message.folder] &&
    (!policy.triggers.inboxOnly || message.folder === 'inbox') && (!policy.triggers.starredOnly || message.starred) &&
    ['subject', 'body', 'sender'].some(key => policy.content[key]));
}

export const DEFAULT_PREFERENCES = {
  displayName: '', signature: '', signatureFormat: 'plain', theme: 'system', density: 'comfortable', sort: 'newest',
  markReadOnOpen: true, replyTone: 'friendly', language: 'English', translationLanguage: '', syncInterval: 0,
};

export const DEFAULT_SKILLS = [
  { id: 'action-list', name: 'Find my next actions', instructions: 'List explicit requests and deadlines in these emails, grouped by sender. Do not invent dates or commitments.', enabled: true, folders: { inbox: true, sent: false, drafts: false, archive: false, trash: false } },
  { id: 'meeting-prep', name: 'Prepare for a conversation', instructions: 'Create a concise preparation brief: background, open questions, and a proposed agenda. Cite the email subjects.', enabled: true, folders: { inbox: true, sent: false, drafts: false, archive: false, trash: false } },
];
