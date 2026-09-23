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
import { nudgeWorkflows } from './accountRun.ts'
import { diarise } from './diary.ts'
import type { HandOutPlan } from './handOut.ts'
import { ID_CHUNK, idChunks } from './accountAllocation.ts'
import { handOutNotices } from './handOutNotice.ts'

/**
 * The two things you can do with a stack of accounts, and they are not independent switches.
 *
 * THE FIRM'S RULE: an allocation cannot happen without a referral, but a referral can happen
 * without an allocation. Putting an account on somebody's desk and booking nobody to ring it is
 * exactly how 355 accounts arrived from Swordfish belonging to a person and diarised by nobody —
 * so that combination is not offered here at all, rather than being a checkbox somebody can
 * clear by accident.
 *
 *   refer              book them into a diary. Whose accounts they are does not change.
 *   allocate_and_refer put them on the person's desk, and book them in. Both, always.
 */
export type HandOutMode = 'refer' | 'allocate_and_refer'


export interface HandOutResult {
  allocated: number
  booked: number
  /** Accounts the diary refused, with why. The allocation stands; these need a person. */
  failed: { accountId: string; message: string }[]
  /** How many people were told. Reported so a silent failure to notify is visible. */
  notified: number
}

export interface Actor {
  id: string | null
  name: string | null
}

