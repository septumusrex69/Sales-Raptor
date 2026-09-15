/**
 * The account list's filters, as data rather than as JSX.
 *
 * Two things live here and nothing else: what a URL means, and what a set of filters reads like
 * in words. Both are pure, both are tested, and neither needs React — which matters because the
 * filters are the part of the screen a person will get wrong, and a wrong filter does not throw.
 * It quietly returns a shorter list, and a shorter list looks like good news.
 *
 * THE URL IS THE STATE. Not component state mirrored into the URL: the URL, read on every render.
 * A collections manager who has narrowed the book to "Nedbank, nothing logged in sixty days,
 * over R10 000" is holding a question, and a question you cannot send to somebody else is half a
 * tool. Reload, back button, and a pasted link all have to land on the same list.
 */
import type { AccountQuery } from './accountBook.ts'

/** Relative windows, because nobody asks "since 17 July". They ask "in the last two months". */
export const QUIET_CHOICES = [
  { days: 7, label: 'nothing in 7 days' },
  { days: 14, label: 'nothing in 14 days' },
  { days: 30, label: 'nothing in 30 days' },
  { days: 60, label: 'nothing in 60 days' },
  { days: 90, label: 'nothing in 90 days' },
] as const

export const PRESCRIBING_CHOICES = [
  { days: 30, label: 'prescribes within 30 days' },
  { days: 90, label: 'prescribes within 90 days' },
  { days: 180, label: 'prescribes within 6 months' },
  { days: 365, label: 'prescribes within a year' },
] as const

export const STATUS_GROUPS = [
  { value: 'active', label: 'Live book' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'closed', label: 'Closed or written off' },
] as const

/** Every key this screen owns. Clearing the filters clears exactly these and leaves the rest. */
/*
 * Every key this screen owns. Clearing the filters clears exactly these and leaves the rest.
 *
 * `bucket` and `drift` have no control in the panel any more — the firm does not use the word
 * "bucket" and did not want mandate drift as a filter — but they stay here, because a view and a
 * summary tile still set them. A param that can be set and cannot be cleared is a filter nobody
 * can turn off.
 */
export const FILTER_PARAMS = [
  'status', 'sub', 'bucket', 'who', 'team', 'from', 'to',
  'adrift', 'never', 'quiet', 'presc', 'duplum', 'waiting', 'min', 'drift',
] as const
export type FilterParam = (typeof FILTER_PARAMS)[number]

/**
 * A date N days from `today`, as an ISO date.
 *
 * Pinned to UTC on purpose. `new Date().toISOString().slice(0, 10)` in Johannesburg is the same
 * calendar day as it is in UTC for all but two hours of the night, and the alternative — local
 * date arithmetic across a DST boundary the country does not observe — is more machinery than
 * the question needs. `today` is a parameter so this can be tested at all.
 */
