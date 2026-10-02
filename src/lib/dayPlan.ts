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
