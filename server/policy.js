import { preferencesFooter } from './footer.js';
import { AI_BEHAVIORS, DEFAULT_POLICY, DEFAULT_PREFERENCES } from '../shared/features.js';

function invalid(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }

export function resolvePolicy(saved = {}) {
  return { ...DEFAULT_POLICY, ...saved, behaviors: { ...DEFAULT_POLICY.behaviors, ...saved.behaviors }, folders: { ...DEFAULT_POLICY.folders, ...saved.folders }, content: { ...DEFAULT_POLICY.content, ...saved.content } };
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
      if (!Number.isInteger(value) || value < 1 || value > 25) invalid('Context limit must be between 1 and 25 messages.');
      next.maxMessages = value;
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
  const choices = { signatureFormat: ['plain', 'html'], theme: ['system', 'light', 'dark'], density: ['comfortable', 'compact', 'spacious'], sort: ['newest', 'oldest', 'sender', 'subject', 'unread', 'starred'], replyTone: ['friendly', 'professional', 'concise', 'warm'], syncInterval: [0, 5, 15, 30] };
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULT_PREFERENCES, key)) invalid(`Unknown preference: ${key}.`);
    if (choices[key]) {
      if (!choices[key].includes(value)) invalid(`Invalid ${key} preference.`);
    } else if (key === 'markReadOnOpen') {
      if (typeof value !== 'boolean') invalid('Mark read on open must be true or false.');
    } else {
      const max = key === 'signature' ? 12000 : key === 'language' ? 60 : 100;
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