export function shiftDays(today: Date, days: number): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const num = (v: string | null): number | undefined => {
  if (v === null || v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/**
 * What a URL is asking for.
 *
 * Unknown values are dropped rather than passed through: `?status=banana` narrows nothing, which
 * is the safe failure. A filter that silently hides accounts because somebody mistyped a query
 * string is how a book goes unworked.
 */
export interface QueryContext {
  /** Team id → the ids of its members. Supplied by the app, which already holds the people. */
  teamMembers?: (teamId: string) => string[]
}

export function queryFromParams(
  params: URLSearchParams,
  today = new Date(),
  ctx: QueryContext = {},
): AccountQuery {
  const q: AccountQuery = {}

  const search = params.get('q')?.trim()
  if (search) q.search = search

  const client = params.get('client')
  if (client) q.companyId = client

  const group = params.get('status')
  if (group && STATUS_GROUPS.some((g) => g.value === group)) {
    q.statusGroup = group as AccountQuery['statusGroup']
  }

  const sub = params.get('sub')
  if (sub) q.subStatus = sub
  const bucket = params.get('bucket')
  if (bucket) q.bucket = bucket
  const who = params.get('who')
  if (who) q.assignedTo = who

  /*
   * A team is a set of desks. Resolved here rather than in SQL because membership lives on
   * profiles, which the app already holds — and an unresolvable team narrows to nothing rather
   * than to the whole book, which is the failure that would matter.
   */
  const team = params.get('team')
  if (team) q.assignedToAny = ctx.teamMembers?.(team) ?? []

  const from = params.get('from')
  if (from) q.handedOverFrom = from
  const to = params.get('to')
  if (to) q.handedOverTo = to

  if (params.get('adrift') === '1') q.adrift = true
  if (params.get('never') === '1') q.neverWorked = true
  if (params.get('duplum') === '1') q.inDuplum = true
  if (params.get('waiting') === '1') q.waitingOnClient = true
  if (params.get('drift') === '1') q.commissionDriftOnly = true

  // Relative in the URL, absolute in the query. A saved link means "in the last 30 days" on the
  // day it is opened, not on the day it was sent.
  const quiet = num(params.get('quiet'))
  if (quiet !== undefined && quiet > 0) q.quietSince = shiftDays(today, -quiet)

  const presc = num(params.get('presc'))
  if (presc !== undefined && presc > 0) q.prescribingBefore = shiftDays(today, presc)

  const min = num(params.get('min'))
  if (min !== undefined && min > 0) q.minOutstanding = min

  return q
}

/**
 * Is anything narrowing the book, beyond the client it belongs to?
 *
 * Lives here rather than beside AccountQuery so it can be tested: accountBook.ts opens a Supabase
 * client on import and cannot be loaded outside a browser. A function nobody can run in a check
 * is a function that drifts.
 */
export function hasAccountFilters(q: AccountQuery): boolean {
  return !!(q.search?.trim() || q.status || q.statusGroup || q.subStatus || q.bucket
    || q.assignedTo || q.assignedToAny
    || q.handedOverFrom || q.handedOverTo || q.adrift || q.neverWorked || q.quietSince
    || q.prescribingBefore || q.inDuplum || q.waitingOnClient || q.minOutstanding
    || q.commissionDriftOnly)
}

export interface FilterChip {
  /** The URL key to delete when the chip's × is clicked. */
  param: FilterParam
  label: string
}

export interface ChipNames {
  /** profiles.id → the person's name, for the desk chip. */
  userName?: (id: string) => string | undefined
  /** teams.id → the team's name. */
  teamName?: (id: string) => string | undefined
}

const money = (n: number) => `R${n.toLocaleString('en-ZA')}`

/**
 * The filters in words, one chip each.
 *
 * Reads back what was asked for rather than which controls are set — "nothing in 30 days" and
 * not "quiet: 30". The chips are the only place the narrowing is visible once the panel is
 * closed, so an unreadable chip is an invisible filter.
 *
 * The client is deliberately absent: it has its own control in the bar and is not something the
 * "Clear filters" button should throw away.
 */
export function filterChips(params: URLSearchParams, names: ChipNames = {}): FilterChip[] {
  const out: FilterChip[] = []

  const group = STATUS_GROUPS.find((g) => g.value === params.get('status'))
  if (group) out.push({ param: 'status', label: group.label })

  const sub = params.get('sub')
  if (sub) out.push({ param: 'sub', label: sub })

  /*
   * The bucket has no control in the panel — "bucket" is Swordfish's word, not the firm's — but
   * a view sets it, so it still has to read back as something. 'Failed PTPs' is the one that
   * matters and it gets the firm's name for it.
   */
  const bucket = params.get('bucket')
  if (bucket === 'Failed PTPs') out.push({ param: 'bucket', label: 'Broken promises' })
  else if (bucket) out.push({ param: 'bucket', label: bucket })

  const team = params.get('team')
  if (team) out.push({ param: 'team', label: names.teamName?.(team) ?? 'One team' })

  const who = params.get('who')
  if (who === 'nobody') out.push({ param: 'who', label: 'On nobody’s desk' })
  else if (who) out.push({ param: 'who', label: names.userName?.(who) ?? 'One agent’s desk' })

  const from = params.get('from')
  const to = params.get('to')
  if (from && to) out.push({ param: 'from', label: `Handed over ${from} to ${to}` })
  else if (from) out.push({ param: 'from', label: `Handed over from ${from}` })
  else if (to) out.push({ param: 'to', label: `Handed over up to ${to}` })

  if (params.get('adrift') === '1') out.push({ param: 'adrift', label: 'No diary date' })
  if (params.get('never') === '1') out.push({ param: 'never', label: 'Never worked' })

  const quiet = num(params.get('quiet'))
  if (quiet !== undefined && quiet > 0) {
    const known = QUIET_CHOICES.find((c) => c.days === quiet)
    out.push({ param: 'quiet', label: known ? known.label[0].toUpperCase() + known.label.slice(1) : `Nothing in ${quiet} days` })
  }

  const presc = num(params.get('presc'))
  if (presc !== undefined && presc > 0) {
    const known = PRESCRIBING_CHOICES.find((c) => c.days === presc)
    out.push({ param: 'presc', label: known ? known.label[0].toUpperCase() + known.label.slice(1) : `Prescribes within ${presc} days` })
  }

  if (params.get('duplum') === '1') out.push({ param: 'duplum', label: 'In duplum' })
  if (params.get('waiting') === '1') out.push({ param: 'waiting', label: 'Waiting on the client' })

  const min = num(params.get('min'))
  if (min !== undefined && min > 0) out.push({ param: 'min', label: `${money(min)} or more outstanding` })

  if (params.get('drift') === '1') out.push({ param: 'drift', label: 'Off their mandate rate' })

  return out
}

/** A copy of the params with every filter this screen owns removed. Search and client survive. */
export function clearedFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const key of FILTER_PARAMS) next.delete(key)
  return next
}
