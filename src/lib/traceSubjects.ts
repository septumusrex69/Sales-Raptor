/**
 * ONE PERSON, ONE TRACE.
 *
 * THE FIRM, looking at an account that had been traced twice: "this is way too bulky and way too
 * much. The important thing here is that there should not be two traces on a single individual...
 * one person can have one trace on the trace results. If it's the second one, a next of kin, it
 * opens a new trace... and then it only shows the new results -- oh, there's a new phone number,
 * or oh, there's a new address, or oh, this guy bought a new property -- and it kind of flags
 * that, puts it on top, like new info."
 *
 * WHAT THEY WERE LOOKING AT. The panel drew one card per FILED REPORT, so a debtor traced twice
 * got two cards with the same address, the same employer, the same next of kin and the same
 * directorships on both -- forty lines to find the one number that had changed. A second search
 * costs the account Annexure B item 4(c), and the screen was answering "what did we buy?" by
 * making the reader diff two cards by eye.
 *
 * ------------------------------------------------------------------------------------------------
 * A SUBJECT IS A PERSON, A REPORT IS A PIECE OF PAPER
 * ------------------------------------------------------------------------------------------------
 *
 * This is the distinction the whole file turns on and the one the screen was missing. A REPORT is
 * what a bureau printed on a day. A SUBJECT is who it was about. Two reports about one person are
 * two readings of the same subject taken at different times; a report about the debtor and a
 * report about a linked director are two different people, and those genuinely are two traces.
 *
 * So the panel groups by subject, draws the LATEST report for each, and says what that report
 * added. The earlier ones are not deleted and not hidden -- they are history, reachable from the
 * trace itself, and the comparison is the only thing on the screen that depends on them.
 *
 * SAME KEY AS previousTraceFor, deliberately: subject kind plus the director's id. Two statements
 * of "the same subject" would eventually disagree, and the way that failure shows is the panel
 * grouping two reports the comparison then refuses to pair -- a card claiming an update with
 * nothing new on it, for ever.
 *
 * PURE: no database, no clock. It takes the reports and sorts them.
 */
import type { TraceItem, TraceItemKind } from './traceStore.ts'

/** The little of a trace this needs. Structural, so scripts/qa can exercise it. */
export interface SubjectTrace {
  id: string
  subjectKind: 'debtor' | 'director'
  directorId: string | null
  subjectName: string | null
  enquiredOn: string | null
  createdAt: string
  items: TraceItem[]
}

export interface TraceSubject<T extends SubjectTrace> {
  /** Stable across renders: the subject, not the report. */
  key: string
  kind: 'debtor' | 'director'
  /** Who it is about. Null on the debtor's own report, where the account already says. */
  name: string | null
  /** The report to draw. */
  latest: T
  /** The one before it about the SAME subject, or null where this is the first. */
  previous: T | null
  /** How many reports there are about this subject, this one included. */
  reports: number
}

/**
 * WHICH SUBJECT A REPORT IS ABOUT.
 *
 * The debtor is one subject however many times they are traced. A director is keyed on their id
 * rather than their name, because a bureau prints "E FERREIRA" on one report and "Elizabeth
 * Ferreira" on the next and those are one person -- keyed on the name they would be two, and the
 * screen would show the second report as a brand new subject with nothing to compare against.
 *
 * A director with no id falls back to the name, lowercased and squeezed: it is the best that can
 * be done, and it is better than lumping every unidentified director into one subject.
 */
export function subjectKey(t: SubjectTrace): string {
  if (t.subjectKind === 'debtor') return 'debtor'
  if (t.directorId) return `director:${t.directorId}`
  return `name:${(t.subjectName ?? '').trim().toLowerCase().replace(/\s+/g, ' ')}`
}

/*
 * WHEN THE BUREAU LOOKED, not when the row was written.
 *
 * A PDF filed today can be a report pulled in March -- TraceUploadModal reads `enquiredOn` off the
 * report itself -- so ordering on createdAt alone would call a six-month-old report the newer one
 * and then report its stale numbers as this week's news. Same rule previousTraceFor uses.
 */
const when = (t: SubjectTrace) => t.enquiredOn ?? t.createdAt

/**
 * The traces, one entry per person.
 *
 * THE DEBTOR FIRST, then everybody else by name. The debtor's own report is the one a collector
 * opens the panel for; a linked director's is context. Alphabetical below that rather than by
 * date, because a list that reorders itself every time somebody files a report is a list nobody
 * can find a name in twice.
 */
export function traceSubjects<T extends SubjectTrace>(traces: readonly T[]): TraceSubject<T>[] {
  const byKey = new Map<string, T[]>()
  for (const t of traces) {
    const key = subjectKey(t)
    const got = byKey.get(key)
    if (got) got.push(t)
    else byKey.set(key, [t])
  }

  const out: TraceSubject<T>[] = []
  for (const [key, group] of byKey) {
    /* Newest first. A stable tie-break on id, or two reports pulled the same day swap places
       between renders and the "new since" block changes its mind. */
    const sorted = [...group].sort((a, b) => {
      const wa = when(a)
      const wb = when(b)
      if (wa !== wb) return wa < wb ? 1 : -1
      return a.id < b.id ? 1 : -1
    })
    out.push({
      key,
      kind: sorted[0].subjectKind,
      /* The debtor's name is already the heading of the account. Naming it again on the card
         would be the screen telling somebody something they are looking straight at. */
      name: sorted[0].subjectKind === 'debtor' ? null : sorted[0].subjectName,
      latest: sorted[0],
      previous: sorted[1] ?? null,
      reports: sorted.length,
    })
  }

  return out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'debtor' ? -1 : 1
    return (a.name ?? '').localeCompare(b.name ?? '')
  })
}

/**
 * HOW MANY REPORTS THERE ARE ABOUT THIS PERSON, in words.
 *
 * ONLY WHERE THERE IS MORE THAN ONE. A card that said "1 report" on every first trace would be a
 * line of furniture on the ordinary case, and the firm's complaint about this panel was its bulk.
 */
export function reportsLine(s: TraceSubject<SubjectTrace>): string | null {
  if (s.reports < 2) return null
  return `${s.reports} reports — showing the latest`
}

/**
 * WHAT KIND OF THING A NEW FINDING IS, in one word a collector reads rather than a column name.
 *
 * THE FIRM'S OWN EXAMPLES, in their order: "oh, there's a new phone number, or oh, there's a new
 * address, or oh, this guy bought a new property." So the word names the thing and not the
 * bureau's field -- "Number" rather than "mobile", because a collector does not care which of the
 * three columns it came out of when the point is that it was not there last time.
 */
const NEW_WORD: Record<TraceItemKind, string> = {
  mobile: 'Number',
  phone: 'Number',
  work: 'Number',
  email: 'Email',
  address: 'Address',
  employer: 'Employer',
  directorship: 'Company',
  property: 'Property',
  link: 'Linked person',
}

export const newFindingWord = (kind: TraceItemKind): string => NEW_WORD[kind]
