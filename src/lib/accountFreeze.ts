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

/* ---------- what the firm needs from the client ---------- */

/**
 * Raise or replace the one thing this account is waiting on the client for.
 *
 * THE RED FLAG, AND IT IS THE ONLY ONE ANYBODY TYPES. Green, amber and grey follow from the
 * sub-status; this does not, because "we are waiting on you" is equally true of a disputed
 * account, a frozen one and a legal one. It is also the most valuable line on a monthly report:
 * it is what turns "why have you not collected" into "here are eleven you can unblock today".
 *
 * The words matter more than the flag. "Please provide the signed agreement and the invoice by
 * 18 September" is actionable; "client action required" is not, which is why the ask is required
 * and the flag is raised by its presence rather than by a separate switch.
 */
export async function askClient(input: {
  accountId: string
  /** What is needed, in words the client can act on. */
  ask: string
  /** When it is needed by, or null where no date was given. */
  dueOn?: string | null
  actor: { id: string | null; name: string | null }
}): Promise<void> {
  const ask = input.ask.trim()
  if (!ask) throw new Error('Say what the client needs to provide.')

  const { error } = await supabase
    .from('debtor_accounts')
    .update({
      client_action_ask: ask,
      client_action_due: input.dueOn || null,
      client_action_raised_at: new Date().toISOString(),
      client_action_raised_by: input.actor.id,
    })
    .eq('id', input.accountId)
  if (error) throw new Error(error.message)

  await note(
    input.accountId,
    `Waiting on the client — ${ask}${input.dueOn ? ` (by ${input.dueOn})` : ''}`,
    input.actor,
  )
}

/**
 * The client came back. Clear the ask.
 *
 * Cleared rather than marked answered: the flag asks "is anything owed right now", and a resolved
 * request is not. What was asked and when survives on the account timeline, which is where
 * somebody looks to find out what happened rather than what is outstanding.
 */
export async function clientAnswered(input: {
  accountId: string
  /** What they came back with. Goes on the timeline. */
  outcome: string
  actor: { id: string | null; name: string | null }
}): Promise<void> {
  const outcome = input.outcome.trim()
  if (!outcome) throw new Error('Say what the client came back with.')

  const { error } = await supabase
    .from('debtor_accounts')
    .update({
      client_action_ask: null,
      client_action_due: null,
      client_action_raised_at: null,
      client_action_raised_by: null,
    })
    .eq('id', input.accountId)
  if (error) throw new Error(error.message)

  await note(input.accountId, `Client came back — ${outcome}`, input.actor)
}
