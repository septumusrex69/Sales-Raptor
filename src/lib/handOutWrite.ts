/**
 * Committing a hand-out plan.
 *
 * WRITES ONLY WHAT WAS SHOWN. It takes a HandOutPlan — the same object the preview rendered — and
 * never re-plans, never re-queries, never re-matches a filter. Between somebody reading the plan
 * and clicking the button an account can be paid, frozen or reassigned by a colleague, and a
 * writer that recalculated would move accounts nobody counted. The plan is the contract.
 *
 * ORDER MATTERS: allocate first, then book. An account booked into a diary belonging to somebody
 * it is not allocated to is a visible oddity a team leader can fix; an account allocated with no
 * diary entry is the adrift pile this whole feature exists to empty. If only one of the two can
 * happen, the diary entry is the one worth having last.
 */
import { supabase } from './supabase'
import { diarise } from './diary.ts'
import type { HandOutPlan } from './handOut.ts'

export interface HandOutResult {
  allocated: number
  booked: number
  /** Accounts the diary refused, with why. The allocation stands; these need a person. */
  failed: { accountId: string; message: string }[]
}

export interface Actor {
  id: string | null
  name: string | null
}

export async function commitHandOut(input: {
  plan: HandOutPlan
  /** Put each account on the desk of whoever it was planned for. */
  alsoAllocate: boolean
  /** Create the diary entries. Off makes this a pure allocation. */
  alsoBook: boolean
  actor: Actor
  reason?: string | null
  /** Called after each account so a long hand-out can show progress rather than appear hung. */
  onProgress?: (done: number, total: number) => void
}): Promise<HandOutResult> {
  const { placements } = input.plan
  const result: HandOutResult = { allocated: 0, booked: 0, failed: [] }
  if (placements.length === 0) return result

  if (input.alsoAllocate) {
    /*
     * Grouped by person so this is one update per desk rather than one per account — five
     * requests for five hundred accounts. Keyed by id, never by re-running the filter.
     */
    const byUser = new Map<string, string[]>()
    for (const p of placements) {
      const list = byUser.get(p.userId) ?? []
      list.push(p.accountId)
      byUser.set(p.userId, list)
    }
    for (const [userId, ids] of byUser) {
      const { error } = await supabase
        .from('debtor_accounts').update({ assigned_to: userId }).in('id', ids)
      if (error) throw new Error(`Allocating failed: ${error.message}`)
      result.allocated += ids.length
    }
  }

  if (!input.alsoBook) return result

  /*
   * One at a time, because diarise() does more than an insert: it supersedes whatever open entry
   * the account already has, writes the note, and respects the one-open-entry index. Batching the
   * insert would skip all of that and hit the unique constraint on the first account that was
   * already booked.
   *
   * A refusal does NOT stop the run. Five hundred accounts and one failure should leave 499
   * booked and one named, not 200 booked and 300 silently skipped.
   */
  let done = 0
  for (const p of placements) {
    try {
      await diarise({
        accountId: p.accountId,
        ownerId: p.userId,
        dueOn: p.dueOn,
        kind: p.kind,
        reason: input.reason?.trim() || null,
        source: 'manual',
        // The account's own timeline already gets the allocation note; a second line per account
        // saying the same thing in other words is noise on five hundred timelines.
        alsoNoteOnAccount: false,
        actor: input.actor,
      })
      result.booked += 1
    } catch (e) {
      result.failed.push({
        accountId: p.accountId,
        message: e instanceof Error ? e.message : String(e),
      })
    }
    done += 1
    input.onProgress?.(done, placements.length)
  }

  return result
}

/** What happened, in a sentence somebody can act on. */
export function handOutSummary(r: HandOutResult, names: (id: string) => string | undefined): string {
  const parts: string[] = []
  if (r.allocated > 0) parts.push(`${r.allocated.toLocaleString('en-ZA')} allocated`)
  if (r.booked > 0) parts.push(`${r.booked.toLocaleString('en-ZA')} booked into the diary`)
  if (parts.length === 0) parts.push('Nothing was changed')
  let out = `${parts.join(' · ')}.`
  if (r.failed.length > 0) {
    const first = names(r.failed[0].accountId) ?? r.failed[0].accountId
    out += ` ${r.failed.length} could not be booked (${first}: ${r.failed[0].message}).`
  }
  return out
}
