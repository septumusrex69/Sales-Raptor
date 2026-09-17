/**
 * Reading a calendar invite out of an email.
 *
 * THE RULES ONLY. No queries and no imports, so every one of them can be checked without a
 * database or a browser — the same split as traceStore / traceStoreData.
 *
 * An invite arrives as a `text/calendar` part, and until now Raptor could show neither it nor the
 * .ics beside it: the body reader takes text/plain and text/html only, so a meeting request
 * rendered as "This message has no text in it". A collector could see that somebody had written
 * to them and nothing about what was being asked.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: work out what time a meeting is in a named timezone.
 * `DTSTART;TZID=Africa/Johannesburg:20260917T160000` is a wall-clock time in a zone whose offset
 * depends on a database this file does not have, so the time is carried AS WRITTEN with the zone
 * named beside it. Guessing an offset would put a meeting an hour out, and a meeting an hour out
 * is worse than one you had to read the zone off.
 */

/** One line of an ICS file, once the folding is undone and the parameters split off. */
export interface IcsLine {
  name: string
  params: Record<string, string>
  value: string
}

/**
 * Undo the line folding.
 *
 * THE FIRST THING, AND THE CLASSIC BUG. RFC 5545 folds any line over 75 octets and marks the
 * continuation with a leading space or tab. Parsed line by line, a long SUMMARY arrives cut in
 * half and the second half reads as a property called " and the rest of the subject" — which
 * then silently becomes nothing at all. Real invites from Outlook fold constantly.
 */
export function unfoldIcs(text: string): string[] {
  const out: string[] = []
  /* \r\n is what the spec says; plenty of senders emit \n alone, and both have to work. */
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += raw.slice(1)
    } else {
      out.push(raw)
    }
  }
  return out.filter((l) => l.trim() !== '')
}

/**
 * Put a TEXT value back the way it was typed.
 *
 * ONE PASS, LEFT TO RIGHT, and that is the whole point. Written as four sequential replaces it
 * reads perfectly well and is wrong: "\\\\n" in the file is an escaped backslash followed by a
 * literal n, but a pass that resolves "\\n" first has already turned its second half into a line
 * break before the doubled backslash is ever looked at. Scanning once, the "\\\\" is consumed as a
 * pair and the n after it is left alone.
 *
 * Found by the check, which asserted the behaviour the old comment described while the code did
 * the opposite.
 */
export function unescapeIcsText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c))
}

/** Split `NAME;PARAM=value:the value` into its three parts. */
export function icsLines(text: string): IcsLine[] {
  const out: IcsLine[] = []
  for (const line of unfoldIcs(text)) {
    const colon = line.indexOf(':')
    if (colon < 1) continue
    const left = line.slice(0, colon)
    const value = line.slice(colon + 1)
    const bits = left.split(';')
    const params: Record<string, string> = {}
    for (const bit of bits.slice(1)) {
      const eq = bit.indexOf('=')
      if (eq < 1) continue
      /* Quoted parameter values are common on CN — "Louwrens, Danielle" contains the separator. */
      params[bit.slice(0, eq).toUpperCase()] = bit.slice(eq + 1).replace(/^"|"$/g, '')
    }
    out.push({ name: bits[0].toUpperCase(), params, value })
  }
  return out
}

export interface InviteWhen {
  /** As written in the invite: 2026-09-17, or 2026-09-17T16:00. Never shifted. */
  startsAt: string | null
  endsAt: string | null
  /** A day, not a time. DTSTART;VALUE=DATE — and its DTEND is the day AFTER the last one. */
  allDay: boolean
  /**
   * The zone the times are written in, or null where they are already an instant.
   *
   * 'UTC' where the value ended in Z, an IANA name where the invite named one, and null where it
   * gave neither — a floating time, which means whatever the reader's own clock says.
   */
  timeZone: string | null
}

/**
 * Read one DTSTART/DTEND.
 *
 * Returns the time AS WRITTEN plus the zone it was written in. See the note at the top of this
 * file for why it is not converted.
 */
