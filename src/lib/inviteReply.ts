/**
 * Answering a meeting request, so the organiser's own calendar hears about it.
 *
 * WHY THIS IS NOT JUST AN EMAIL SAYING "YES". Outlook, Google and Apple all update the
 * organiser's meeting automatically when the answer arrives as an iTIP reply — a `text/calendar`
 * part carrying METHOD:REPLY and this attendee's PARTSTAT (RFC 5546 §3.2.3). Danielle sees
 * "Stephan accepted" against the meeting itself. A polite email saying yes leaves her tracking
 * list still showing "No response", and she has to tick it off by hand or assume nobody is
 * coming.
 *
 * THE RULES ONLY. No queries, no fetch, no imports — so every one of them can be checked without
 * a mail server, which matters here because the failure mode is silent: a reply that is subtly
 * malformed is not rejected, it is ignored, and nobody finds out until the day of the meeting.
 *
 * What a REPLY must carry, and what it must not:
 *   - the SAME UID and SEQUENCE as the request, or the organiser cannot match it to the meeting
 *     or tell a stale answer from a current one
 *   - exactly ONE ATTENDEE, this person, with their PARTSTAT. Echoing the whole attendee list is
 *     the classic mistake and reads as this person answering on everybody's behalf.
 *   - the ORGANIZER, unchanged
 *   - a fresh DTSTAMP, which is when the answer was given
 */

export type InviteResponse = 'accepted' | 'tentative' | 'declined'

/** The PARTSTAT each answer is written as on the wire. */
export const PARTSTAT: Record<InviteResponse, string> = {
  accepted: 'ACCEPTED',
  tentative: 'TENTATIVE',
  declined: 'DECLINED',
}

/** How the answer is said to a person — on the button, in the subject, on the card afterwards. */
export const RESPONSE_WORD: Record<InviteResponse, string> = {
  accepted: 'Accepted',
  tentative: 'Tentative',
  declined: 'Declined',
}

export interface ReplyPerson {
  name: string | null
  email: string
}

/**
 * Escape a TEXT value for an ICS file.
 *
 * Backslash FIRST. Done in the other order, the backslash pass would go on to escape the
 * backslashes the comma and semicolon passes had just introduced, and one comma in a meeting
 * title would arrive at the organiser as "\\,".
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
}

/**
 * Fold a content line to 75 octets, as RFC 5545 requires.
 *
 * Counted in OCTETS, not characters. A meeting called "Kobus se herbeplanning – Julie" carries a
 * multi-byte dash, and a fold that counts characters can land in the middle of it: the two halves
 * arrive as broken bytes and the organiser's parser gives up on the line. Split on the encoded
 * bytes and the boundary is always between characters.
 */
export function foldIcsLine(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const decoder = new TextDecoder()
  const out: string[] = []
  let at = 0
  /* 75 for the first line, 74 after it, because each continuation spends an octet on its space. */
  let room = 75
  while (at < bytes.length) {
    let take = Math.min(room, bytes.length - at)
    /* Step back off a continuation byte (10xxxxxx) so a character is never cut in half. */
    while (take > 1 && at + take < bytes.length && (bytes[at + take] & 0xc0) === 0x80) take -= 1
    out.push(decoder.decode(bytes.slice(at, at + take)))
    at += take
    room = 74
  }
  return out.join('\r\n ')
}

