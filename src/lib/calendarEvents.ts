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
import {
  attendeeFor, replyBody, replyIcs, replySubject, type InviteResponse,
} from './inviteReply.ts'

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
   * ONE UPSERT, WHETHER OR NOT THERE IS A UID.
   *
   * This read `invite.uid ? upsert : insert` because the unique index used to be partial
   * (`where ical_uid is not null`) and an upsert against it failed outright — "there is no unique
   * or exclusion constraint matching the ON CONFLICT specification", which is what the firm saw
   * on the button. Postgres will only use a partial index for an ON CONFLICT when the statement
   * repeats its predicate, and PostgREST emits none. The index is now a plain one, which allows
   * exactly the same rows — NULLs are distinct in a unique btree, so hand-made events with no UID
   * still coexist — and an ON CONFLICT on a null UID matches nothing and inserts. The branch is
   * gone rather than left in place untested.
   */
  const { data, error } = await supabase
    .from('calendar_events')
    .upsert(row, { onConflict: 'owner_id,ical_uid' })
    .select(COLUMNS).single()
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

/* ---------- answering the organiser ---------- */

/**
 * Tell the organiser, and remember that we did.
 *
 * TWO THINGS HAPPEN AND ONE OF THEM IS IRREVERSIBLE. The reply is an email: once it has gone,
 * it has gone. So it goes FIRST, and the note in Raptor is written only after the mail server
 * has taken it — the other order would leave a card saying "You accepted" for an answer that
 * never left the building, which is exactly the kind of quiet lie that ends with somebody not
 * turning up.
 *
 * A failure to write the note afterwards is swallowed on purpose: the organiser has been told,
 * which is the part that matters to them, and the worst that follows is that the card offers
 * the buttons again.
 */
export async function replyToInvite(input: {
  invite: CalendarInvite
  response: InviteResponse
  /** Every address this person answers to, so the reply goes out as the one they were invited as. */
  myAddresses: string[]
  /** The message the invitation arrived on. The note is written against it. */
  mailId: string | null
  accessToken: string
  /** When the meeting is, in words, for the one line the organiser reads. */
  when: string | null
}): Promise<void> {
  const { invite, response, myAddresses, mailId, accessToken } = input
  const organiser = invite.organiser?.email
  if (!invite.uid || !organiser) {
    throw new Error('This invitation does not say who to answer, so Raptor cannot reply to it.')
  }
  const me = attendeeFor(invite.attendees, myAddresses)
  if (!me) throw new Error('Raptor does not know which address you were invited as.')

  const at = inviteInstant(invite.when)
  const ics = replyIcs({
    uid: invite.uid,
    sequence: invite.sequence,
    summary: invite.summary,
    organiser: { name: invite.organiser?.name ?? null, email: organiser },
    me,
    response,
    now: new Date(),
    /* An all-day event's dates are not instants and are left out rather than stamped at midnight
       UTC, which would be a time nobody agreed to. */
    startsAt: invite.when.allDay ? null : at.startsAt,
    endsAt: invite.when.allDay ? null : at.endsAt,
  })

  const res = await fetch('/api/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      to: organiser,
      subject: replySubject(invite.summary, response),
      bodyHtml: replyBody({ summary: invite.summary, response, when: input.when, me }),
      calendarReply: ics,
    }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? 'Could not send your answer to the organiser.')
  }

  if (!mailId) return
  await supabase
    .from('user_emails')
    .update({ invite_response: response, invite_responded_at: new Date().toISOString() })
    .eq('id', mailId)
    /* The organiser already has the answer; a note we failed to write is not worth undoing it. */
    .then(undefined, () => {})
}
