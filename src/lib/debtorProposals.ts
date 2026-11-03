/**
 * A DEBTOR'S ARRANGEMENT OFFER, AS STAFF SEE AND DECIDE IT (Raptor H16, debtor portal part 3).
 *
 * The portal's server writes the offer; this reads it and records the decision. ACCEPTING IS recordPromise -- the very
 * press a collector makes when they take a promise on the phone: the promises_to_pay row, item 5, the timeline note,
 * and the confirmation workflow. A second, portal-only way to create a promise would be a promise that skipped one of
 * those, and nobody would see which.
 */
import { supabase } from './supabase'
import { recordPromise } from './accountPromises'
import { addNote } from './accountWorkspace'
import { clockNow } from './clock'
import type { Arrangement } from './arrangements'
import type { ChargeResult } from './accountCharges'

export interface DebtorProposal {
  id: string
  arrangement: Arrangement
  amount: number
  firstDueOn: string
  note: string | null
  balanceThen: number | null
  createdAt: string
  /** More than 12 months: an application, which may be accepted only once its affordability assessment is signed. */
  needsAssessment: boolean
  /** Where that assessment stands: 'sent' (waiting for the debtor), 'signed', or null where none could be made. */
  assessmentState: string | null
  assessmentToken: string | null
}

export async function fetchPendingProposal(accountId: string): Promise<DebtorProposal | null> {
  const { data, error } = await supabase.from('debtor_arrangement_proposals')
    .select('id, arrangement, amount, first_due_on, note, balance_then, created_at, needs_assessment, signing_token')
    .eq('account_id', accountId).eq('status', 'pending').maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const token = (data.signing_token as string | null) ?? null
  const { data: signing } = token
    ? await supabase.from('signing_requests').select('state').eq('token', token).maybeSingle()
    : { data: null }
  return {
    needsAssessment: !!data.needs_assessment, assessmentToken: token, assessmentState: (signing?.state as string | undefined) ?? null,
    id: data.id as string, arrangement: data.arrangement as Arrangement, amount: Number(data.amount), firstDueOn: data.first_due_on as string,
    note: (data.note as string | null) ?? null, balanceThen: data.balance_then === null ? null : Number(data.balance_then), createdAt: data.created_at as string,
  }
}

/** 1 = Monday .. 7 = Sunday, read as UTC so a timezone cannot move the day. */
const isoWeekday = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7 }

/**
 * ACCEPT: the promise first, then the offer marked accepted with it. In that order because a promise that was taken is
 * the thing that matters to the debtor; an offer left "pending" beside a live promise is refused the next time anyone
 * presses (one live promise per account) and says so, which is recoverable -- the other order is not.
 */
export async function acceptProposal(p: DebtorProposal, accountId: string, actor: { id: string | null; name: string | null }, accessToken: string | null): Promise<ChargeResult> {
  /* AN APPLICATION IS DECIDED ON THE ASSESSMENT (Stephan, 3 Nov), so it cannot be accepted before the debtor has signed
     it. Here as well as on the card's button, because a button is a suggestion and this is the rule. */
  if (p.needsAssessment && p.assessmentState !== 'signed') {
    throw new Error('This is an application for more than 12 months: wait for the debtor to sign the affordability assessment, then accept.')
  }
  const { promise, charge } = await recordPromise({
    accountId, amount: p.amount, dueOn: p.firstDueOn, arrangement: p.arrangement,
    /* The debtor chose a first date; the instalment day is that date's, as the collector's own form takes it. */
    dayOfMonth: p.arrangement === 'monthly' ? Number(p.firstDueOn.slice(8, 10)) : null,
    onLastDay: false,
    dayOfWeek: p.arrangement === 'weekly' ? isoWeekday(p.firstDueOn) : null,
    notes: p.note ? `Offered by the debtor on the debtor portal: "${p.note}"` : 'Offered by the debtor on the debtor portal.',
    actor, accessToken,
  })
  const { error } = await supabase.from('debtor_arrangement_proposals')
    .update({ status: 'accepted', promise_id: promise.id, decided_by: actor.id, decided_by_name: actor.name, decided_at: clockNow().toISOString() })
    .eq('id', p.id).eq('status', 'pending')
  if (error) throw new Error(`The promise was taken, but the offer could not be marked accepted: ${error.message}`)
  return charge
}

/** DECLINE, WITH A REASON THE DEBTOR WILL READ -- the portal shows it to them word for word. */
export async function declineProposal(p: DebtorProposal, accountId: string, reason: string, actor: { id: string | null; name: string | null }): Promise<void> {
  const why = reason.trim()
  if (!why) throw new Error('Say why, in words the debtor will read on their page.')
  const { error } = await supabase.from('debtor_arrangement_proposals')
    .update({ status: 'declined', decline_reason: why, decided_by: actor.id, decided_by_name: actor.name, decided_at: clockNow().toISOString() })
    .eq('id', p.id).eq('status', 'pending')
  if (error) throw new Error(error.message)
  await addNote({ accountId, body: `Declined the debtor's arrangement offer from the debtor portal: ${why}`, source: 'system', authorName: actor.name, createdBy: actor.id })
}
