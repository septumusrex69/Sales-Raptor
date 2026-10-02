/**
 * A PERSON'S DAY: THE MEETINGS THEY HAVE AND THE WORK THEY OWE, IN ONE LIST.
 *
 * THE FIRM, after a client's Teams invitation landed on the calendar and nowhere else: "it added
 * it to my calendar, but it didn't add it to my tasks... I think it should add it to the task as
 * well. And if you click on a specific day in the calendar, it should take you to the tasks and
 * have that filter for that entire day." And on what that page should read as: "what do you need
 * to do for the day in your tasks?"
 *
 * ------------------------------------------------------------------------------------------------
 * A MEETING IS NOT A TASK, AND IT MUST NOT BECOME A ROW IN `tasks`
 * ------------------------------------------------------------------------------------------------
 *
 * This is the decision the whole file turns on, so it is written down rather than implied.
 *
 * A MEETING has a start, an end, other people and a place: you are SOMEWHERE AT A TIME, and the
 * client who sent the invitation can move it. A TASK is something to finish by a day, and the only
 * person who can move it is you.
 *
 * Writing a task row for every accepted invitation would give two things to complete for one
 * commitment, and they would drift the moment the client rescheduled -- the meeting would move and
 * its shadow task would not, which is the failure the diary already taught this codebase (a status
 * with no record behind it, and a record with no status in front of it). Ticking one would not
 * answer the other, and "complete" does not even mean the same thing for the two: a task is done
 * when you have done it, a meeting is done when the hour has passed.
 *
 * SO THE TWO TABLES STAY SEPARATE AND ARE MERGED AT THE READ. `calendar_events` keeps the
 * meetings, `tasks` keeps the tasks, nothing is copied, and this function is the only place that
 * decides what a day looks like. Written out on both pages, the calendar and the task list would
 * eventually disagree about what is on a Tuesday -- the same reasoning as applyAccountFilters.
 *
 * ------------------------------------------------------------------------------------------------
 * PURE, AND THE SHAPES ARE STRUCTURAL ON PURPOSE
 * ------------------------------------------------------------------------------------------------
 *
 * It takes plain objects rather than `CalendarEvent` and `Task`, so `scripts/qa` can import it --
 * calendarEvents.ts pulls in the Supabase client and can only be read back as text. Same split as
 * traceStore / traceStoreData.
 */

/**
 * LOCAL YYYY-MM-DD, AND THE ONE COPY THAT MATTERS.
 *
 * The calendar and the task list each carried their own `ymd`, and they have to agree exactly or
 * clicking a day lands on a list that is empty for a reason nobody can see. One function, imported
 * by both, is the only way that cannot happen.
 *
 * DELIBERATELY NOT `toISOString()`, which converts to UTC: a meeting at ten at night in
 * Johannesburg is the NEXT day in UTC, so a day built that way puts it on the wrong square.
 */
export function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** What a day's list needs from a calendar event. A subset of CalendarEvent, structurally. */
export interface DayMeeting {
  id: string
  title: string
  /** The instant it starts. Null for an all-day event and for an invite whose time was floating. */
  startsAt: string | null
  endsAt: string | null
  allDay: boolean
  /** The day it is on, where there is no instant. */
  startsOn: string | null
  location: string | null
  /**
   * The invitation's own words, where it carried any.
   *
   * HERE BECAUSE THE JOIN LINK IS IN THEM. An invitation prints the URL in the middle of its
   * boilerplate and nowhere else, so a day's list that wanted a Join button had to read the notes
   * -- see joinLink. Nullable and optional: a meeting somebody typed in by hand has none.
   */
  notes?: string | null
  /* WHO ELSE IS IN IT. A count on the row rather than a list: what somebody needs at a glance is
     whether this is a client meeting or a note to themselves. */
  attendees: { name: string | null; email: string | null }[]
  organiserName: string | null
}

/** Likewise for a task. `status` is here only so a cancelled one can be left out. */
export interface DayTask {
  id: string
  title: string
  /** A full timestamp, always -- see `taskTime` for why that is not the same as having a time. */
  dueDate: string
  status: string
}

/**
 * WHICH DAY A MEETING IS ON.
 *
 * An all-day event carries the day and no instant; a timed one carries the instant and the day is
 * read off it IN LOCAL TIME. An invitation whose time was floating has neither resolved, and it
 * belongs on no day rather than on today -- the calendar already lists those separately as the
 * ones it could not place, and quietly dropping them onto a square would be worse than saying so.
 */
