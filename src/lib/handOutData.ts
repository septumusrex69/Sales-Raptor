/**
 * Everything the hand-out planner needs, gathered and shaped.
 *
 * The planner is pure and knows nothing about Supabase, which is what makes it testable. This is
 * the seam: it reads the accounts, the people and the diaries, derives the two things an account
 * cannot tell you about itself — its band and what kind of work it is — and hands over plain data.
 */
import { supabase } from './supabase'
import { applyAccountFilters, type AccountQuery, type DebtorAccount } from './accountBook'
import { COLLECTING_ROLES, UNGRADED_EQUIVALENT, accountBand } from './collectorGrade.ts'
import { clientPosition } from './clientPosition.ts'
import { DEFAULT_DIARY_CAPACITY } from './diaryPriority.ts'
import type { DiaryKind } from './diaryPriority.ts'
import type { PlannableAccount, PlannableCollector } from './handOut.ts'
import type { CollectorGrade } from './collectorGrade.ts'
import type { User } from '../types'

/**
 * What kind of work this account is, from what it already says.
 *
 * READS THE BUCKET BEFORE THE SUB-STATUS for broken promises, and the gap is the reason: Swordfish
 * files 40 accounts under 'Failed PTPs' while only 3 carry sub-status 'Payment Default', and 13 of
 * those 40 still claim a live promise the old system had already flagged as broken. Trusting the
 * sub-status here would find three of the forty and leave the rest as routine reviews.
 */
export function diaryKindFor(a: DebtorAccount): DiaryKind {
  const sub = (a.subStatus ?? '').toLowerCase()
  if (a.bucket === 'Failed PTPs' || /payment\s*default/.test(sub)) return 'promise_broken'
  if (!a.lastActionAt) return 'new_account'
  if (/promise\s*to\s*pay|\bptp\b/.test(sub)) return 'promise_due'
  if (/defended|dispute/.test(sub)) return 'dispute_chase'
  if (/tracing|trace/.test(sub)) return 'trace'
  return 'review'
}

/** An account as the planner sees it: a band, a kind, and a name a person can read. */
export function toPlannable(a: DebtorAccount, alreadyBooked: boolean): PlannableAccount {
  const position = clientPosition({ status: a.status, subStatus: a.subStatus })
  return {
    id: a.id,
    label: [a.accountNumber, [a.debtorFirstName, a.debtorSurname].filter(Boolean).join(' ')]
      .filter(Boolean).join(' · ') || a.id,
    band: accountBand({
      capitalOutstanding: a.capitalOutstanding,
      disputed: position === 'disputed',
      inLegal: position === 'legal',
      underAdministration: position === 'under_administration',
    }),
    kind: diaryKindFor(a),
    capitalOutstanding: a.capitalOutstanding,
    alreadyBooked,
  }
}

export interface HandOutContext {
  accounts: PlannableAccount[]
  /** Everyone who could be given work: has a grade, and is active. */
  collectors: PlannableCollector[]
  /** Accounts in the selection that already carry an open diary entry. */
  alreadyBookedCount: number
}

/**
 * Load what the plan needs.
 *
 * `selection` is either the ids that were ticked or the filter that was showing — the same two
 * shapes the bulk bar offers, resolved through the same clause builder the list uses, so the plan
 * is made of exactly the accounts a person was looking at.
 */
export async function loadHandOutContext(input: {
  selection: { kind: 'ids'; ids: string[] } | { kind: 'matching'; query: AccountQuery }
  users: User[]
  /** The window being planned, so only the relevant slice of everyone's diary is fetched. */
  from: string
  to: string
  limit: number
}): Promise<HandOutContext> {
  const accountsQuery = input.selection.kind === 'ids'
    ? supabase.from('debtor_accounts').select('*').in('id', input.selection.ids)
    : applyAccountFilters(
      supabase.from('debtor_accounts').select('*').order('account_number').limit(input.limit),
      input.selection.query,
    )

  const [accountsRes, loadRes, dayRes] = await Promise.all([
    accountsQuery,
    supabase.rpc('collector_book_load'),
    supabase.rpc('diary_day_load', { p_from: input.from, p_to: input.to }),
  ])
  if (accountsRes.error) throw new Error(accountsRes.error.message)
  if (loadRes.error) throw new Error(loadRes.error.message)
  if (dayRes.error) throw new Error(dayRes.error.message)

  /* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON from PostgREST. */
  const rows = (accountsRes.data ?? []) as any[]
  const ids = rows.map((r) => r.id as string)

  /*
   * Which of these already carry an open diary entry. Asked for explicitly rather than read off
   * debtor_accounts.diary_date, because that column is kept in step by a trigger and the entry is
   * the thing the unique index actually protects. Skipping is the point: rebooking would drag an
   * account off whoever's Tuesday it is sitting on, silently.
   */
  let booked = new Set<string>()
  if (ids.length > 0) {
    const { data: openRows, error } = await supabase
      .from('diary_entries').select('account_id').eq('state', 'open').in('account_id', ids)
    if (error) throw new Error(error.message)
    booked = new Set((openRows ?? []).map((r: any) => r.account_id as string))
  }

  const bookLoad = new Map<string, number>(
    ((loadRes.data ?? []) as any[]).map((r) => [r.user_id as string, Number(r.in_play_accounts ?? 0)]),
  )
  const byDay = new Map<string, Record<string, number>>()
  for (const r of (dayRes.data ?? []) as any[]) {
    if (!r.owner_id) continue
    const days = byDay.get(r.owner_id) ?? {}
    days[String(r.due_on)] = Number(r.entries ?? 0)
    byDay.set(r.owner_id, days)
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const collectors: PlannableCollector[] = input.users
    /*
     * ROLE ADMITS, GRADE WIDENS. Anyone whose job is working a book is offered; the grade only
     * decides which accounts they may be given. Requiring a grade first meant a firm with thirty
     * pre-legal clerks saw an empty hand-out screen until somebody graded all thirty by hand.
     *
     * Anyone already graded is included whatever their role, so a manager who carries a book
     * does not disappear from the list.
     */
    .filter((u) => u.status === 'Active' && (COLLECTING_ROLES.includes(u.role) || !!u.collectorGrade))
    .map((u) => ({
      userId: u.id,
      name: u.name,
      grade: (u.collectorGrade as CollectorGrade | undefined) ?? UNGRADED_EQUIVALENT,
      ungraded: !u.collectorGrade,
      bookCeiling: u.bookCeiling ?? null,
      inPlayNow: bookLoad.get(u.id) ?? 0,
      capacity: u.diaryCapacity && u.diaryCapacity > 0 ? u.diaryCapacity : DEFAULT_DIARY_CAPACITY,
      bookedByDay: byDay.get(u.id) ?? {},
    }))

  const accounts = rows.map((r) => {
    const a = {
      id: r.id,
      accountNumber: r.account_number,
      debtorFirstName: r.debtor_first_name,
      debtorSurname: r.debtor_surname,
      capitalOutstanding: Number(r.capital_outstanding ?? 0),
      status: r.status ?? '',
      subStatus: r.sub_status,
      bucket: r.bucket,
      lastActionAt: r.last_action_at,
    } as DebtorAccount
    return toPlannable(a, booked.has(r.id))
  })

  return { accounts, collectors, alreadyBookedCount: booked.size }
}
