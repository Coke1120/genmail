import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, ExternalLink, LoaderCircle, MapPin, Plus, RefreshCw, Settings2, X } from 'lucide-react';
import './calendar.css';

const PROVIDERS = { google: 'Google Calendar', microsoft: 'Outlook Calendar' };
const dateValue = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const localValue = date => `${dateValue(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
const addDays = (value, days) => { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + days); return dateValue(date); };
const initialRange = () => { const start = dateValue(new Date()); return { start, end: addDays(start, 6) }; };
const initialForm = () => { const start = new Date(); start.setDate(start.getDate() + 1); start.setHours(9, 0, 0, 0); const end = new Date(start); end.setHours(10); return { title: '', description: '', location: '', start: localValue(start), end: localValue(end) }; };
const calendarKey = calendar => JSON.stringify([calendar.provider, calendar.id]);
const readableDate = value => { const date = new Date(value?.length === 10 ? `${value}T12:00:00` : value); return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); };
const readableTime = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); };
const safeWebUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; } };

async function calendarRequest(path, options = {}) {
  const response = await fetch(`/api/calendars${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Calendar request failed (${response.status}). Please try again.`);
  return body;
}

export default function Calendar({ onNotify, onOpenSettings, onDirtyChange, onBusyChange }) {
  const [catalog, setCatalog] = useState({ connections: [], calendars: [], errors: [] });
  const [selection, setSelection] = useState('');
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [range, setRange] = useState(initialRange);
  const [events, setEvents] = useState([]);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventError, setEventError] = useState('');
  const [eventsRevision, setEventsRevision] = useState(0);
  const [form, setForm] = useState(initialForm);
  const savedForm = useRef(form);
  const [formOpen, setFormOpen] = useState(false);
  const [review, setReview] = useState(null);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const pendingCreate = useRef(null);
  const attempt = useRef(null);
  const formHeading = useRef(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const selected = catalog.calendars.find(calendar => calendarKey(calendar) === selection);
  const connection = catalog.connections.find(item => item.provider === selected?.provider && item.connected);
  const rangeDays = (Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86400000 + 1;
  const rangeError = !Number.isFinite(rangeDays) || rangeDays < 1 ? 'Choose an end date on or after the start date.' : rangeDays > 90 ? 'Choose a range of 90 days or fewer.' : '';
  const dirty = formOpen && (JSON.stringify(form) !== JSON.stringify(savedForm.current) || !!review);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(creating); }, [creating, onBusyChange]);
  useEffect(() => {
    const warn = event => { if (dirty || creating) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, creating]);
  useEffect(() => () => { pendingCreate.current?.abort(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setCatalogError('');
    calendarRequest('', { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setCatalog(result);
      setSelection(previous => result.calendars.some(calendar => calendarKey(calendar) === previous) ? previous : result.calendars.length ? calendarKey(result.calendars.find(calendar => calendar.primary) || result.calendars[0]) : '');
    }).catch(error => { if (!controller.signal.aborted) setCatalogError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [catalogRevision]);

  useEffect(() => {
    const controller = new AbortController();
    setEvents([]); setEventError('');
    if (!selected || !connection || rangeError) { setEventLoading(false); return () => controller.abort(); }
    setEventLoading(true);
    const query = new URLSearchParams({ calendarId: selected.id, start: new Date(`${range.start}T00:00:00`).toISOString(), end: new Date(`${addDays(range.end, 1)}T00:00:00`).toISOString() });
    calendarRequest(`/${selected.provider}/events?${query}`, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setEvents(result.events || []);
    }).catch(error => { if (!controller.signal.aborted) setEventError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setEventLoading(false); });
    return () => controller.abort();
  }, [selection, connection?.email, range.start, range.end, rangeError, eventsRevision, catalogRevision]);

  function openForm() {
    setFormOpen(true); setCreateError('');
    requestAnimationFrame(() => formHeading.current?.focus());
  }

  function resetForm() {
    const next = initialForm(); savedForm.current = next; setForm(next);
  }

  function closeForm() {
    if (creating || (dirty && !window.confirm('Discard this calendar event draft?'))) return;
    setFormOpen(false); setReview(null); resetForm(); setCreateError(''); attempt.current = null;
  }

  function reviewEvent(event) {
    event.preventDefault(); setCreateError('');
    if (!selected?.canWrite || !connection || creating) return;
    const start = new Date(form.start); const end = new Date(form.end);
    if (!form.title.trim() || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) { setCreateError('Enter a title and an end time after the start time.'); return; }
    // Native datetime fields normalize daylight-saving gaps; reject that silent time change.
    if (localValue(start) !== form.start || localValue(end) !== form.end) { setCreateError('This local time does not exist because the clocks change. Choose another time.'); return; }
    setReview({ provider: selected.provider, calendarName: selected.name, calendarId: selected.id, connectionEmail: connection.email, title: form.title.trim(), description: form.description.trim(), location: form.location.trim(), start: start.toISOString(), end: end.toISOString() });
  }

  async function createEvent() {
    if (!review || pendingCreate.current || !connection || review.connectionEmail !== connection.email || review.provider !== selected?.provider || review.calendarId !== selected?.id) return;
    const { provider, calendarName, ...payload } = review;
    const fingerprint = JSON.stringify({ provider, ...payload });
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: crypto.randomUUID() };
    const controller = new AbortController(); pendingCreate.current = controller;
    setCreating(true); setCreateError('');
    try {
      await calendarRequest(`/${provider}/events`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, requestId: attempt.current.requestId }) });
      if (controller.signal.aborted) return;
      setFormOpen(false); setReview(null); resetForm(); attempt.current = null;
      setEventsRevision(value => value + 1);
      onNotify?.(`Event created in ${PROVIDERS[provider]}.`);
    } catch (error) {
      if (!controller.signal.aborted) setCreateError(`${error.message} Your reviewed event is kept. Retrying uses the same request ID to avoid creating a duplicate.`);
    } finally { if (pendingCreate.current === controller) { pendingCreate.current = null; if (!controller.signal.aborted) setCreating(false); } }
  }

  function changeSelection(value) {
    if (creating || (dirty && !window.confirm('Discard this event draft and switch calendars?'))) return;
    setSelection(value); setFormOpen(false); setReview(null); setCreateError(''); resetForm(); attempt.current = null;
  }

  return <section className="calendar-page" aria-label="Calendar">
    <div className="calendar-inner">
      <header className="calendar-heading"><div><span className="eyebrow">A LITTLE ROOM IN YOUR DAY</span><h1>Your calendar<span>.</span></h1><p>Google and Outlook, connected to your real schedule.</p></div><button className="button secondary" onClick={onOpenSettings} disabled={creating}><Settings2 size={15} />Connections</button></header>
      {catalogError && <div className="calendar-error" role="alert"><p>{catalogError}</p><button className="button secondary" onClick={() => setCatalogRevision(value => value + 1)}>Retry connections</button></div>}
      {catalog.errors?.map(error => <div className="calendar-error" role="alert" key={error.provider}><p><strong>{PROVIDERS[error.provider] || error.provider}:</strong> {error.message}</p><button className="button secondary" onClick={onOpenSettings}>Manage connection</button></div>)}
      {loading && <p className="calendar-status" role="status"><LoaderCircle size={17} className="calendar-spinner" />Loading calendars…</p>}
      {!loading && !catalog.calendars.length && !catalogError && <section className="calendar-empty"><span className="calendar-empty-icon"><CalendarDays size={31} /></span><h2>Bring your day together.</h2><p>Connect Google Calendar or Outlook Calendar to view events and create plans. Calendar connections work independently of your mailbox.</p><button className="button primary" onClick={onOpenSettings}>Connect a calendar</button></section>}
      {!!catalog.calendars.length && <>
        <section className="calendar-controls" aria-label="Calendar and date range">
          <label className="calendar-field calendar-selector">Calendar<select value={selection} onChange={event => changeSelection(event.target.value)} disabled={creating}>{catalog.calendars.map(calendar => <option key={calendarKey(calendar)} value={calendarKey(calendar)}>{PROVIDERS[calendar.provider]} · {calendar.name}{calendar.canWrite ? '' : ' (read only)'}</option>)}</select></label>
          <div className="calendar-range"><label className="calendar-field">From<input type="date" value={range.start} onChange={event => setRange(value => ({ ...value, start: event.target.value }))} required disabled={creating} /></label><label className="calendar-field">Through<input type="date" value={range.end} min={range.start} max={range.start ? addDays(range.start, 89) : undefined} onChange={event => setRange(value => ({ ...value, end: event.target.value }))} required disabled={creating} /></label></div>
          <div className="calendar-navigation"><button className="icon-button" aria-label="Previous week" disabled={creating || !!rangeError} onClick={() => setRange(value => ({ start: addDays(value.start, -7), end: addDays(value.end, -7) }))}><ChevronLeft size={17} /></button><button className="button ghost" disabled={creating} onClick={() => setRange(initialRange())}>Today</button><button className="icon-button" aria-label="Next week" disabled={creating || !!rangeError} onClick={() => setRange(value => ({ start: addDays(value.start, 7), end: addDays(value.end, 7) }))}><ChevronRight size={17} /></button></div>
        </section>
        <div className="calendar-agenda-heading"><div><h2>{selected?.name || 'Agenda'}</h2><p>Times shown in {timezone}.{selected?.timeZone && selected.timeZone !== timezone ? ` Calendar timezone: ${selected.timeZone}.` : ''}</p>{connection && <p>{connection.email} · {PROVIDERS[selected?.provider]}</p>}</div><div className="calendar-button-row"><button className="icon-button" aria-label="Refresh calendar events" disabled={eventLoading || creating || !!rangeError} onClick={() => setEventsRevision(value => value + 1)}><RefreshCw size={16} className={eventLoading ? 'calendar-spinner' : ''} /></button><button className="button primary" disabled={!selected?.canWrite || !connection || formOpen || creating} onClick={openForm}><Plus size={15} />New event</button></div></div>
        {selected && !selected.canWrite && <p className="calendar-note">You have read-only access to this calendar. Choose a writable calendar to create an event.</p>}
        {formOpen && <section className="calendar-event-form" aria-labelledby="calendar-new-event"><div className="calendar-form-heading"><h2 id="calendar-new-event" tabIndex={-1} ref={formHeading}>{review ? 'Review your event' : 'Make a little time.'}</h2><button className="icon-button" aria-label="Close event draft" onClick={closeForm} disabled={creating}><X size={18} /></button></div>
          {createError && <p className="calendar-error" role="alert">{createError}</p>}
          {review ? <><dl className="calendar-review"><div><dt>Calendar</dt><dd>{PROVIDERS[review.provider]} · {review.calendarName}<small>{review.connectionEmail}</small></dd></div><div><dt>Event</dt><dd>{review.title}</dd></div><div><dt>Starts</dt><dd>{readableDate(review.start)} · {readableTime(review.start)}</dd></div><div><dt>Ends</dt><dd>{readableDate(review.end)} · {readableTime(review.end)}</dd></div><div><dt>Timezone</dt><dd>{timezone}</dd></div>{review.location && <div><dt>Location</dt><dd>{review.location}</dd></div>}{review.description && <div><dt>Description</dt><dd>{review.description}</dd></div>}</dl><p className="calendar-note">This creates a real event in the selected calendar. No attendees are added.</p><div className="calendar-form-actions"><button className="button secondary" disabled={creating} onClick={() => { setReview(null); setCreateError(''); }}>Edit details</button><button className="button primary" disabled={creating} onClick={createEvent}>{creating ? <LoaderCircle size={15} className="calendar-spinner" /> : <Check size={15} />}{creating ? 'Creating event…' : `Create event in ${PROVIDERS[review.provider]}`}</button></div></> : <form onSubmit={reviewEvent}><fieldset disabled={creating}><label className="calendar-field">Event title<input required maxLength={200} value={form.title} onChange={event => setForm(value => ({ ...value, title: event.target.value }))} placeholder="Time to catch up" /></label><div className="calendar-form-columns"><label className="calendar-field">Starts<input type="datetime-local" required value={form.start} onChange={event => setForm(value => ({ ...value, start: event.target.value }))} /></label><label className="calendar-field">Ends<input type="datetime-local" required value={form.end} onChange={event => setForm(value => ({ ...value, end: event.target.value }))} /></label></div><p className="calendar-note">Enter times in {timezone}. Review the exact date and time before creating.</p><label className="calendar-field">Location <span>(optional)</span><input maxLength={500} value={form.location} onChange={event => setForm(value => ({ ...value, location: event.target.value }))} /></label><label className="calendar-field">Description <span>(optional)</span><textarea rows={3} maxLength={5000} value={form.description} onChange={event => setForm(value => ({ ...value, description: event.target.value }))} /></label><div className="calendar-form-actions"><button type="button" className="button secondary" onClick={closeForm}>Cancel</button><button className="button primary" type="submit">Review event<ChevronRight size={15} /></button></div></fieldset></form>}
        </section>}
        {rangeError && <p className="calendar-error" role="alert">{rangeError}</p>}
        {eventError && <div className="calendar-error" role="alert"><p>{eventError}</p><button className="button secondary" onClick={() => setEventsRevision(value => value + 1)}>Retry events</button></div>}
        {eventLoading && <p className="calendar-status" role="status"><LoaderCircle size={17} className="calendar-spinner" />Loading events…</p>}
        {!eventLoading && !eventError && !rangeError && <section className="calendar-agenda" aria-label="Calendar events" aria-live="polite">{events.length ? events.map(event => {
          const link = safeWebUrl(event.webUrl);
          const allDayEnd = event.end?.slice(0, 10);
          return <article className="calendar-event" key={event.id}><div className="calendar-event-date"><CalendarDays size={16} /><strong>{readableDate(event.start)}</strong><span>{event.allDay ? 'All day' : readableTime(event.start)}</span></div><div className="calendar-event-content"><h3>{event.title || '(Untitled event)'}</h3><p><Clock3 size={13} />{event.allDay ? `All day${allDayEnd && allDayEnd !== addDays(event.start.slice(0, 10), 1) ? ` · through ${readableDate(addDays(allDayEnd, -1))}` : ''}` : `${readableTime(event.start)} – ${readableDate(event.start) === readableDate(event.end) ? '' : `${readableDate(event.end)} · `}${readableTime(event.end)}`}{event.status === 'cancelled' ? ' · Cancelled' : ''}</p>{event.location && <p><MapPin size={13} />{event.location}</p>}{event.description && <details><summary>Description</summary><p className="calendar-description">{event.description}</p></details>}</div>{link && <a className="calendar-event-link" href={link} target="_blank" rel="noopener noreferrer" aria-label={`Open ${event.title || 'event'} in ${PROVIDERS[selected?.provider]}`}>Open<ExternalLink size={13} /></a>}</article>;
        }) : <div className="calendar-empty-agenda"><CalendarDays size={25} /><h3>A little breathing room.</h3><p>No events in this date range.</p></div>}</section>}
      </>}
    </div>
  </section>;
}