export function meetingDay(m: DayMeeting): string | null {
  if (m.allDay) return m.startsOn
  if (m.startsAt) return localDay(new Date(m.startsAt))
  return m.startsOn
}

/** 'HH:MM' for a timed meeting, null for one that takes the whole day. */
export function meetingTime(m: DayMeeting): string | null {
  if (m.allDay || !m.startsAt) return null
  const d = new Date(m.startsAt)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * THE TIME A TASK IS DUE, OR NULL WHERE NOBODY SET ONE -- AND MIDNIGHT IS HOW WE KNOW.
 *
 * `dueDate` is a single timestamp with no companion flag, so there is nothing in the data that
 * says "a time was chosen here". Midnight is the one value that cannot have been meant: nobody
 * schedules a call for twelve o'clock at night, and it is exactly what you get from a date with
 * no time behind it.
 *
 * THE OTHER HALF OF THIS RULE IS IN THE ADD BOX, and without it the rule is useless: that form
 * used to default the time to 09:00, so every task ever added carried a time nobody picked. It now
 * opens blank, which is what makes a time on a task mean somebody wanted it there.
 *
 * NOT A REQUIRED FIELD, AND THAT IS THE POINT. The firm's own instinct was right -- most work is
 * "sometime today". A required time is a time everybody invents, and an invented time is one
 * nobody trusts, which is how a column stops being read.
 */
export function taskTime(t: DayTask): string | null {
  const d = new Date(t.dueDate)
  if (Number.isNaN(d.getTime())) return null
  if (d.getHours() === 0 && d.getMinutes() === 0) return null
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export interface DayPlan {
  /** Sorted: the whole-day ones first, then by the clock. */
  meetings: DayMeeting[]
  /** Tasks somebody put a time against, in time order. */
  timed: DayTask[]
  /** Everything else due that day. The ordinary case. */
  anytime: DayTask[]
  /** Meetings plus tasks. What "you have 6 things on Tuesday" counts. */
  total: number
}

/**
 * ONE DAY, ASSEMBLED.
 *
 * MEETINGS FIRST, BECAUSE THEY ARE THE PART OF THE DAY THAT IS ALREADY SPENT. A list that opened
 * with eleven tasks and buried a two o'clock with a client six rows down would be a list that
 * answers "what do I owe" rather than the firm's own question, which was "what do you need to do
 * for the day".
 *
 * A CANCELLED TASK IS NOT WORK. Left in to match the calendar, which excludes them too -- the two
 * views have to show the same day or the drilldown reads as broken.
 */
export function planDay(input: { day: string; meetings: DayMeeting[]; tasks: DayTask[] }): DayPlan {
  const meetings = input.meetings
    .filter((m) => meetingDay(m) === input.day)
    .sort((a, b) => {
      const at = meetingTime(a)
      const bt = meetingTime(b)
      /* All day sits above the clock: it frames the day rather than taking an hour out of it. */
      if (at === null && bt === null) return a.title.localeCompare(b.title)
      if (at === null) return -1
      if (bt === null) return 1
      return at.localeCompare(bt)
    })

  const onTheDay = input.tasks.filter(
    (t) => t.status !== 'Cancelled' && localDay(new Date(t.dueDate)) === input.day,
  )

  const timed = onTheDay
    .filter((t) => taskTime(t) !== null)
    .sort((a, b) => (taskTime(a) ?? '').localeCompare(taskTime(b) ?? ''))
  const anytime = onTheDay.filter((t) => taskTime(t) === null)

  return { meetings, timed, anytime, total: meetings.length + onTheDay.length }
}

/**
 * HOW THE DAY READS IN ONE LINE, for the heading over the list.
 *
 * COUNTS THE TWO KINDS SEPARATELY because they are two different obligations, and a single "7
 * things" hides the one fact somebody actually needs at a glance -- whether any of it is an
 * appointment they have to be at.
 *
 * NOTHING IS A REAL ANSWER. An empty day says so plainly rather than drawing an empty table under
 * a heading that promises work.
 */
export function dayHeadline(plan: DayPlan): string {
  const bits: string[] = []
  if (plan.meetings.length) {
    bits.push(plan.meetings.length === 1 ? '1 meeting' : `${plan.meetings.length} meetings`)
  }
  const tasks = plan.timed.length + plan.anytime.length
  if (tasks) bits.push(tasks === 1 ? '1 task' : `${tasks} tasks`)
  if (bits.length === 0) return 'Nothing booked'
  return bits.join(' · ')
}

/* ------------------------------------------------------------------------------------------------
 * WHEN A MEETING IS, IN ONE SENTENCE
 *
 * HERE RATHER THAN IN THE COMPONENT THAT DRAWS IT, for the reason outcomeReady moved too: a pure
 * function in a .tsx file cannot be imported by scripts/qa at all, so the only thing a check could
 * do was match its source and hope. It is also the same question meetingTime above answers more
 * narrowly, and two places deciding what an all-day event's time is would eventually disagree.
 * ---------------------------------------------------------------------------------------------- */

const DAY = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } as const
const CLOCK = { hour: '2-digit', minute: '2-digit' } as const

/**
 * WHEN IT IS, IN ONE SENTENCE.
 *
 * THREE SHAPES, because a meeting has three. An all-day event has no clock to show and a 00:00
 * against it would be a time nobody set; a meeting with an end shows the span, which is the thing
 * somebody is deciding around; and an invitation whose time never resolved says so rather than
 * inventing an hour -- see inviteInstant.
 */
export function whenItIs(m: DayMeeting): string {
  if (m.allDay) return m.startsOn ? `${long(m.startsOn)} · all day` : 'All day'
  if (!m.startsAt) return 'No time on the invitation'
  const start = new Date(m.startsAt)
  const day = start.toLocaleDateString('en-ZA', DAY)
  const from = start.toLocaleTimeString('en-ZA', CLOCK)
  if (!m.endsAt) return `${day} · ${from}`
  const to = new Date(m.endsAt).toLocaleTimeString('en-ZA', CLOCK)
  return `${day} · ${from} to ${to}`
}

/* A date-only value is parsed at midday, never midnight: `new Date('2026-10-08')` is midnight UTC,
   which is the day before for every reader west of Greenwich. */
const long = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-ZA', DAY)

/* ------------------------------------------------------------------------------------------------
 * HOW FULL EACH DAY IS, BEFORE ANYTHING IS BOOKED ONTO IT
 *
 * THE FIRM, on adding a task: "if you create a task, now you say, okay, well, add a task, but it
 * asks you when -- but it should look like a rediarisation almost thing, to show you how many
 * meetings do you have for a specific day."
 *
 * WHICH IS THE DIARY'S OWN ARGUMENT, MOVED. DiaryDatePicker puts the count on every day BEFORE the
 * choice is made, and the reason is written there: a number that appears once you have already
 * picked the 5th tells you that you have overbooked yourself and leaves you to work out which
 * other day is better. The book it replaced is the evidence -- one agent came across from
 * Swordfish carrying 44 accounts diarised onto a single date, every one still open weeks later.
 *
 * AND IT IS A DIFFERENT COUNT, WHICH IS WHY IT IS NOT THAT FUNCTION. The diary counts ACCOUNTS
 * against a capacity the firm has set (50 a day, for everybody). A day of meetings and tasks has
 * no such number and the firm has not been asked for one, so this counts and does not judge: no
 * "full", no "over", no colour that says somebody is behind. Inventing a tasks-per-day ceiling
 * here would put a warning on a screen that fires when nothing is wrong, which CLAUDE.md is blunt
 * about -- people stop reading those, including the ones that matter.
 * ---------------------------------------------------------------------------------------------- */

/** What a day holds, for a square in a grid. */
export interface DayCount {
  meetings: number
  tasks: number
  /** What "you have 6 things on Tuesday" counts. */
  total: number
}

export const NO_DAY_COUNT: DayCount = { meetings: 0, tasks: 0, total: 0 }

/**
 * COUNT A RANGE IN ONE PASS, rather than calling planDay once per square.
 *
 * A month grid is 42 days and planDay filters the whole list for each one, so drawn that way the
 * work is 42 times the diary it is modelled on. This walks the two lists once and drops each item
 * into its day -- the same `meetingDay` and the same cancelled-task rule planDay uses, because the
 * number under the 8th has to be the number of rows the 8th then shows. Two implementations of
 * "what is on a day" is the drift dayPlan exists to prevent.
 */
export function dayCounts(input: {
  meetings: DayMeeting[]
  tasks: DayTask[]
}): Map<string, DayCount> {
  const out = new Map<string, DayCount>()
  const at = (day: string): DayCount => {
    const got = out.get(day)
    if (got) return got
    const made = { meetings: 0, tasks: 0, total: 0 }
    out.set(day, made)
    return made
  }
  for (const m of input.meetings) {
    const day = meetingDay(m)
    /* A meeting with no day resolved belongs on no square -- the calendar lists those separately
       as the ones it could not place, and counting one into today would be a figure nobody can
       find the row behind. */
    if (!day) continue
    const c = at(day)
    c.meetings += 1
    c.total += 1
  }
  for (const t of input.tasks) {
    if (t.status === 'Cancelled') continue
    const d = new Date(t.dueDate)
    if (Number.isNaN(d.getTime())) continue
    const c = at(localDay(d))
    c.tasks += 1
    c.total += 1
  }
  return out
}

/**
 * WHAT A DAY HOLDS, IN WORDS.
 *
 * TWO KINDS COUNTED SEPARATELY, like dayHeadline and for the same reason: a single "6 things"
 * hides the one fact somebody choosing a day actually needs, which is whether any of it is an
 * appointment they have to be at. A day with four meetings on it is full in a way a day with four
 * tasks on it is not.
 *
 * "NOTHING BOOKED" IS A REAL ANSWER and is said rather than left blank -- an empty line under a
 * date reads as a count that failed to load, which is the opposite of the fact it is reporting.
 */
export function dayCountSentence(c: DayCount): string {
  const bits: string[] = []
  if (c.meetings) bits.push(c.meetings === 1 ? '1 meeting' : `${c.meetings} meetings`)
  if (c.tasks) bits.push(c.tasks === 1 ? '1 task' : `${c.tasks} tasks`)
  return bits.length ? bits.join(' · ') : 'Nothing booked'
}

/**
 * THE DAYS OF A WEEK-ALIGNED STRIP, Monday first.
 *
 * ITS OWN RATHER THAN diaryPriority's `calendarStrip`, which this deliberately mirrors: that one
 * is imported by SQL-facing diary code and by the account book, and a task picker reaching into it
 * would tie the two together for the sake of six lines of date arithmetic. Monday first because
 * the diary's grid is, and a person using both in one afternoon must not have to re-learn where
 * Saturday is.
 */
export function weekStrip(from: string, weeks: number): string[] {
  const start = new Date(`${from}T12:00:00`)
  /* Monday as 0. getDay() is Sunday-based, so Sunday (0) is six days into the week, not before it. */
  const back = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - back)
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    return localDay(d)
  })
}

