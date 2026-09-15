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
   * No range, so PostgREST's default page cap applies. Raised deliberately rather than paged: a
   * bulk action over more accounts than one request returns is one nobody can verify afterwards,
   * and "allocate the whole book" is better done per client than in a single swing.
   */
  const { data, error } = await applyAccountFilters(
    supabase.from('debtor_accounts').select('id').limit(BULK_CEILING + 1),
    selection.query,
  )
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => (r as { id: string }).id)
}

/**
 * The most accounts one action may move.
 *
 * Not a technical limit — it is the point past which nobody is really checking. A clerk moving
 * two thousand accounts in one click has not reviewed two thousand accounts, and the undo for
 * this is another bulk action in the other direction plus a timeline full of noise.
 */
export const BULK_CEILING = 500

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
   */
  const { error } = await supabase
    .from('debtor_accounts')
    .update({ assigned_to: input.toUserId })
    .in('id', ids)
  if (error) throw new Error(error.message)

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
