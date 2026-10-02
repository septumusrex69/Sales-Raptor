/**
 * UNDOING A HANDOVER THAT SHOULD NEVER HAVE COME IN.
 *
 * THE FIRM, after a test import went in twice: "make sure that everything is being deleted." And
 * the general case behind it, which is the one that matters: a client sends the wrong file, or the
 * same file twice, and two hundred accounts open that nobody should be collecting on. Until now
 * the only way back was somebody with a database console, which on an iPad is no way back at all.
 *
 * IT IS A REVERSAL, NOT A TIDY-UP, AND THAT IS WHY IT REFUSES SO MUCH. The moment a debtor has
 * paid, promised, disputed, or had a document filed on their account, there is a record the firm
 * may be asked about — and deleting it is destroying evidence rather than undoing a mistake. So
 * this is only ever available on a batch nothing has happened on, and it says which thing stopped
 * it rather than going quiet.
 *
 * WHAT DOES NOT STOP IT, DELIBERATELY:
 *
 *   - NOTICES ALREADY SENT. A wrongly imported batch is exactly the case where the handover email
 *     and SMS have already gone out, so blocking on them would refuse every batch the firm
 *     actually wants back. They are COUNTED and shown instead, because somebody pressing this
 *     should know that debtors have already been written to.
 *   - FEES RAISED. CLAUDE.md: a fee is raised on the action and only becomes billable once money
 *     is recovered. An unrecovered fee on an account that should never have existed is a fee that
 *     goes with it. A PAYMENT is the other thing entirely, and it refuses.
 *
 * THE HANDOVER ROW IS KEPT AND MARKED, not deleted, so "this batch arrived on the 1st and was
 * discarded on the 2nd by Stephan" survives the accounts it opened. A reversal nobody can see
 * afterwards is indistinguishable from data loss.
 */
import { supabase } from './supabase'
import { discardNoteBody, discardNoteSubject } from './importNote'
import { formatCurrency } from '../data/mockData'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come back as untyped JSON. */

export interface DiscardableBatch {
  handoverId: string
  reference: string | null
  receivedAt: string
  /** Accounts still on the book from this batch. */
  accounts: number
  /** What those accounts are worth, so nobody discards two hundred thousand rand by accident. */
  capital: number
  /** Notices already sent to debtors. Shown, never a refusal — see the note above. */
  noticesSent: number
  /** What stops it, in the firm's words. Empty means it can go. */
  blockers: string[]
}

/** The accounts a batch opened that are still there. */
async function accountIdsFor(handoverId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('debtor_accounts').select('id').eq('handover_id', handoverId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: any) => r.id as string)
}

/**
 * WHAT WOULD STOP THIS BATCH BEING UNDONE, in sentences a person can act on.
 *
 * Asked before the button is offered AND again inside `discardHandover`, because a screen is not
 * a rule: a tab left open while somebody takes a payment would otherwise discard an account that
 * had become real in the meantime.
 */
export async function discardBlockers(accountIds: string[]): Promise<string[]> {
  if (accountIds.length === 0) return []
  const count = async (table: string, column = 'account_id') => {
    const { count: n, error } = await supabase
      .from(table).select('id', { count: 'exact', head: true }).in(column, accountIds)
    if (error) throw new Error(error.message)
    return n ?? 0
  }
  const [payments, promises, documents, paid] = await Promise.all([
    count('account_payments'),
    count('promises_to_pay'),
    count('account_documents'),
    /* ON A REMITTANCE RUN is the hardest refusal of the four: the client has been invoiced on it.
       CLAUDE.md states it as law — financial records are immutable once remittance has run. */
    count('payover_run_lines'),
  ])
  const out: string[] = []
  if (payments > 0) out.push(`${payments} payment${payments === 1 ? ' has' : 's have'} been received on these accounts.`)
  if (paid > 0) out.push(`${paid} of these accounts are on a remittance run that has already gone to the client.`)
  if (promises > 0) out.push(`${promises} debtor${promises === 1 ? ' has' : 's have'} made an arrangement on these accounts.`)
  if (documents > 0) out.push(`${documents} document${documents === 1 ? ' is' : 's are'} filed on these accounts.`)
  return out
}

