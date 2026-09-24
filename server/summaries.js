export const priorityGuide = 'P0: explicit emergency requiring immediate attention. P1: explicit action due today. P2: normal action or follow-up. P3: information with no action requested. P4: low-priority bulk/promotional mail. Use P2 when urgency is unclear; never invent a deadline or emergency. Priorities are suggestions for human review.';

export function prioritySummary(raw, messages) {
  let entries;
  try { entries = JSON.parse(raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1')).items; } catch { /* Validated below. */ }
  const ids = new Set(messages.map(message => message.id)), seen = new Set();
  if (!Array.isArray(entries) || entries.length !== ids.size || entries.some(item => {
    if (!item || !ids.has(item.messageId) || seen.has(item.messageId) || !/^P[0-4]$/.test(item.priority) || typeof item.summary !== 'string' || !item.summary.trim() || item.summary.length > 4000) return true;
    seen.add(item.messageId); return false;
  })) throw Object.assign(new Error('The model returned an incomplete P0–P4 summary. Try fewer context messages or a higher response token limit.'), { status: 502 });
  const items = entries.map(({ messageId, priority, summary }) => ({ messageId, priority, summary: summary.trim() })).sort((a, b) => a.priority.localeCompare(b.priority));
  return { items, text: ['P0', 'P1', 'P2', 'P3', 'P4'].map(priority => `${priority} (${items.filter(item => item.priority === priority).length})\n${items.filter(item => item.priority === priority).map(item => `• ${item.summary}`).join('\n') || '—'}`).join('\n\n') };
}
