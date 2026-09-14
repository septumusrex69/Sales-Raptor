/**
 * The collections diary: reading a day, booking one, and moving work that was missed.
 *
 * Direct paged queries rather than AppStore, for the same reason accountBook.ts is: the book is
 * hundreds of thousands of rows and an agent's day is a few dozen of them. Ordering happens in
 * the database, by the generated `priority` column, because sorting a six-figure table in the
 * browser is not a thing that can work.
 *
 * The one rule that shapes every function here: AN ENTRY IS NEVER EDITED. It is worked, or it is
 * moved — and moving means closing this one and writing a new one, so the date it was originally
 * due survives. That is what lets a team leader ask "what did we miss last month" and get an
 * answer that is true. The database enforces it (protect_closed_diary_entries); this file simply
 * never tries.
 */
import { supabase } from './supabase'
import { addNote } from './accountWorkspace.ts'
import {
  type DiaryKind, calendarStrip, isMissed, sortDiary,
} from './diaryPriority.ts'

export interface DiaryEntry {
  id: string
  accountId: string
  ownerId: string | null
  dueOn: string
  kind: DiaryKind
  priority: number
  reason: string | null
  state: 'open' | 'done' | 'moved' | 'cancelled'
  source: 'manual' | 'swordfish' | 'promise' | 'dispute' | 'handover' | 'system'
  promiseId: string | null
  queryId: string | null
  doneAt: string | null
  doneBy: string | null
  outcome: string | null
  movedTo: string | null
  movedAt: string | null
  movedBy: string | null
  movedReason: string | null
  createdAt: string
  createdByName: string | null
}

/**
 * A diary row with just enough of the account attached to decide what to do without opening it.
 *
 * The balance and the debtor's name are here because a day list that shows only account numbers
 * makes the agent open every one to find out which is worth the call. The prescription date is
 * here because it changes the ORDER — see compareDiary.
 */