/** Every batch this client has sent that still has accounts on the book, newest first. */
export async function fetchDiscardableBatches(companyId: string): Promise<DiscardableBatch[]> {
  const { data, error } = await supabase
    .from('handovers')
    .select('id, reference, received_at')
    .eq('company_id', companyId)
    .order('received_at', { ascending: false })
    .limit(25)
  if (error) throw new Error(error.message)

  const out: DiscardableBatch[] = []
  for (const h of (data ?? []) as any[]) {
    const { data: accounts, error: accErr } = await supabase
      .from('debtor_accounts')
      .select('id, capital_outstanding')
      .eq('handover_id', h.id)
    if (accErr) throw new Error(accErr.message)
    const ids = (accounts ?? []).map((a: any) => a.id as string)
    /* A batch whose accounts are already gone is not offered: there is nothing left to undo, and
       a Discard button beside nothing is a button somebody presses to find out what it does. */
    if (ids.length === 0) continue
    const { count: notices } = await supabase
      .from('workflow_run_steps')
      .select('id', { count: 'exact', head: true })
      .eq('state', 'sent')
      .in('run_id', (await supabase.from('workflow_runs').select('id').in('account_id', ids))
        .data?.map((r: any) => r.id as string) ?? ['00000000-0000-0000-0000-000000000000'])
    out.push({
      handoverId: h.id,
      reference: h.reference ?? null,
      receivedAt: h.received_at,
      accounts: ids.length,
      capital: (accounts ?? []).reduce((n: number, a: any) => n + Number(a.capital_outstanding ?? 0), 0),
      noticesSent: notices ?? 0,
      blockers: await discardBlockers(ids),
    })
  }
  return out
}

/**
 * Undo it: the accounts go, the draft goes, the batch stays and is marked.
 *
 * THE ORDER IS THE SAFE ONE. The blockers are re-read first, against the ids as they stand now
 * rather than as the screen last saw them. Then the accounts, which cascade to everything hanging
 * off them — the contacts, the diary entries, the workflow runs and their steps, the notes, the
 * fees. Then the draft, whose only purpose was to produce accounts that no longer exist. The
 * handover row is marked last, so a failure halfway leaves a batch that still says it is live
 * rather than one that claims to be discarded with accounts still on the book.
 */
export async function discardHandover(input: {
  handoverId: string
  by: string | null
  reason: string | null
  /** For the client's own note. Read before the accounts go, because afterwards there is nothing
      left to add up — see the note below. */
  companyId?: string | null
  reference?: string | null
  capital?: number
  noticesSent?: number
}): Promise<{ accounts: number }> {
  const ids = await accountIdsFor(input.handoverId)
  const blockers = await discardBlockers(ids)
  if (blockers.length > 0) {
    throw new Error(`This handover can no longer be undone. ${blockers.join(' ')}`)
  }

  if (ids.length > 0) {
    const { error } = await supabase.from('debtor_accounts').delete().in('id', ids)
    if (error) throw new Error(error.message)
  }

  /* The draft is the record of what was corrected on the way IN, and what it corrected its way
     into is gone. Never fatal: a draft left behind is clutter on one screen, and failing here
     after the accounts have gone would report a discard that did happen as one that did not. */
  await supabase.from('handover_drafts').delete().eq('handover_id', input.handoverId)

  const { error: markErr } = await supabase
    .from('handovers')
    .update({
      discarded_at: new Date().toISOString(),
      discarded_by: input.by,
      discarded_reason: input.reason,
    })
    .eq('id', input.handoverId)
  if (markErr) throw new Error(markErr.message)

  /*
   * AND THE CLIENT'S OWN HISTORY SAYS IT HAPPENED.
   *
   * THE FIRM, after discarding two batches: "the notes that I made of like retracting the handover
   * file, that's also not there. You remember I took it out, those handover files."
   *
   * THEY HAD, AND IT LEFT NO TRACE A PERSON COULD READ. The three stamps above are the right
   * record and are on nobody's screen, while the client's Notes list went on showing three imports
   * with nothing taking any of them back. "A reversal nobody can see afterwards is
   * indistinguishable from data loss" is written at the top of this file as the reason the row is
   * kept at all — it just never reached the one place somebody actually looks.
   *
   * LAST, AND IT CANNOT FAIL THE DISCARD. Same reasoning the import applies to its own note: this
   * is a record of what happened, so it is written after the thing it records, and a timeline entry
   * that failed is not worth undoing a reversal over. Swallowed rather than thrown — by this point
   * the accounts are gone and the batch is marked, and reporting failure would be a lie about the
   * part that matters.
   */
  if (input.companyId) {
    try {
      await supabase.from('activities').insert({
        type: 'Note',
        user_id: input.by,
        company_id: input.companyId,
        subject: discardNoteSubject(input.reference ?? null),
        notes: discardNoteBody({
          accounts: ids.length,
          capital: formatCurrency(input.capital ?? 0),
          reason: input.reason,
          noticesSent: input.noticesSent,
        }),
        activity_date: new Date().toISOString(),
      })
    } catch { /* see above: the reversal happened; a note that did not file is not a failed one. */ }
  }

  return { accounts: ids.length }
}