/** Shift a 'YYYY-MM-DD' by whole days, through month and year ends. */
export function shiftDay(day: string, by: number): string {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + by)
  return localDay(d)
}

/* ------------------------------------------------------------------------------------------------
 * THE LINK YOU ACTUALLY PRESS AT TWO MINUTES PAST
 *
 * THE FIRM, reading a Teams invitation on the calendar: "if the link is pulled in there as well,
 * that'd be cool."
 *
 * IT WAS ALREADY ON THE SCREEN AND NOT PRESSABLE. An invitation's notes carry the join URL in the
 * middle of forty lines of boilerplate -- meeting id, passcode, a tenant key, two help links and a
 * conferencing-device paragraph -- and the one thing anybody needs from all of it is the first of
 * those URLs. Finding it meant scrolling the notes and selecting a line of text by hand on a
 * tablet, thirty seconds after the meeting had started.
 *
 * THE HARD PART IS NOT FINDING A URL, IT IS NOT FINDING THE WRONG ONE. The Teams boilerplate in
 * front of the firm right now contains aka.ms/JoinTeamsMeeting (a help page), a webex.com/msteams
 * marketing page, and a "System reference" meetup-join link that is the same meeting by another
 * route. A button that opened the help page would be worse than no button: it looks like it worked.
 *
 * SO IT IS A CLOSED LIST OF SHAPES, not "the first https:// in the notes". Anything this does not
 * recognise gets no button, which is the honest answer -- the notes are still there to read.
 * ---------------------------------------------------------------------------------------------- */

