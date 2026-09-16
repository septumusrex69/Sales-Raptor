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
  /** The promise itself, where the entry is checking one. See the mapper. */
  promise: { id: string; amount: number; dueOn: string; status: string } | null
  queryId: string | null
  doneAt: string | null
  doneBy: string | null
  outcome: string | null
  movedTo: string | null
  movedAt: string | null
  movedBy: string | null
  movedReason: string | null
  createdAt: string
  /** Who booked it. Compared against owner_id to tell a referral from your own next date. */
  createdBy: string | null
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
    /* Carried so the finish box can preview the client's own line before the date is booked. */
    subStatus: string | null
    /* Swordfish's own filing, and evidence where the sub-status is silent — see clientPosition. */
    bucket: string | null
    clientActionAsk: string | null
    prescriptionDate: string | null
    mainComment: string | null
    mainCommentAt: string | null
    /* Whether it has ever been worked, which is the whole of the internal "New" rung. */
    lastActionAt: string | null
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
  createdBy: r.created_by ?? null,
  /*
   * The promise this entry is here to check, where there is one.
   *
   * Carried so the finish box can SHOW it rather than ask for it again. The firm's objection, and
   * it was right: "there's already a PTP in place, why do you need to redo this?" A box that
   * demands an amount and a date somebody already gave teaches them to retype it, and then the
   * promise on the account and the one in the box are two different promises.
   */
  promise: r.promises_to_pay
    ? {
      id: r.promises_to_pay.id as string,
      amount: Number(r.promises_to_pay.amount ?? 0),
      dueOn: String(r.promises_to_pay.due_on),
      status: String(r.promises_to_pay.status),
    }
    : null,
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
    subStatus: r.debtor_accounts?.sub_status ?? null,
    bucket: r.debtor_accounts?.bucket ?? null,
    clientActionAsk: r.debtor_accounts?.client_action_ask ?? null,
    prescriptionDate: r.debtor_accounts?.prescription_date ?? null,
    mainComment: r.debtor_accounts?.main_comment ?? null,
    mainCommentAt: r.debtor_accounts?.main_comment_at ?? null,
    lastActionAt: r.debtor_accounts?.last_action_at ?? null,
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
  promises_to_pay!diary_entries_promise_id_fkey ( id, amount, due_on, status ),
  debtor_accounts!diary_entries_account_id_fkey (
    id, company_id, account_number, debtor_first_name, debtor_surname,
    capital_outstanding, status, sub_status, bucket, client_action_ask, last_action_at,
    prescription_date, main_comment, main_comment_at
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

/**
 * How many entries this person has closed today.
 *
 * The work bar used to read "1 of 42", which is true and useless: a finished entry leaves the
 * queue, so the next one is always the first of what is left and the "1 of" never moves. An
 * agent three hours into a diary saw the same words as one who had just started.
 *
 * What they actually want to know is how far they have got, and that is two numbers: what is
 * done and what is left. The done half cannot come from the day's queue, because the queue holds
 * only what is still open — hence its own count.
 */
export async function countWorkedToday(ownerId: string | null, date: string): Promise<number> {
  if (!ownerId) return 0
  // Never throws. Nothing depends on this number, and something important sits next to it.
  try {
    return await countDone(ownerId, date)
  } catch {
    return 0
  }
}

async function countDone(ownerId: string, date: string): Promise<number> {
  const { count, error } = await supabase
    .from('diary_entries')
    .select('id', { count: 'exact', head: true })
    .eq('state', 'done')
    .eq('done_by', ownerId)
    .gte('done_at', `${date}T00:00:00`)
    .lte('done_at', `${date}T23:59:59.999`)
  if (error) return 0
  return count ?? 0
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
  /*
   * ONE DIARY DATE PER ACCOUNT, at the firm's instruction: booking a new one takes the old one
   * away. Enforced by a unique index on open entries, so this is not a nicety — without it the
   * insert below is simply refused.
   *
   * Done here rather than in each caller because every path that books a date goes through this
   * function, and a rule implemented in four places is a rule that holds in three.
   *
   * Marked `moved` rather than cancelled: the work did not stop, it went somewhere else, and the
   * original keeps the date it was always due so "this was booked for the 7th and nobody worked
   * it" survives as a fact.
   */
  /*
   * EVERY open entry, with nothing spared. There was once an escape hatch for the entry a caller
   * was in the middle of closing itself — and it was the bug: the caller's entry stayed open,
   * the insert below made a second, and the unique index refused it. Callers close first now.
   */
  const { error: supersedeError } = await supabase
    .from('diary_entries')
    .update({ state: 'moved', moved_at: new Date().toISOString(), moved_by: input.actor.id })
    .eq('account_id', input.accountId)
    .eq('state', 'open')
  if (supersedeError) throw new Error(supersedeError.message)

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
    /*
     * NOTHING IS SPARED. diarise() supersedes the original on the way past, marking it `moved`
     * with who and when — which is what makes room for the replacement, because an account may
     * hold only one open entry. Sparing it, as this used to, left two open at once and the index
     * refused the insert outright.
     */
    promiseId: null,
    queryId: null,
    alsoNoteOnAccount: input.alsoNoteOnAccount,
    actor: input.actor,
  })

  /*
   * The original is already `moved`. What is left is where it went and why — and those two
   * columns can still be written because protect_closed_diary_entries preserves account, owner,
   * date, kind, state, source and the done/moved stamps on a closed row, and deliberately not
   * moved_to or moved_reason. That exclusion is the only reason the audit trail can be completed
   * after the fact; do not add them to the trigger.
   */
  const { error } = await supabase.from('diary_entries').update({
    moved_reason: input.reason?.trim() || null,
    moved_to: replacement.id,
  }).eq('id', input.entry.id)
  if (error) {
    // The move HAPPENED — the old entry is closed and the new one exists. Only the link between
    // them is missing, so say that rather than implying the work did not move.
    throw new Error(`Moved to ${input.dueOn}, but the trail linking the old entry to the new one could not be written: ${error.message}`)
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
 * THIS ONE CLOSES BEFORE THE NEXT IS WRITTEN, and it used to be the other way round.
 *
 * The old order booked the replacement first, on the reasoning that a failure would leave the
 * account double-booked — visible, and fixed in ten seconds — where closing first risked leaving
 * it in nobody's diary, invisible and permanent. That was right at the time. Two things have
 * since made it wrong:
 *
 *   - An account may not hold two open entries. The partial unique index refuses the second, so
 *     the old order does not merely risk a double booking, it CANNOT COMPLETE: working an entry
 *     and booking the next threw a constraint violation at the agent every time.
 *   - "In nobody's diary" stopped being invisible. The No diary date view counts exactly this,
 *     on the accounts screen, live.
 *
 * So the risk the old order was avoiding is now the one that is caught, and the risk it accepted
 * is now the one that is impossible. If the booking fails after the close, the work is saved,
 * the account lands in No diary date, and the agent is told in those words.
 */
export async function workEntry(input: {
  entry: DiaryEntry
  /**
   * What came of it. Optional, and it is the ONLY note.
   *
   * There were two boxes — "what came of it" and, lower down, "a note" — which is the same
   * question asked twice. Somebody who has just written two sentences about a phone call has
   * nothing left for the second box, so it got a full stop in it. One box, carried everywhere:
   * onto the closed entry, onto the next one as the reason it is coming back, and onto the
   * account's own timeline.
   */
  outcome?: string
  /** Either when it comes back, or why it is leaving the book altogether. */
  next:
    | { comesBack: true; dueOn: string; kind: DiaryKind }
    | { comesBack: false; exit: CirculationExit }
  actor: Actor
}): Promise<void> {
  const said = input.outcome?.trim() ?? ''

  // Closed first, as `done`, carrying the agent's outcome. Until this lands the account still
  // holds an open entry, and the index would refuse the replacement.
  await completeEntry({ id: input.entry.id, outcome: said || null, actor: input.actor })

  /*
   * ONE note on the account's timeline, saying what happened and what happens next.
   *
   * Both halves in one line because they are one event: "Rang him, no answer. Back on 21
   * September." Two separate notes a second apart read as two things having happened, and the
   * timeline is what somebody scrolls when they pick this account up cold.
   *
   * Allowed to fail without failing the work. An account whose entry closed but whose note did
   * not save is a small gap; refusing to close the entry over it would strand the agent.
   */
  try {
    const next = input.next.comesBack
      ? `Back on ${input.next.dueOn}.`
      : `Out of the diary — ${exitLabel(input.next.exit).toLowerCase()}.`
    const body = said ? `${said} ${next}` : next
    await addNote({
      accountId: input.entry.accountId,
      body,
      authorName: input.actor.name,
      createdBy: input.actor.id,
    })
  } catch {
    // Deliberately swallowed — see above.
  }

  if (input.next.comesBack) {
    try {
      await diarise({
        accountId: input.entry.accountId,
        // Stays with whoever holds it. One person does not move work into another person's diary.
        ownerId: input.entry.ownerId,
        dueOn: input.next.dueOn,
        kind: input.next.kind,
        reason: said || null,
        // The note above covers both halves in one sentence; a second would read as two events.
        alsoNoteOnAccount: false,
        actor: input.actor,
      })
    } catch (e) {
      /*
       * The work is already saved. Say precisely what did and did not happen, and where the
       * account has gone — "failed" on its own would have an agent redo a call they have made.
       */
      throw new Error(
        `The work was saved, but ${input.next.dueOn} could not be booked: `
        + `${e instanceof Error ? e.message : String(e)}. `
        + 'The account is now under No diary date on the accounts screen.',
      )
    }
  }
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
