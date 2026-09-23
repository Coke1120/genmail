import { createHash } from 'node:crypto';
import { simpleParser } from 'mailparser';
import { providerRequest } from './providers.js';

const origins = { google: 'https://www.googleapis.com', microsoft: 'https://graph.microsoft.com' };
const roots = { google: '/calendar/v3', microsoft: '/v1.0/me' };

function connectionProvider(connection) {
  if (!Object.hasOwn(origins, connection?.provider) || typeof connection.accessToken !== 'string' || !connection.accessToken) {
    throw new Error('A connected Google or Microsoft calendar is required.');
  }
  return connection.provider;
}

function calendarPath(provider, calendarId) {
  if (typeof calendarId !== 'string' || !calendarId || calendarId.length > 2048 || /[\x00-\x1f\x7f]/.test(calendarId) || ['.', '..'].includes(calendarId)) {
    throw new Error('A valid calendar ID is required.');
  }
  return `${roots[provider]}/calendars/${encodeURIComponent(calendarId)}`;
}

function api(connection, path, options = {}) {
  const provider = connectionProvider(connection);
  return providerRequest(`${origins[provider]}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      ...(provider === 'microsoft' ? { Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"' } : {}),
      ...options.headers,
    },
  }, provider === 'google' ? 'Google Calendar' : 'Outlook Calendar');
}

async function pages(connection, path, limit) {
  const provider = connectionProvider(connection);
  const original = new URL(path, origins[provider]);
  const items = [];
  const seen = new Set();
  let next = original;
  // ponytail: bounded complete reads; add incremental sync if a calendar exceeds these limits.
  for (let page = 0; page < 10; page++) {
    if (seen.has(next.href)) throw new Error('The calendar provider returned a repeated page.');
    seen.add(next.href);
    const result = await api(connection, `${next.pathname}${next.search}`);
    const entries = provider === 'google' ? result?.items : result?.value;
    if (entries !== undefined && !Array.isArray(entries)) throw new Error('The calendar provider returned an invalid list.');
    if (!result || typeof result !== 'object') throw new Error('The calendar provider returned an invalid list.');
    items.push(...(entries || []));
    if (items.length > limit) throw new Error(`This calendar request exceeds ${limit} items. Select a smaller date range.`);
    const cursor = provider === 'google' ? result.nextPageToken : result['@odata.nextLink'];
    if (!cursor) return items;
    if (typeof cursor !== 'string' || cursor.length > 8192) throw new Error('The calendar provider returned an invalid next page.');
    if (provider === 'google') {
      next = new URL(original);
      next.searchParams.set('pageToken', cursor);
    } else {
      try { next = new URL(cursor); } catch { throw new Error('The calendar provider returned an invalid next page.'); }
      if (next.origin !== original.origin || next.pathname !== original.pathname || next.username || next.password || next.hash) {
        throw new Error('The calendar provider returned an unsafe next page.');
      }
    }
  }
  throw new Error('This calendar request has too many pages. Select a smaller date range.');
}

export async function listCalendars(connection) {
  const provider = connectionProvider(connection);
  const items = await pages(connection, provider === 'google'
    ? '/calendar/v3/users/me/calendarList?maxResults=100'
    : '/v1.0/me/calendars?$top=100&$select=id,name,isDefaultCalendar,canEdit', 500);
  return items.filter(item => item && typeof item.id === 'string' && !item.deleted).map(item => ({
    id: item.id,
    name: String(provider === 'google' ? item.summaryOverride || item.summary || 'Untitled calendar' : item.name || 'Untitled calendar').slice(0, 500),
    primary: provider === 'google' ? !!item.primary : !!item.isDefaultCalendar,
    canWrite: provider === 'google' ? ['owner', 'writer'].includes(item.accessRole) : item.canEdit === true,
    timeZone: provider === 'google' && typeof item.timeZone === 'string' ? item.timeZone : 'UTC',
  }));
}

function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,7})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw new Error('Calendar dates must be valid ISO timestamps with a time zone.');
  }
  return new Date(value).toISOString();
}

function eventDate(value, provider, allDay) {
  if (provider === 'google' && allDay) {
    const date = value?.date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('Google Calendar returned an invalid event date.');
    }
    instant(`${date}T00:00:00Z`);
    return date;
  }
  let date = value?.dateTime;
  if (provider === 'microsoft' && typeof date === 'string' && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(date)) {
    if (value?.timeZone && !['UTC', 'Etc/UTC'].includes(value.timeZone)) throw new Error('Outlook Calendar did not return the requested UTC event times.');
    date += 'Z';
  }
  return instant(date);
}

async function normalizedEvent(item, provider, calendarId) {
  if (!item || typeof item.id !== 'string' || !item.id) throw new Error('The calendar provider returned an invalid event.');
  const allDay = provider === 'google' ? !!item.start?.date : !!item.isAllDay;
  let description = String(provider === 'google' ? item.description || '' : item.body?.content || '').slice(0, 100000);
  if (provider === 'google' || item.body?.contentType?.toLowerCase() === 'html') {
    description = (await simpleParser(`Content-Type: text/html; charset=utf-8\r\n\r\n${description}`, { skipTextToHtml: true })).text || '';
  }
  let webUrl = provider === 'google' ? item.htmlLink || '' : item.webLink || '';
  try {
    const parsed = new URL(webUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) webUrl = '';
  } catch { webUrl = ''; }
  return {
    id: item.id, title: String(provider === 'google' ? item.summary || '(No title)' : item.subject || '(No title)').slice(0, 1000),
    description, location: String(provider === 'google' ? item.location || '' : item.location?.displayName || '').slice(0, 2000),
    start: eventDate(item.start, provider, allDay), end: eventDate(item.end, provider, allDay), allDay,
    webUrl, calendarId, status: item.status === 'cancelled' || item.isCancelled ? 'cancelled' : 'confirmed',
  };
}

export async function listCalendarEvents(connection, { calendarId, start, end }) {
  const provider = connectionProvider(connection);
  const base = calendarPath(provider, calendarId);
  const from = instant(start);
  const to = instant(end);
  if (Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new Error('Choose a calendar date range of no more than 366 days.');
  const query = provider === 'google'
    ? new URLSearchParams({ timeMin: from, timeMax: to, singleEvents: 'true', orderBy: 'startTime', showDeleted: 'false', maxResults: '250' })
    : new URLSearchParams({ startDateTime: from, endDateTime: to, $top: '250', $orderby: 'start/dateTime', $select: 'id,subject,body,location,start,end,isAllDay,isCancelled,webLink,type' });
  const items = await pages(connection, `${base}/${provider === 'google' ? 'events' : 'calendarView'}?${query}`, 1000);
  return Promise.all(items.filter(item => item && item.status !== 'cancelled' && !item.isCancelled).map(item => normalizedEvent(item, provider, calendarId)));
}

export async function createCalendarEvent(connection, { calendarId, title, description = '', location = '', start, end, requestId }) {
  const provider = connectionProvider(connection);
  const base = calendarPath(provider, calendarId);
  if (typeof title !== 'string' || !title.trim() || title.length > 300 || /[\x00-\x1f\x7f]/.test(title)) throw new Error('A calendar event title of up to 300 characters is required.');
  if (typeof description !== 'string' || description.length > 10000 || typeof location !== 'string' || location.length > 1000) throw new Error('The calendar event description or location is too long.');
  if (typeof requestId !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(requestId)) throw new Error('A UUID request ID is required to create a calendar event.');
  const from = instant(start);
  const to = instant(end);
  if (Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new Error('The calendar event must end after it starts and last no more than 366 days.');
  const id = `m${createHash('sha256').update(requestId.toLowerCase()).digest('hex')}`;
  const escapedDescription = description.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  const body = provider === 'google'
    ? { id, summary: title.trim(), description: escapedDescription, location, start: { dateTime: from }, end: { dateTime: to } }
    : { transactionId: requestId.toLowerCase(), subject: title.trim(), body: { contentType: 'text', content: description }, location: { displayName: location }, start: { dateTime: from.slice(0, -1), timeZone: 'UTC' }, end: { dateTime: to.slice(0, -1), timeZone: 'UTC' } };
  let result;
  try {
    result = await api(connection, `${base}/events${provider === 'google' ? '?sendUpdates=none' : ''}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch (error) {
    if (provider !== 'google' || error.providerStatus !== 409) throw error;
    result = await api(connection, `${base}/events/${id}`);
    if (result?.status === 'cancelled' || result?.summary !== body.summary || (result?.description || '') !== body.description || (result?.location || '') !== body.location
      || eventDate(result.start, provider, false) !== from || eventDate(result.end, provider, false) !== to) {
      throw new Error('This calendar request ID was already used for different event details. Refresh before creating a new event.');
    }
  }
  return normalizedEvent(result, provider, calendarId);
}
