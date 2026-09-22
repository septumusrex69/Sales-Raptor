/**
 * Moving accounts between desks, in bulk.
 *
 * The book arrived from Swordfish with every one of its 736 accounts unallocated — the old system
 * carried the agent's name as free text, which is a label rather than an owner, so nothing could
 * be assigned, counted or handed over. Allocating them one at a time is not a thing anybody would
 * finish.
 *
 * THE DANGEROUS PART IS "ALL 214 MATCHING", not the tick boxes. A person who ticks eleven rows
 * has seen eleven rows; a person who clicks "select all matching" is trusting that the filters
 * mean the same thing to the database as they did to the list. They do, because both go through
 * applyAccountFilters — one function, used twice, which is the whole reason it exists.
 *
 * Every move leaves a note on each account. A book where accounts change hands invisibly is a
 * book where "who was supposed to be working this in March" has no answer, and that question is
 * asked every time a client complains.
 */
import { supabase } from './supabase'
import { applyAccountFilters, type AccountQuery } from './accountBook'

export interface Actor {
  id: string | null
  name: string | null
}

/**
 * Which accounts a bulk action applies to.
 *
 * Two shapes, deliberately not one. `ids` is what was ticked and cannot grow between the
 * confirmation and the write. `query` is a filter, and a filter can match more accounts by the
 * time it runs than it did when it was counted — so the count is re-taken and shown, and the
 * caller confirms against a number rather than a promise.
 */
export type Selection =
  | { kind: 'ids'; ids: string[] }
  | { kind: 'matching'; query: AccountQuery }

export interface BulkResult {
  /** How many accounts were actually changed. */
  changed: number
  /** Accounts changed, but whose note could not be written. The move stands; the trail is short. */
  notesFailed: number
}

/** The ids a selection covers. Resolved before the write so the note and the update agree. */
async function resolveIds(selection: Selection): Promise<string[]> {
  if (selection.kind === 'ids') return selection.ids

  /*
   * COUNTED FIRST, THEN FETCHED, AND THE TWO MUST AGREE. One request rather than paging, which
   * means the ids that come back are only the whole answer if nothing capped them — and a cap is
   * silent. PostgREST will return exactly its max-rows and say nothing, so a shuffle of three
   * thousand could quietly move the first thousand and report success, which is the worst failure
   * this module has available to it: a bulk action that looks finished and is not.
   *
   * So the exact count is taken separately and checked against what arrived. The two can also
   * differ because a colleague changed something in between, which is why the message says the
   * safe thing rather than blaming a cap it cannot see.
   */
  const expected = await selectionCount(selection)
  if (expected > BULK_CEILING) throw new BulkTooLarge(expected)

  const { data, error } = await applyAccountFilters(
    supabase.from('debtor_accounts').select('id').limit(BULK_CEILING + 1),
    selection.query,
  )
  if (error) throw new Error(error.message)
  const ids = (data ?? []).map((r) => (r as { id: string }).id)
  if (ids.length !== expected) {
    throw new Error(
      `${expected.toLocaleString('en-ZA')} accounts match but the database returned `
      + `${ids.length.toLocaleString('en-ZA')}. Nothing has been changed. Somebody may have `
      + 'edited an account while this was being counted — check the filters and try again.',
    )
  }
  return ids
}

/**
 * The most accounts one action may move.
 *
 * FIVE THOUSAND, AND IT WAS FIVE HUNDRED. The note here used to argue that this was not a
 * technical limit but the point past which nobody is really checking — a clerk moving two
 * thousand accounts in one click has not reviewed two thousand accounts. That reasoning holds
 * for allocating, and the firm has pointed out it does not hold for the job they actually do
 * most: SHUFFLING THE BOOK, moving every account that has gone two month ends since handover
 * without paying, which is routinely three thousand accounts at a time. Nobody reviews those
 * individually and nobody is meant to — the rule is the review, and the plan preview is where it
 * is checked. A ceiling that forced it into seven passes would not add a review, only six more
 * chances to lose track of which pass covered what.
 *
 * Still a ceiling rather than none, because an unbounded bulk action over a six-figure table is
 * a request nobody can verify afterwards, and "the whole book" is better done per client.
 */
export const BULK_CEILING = 5000

/**
 * Ids per request, for any write that filters on `in(id, ...)`.
 *
 * PostgREST takes filters in the QUERY STRING, including on an UPDATE, so a list of ids is URL
 * length rather than body size: a UUID plus its comma is 37 characters, so a hundred of them is
 * about 3.7 KB and two hundred would sit on top of the 8 KB request line most proxies allow. At
 * the old ceiling of five hundred this was one request of nearly twenty kilobytes, which is a
 * limit waiting to be found on the day somebody shuffles a big client.
 */
export const ID_CHUNK = 100

/** A list of ids split into URL-safe requests. */
export function idChunks(ids: string[]): string[][] {
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) out.push(ids.slice(i, i + ID_CHUNK))
  return out
}