export interface DiaryRow extends DiaryEntry {
  account: {
    id: string
    companyId: string | null
    accountNumber: string | null
    debtorFirstName: string | null
    debtorSurname: string | null
    capitalOutstanding: number
    status: string
    prescriptionDate: string | null
    mainComment: string | null
    mainCommentAt: string | null
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come back as untyped JSON from PostgREST. */
const toEntry = (r: any): DiaryEntry => ({
  id: r.id,
  accountId: r.account_id,
  ownerId: r.owner_id,
  dueOn: r.due_on,
  kind: r.kind,
  priority: Number(r.priority ?? 70),
  reason: r.reason ?? null,
  state: r.state,
  source: r.source,
  promiseId: r.promise_id ?? null,
  queryId: r.query_id ?? null,
  doneAt: r.done_at ?? null,
  doneBy: r.done_by ?? null,
  outcome: r.outcome ?? null,
  movedTo: r.moved_to ?? null,
  movedAt: r.moved_at ?? null,
  movedBy: r.moved_by ?? null,
  movedReason: r.moved_reason ?? null,
  createdAt: r.created_at,
  createdByName: r.created_by_name ?? null,
})

const toRow = (r: any): DiaryRow => ({
  ...toEntry(r),
  account: {
    id: r.debtor_accounts?.id ?? r.account_id,
    // The id only. The client's NAME comes from AppStore, which already holds every company on
    // every page — embedding companies through debtor_accounts would be a second join on every
    // row of a list that pages out of a six-figure table, to fetch something already in memory.
    companyId: r.debtor_accounts?.company_id ?? null,
    accountNumber: r.debtor_accounts?.account_number ?? null,
    debtorFirstName: r.debtor_accounts?.debtor_first_name ?? null,
    debtorSurname: r.debtor_accounts?.debtor_surname ?? null,
    capitalOutstanding: Number(r.debtor_accounts?.capital_outstanding ?? 0),
    status: r.debtor_accounts?.status ?? '',
    prescriptionDate: r.debtor_accounts?.prescription_date ?? null,
    mainComment: r.debtor_accounts?.main_comment ?? null,
    mainCommentAt: r.debtor_accounts?.main_comment_at ?? null,
  },
})
/* eslint-enable @typescript-eslint/no-explicit-any */

/*
 * The embed is named explicitly.
 *
 * diary_entries has exactly one foreign key to debtor_accounts today, so an unnamed embed would
 * resolve — but a second one (say, an account this was moved from) would make it ambiguous, and
 * PostgREST rejects the WHOLE request when an embed is ambiguous rather than dropping a field.
 * A day list that empties itself is a worse bug than a verbose select.
 */
const ROW_SELECT = `
  *,
  debtor_accounts!diary_entries_account_id_fkey (
    id, company_id, account_number, debtor_first_name, debtor_surname,
    capital_outstanding, status, prescription_date, main_comment, main_comment_at
  )
`

/** The debtor's name as it should read in a list. */
export function debtorName(row: DiaryRow): string {
  const name = [row.account.debtorFirstName, row.account.debtorSurname].filter(Boolean).join(' ').trim()
  return name || row.account.accountNumber || 'Unnamed account'
}

/* ---------- reading a day ---------- */

export interface DayOfWork {
  /** Entries due on the day asked for. */
  due: DiaryRow[]
  /** Open entries whose day has already gone, most urgent first. */
  overdue: DiaryRow[]
}

/**
 * One agent's work for one day: what is due, and what was missed.
 *
 * Two lists rather than one, deliberately. The Swordfish book arrived with 279 overdue entries;
 * merged into a single list, today's actual work sits at the bottom of a year of arrears and
 * never gets done. Separating them means the backlog is impossible to miss and impossible to
 * drown in.
 *
 * `overdueLimit` caps the second list because it is a backlog, not a day. Clearing it is the
 * bulk re-diarise tool's job, not a matter of scrolling.
 */
export async function fetchDay(input: {
  ownerId: string | null
  date: string
  /** Include work that belongs to nobody yet. A team leader's view; off by default. */
  includeUnassigned?: boolean
  overdueLimit?: number
}): Promise<DayOfWork> {
  const base = () => {
    const q = supabase.from('diary_entries').select(ROW_SELECT).eq('state', 'open')
    if (input.includeUnassigned) return input.ownerId ? q.or(`owner_id.eq.${input.ownerId},owner_id.is.null`) : q
    return input.ownerId ? q.eq('owner_id', input.ownerId) : q.is('owner_id', null)
  }

  const [due, overdue] = await Promise.all([
    base().eq('due_on', input.date).order('priority').order('due_on'),
    base().lt('due_on', input.date).order('priority').order('due_on').limit(input.overdueLimit ?? 200),
  ])
  if (due.error) throw new Error(due.error.message)
  if (overdue.error) throw new Error(overdue.error.message)

  // The database orders by the ladder; this re-sorts so an account about to prescribe comes
  // first. That rule needs the account's prescription date, which the database cannot order by
  // without a join it would have to do on every row of the book.
  const lift = (rows: DiaryRow[]) =>
    sortDiary(rows.map((r) => ({ ...r, prescriptionOn: r.account.prescriptionDate })), input.date)

  return {
    due: lift((due.data ?? []).map(toRow)),
    overdue: lift((overdue.data ?? []).map(toRow)),
  }
}

/** Everything ever diarised on one account, newest first — the account page's Diary tab. */
export async function fetchAccountDiary(accountId: string): Promise<DiaryEntry[]> {
  const { data, error } = await supabase
    .from('diary_entries')
    .select('*')
    .eq('account_id', accountId)
    .order('due_on', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(toEntry)
}

/* ---------- how full the days ahead are ---------- */

export type DayLoads = Map<string, number>

/**
 * How many accounts this person already has on each day in a range.
 *
 * Counted in one query and tallied here rather than asking per day: the picker shows three weeks
 * at once, and twenty-one round trips to draw one calendar is how a modal comes to take a second
 * to open.
 *
 * Only OPEN entries count. A day whose work is done is a free day, however busy it was.
 */
export async function fetchDayLoads(input: {
  ownerId: string | null
  from: string
  to: string
}): Promise<DayLoads> {
  let q = supabase.from('diary_entries').select('due_on').eq('state', 'open')
    .gte('due_on', input.from).lte('due_on', input.to)
  q = input.ownerId ? q.eq('owner_id', input.ownerId) : q.is('owner_id', null)
  const { data, error } = await q
  if (error) throw new Error(error.message)

  const loads: DayLoads = new Map()
  for (const r of data ?? []) {
    const day = (r as { due_on: string }).due_on
    loads.set(day, (loads.get(day) ?? 0) + 1)
  }
  return loads
}

/** The loads for the weeks a picker is showing, keyed by date. */
export async function fetchStripLoads(input: {
  ownerId: string | null
  from: string
  weeks: number
}): Promise<DayLoads> {
  const days = calendarStrip(input.from, input.weeks)
  return fetchDayLoads({ ownerId: input.ownerId, from: days[0], to: days[days.length - 1] })
}

/* ---------- booking work ---------- */

export interface Actor {
  id: string | null
  name: string | null
}

/**
 * Put an account in somebody's diary.
 *
 * The note is optional and it goes in TWO places: on the entry, where the day list reads it, and
 * on the account's own timeline, where the history lives. At the firm's instruction — a line
 * worth writing about why an account is coming back is a line worth finding six months later by
 * someone reading the account rather than the diary.
 *
 * The timeline write is allowed to fail without failing the booking. An account that is diarised
 * but missing one note is a small gap; a booking that was refused because a note would not save
 * is an account nobody comes back to.
 */
export async function diarise(input: {
  accountId: string
  ownerId: string | null
  dueOn: string
  kind?: DiaryKind
  reason?: string | null
  source?: DiaryEntry['source']
  promiseId?: string | null
  queryId?: string | null
  /** Also write the note onto the account's timeline. Off for system-generated bookings. */
  alsoNoteOnAccount?: boolean
  actor: Actor
}): Promise<DiaryEntry> {
  const { data, error } = await supabase.from('diary_entries').insert({
    account_id: input.accountId,
    owner_id: input.ownerId,
    due_on: input.dueOn,
    kind: input.kind ?? 'review',
    reason: input.reason?.trim() || null,
    source: input.source ?? 'manual',
    promise_id: input.promiseId ?? null,
    query_id: input.queryId ?? null,
    created_by: input.actor.id,
    created_by_name: input.actor.name,
  }).select('*').single()
  if (error) throw new Error(error.message)

  if (input.alsoNoteOnAccount && input.reason?.trim()) {
    try {
      await addNote({
        accountId: input.accountId,
        body: `Diarised for ${input.dueOn}. ${input.reason.trim()}`,
        authorName: input.actor.name,
        createdBy: input.actor.id,
      })
    } catch {
      // Deliberately swallowed — see the note above the function.
    }
  }
  return toEntry(data)
}

/**
 * This one is worked.
 *
 * `outcome` is the agent's one line about what happened, kept on the entry rather than only in
 * the account's timeline so the diary can be read on its own: "worked 40, reached 12" is a
 * question about diary rows, not about notes.
 */
export async function completeEntry(input: {
  id: string
  outcome?: string | null
  actor: Actor
}): Promise<DiaryEntry> {
  const { data, error } = await supabase.from('diary_entries').update({
    state: 'done',
    done_at: new Date().toISOString(),
    done_by: input.actor.id,
    outcome: input.outcome?.trim() || null,
  }).eq('id', input.id).eq('state', 'open').select('*').single()
  if (error) throw new Error(error.message)
  return toEntry(data)
}

/**
 * Move an entry to another day, or to somebody else.
 *
 * Two rows, not an edit. The original keeps the date it was always due and is stamped 'moved'
 * with who moved it and why; a new open entry carries the work forward. The old row then points
 * at the new one, so the chain can be walked: "diarised for 4 September, moved on the 14th by
 * Meloney because Ruben was booked off, now due the 21st."
 *
 * The alternative — updating due_on in place — is what the system this replaces did, and it is
 * why nobody can say how much work was missed last year.
 */
export async function moveEntry(input: {
  entry: DiaryEntry
  dueOn: string
  /**
   * Whose diary it lands in.
   *
   * Only the clerk's bulk tool passes this, where covering an absent agent is the entire point.
   * A single move never does: at the firm's instruction, one person does not put work into
   * another person's diary — that is what escalation is for.
   */
  ownerId?: string | null
  reason?: string
  /**
   * Mirror the note onto the account's timeline.
   *
   * True for a single move, where the note is about THIS debtor ("asked for another week").
   * False for the clerk's bulk tool, where it is about a person's week ("Ruben booked off") and
   * writing it onto two hundred debtors' histories would be noise rather than a record.
   */
  alsoNoteOnAccount?: boolean
  actor: Actor
}): Promise<DiaryEntry> {
  const replacement = await diarise({
    accountId: input.entry.accountId,
    ownerId: input.ownerId === undefined ? input.entry.ownerId : input.ownerId,
    dueOn: input.dueOn,
    kind: input.entry.kind,
    reason: input.entry.reason,
    source: input.entry.source,
    promiseId: null,
    queryId: null,
    alsoNoteOnAccount: input.alsoNoteOnAccount,
    actor: input.actor,
  })

  const { error } = await supabase.from('diary_entries').update({
    state: 'moved',
    moved_at: new Date().toISOString(),
    moved_by: input.actor.id,
    moved_reason: input.reason?.trim() || null,
    moved_to: replacement.id,
  }).eq('id', input.entry.id).eq('state', 'open')
  if (error) {
    // The replacement exists and the original does not know about it: two open entries on one
    // account is a duplicate in somebody's day, which is visible and fixable. Saying the move
    // failed while the new entry sits there would be worse.
    throw new Error(`Moved to ${input.dueOn}, but the original entry could not be closed: ${error.message}`)
  }
  return replacement
}

/**
 * The clerk's tool: move a pile of missed work onto new days.
 *
 * Spread across working days rather than dumped on one, because dumping is what created the
 * problem — an agent in the imported book has 44 accounts on a single date. `perDay` is how many
 * land on each day before it moves to the next; weekends and public holidays are skipped by the
 * caller, which supplies the days.
 *
 * Returns what it managed, rather than throwing on the first failure: a clerk clearing 200
 * entries needs to know which ones did not move, not to lose the other 199.
 */
export async function bulkMove(input: {
  entries: DiaryEntry[]
  /** Working days to spread across, in order. Supplied by the caller so the calendar rules live in one place. */
  days: string[]
  perDay: number
  ownerId?: string | null
  reason?: string
  actor: Actor
}): Promise<{ moved: number; failed: { entry: DiaryEntry; error: string }[] }> {
  if (input.days.length === 0) throw new Error('No working days were given to move this work onto.')
  const failed: { entry: DiaryEntry; error: string }[] = []
  let moved = 0

  for (let i = 0; i < input.entries.length; i += 1) {
    const day = input.days[Math.min(Math.floor(i / Math.max(1, input.perDay)), input.days.length - 1)]
    try {
      await moveEntry({
        entry: input.entries[i],
        dueOn: day,
        ownerId: input.ownerId,
        reason: input.reason,
        actor: input.actor,
      })
      moved += 1
    } catch (e) {
      failed.push({ entry: input.entries[i], error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { moved, failed }
}

/** Take an entry off the diary without working it — the account closed, was paid, went legal. */
export async function cancelEntry(input: { id: string; reason: string; actor: Actor }): Promise<void> {
  const { error } = await supabase.from('diary_entries').update({
    state: 'cancelled',
    moved_reason: input.reason.trim() || null,
    moved_by: input.actor.id,
  }).eq('id', input.id).eq('state', 'open')
  if (error) throw new Error(error.message)
}

/* ---------- an account stays in circulation ---------- */

/**
 * The reasons an account may legitimately leave a diary and not come back.
 *
 * The firm's rule: "you can't just say an account is done without re-diarising it. An account
 * should always be in circulation in a clerk's diary." Working an entry is finishing an
 * APPOINTMENT, not finishing an account — the account is still owed, and an account nobody is
 * booked to ring again is an account that goes quiet for a year. 355 of them arrived from
 * Swordfish in exactly that condition.
 *
 * So closing an entry always books the next one. These are the only ways out, and every one of
 * them is a statement that there is nothing left to collect — which is a real thing that
 * happens, and which is why this is a short list rather than a checkbox saying "no".
 */
export const CIRCULATION_EXITS = [
  { id: 'paid', label: 'Paid in full' },
  { id: 'written_off', label: 'Written off' },
  { id: 'legal', label: 'Handed to the attorneys' },
  { id: 'withdrawn', label: 'Withdrawn by the client' },
  { id: 'prescribed', label: 'Prescribed — no longer enforceable' },
] as const

export type CirculationExit = (typeof CIRCULATION_EXITS)[number]['id']

export function exitLabel(id: CirculationExit): string {
  return CIRCULATION_EXITS.find((e) => e.id === id)?.label ?? id
}

/**
 * Work an entry: record what came of it, and say what happens to the account next.
 *
 * ONE CALL, because the two halves must not come apart. Closing without booking is the failure
 * this whole design exists to prevent, and leaving it to two buttons in a modal means that one
 * day somebody presses the first and is interrupted.
 *
 * The next entry is written BEFORE this one closes. If the second write fails the account is
 * double-booked, which somebody sees and fixes in ten seconds. In the other order a failure
 * leaves the account in nobody's diary with nothing to say it should have been — invisible,
 * and permanent.
 */
export async function workEntry(input: {
  entry: DiaryEntry
  outcome: string
  /** Either when it comes back, or why it is leaving the book altogether. */
  next:
    | { comesBack: true; dueOn: string; kind: DiaryKind; note?: string }
    | { comesBack: false; exit: CirculationExit; note?: string }
  actor: Actor
}): Promise<void> {
  if (input.next.comesBack) {
    await diarise({
      accountId: input.entry.accountId,
      // Stays with whoever holds it. One person does not move work into another person's diary.
      ownerId: input.entry.ownerId,
      dueOn: input.next.dueOn,
      kind: input.next.kind,
      reason: input.next.note,
      alsoNoteOnAccount: true,
      actor: input.actor,
    })
  } else {
    // Out of circulation is a fact about the ACCOUNT, so it is written where the account's
    // history is read rather than only on a diary row nobody will look for.
    try {
      await addNote({
        accountId: input.entry.accountId,
        body: `Out of the diary — ${exitLabel(input.next.exit).toLowerCase()}.`
          + (input.next.note?.trim() ? ` ${input.next.note.trim()}` : ''),
        authorName: input.actor.name,
        createdBy: input.actor.id,
      })
    } catch {
      // See diarise: a missing note must not refuse the work.
    }
  }

  await completeEntry({ id: input.entry.id, outcome: input.outcome, actor: input.actor })
}

/**
 * Active accounts with nothing booked — the hole this design is meant to close.
 *
 * Counted rather than prevented, because the database cannot sensibly refuse to leave an account
 * un-diarised (an import creates thousands at once, and a write-off legitimately empties one).
 * A number a team leader can see is the honest version: it was 355 on the day the Swordfish book
 * landed, and it should trend to nothing.
 */
export async function countOutOfCirculation(): Promise<number> {
  const { data, error } = await supabase
    .from('debtor_accounts')
    .select('id')
    .is('diary_date', null)
    .ilike('status', 'Active%')
    .limit(2000)
  if (error) throw new Error(error.message)
  return (data ?? []).length
}

/* ---------- the team leader's view ---------- */

export interface AgentLoad {
  ownerId: string | null
  due: number
  overdue: number
  /** The oldest thing still open, which is the number that says whether somebody is in trouble. */
  oldest: string | null
}

/**
 * Who is carrying what, for the day given.
 *
 * One query for the whole firm rather than one per agent: there are a few dozen people and this
 * is a screen somebody leaves open.
 */
export async function fetchTeamLoad(date: string): Promise<AgentLoad[]> {
  const { data, error } = await supabase
    .from('diary_entries')
    .select('owner_id, due_on')
    .eq('state', 'open')
    .lte('due_on', date)
  if (error) throw new Error(error.message)

  const byOwner = new Map<string | null, AgentLoad>()
  for (const r of (data ?? []) as { owner_id: string | null; due_on: string }[]) {
    const current = byOwner.get(r.owner_id) ?? { ownerId: r.owner_id, due: 0, overdue: 0, oldest: null }
    if (isMissed({ state: 'open', dueOn: r.due_on }, date)) current.overdue += 1
    else current.due += 1
    if (!current.oldest || r.due_on < current.oldest) current.oldest = r.due_on
    byOwner.set(r.owner_id, current)
  }
  // Worst first: whoever is furthest behind is who a leader has to deal with.
  return [...byOwner.values()].sort((a, b) => b.overdue - a.overdue || b.due - a.due)
}

/** Everything one agent has missed, for the bulk re-diarise tool. */
export async function fetchOverdue(input: {
  ownerId: string | null
  before: string
  limit?: number
}): Promise<DiaryRow[]> {
  let q = supabase.from('diary_entries').select(ROW_SELECT).eq('state', 'open').lt('due_on', input.before)
  q = input.ownerId ? q.eq('owner_id', input.ownerId) : q.is('owner_id', null)
  const { data, error } = await q.order('priority').order('due_on').limit(input.limit ?? 500)
  if (error) throw new Error(error.message)
  return (data ?? []).map(toRow)
}