/** An instant as ICS writes UTC: 20260929T123000Z. */
export function icsStamp(iso: string): string {
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`
}

/** A person as an ICS address line, with their name where the invite gave one. */
function personLine(name: string, person: ReplyPerson, params: string[] = []): string {
  const bits = [name]
  if (person.name) bits.push(`CN=${escapeIcsText(person.name)}`)
  bits.push(...params)
  return `${bits.join(';')}:mailto:${person.email}`
}

export interface ReplyInput {
  uid: string
  /** Echoed back unchanged. Absent on plenty of real invites, and 0 is the right default. */
  sequence: number | null
  summary: string | null
  organiser: ReplyPerson
  /** This person, as the invite addressed them — see `attendeeFor`. */
  me: ReplyPerson
  response: InviteResponse
  /** When the answer was given. Passed in so the output is testable. */
  now: Date
  /** The meeting's start and end as real instants, where they could be resolved. */
  startsAt?: string | null
  endsAt?: string | null
}

/**
 * The reply, as an ICS file.
 *
 * DTSTART is included only when the time could actually be resolved to an instant. An invite with
 * a floating time has no instant to state, and writing one anyway would be Raptor telling the
 * organiser a time nobody agreed to. RFC 5546 makes DTSTART optional in a REPLY precisely so it
 * can be left out.
 */
export function replyIcs(input: ReplyInput): string {
  const { uid, sequence, summary, organiser, me, response, now } = input
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Bredell Ferreira//Raptor//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:REPLY',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SEQUENCE:${sequence ?? 0}`,
    `DTSTAMP:${icsStamp(now.toISOString())}`,
    personLine('ORGANIZER', organiser),
    /*
     * ONE ATTENDEE, and it is this person. RSVP=FALSE says the answer is final rather than a
     * request for one back, which is what stops some clients from asking the organiser to
     * respond to the response.
     */
    personLine('ATTENDEE', me, [`PARTSTAT=${PARTSTAT[response]}`, 'RSVP=FALSE']),
  ]
  if (input.startsAt) lines.push(`DTSTART:${icsStamp(input.startsAt)}`)
  if (input.endsAt) lines.push(`DTEND:${icsStamp(input.endsAt)}`)
  if (summary) lines.push(`SUMMARY:${escapeIcsText(`${RESPONSE_WORD[response]}: ${summary}`)}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  /* CRLF throughout and a trailing one: some parsers drop a last line that has no ending. */
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`
}

/** What the organiser sees in their inbox. The convention every mail client already uses. */
export function replySubject(summary: string | null, response: InviteResponse): string {
  return `${RESPONSE_WORD[response]}: ${summary ?? 'Meeting'}`
}

/**
 * The note in the body.
 *
 * Short on purpose. The calendar part is what does the work; this is what the organiser reads if
 * their client shows the message rather than folding it into the meeting. It says what happened
 * and nothing else — an invented apology for a decline would be Raptor speaking for somebody.
 */
export function replyBody(input: {
  summary: string | null
  response: InviteResponse
  when: string | null
  me: ReplyPerson
}): string {
  const who = input.me.name ?? input.me.email
  const what = input.summary ?? 'the meeting'
  const verb = input.response === 'accepted' ? 'has accepted'
    : input.response === 'tentative' ? 'has tentatively accepted'
      : 'has declined'
  const when = input.when ? ` (${input.when})` : ''
  return `<p>${escapeHtml(who)} ${verb} your invitation to <strong>${escapeHtml(what)}</strong>${escapeHtml(when)}.</p>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Which attendee on the invitation is me.
 *
 * MATCHED ON ADDRESS, and the reply must go out as the address the organiser invited — not as
 * whatever this person happens to be signed in as. Danielle invited stephan@bredellferreira.co.za;
 * a reply from a different address is an attendee her calendar has never heard of, and it lands
 * as a stranger's answer or as nothing at all.
 *
 * Falls back to the address given rather than returning null, because an invitation sent to a
 * distribution list names nobody in particular and answering it is still better than not.
 */
export function attendeeFor(
  attendees: { name: string | null; email: string | null }[],
  addresses: string[],
): ReplyPerson | null {
  const mine = addresses.map((a) => a.trim().toLowerCase()).filter(Boolean)
  if (mine.length === 0) return null
  const found = attendees.find(
    (a) => a.email && mine.includes(a.email.trim().toLowerCase()),
  )
  if (found?.email) return { name: found.name, email: found.email }
  return { name: null, email: mine[0] }
}

/**
 * Whether this invitation can be answered at all.
 *
 * A reply with no organiser has nowhere to go, and one with no UID cannot be matched to a meeting
 * at the other end. Both happen — a "PUBLISH" calendar attachment has neither — and the button
 * must not be offered for something that would silently go nowhere.
 */
export function canReplyTo(invite: {
  uid: string | null
  organiser: { email: string | null } | null
  cancelled: boolean
  method: string | null
}): boolean {
  if (invite.cancelled) return false
  if (invite.method === 'REPLY' || invite.method === 'PUBLISH') return false
  return Boolean(invite.uid && invite.organiser?.email)
}