export class BulkTooLarge extends Error {
  /** Declared and assigned separately: parameter properties are not erasable TypeScript syntax. */
  count: number
  constructor(count: number) {
    super(`That is ${count.toLocaleString('en-ZA')} accounts. Narrow the filters to ${BULK_CEILING} or fewer, or work through it a client at a time.`)
    this.name = 'BulkTooLarge'
    this.count = count
  }
}

/**
 * Put a set of accounts on somebody's desk, or take them off every desk.
 *
 * `toUserId: null` returns them to the unallocated pile, which is a real thing a team leader
 * does — an agent leaves, and their book has to go somewhere before it is shared out.
 */
export async function allocate(input: {
  selection: Selection
  toUserId: string | null
  toUserName: string | null
  actor: Actor
  /** Why, in the team leader's words. Optional: "shared out the new handover" is often the whole story. */
  reason?: string | null
}): Promise<BulkResult> {
  const ids = await resolveIds(input.selection)
  if (ids.length > BULK_CEILING) throw new BulkTooLarge(ids.length)
  if (ids.length === 0) return { changed: 0, notesFailed: 0 }

  /*
   * Written by id, not by re-running the filter. Between the count and the write an account can
   * be paid, frozen or reassigned by somebody else — and an update that re-matched would quietly
   * move accounts nobody counted, which is the exact failure this whole module is careful about.
   *
   * In chunks — see ID_CHUNK. A failure part way leaves the earlier chunks moved, which is why it
   * throws rather than reporting a count: a half-finished move the caller was told succeeded is
   * worse than one they are told to go and look at. The notes below name every account that did
   * move, so the trail is there either way.
   */
  for (const chunk of idChunks(ids)) {
    const { error } = await supabase
      .from('debtor_accounts')
      .update({ assigned_to: input.toUserId })
      .in('id', chunk)
    if (error) throw new Error(error.message)
  }

  const where = input.toUserName
    ? `Moved to ${input.toUserName}’s desk`
    : 'Taken off the desk and returned to the unallocated pile'
  const by = input.actor.name ? ` by ${input.actor.name}` : ''
  const why = input.reason?.trim() ? ` — ${input.reason.trim()}` : ''
  const notesFailed = await noteEach(ids, `${where}${by}${why}.`, input.actor)

  return { changed: ids.length, notesFailed }
}

/**
 * One note per account, in chunks.
 *
 * source: 'manual' rather than 'system', because the timeline's default filter hides system
 * notes — and an allocation somebody has to answer for later is not machine chatter. A person
 * decided this, and the note should sit where a person will see it.
 *
 * Never throws. The allocation is already written; failing the whole call because a note did not
 * save would tell the caller nothing happened when it did.
 */
async function noteEach(ids: string[], body: string, actor: Actor): Promise<number> {
  let failed = 0
  for (let i = 0; i < ids.length; i += 100) {
    const rows = ids.slice(i, i + 100).map((accountId) => ({
      account_id: accountId,
      body,
      author_name: actor.name,
      created_by: actor.id,
      kind: 'status',
      source: 'manual',
    }))
    const { error } = await supabase.from('account_notes').insert(rows)
    if (error) failed += rows.length
  }
  return failed
}

/**
 * How many of a selection are on nobody's desk.
 *
 * THE FIRM, on the accounts a handover has just opened: "there's no option of just referring. It
 * should be allocated and referred."
 *
 * AND THAT IS A RULE, NOT A PREFERENCE FOR NEW ACCOUNTS. handOutWrite.ts already refuses
 * "allocate but do not book", because an account on a desk with nobody diarised is how 355
 * accounts arrived from Swordfish owned by somebody and rung by nobody. Refer-only on an account
 * nobody owns is the same fault seen from the other side: a diary entry against a book that is
 * not anybody's. So the question the screen has to answer is not "is this an import" -- it is
 * "does this account have an owner for a referral to leave alone", and only the book can say.
 */
export async function unallocatedCount(selection: Selection): Promise<number> {
  if (selection.kind === 'ids') {
    let total = 0
    /* In chunks, like every other id query here: PostgREST gives up on a long `in` list long
       before Postgres does, and a 5 000-account batch is exactly what this is for. */
    for (const ids of idChunks(selection.ids)) {
      const { count, error } = await supabase.from('debtor_accounts')
        .select('id', { count: 'exact', head: true }).in('id', ids).is('assigned_to', null)
      if (error) throw new Error(error.message)
      total += count ?? 0
    }
    return total
  }
  const { count, error } = await applyAccountFilters(
    supabase.from('debtor_accounts').select('id', { count: 'exact', head: true }),
    /* The same filters, plus the one question being asked. `nobody` is what applyAccountFilters
       reads as "is null" -- see the note on assignedTo there. */
    { ...selection.query, assignedTo: 'nobody' },
  )
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** How many accounts a selection covers, for the confirmation that has to name a number. */
export async function selectionCount(selection: Selection): Promise<number> {
  if (selection.kind === 'ids') return selection.ids.length
  const { count, error } = await applyAccountFilters(
    supabase.from('debtor_accounts').select('id', { count: 'exact', head: true }),
    selection.query,
  )
  if (error) throw new Error(error.message)
  return count ?? 0
}