/*
 * The shapes, most specific first.
 *
 * TEAMS HAS TWO REAL ONES. `/meet/<id>` is what a modern invitation prints at the top; the older
 * `/l/meetup-join/...` is what Outlook writes and is what the firm's own FNB invitation carries
 * further down. Both open the meeting, so both count -- the order decides which wins when a single
 * invitation carries both, and the short one is the one a person would have clicked.
 */
const JOIN_PATTERNS: readonly RegExp[] = [
  /https:\/\/teams\.microsoft\.com\/meet\/\S+/i,
  /https:\/\/teams\.(?:microsoft|live)\.com\/l\/meetup-join\/\S+/i,
  /https:\/\/[\w.-]*zoom\.us\/j\/\S+/i,
  /https:\/\/meet\.google\.com\/[a-z-]{10,}/i,
  /https:\/\/[\w.-]*webex\.com\/(?:meet|join)\/\S+/i,
  /https:\/\/[\w.-]*gotomeeting\.com\/join\/\S+/i,
]

/**
 * The URL that opens this meeting, or null where the invitation does not carry one.
 *
 * NULL IS THE COMMON CASE AND IS NOT A FAILURE. A meeting in a boardroom has no link, and a button
 * that appeared on every meeting and did nothing on half of them is the thing that teaches people
 * not to press it.
 *
 * THE LOCATION IS LOOKED AT TOO, because some clients put the URL there and write "Microsoft Teams
 * Meeting" in the notes. Notes first: where both carry one, the notes' is the invitation's own.
 *
 * PURE: it takes two strings and returns one.
 */