export async function commitHandOut(input: {
  plan: HandOutPlan
  /**
   * Refer only, or allocate and refer.
   *
   * There is deliberately no "allocate only". See HandOutMode: an account on a desk with nobody
   * booked to ring it is the state this whole feature exists to end, and a mode that produced it
   * would be a hole in the rule rather than a choice.
   */
  mode: HandOutMode
  actor: Actor
  reason?: string | null
  /**
   * The batch these accounts arrived in, when the whole hand-out came out of one.
   *
   * Only used to make the clerk's "see them" link a real list rather than their whole desk. A
   * hand-out assembled out of a filter across several batches leaves this null and the link falls
   * back to the person's own accounts, which is still true.
   */
  handoverId?: string | null
  /** Called after each account so a long hand-out can show progress rather than appear hung. */
  onProgress?: (done: number, total: number) => void
  /**
   * The caller's session, used for one thing only: hurrying a SINGLE account's workflow along.
   *
   * The database trigger starts the run whoever writes `assigned_to`, so the workflow happens
   * with or without this. What it buys is promptness -- the handover is an email and then an SMS
   * five to ten minutes later, and a once-daily sweep would introduce the firm to the debtor the
   * following dawn. Optional, because a hand-out with no token still hands out.
   */
  accessToken?: string | null
}): Promise<HandOutResult> {
  const { placements } = input.plan
  const result: HandOutResult = { allocated: 0, booked: 0, failed: [], notified: 0 }
  if (placements.length === 0) return result

  /*
   * Counted as the writes succeed, never off the plan. A clerk told "12 accounts allocated to you"
   * who finds nine is worse off than one told nine: the bell is the only account of this the
   * person gets, and an optimistic count turns it into a thing they have to re-check by hand.
   */
  const allocatedBy = new Map<string, number>()
  const bookedBy = new Map<string, number>()
  const bump = (m: Map<string, number>, userId: string, n = 1) => {
    m.set(userId, (m.get(userId) ?? 0) + n)
  }

  if (input.mode === 'allocate_and_refer') {
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
      /*
       * Chunked as well as grouped. Grouping alone is one request per desk, which is fine until a
       * shuffle of three thousand accounts goes to one person and that request carries three
       * thousand ids in its URL — see ID_CHUNK.
       */
      for (const chunk of idChunks(ids)) {
        const { error } = await supabase
          .from('debtor_accounts').update({ assigned_to: userId }).in('id', chunk)
        if (error) throw new Error(`Allocating failed: ${error.message}`)
        result.allocated += chunk.length
        bump(allocatedBy, userId, chunk.length)
      }
    }
  }

  /*
   * AND A SINGLE ALLOCATION IS HURRIED ALONG.
   *
   * ONE, NOT A BATCH, and the line is drawn here rather than at some size that looks safe: a
   * hand-out of five hundred accounts would be five hundred calls out of somebody's browser,
   * each one sending real email. A batch waits for the sweep, which is what the sweep is for.
   * One account is the interactive case -- somebody is standing there having just given an
   * account to a collector, and expecting the debtor to hear from the firm.
   *
   * NOT AWAITED. The accounts ARE allocated and the run IS created; a slow send must not make
   * the hand-out look like it failed, and the sweep is the backstop either way.
   */
  if (input.mode === 'allocate_and_refer' && placements.length === 1 && input.accessToken) {
    nudgeWorkflows(input.accessToken, placements[0].accountId)
  }

  /*
   * No early return on the way past. BOTH modes book — that is the rule — so there is no branch
   * here that could skip the diary and leave an allocation standing on its own.
   */
  /*
   * IN BATCHES, AND IN TWO PASSES: supersede every open entry on these accounts, then insert all
   * the new ones. It was one diarise() per account, which is two round trips each — a hundred
   * accounts took two hundred sequential requests and, in the firm's words, "a very long time".
   * The batch size is ID_CHUNK because the supersede filters on a list of account ids, and that
   * list is URL length rather than body size.
   *
   * The two passes are not an optimisation detail, they are what makes the batch legal. An
   * account may carry ONE open diary entry and a partial unique index enforces it, so inserting
   * a hundred rows while a hundred old ones are still open is refused on the first collision.
   * Closing them all first is exactly what diarise() does per account; doing it for the whole
   * stack at once is the same rule at a different grain.
   *
   * What is deliberately NOT batched: the account timeline note. commitHandOut never wrote one
   * anyway (a second line per account saying what the allocation note already says is noise on
   * five hundred timelines), so there is nothing lost here that diarise() was giving us.
   */
  const rows = placements.map((p) => ({
    account_id: p.accountId,
    owner_id: p.userId,
    due_on: p.dueOn,
    kind: p.kind,
    reason: input.reason?.trim() || null,
    /*
     * 'handover', not 'manual'. The enum has had the word all along and a bulk hand-out is
     * precisely it: work arriving on somebody's desk because a team leader sent it, not because
     * they booked their own next date. It is what lets the diary say "Referred by" without a
     * ninth rung on the ladder — the firm's choice, and the right one: the ladder orders a day by
     * urgency, and who sent the work is not urgency.
     */
    source: 'handover' as const,
    created_by: input.actor.id,
    created_by_name: input.actor.name,
  }))

  let done = 0
  const tick = (n: number) => { done += n; input.onProgress?.(done, placements.length) }

  for (let i = 0; i < placements.length; i += ID_CHUNK) {
    const slice = placements.slice(i, i + ID_CHUNK)
    try {
      const { error: supersedeError } = await supabase
        .from('diary_entries')
        .update({ state: 'moved', moved_at: new Date().toISOString(), moved_by: input.actor.id })
        .in('account_id', slice.map((p) => p.accountId))
        .eq('state', 'open')
      if (supersedeError) throw new Error(supersedeError.message)

      const { error } = await supabase.from('diary_entries').insert(rows.slice(i, i + ID_CHUNK))
      if (error) throw new Error(error.message)
      result.booked += slice.length
      for (const p of slice) bump(bookedBy, p.userId)
      tick(slice.length)
    } catch {
      /*
       * ONE BAD ROW MUST NOT COST THE OTHER NINETY-NINE. A batch fails whole, so the fallback
       * walks this chunk the slow way — the same diarise() per account as before — and each
       * account that still refuses is named. Five hundred accounts and one failure leaves 499
       * booked and one on a list, not 200 booked and 300 silently gone.
       *
       * Re-superseding inside diarise() is harmless: the entries this chunk's first pass already
       * closed are no longer open, so the update matches nothing.
       */
      for (const p of slice) {
        try {
          await diarise({
            accountId: p.accountId,
            ownerId: p.userId,
            dueOn: p.dueOn,
            kind: p.kind,
            reason: input.reason?.trim() || null,
            source: 'handover',
            // The account's own timeline already gets the allocation note; a second line per
            // account saying the same thing in other words is noise on five hundred timelines.
            alsoNoteOnAccount: false,
            actor: input.actor,
          })
          result.booked += 1
          bump(bookedBy, p.userId)
        } catch (e) {
          result.failed.push({
            accountId: p.accountId,
            message: e instanceof Error ? e.message : String(e),
          })
        }
        tick(1)
      }
    }
  }

  /*
   * THE BELL, LAST AND NEVER FATAL. THE FIRM: "there should be some sort of notification that's
   * being shown to the clerk that, oh, you've received seven new handovers and referrals."
   *
   * After the writes, because a notice about accounts that did not move is a lie, and the counts
   * above are of rows that actually landed. Wrapped so a notifications table that refuses cannot
   * undo an allocation that succeeded — the work is on the desks either way, and a team leader who
   * saw "500 allocated" then an error would reasonably re-run the whole hand-out.
   *
   * A failure to allocate is a different matter and still throws above: that one is not cosmetic.
   */
  const notices = handOutNotices({
    /* Empty in refer-only mode, because nothing above filled it. Nobody is told their book grew
       when all that happened is that they were booked to ring somebody else's accounts. */
    allocated: allocatedBy,
    referred: bookedBy,
    handoverId: input.handoverId ?? null,
    actorId: input.actor.id,
  })
  for (const n of notices) {
    try {
      const { error } = await supabase.rpc('notify_user', {
        p_user_id: n.userId, p_type: n.type, p_message: n.message, p_link: n.link,
      })
      if (!error) result.notified += 1
    } catch { /* see above: a bell that did not ring must not undo work that did happen. */ }
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