export function icsDate(line: IcsLine | undefined): { at: string | null; allDay: boolean; tz: string | null } {
  if (!line) return { at: null, allDay: false, tz: null }
  const v = line.value.trim()

  /* A whole day: 20260917, with no time at all. */
  if (/^\d{8}$/.test(v) && (line.params.VALUE === 'DATE' || !v.includes('T'))) {
    return { at: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, allDay: true, tz: null }
  }

  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v)
  if (!m) return { at: null, allDay: false, tz: null }
  const [, y, mo, d, h, mi] = m
  return {
    at: `${y}-${mo}-${d}T${h}:${mi}`,
    allDay: false,
    /* Z is an instant and needs no zone database; a TZID is a name we carry and do not resolve. */
    tz: m[7] === 'Z' ? 'UTC' : (line.params.TZID ?? null),
  }
}

export interface InvitePerson {
  name: string | null
  email: string | null
  /** NEEDS-ACTION, ACCEPTED, DECLINED, TENTATIVE — what the invite says they have said. */
  status: string | null
  /** OPT-PARTICIPANT means their coming is optional. Worth knowing before rearranging a day. */
  optional: boolean
}

/** `ORGANIZER;CN=Danielle Louwrens:mailto:daniellel@example.co.za` */
export function icsPerson(line: IcsLine): InvitePerson {
  const raw = line.value.trim()
  const email = /^mailto:/i.test(raw) ? raw.slice(7).trim() : (raw.includes('@') ? raw : null)
  const cn = line.params.CN ? unescapeIcsText(line.params.CN).trim() : null
  return {
    /* A CN that is just the address again is not a name, and printing both reads as a bug. */
    name: cn && cn.toLowerCase() !== (email ?? '').toLowerCase() ? cn : null,
    email: email || null,
    status: line.params.PARTSTAT ? line.params.PARTSTAT.toUpperCase() : null,
    optional: (line.params.ROLE ?? '').toUpperCase() === 'OPT-PARTICIPANT',
  }
}

export type InviteMethod = 'REQUEST' | 'CANCEL' | 'REPLY' | 'PUBLISH' | 'COUNTER' | null

export interface CalendarInvite {
  method: InviteMethod
  /**
   * Whether this UNDOES a meeting rather than asking for one.
   *
   * THE ONE THING THAT MUST NOT BE GOT WRONG. A cancellation arrives as an ordinary-looking
   * invite carrying METHOD:CANCEL or STATUS:CANCELLED, and shown as an invitation it would put a
   * meeting in somebody's day that the organiser has already called off.
   */
  cancelled: boolean
  summary: string | null
  location: string | null
  description: string | null
  organiser: InvitePerson | null
  attendees: InvitePerson[]
  when: InviteWhen
  /** A phrase for a repeating meeting, or null for a one-off. Never the raw RRULE. */
  repeats: string | null
  uid: string | null
}

const FREQ: Record<string, string> = {
  DAILY: 'Repeats daily', WEEKLY: 'Repeats weekly', MONTHLY: 'Repeats monthly',
  YEARLY: 'Repeats yearly', HOURLY: 'Repeats hourly', MINUTELY: 'Repeats every few minutes',
}

/**
 * How often it repeats, in words.
 *
 * The RRULE is shown as a PHRASE and never in full: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;COUNT=12"
 * is not something to put in front of a collector, and the parts of it that matter to somebody
 * deciding whether to attend are how often and how long for.
 */
export function describeRepeat(rrule: string | undefined): string | null {
  if (!rrule) return null
  const parts: Record<string, string> = {}
  for (const bit of rrule.split(';')) {
    const eq = bit.indexOf('=')
    if (eq > 0) parts[bit.slice(0, eq).toUpperCase()] = bit.slice(eq + 1)
  }
  const base = FREQ[(parts.FREQ ?? '').toUpperCase()]
  if (!base) return null
  const every = Number(parts.INTERVAL ?? '1')
  const head = every > 1
    ? base.replace(/^Repeats \w+$/, `Repeats every ${every} ${
      { DAILY: 'days', WEEKLY: 'weeks', MONTHLY: 'months', YEARLY: 'years' }[(parts.FREQ ?? '').toUpperCase()] ?? 'times'
    }`)
    : base
  if (parts.COUNT) return `${head}, ${parts.COUNT} times`
  if (parts.UNTIL) {
    const until = icsDate({ name: 'UNTIL', params: {}, value: parts.UNTIL })
    if (until.at) return `${head} until ${until.at.slice(0, 10)}`
  }
  return head
}

