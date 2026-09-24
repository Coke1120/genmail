import { preferencesFooter } from './footer.js';
import { AI_BEHAVIORS, DEFAULT_POLICY, DEFAULT_PREFERENCES } from '../shared/features.js';

function invalid(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }

export function resolvePolicy(saved = {}) {
  return { ...DEFAULT_POLICY, ...saved, summarySchedule: { ...DEFAULT_POLICY.summarySchedule, ...saved.summarySchedule }, triggers: { ...DEFAULT_POLICY.triggers, ...saved.triggers }, behaviors: { ...DEFAULT_POLICY.behaviors, ...saved.behaviors }, folders: { ...DEFAULT_POLICY.folders, ...saved.folders }, content: { ...DEFAULT_POLICY.content, ...saved.content } };
}

export function updatePolicy(current, patch) {
  if (!object(patch)) invalid('AI permissions must be an object.');
  const next = resolvePolicy(current);
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULT_POLICY, key)) invalid(`Unknown permission: ${key}.`);
    if (key === 'enabled') {
      if (typeof value !== 'boolean') invalid('AI enabled must be true or false.');
      next.enabled = value;
    } else if (key === 'maxMessages') {
      if (!Number.isInteger(value) || value < 1 || value > 50) invalid('Context limit must be between 1 and 50 messages.');
      next.maxMessages = value;
    } else if (key === 'summarySchedule') {
      if (!object(value)) invalid('Summary schedule must be an object.');
      for (const [field, entry] of Object.entries(value)) {
        if (!Object.hasOwn(DEFAULT_POLICY.summarySchedule, field)) invalid('Unknown summary schedule setting.');
        if (field === 'cadence' && !['daily', 'interval'].includes(entry)) invalid('Choose daily or interval summaries.');
        if (field === 'time' && (typeof entry !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry))) invalid('Summary time must use HH:MM.');
        if (field === 'everyHours' && (!Number.isInteger(entry) || entry < 1 || entry > 168)) invalid('Summary interval must be 1–168 whole hours.');
        if (field === 'timeZone') {
          if (typeof entry !== 'string' || !entry.trim() || entry.length > 100) invalid('Choose a valid IANA time zone.');
          try { new Intl.DateTimeFormat('en', { timeZone: entry }).format(); } catch { invalid('Choose a valid IANA time zone, such as Asia/Hong_Kong.'); }
        }
        next.summarySchedule[field] = entry;
      }
    } else {
      if (!object(value)) invalid(`${key} must contain permission checkboxes.`);
      for (const [id, enabled] of Object.entries(value)) {
        if (!Object.hasOwn(DEFAULT_POLICY[key], id) || typeof enabled !== 'boolean') invalid(`Invalid ${key} permission: ${id}.`);
        next[key][id] = enabled;
      }
    }
  }
  return next;
}

export function updatePreferences(current, patch) {
  if (!object(patch)) invalid('Preferences must be an object.');
  const next = { ...DEFAULT_PREFERENCES, ...current };
  const choices = { signatureFormat: ['plain', 'html'], theme: ['system', 'light', 'dark'], density: ['comfortable', 'compact', 'spacious'], sort: ['newest', 'oldest', 'sender', 'subject', 'unread', 'starred'], replyTone: ['friendly', 'professional', 'concise', 'warm'], syncInterval: [0, 1, 5, 15, 30] };
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULT_PREFERENCES, key)) invalid(`Unknown preference: ${key}.`);
    if (choices[key]) {
      if (!choices[key].includes(value)) invalid(`Invalid ${key} preference.`);
    } else if (key === 'markReadOnOpen') {
      if (typeof value !== 'boolean') invalid('Mark read on open must be true or false.');
    } else {
      const max = key === 'signature' ? 12000 : ['language', 'translationLanguage'].includes(key) ? 60 : 100;
      if (typeof value !== 'string' || value.length > max || (key === 'language' && !value.trim())) invalid(`${key} must be text of at most ${max} characters.`);
      if (key === 'displayName' && /[\r\n]/.test(value)) invalid('Display name must be a single line.');
    }
    next[key] = value;
  }
  const footer = preferencesFooter(next);
  next.signature = next.signatureFormat === 'html' ? footer.html : footer.text;
  return next;
}

export function requireBehavior(policy, action) {
  const feature = AI_BEHAVIORS.find(item => item.id === action);
  if (!feature) invalid('Unknown AI behavior.');
  if (!policy.enabled || !policy.behaviors[action]) invalid(`${feature.label} is disabled in AI permissions.`, 403);
  const scope = { memory: 'contacts', research: 'contacts', meeting: 'calendar', schedule: 'calendar', attachments: 'attachments' }[action];
  if (scope && !policy.content[scope]) invalid(`Enable ${scope} access in AI permissions to use ${feature.label.toLowerCase()}.`, 403);
  if (action === 'batchReplies' && (!policy.content.sender || !policy.content.body)) invalid('Batch replies require sender and body access.', 403);
  return feature;
}

export function redactMessage(message, policy) {
  return {
    id: message.id, date: message.date, folder: message.folder, read: message.read, starred: message.starred,
    fromName: policy.content.sender ? message.fromName : '', fromEmail: policy.content.sender ? message.fromEmail : '',
    to: policy.content.sender ? message.to : '', subject: policy.content.subject ? message.subject : '',
    body: policy.content.body ? message.body : '', preview: policy.content.body ? message.preview : '',
    category: message.category, labels: policy.content.subject ? message.labels : [],
  };
}

export function permittedMessages(messages, policy) {
  return messages.filter(message => policy.folders[message.folder]).map(message => redactMessage(message, policy));
}
