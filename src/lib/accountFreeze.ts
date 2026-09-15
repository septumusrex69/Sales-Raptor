import { supabase } from './supabase'
import { addNote } from './accountWorkspace.ts'
import { frozenByLabel, type FrozenBy } from './clientPosition.ts'

/**
 * Stopping and restarting work on an account.
 *
 * THE FIRST THING IN RAPTOR THAT WRITES A STATUS. Until now debtor_accounts.status was read
 * everywhere and written nowhere -- it arrived from Swordfish and sat there. That matters for
 * more than freezing: account_status_events is filled by a trigger on any status change, so this
 * is also the first code path that produces the movement history a monthly client report is
 * built from.
 *
 * A FREEZE IS THREE FACTS, NOT A LABEL. 150 of 736 accounts on the book read "Frozen" and
 * nothing else, which cannot answer a client asking why their account has not moved in four
 * months -- and cannot tell the firm whether it was the client who asked. Who, why and when, or
 * the word means nothing.
 *
 * Reversible, and deliberately not an approval flow: a freeze stops work, it does not change a
 * balance or a fee, and nothing it does is hard to undo. The audit is the point, not the gate.
 */

/** What the account's status becomes while frozen. Read by clientPosition(). */
const FROZEN_STATUS = 'Frozen'

/**
 * What an account goes back to when work restarts.
 *
 * The inherited vocabulary has three ways of saying Active -- 'Active: Activated',
 * 'Active: Re-opened', 'Active: Unfrozen' -- which is provenance baked into a label rather than
 * a state. 'Active: Unfrozen' is the one that is true of an account coming off a freeze, and the
 * status history now records where it came from, so the label no longer has to.
 */
const UNFROZEN_STATUS = 'Active: Unfrozen'

export async function freezeAccount(input: {
  accountId: string
  by: FrozenBy
  reason: string
  actor: { id: string | null; name: string | null }
}): Promise<void> {
  const reason = input.reason.trim()
  // Refused rather than defaulted. A freeze with no reason is the state this is meant to end.
  if (!reason) throw new Error('A freeze needs a reason.')

  const { error } = await supabase
    .from('debtor_accounts')
    .update({
      status: FROZEN_STATUS,
      frozen_by: input.by,
      frozen_reason: reason,
      frozen_at: new Date().toISOString(),
      frozen_by_user: input.actor.id,
    })
    .eq('id', input.accountId)
  if (error) throw new Error(error.message)

  await note(input.accountId, `${frozenByLabel(input.by)} — ${reason}`, input.actor)
}

export async function unfreezeAccount(input: {
  accountId: string
  reason: string
  actor: { id: string | null; name: string | null }
}): Promise<void> {
  const reason = input.reason.trim()
  if (!reason) throw new Error('Restarting work needs a reason too.')

  /*
   * The freeze fields are cleared, not kept. They describe the CURRENT freeze, and an account
   * that is working is not frozen. What happened is not lost: the status event written by the
   * trigger carries the reason being left behind, which is why record_account_status_event()
   * coalesces the old reason when the new one is null.
   */
  const { error } = await supabase
    .from('debtor_accounts')
    .update({
      status: UNFROZEN_STATUS,
      frozen_by: null,
      frozen_reason: null,
      frozen_at: null,
      frozen_by_user: null,
    })
    .eq('id', input.accountId)
  if (error) throw new Error(error.message)

  await note(input.accountId, `Work restarted — ${reason}`, input.actor)
}

/**
 * The timeline entry.
 *
 * source 'manual' rather than 'system': the words are a person's, and the timeline's default
 * "just what people wrote" filter hides anything marked system. A freeze note nobody can see
 * without changing a filter is a freeze note nobody reads.
 *
 * Never throws. The status is already written at this point, and failing the whole freeze
 * because a note did not save would leave the caller believing nothing happened when it did.
 */
async function note(
  accountId: string,
  body: string,
  actor: { id: string | null; name: string | null },
): Promise<void> {
  try {
    await addNote({
      accountId,
      body,
      authorName: actor.name,
      createdBy: actor.id,
      kind: 'status',
      source: 'manual',
    })
  } catch {
    /* the freeze itself is recorded in account_status_events regardless */
  }
}