/**
 * The meeting an email is asking about, or null where the text is not an invite at all.
 *
 * Only the FIRST VEVENT is read. A repeating meeting's invite carries the series and then one
 * VEVENT per exception, and listing all of them would report a single invitation as nine
 * meetings. The series is the thing being asked about; the exceptions are its detail.
 */
export function parseInvite(ics: string | null | undefined): CalendarInvite | null {
  if (!ics || !/BEGIN:VCALENDAR/i.test(ics)) return null
  const all = icsLines(ics)

  const method = (all.find((l) => l.name === 'METHOD')?.value ?? '').toUpperCase()
  const start = all.findIndex((l) => l.name === 'BEGIN' && l.value.toUpperCase() === 'VEVENT')
  if (start === -1) return null
  const endAt = all.findIndex((l, i) => i > start && l.name === 'END' && l.value.toUpperCase() === 'VEVENT')
  const event = all.slice(start + 1, endAt === -1 ? all.length : endAt)

  const first = (name: string) => event.find((l) => l.name === name)
  const text = (name: string) => {
    const v = first(name)?.value
    return v ? unescapeIcsText(v).trim() || null : null
  }

  const from = icsDate(first('DTSTART'))
  const to = icsDate(first('DTEND'))
  const status = (first('STATUS')?.value ?? '').toUpperCase()

  return {
    method: (['REQUEST', 'CANCEL', 'REPLY', 'PUBLISH', 'COUNTER'].includes(method)
      ? method : null) as InviteMethod,
    /* Either flag alone means called off — senders do not agree on which they set. */
    cancelled: method === 'CANCEL' || status === 'CANCELLED',
    summary: text('SUMMARY'),
    location: text('LOCATION'),
    description: text('DESCRIPTION'),
    organiser: first('ORGANIZER') ? icsPerson(first('ORGANIZER')!) : null,
    attendees: event.filter((l) => l.name === 'ATTENDEE').map(icsPerson),
    when: { startsAt: from.at, endsAt: to.at, allDay: from.allDay, timeZone: from.tz },
    repeats: describeRepeat(first('RRULE')?.value),
    uid: text('UID'),
  }
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * When the meeting is, in words.
 *
 * Written out here rather than through Intl, deliberately: en-ZA renders September as "Sept",
 * which is neither the full month nor a normal abbreviation, and this codebase has been bitten by
 * it before. The times are the invite's own wall-clock strings and are never shifted.
 *
 * AN ALL-DAY EVENT'S DTEND IS THE DAY AFTER IT ENDS. A one-day event reads 17th to 18th in the
 * file and is a single day to a person, so the last day is stepped back before it is shown.
 */
export function inviteWhen(when: InviteWhen): string | null {
  if (!when.startsAt) return null
  const day = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-')
    return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m} ${y}`
  }
  const time = (iso: string) => iso.slice(11, 16)

  if (when.allDay) {
    const last = when.endsAt ? stepBack(when.endsAt.slice(0, 10)) : null
    return last && last !== when.startsAt.slice(0, 10)
      ? `${day(when.startsAt)} to ${day(last)}`
      : `${day(when.startsAt)}, all day`
  }

  const zone = when.timeZone && when.timeZone !== 'UTC' ? ` (${when.timeZone})` : when.timeZone === 'UTC' ? ' UTC' : ''
  const sameDay = when.endsAt && when.endsAt.slice(0, 10) === when.startsAt.slice(0, 10)
  if (when.endsAt && sameDay) return `${day(when.startsAt)}, ${time(when.startsAt)}–${time(when.endsAt)}${zone}`
  if (when.endsAt) return `${day(when.startsAt)} ${time(when.startsAt)} to ${day(when.endsAt)} ${time(when.endsAt)}${zone}`
  return `${day(when.startsAt)}, ${time(when.startsAt)}${zone}`
}

/** The day before an ISO date, without pulling in a date library for one subtraction. */
function stepBack(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** What the invite is asking, in one line, for the heading above it. */
export function inviteHeadline(invite: CalendarInvite): string {
  if (invite.cancelled) return 'Meeting cancelled'
  if (invite.method === 'REPLY') return 'Reply to a meeting request'
  if (invite.method === 'COUNTER') return 'Another time proposed'
  if (invite.method === 'PUBLISH') return 'Meeting details'
  return 'Meeting request'
}
