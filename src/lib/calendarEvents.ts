/**
 * Raptor's own calendar: reading and writing it.
 *
 * The queries only; every rule lives in calendarInvite.ts, which imports nothing.
 *
 * The firm's instruction on an invite: "it should go to the Raptor calendar ... the Raptor one
 * should be the main one." Until this existed the Calendar page was a rendering of tasks and deal
 * close dates, so accepting an invitation had nowhere to land and the .ics went to whatever
 * calendar the device happened to have.
 */
import { supabase } from './supabase'
import { inviteInstant, type CalendarInvite } from './calendarInvite.ts'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come back as untyped JSON from PostgREST. */

export interface CalendarEvent {
  id: string
  ownerId: string
  title: string
  /** Null for an all-day event, and for an invite whose time was floating. See startsOn. */
  startsAt: string | null
  endsAt: string | null
  allDay: boolean
  startsOn: string | null
  endsOn: string | null
  location: string | null
  notes: string | null
  source: 'manual' | 'invite'
  icalUid: string | null
  organiserName: string | null
  organiserEmail: string | null
  attendees: { name: string | null; email: string | null }[]
  userEmailId: string | null
  createdAt: string
}

const COLUMNS =
  'id,owner_id,title,starts_at,ends_at,all_day,starts_on,ends_on,location,notes,source,'
  + 'ical_uid,organiser_name,organiser_email,attendees,user_email_id,created_at'

/*
 * EVERY COLUMN BY HAND, and this file is the reason to be careful: a column present in the
 * database, in the type and in the select but missing here reads as undefined for ever and
 * nothing fails. diary_capacity sat in that state for months.
 */
const toEvent = (r: any): CalendarEvent => ({
  id: r.id,
  ownerId: r.owner_id,
  title: r.title,
  startsAt: r.starts_at ?? null,
  endsAt: r.ends_at ?? null,
  allDay: !!r.all_day,
  startsOn: r.starts_on ?? null,
  endsOn: r.ends_on ?? null,
  location: r.location ?? null,
  notes: r.notes ?? null,
  source: r.source,
  icalUid: r.ical_uid ?? null,
  organiserName: r.organiser_name ?? null,
  organiserEmail: r.organiser_email ?? null,
  attendees: Array.isArray(r.attendees) ? r.attendees : [],
  userEmailId: r.user_email_id ?? null,
  createdAt: r.created_at,
})

/** This person's calendar. RLS scopes it to them as well; the filter is for the index. */
export async function fetchCalendarEvents(ownerId: string): Promise<CalendarEvent[]> {
  const { data, error } = await supabase.from('calendar_events')
    .select(COLUMNS).eq('owner_id', ownerId).order('starts_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map(toEvent)
}

/**
 * Put a meeting request on somebody's calendar.
 *
 * UPSERTED ON THE INVITE'S UID, which is what stops a revised invitation arriving as a second
 * meeting. An organiser who moves a meeting sends the whole thing again carrying the same UID;
 * inserted blindly, a collector's Tuesday would fill up with the same catch-up four times.
 *
 * A CANCELLATION IS NEVER ADDED. It arrives looking like an invitation and means the opposite,
 * and the screen does not offer the button — this is the second guard, because the cost of
 * getting it wrong is a meeting in somebody's day that the organiser has called off.
 */
export async function acceptInvite(input: {
  invite: CalendarInvite
  ownerId: string
  /** The message it came off, so the event can point back at what was agreed to. */
  userEmailId: string | null
}): Promise<CalendarEvent> {
  const { invite, ownerId, userEmailId } = input
  if (invite.cancelled) throw new Error('That meeting has been cancelled — there is nothing to add.')

  const at = inviteInstant(invite.when)
  const row = {
    owner_id: ownerId,
    title: invite.summary ?? 'Untitled meeting',
    /* An all-day event is a date and has no time; storing midnight would show it as 00:00. */
    starts_at: invite.when.allDay ? null : at.startsAt,
    ends_at: invite.when.allDay ? null : at.endsAt,
    all_day: invite.when.allDay,
    starts_on: invite.when.allDay ? at.startsAt : null,
    ends_on: invite.when.allDay ? at.endsAt : null,
    location: invite.location,
    notes: invite.description,
    source: 'invite' as const,
    ical_uid: invite.uid,
    organiser_name: invite.organiser?.name ?? null,
    organiser_email: invite.organiser?.email ?? null,
    attendees: invite.attendees.map((a) => ({ name: a.name, email: a.email })),
    user_email_id: userEmailId,
    created_by: ownerId,
  }

  /*
   * An invite with no UID cannot be matched to a later revision, so it is inserted rather than
   * upserted — PostgREST would otherwise conflict every one of them onto the same null key.
   */
  const q = invite.uid
    ? supabase.from('calendar_events').upsert(row, { onConflict: 'owner_id,ical_uid' })
    : supabase.from('calendar_events').insert(row)

  const { data, error } = await q.select(COLUMNS).single()
  if (error) throw new Error(error.message)
  return toEvent(data)
}

/** Take it off again. The honest undo for a meeting somebody added and then could not attend. */
export async function removeCalendarEvent(id: string): Promise<void> {
  const { error } = await supabase.from('calendar_events').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Whether this invitation is already on the calendar.
 *
 * Matched on the UID rather than on the title and time, because a revised invitation changes the
 * time and is still the same meeting — which is exactly when somebody is most likely to press the
 * button again.
 */
export function eventForInvite(
  events: CalendarEvent[], invite: CalendarInvite,
): CalendarEvent | null {
  if (!invite.uid) return null
  return events.find((e) => e.icalUid === invite.uid) ?? null
}