export function joinLink(notes: string | null | undefined, location?: string | null): string | null {
  for (const text of [notes, location]) {
    if (!text) continue
    for (const pattern of JOIN_PATTERNS) {
      const hit = pattern.exec(text)
      /* TRAILING PUNCTUATION IS NOT PART OF A URL. An invitation writes "Join: <url>" and a human
         writes "see https://…meet/123." -- the full stop belongs to the sentence, and a link with
         one on the end 404s. Angle brackets likewise: Outlook wraps URLs in them. */
      if (hit) return hit[0].replace(/[)>\].,;'"]+$/, '')
    }
  }
  return null
}

/**
 * WHO THE MEETING IS WITH, in one name.
 *
 * THE FIRM: "I see Bredell Ferreira partnership, and then call centre discussion. It's more
 * important... that it's with this person. Simone Pretorius -- that's really important."
 *
 * A subject line names the SUBJECT; what somebody scanning a month actually wants is who they will
 * be sitting with, because that is what decides whether a Tuesday is free.
 *
 * THE ORGANISER FIRST, because they are the one who called it and the one to ring if it has to
 * move. Falling back to the first attendee who is not us -- an invitation the firm sent itself has
 * the firm as organiser, and "with Stephan" on Stephan's own calendar says nothing.
 *
 * NULL WHERE THERE IS NOBODY ELSE, which is a real answer: a note to yourself in the calendar is
 * not a meeting with anybody, and "with —" would be furniture on every one of them.
 */
export function meetingWith(m: {
  organiserName: string | null
  organiserEmail?: string | null
  attendees: { name: string | null; email: string | null }[]
}, ourAddresses: readonly string[] = []): string | null {
  const ours = new Set(ourAddresses.map((a) => a.trim().toLowerCase()).filter(Boolean))
  const mine = (email: string | null | undefined) => !!email && ours.has(email.trim().toLowerCase())

  if (m.organiserName && !mine(m.organiserEmail)) return tidyName(m.organiserName)
  for (const a of m.attendees) {
    if (mine(a.email)) continue
    if (a.name) return tidyName(a.name)
    /* AN ADDRESS IS A NAME WHEN THERE IS NO NAME. "oscar.moagi@fnb.co.za" tells somebody who it is
       with; dropping the attendee because the invitation omitted a display name does not. */
    if (a.email) return a.email
  }
  return m.organiserName ? tidyName(m.organiserName) : null
}

/*
 * "Moagi, Oscar" is how Exchange writes a name and is not how anybody says it.
 *
 * Only on a SINGLE comma, and only where both halves look like names: "Smith, Jones and Partners"
 * is a firm, and turning it into "Jones and Partners Smith" would be worse than leaving it.
 */
function tidyName(name: string): string {
  const parts = name.split(',')
  if (parts.length !== 2) return name.trim()
  const [last, first] = parts.map((p) => p.trim())
  if (!last || !first || /\s/.test(first)) return name.trim()
  return `${first} ${last}`
}
