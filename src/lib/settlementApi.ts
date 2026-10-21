import { supabase } from './supabase'
import { toSettlement, type Settlement } from './settlement'

/**
 * A SETTLEMENT, THE CALLS. The rules are in settlement.ts and, decisively, in the database:
 * account_settlements has no write policy, so each of these is the only door to what it does,
 * and each asks the tick itself.
 */

/** The live offer on the account, or the newest closed one, or null. */
export async function fetchSettlement(accountId: string): Promise<Settlement | null> {
  const { data, error } = await supabase.rpc('account_settlement', { p_account: accountId })
  if (error) throw new Error(error.message)
  const row = (data as Record<string, unknown>[] | null)?.[0]
  return row ? toSettlement(row) : null
}

/** Put the debtor's offer up. `balance` is the balance the saving is measured from, today. */
export async function proposeSettlement(
  accountId: string, amount: number, balance: number, note?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('propose_settlement', {
    p_account: accountId, p_amount: amount, p_balance: balance, p_note: note ?? null,
  })
  if (error) throw new Error(error.message)
  return String(data)
}

/**
 * RECORD THE CLIENT'S YES, WITH THE WRITING ATTACHED (the firm, 11 Oct: "it should ask you to upload
 * it or to pin an email to it ... so that there's a record of it and it lives in the account").
 * Also how an expiry is extended or the figure changed: a settlement already proven keeps its proof
 * when neither is given. The database checks the email or document is on this account.
 */
export async function approveSettlement(
  id: string, expiresOn: string, amount: number,
  proof: { emailId?: string | null; documentId?: string | null; note?: string | null },
): Promise<void> {
  const { error } = await supabase.rpc('approve_settlement_with_proof', {
    p_id: id, p_expires_on: expiresOn, p_amount: amount,
    p_email: proof.emailId ?? null, p_document: proof.documentId ?? null, p_note: proof.note ?? null,
  })
  if (error) throw new Error(error.message)
}

/** Where a settlement's proof is: the email and the document it points at, read by the settlement. */
export interface SettlementProof {
  email: { id: string; subject: string | null; occurredAt: string; from: string | null; body: string | null } | null
  document: { id: string; name: string; storagePath: string } | null
}

export async function fetchSettlementProof(settlementId: string): Promise<SettlementProof> {
  const { data, error } = await supabase.from('account_settlements')
    .select('evidence_email_id, evidence_document_id').eq('id', settlementId).maybeSingle()
  if (error) throw new Error(error.message)
  const row = data as { evidence_email_id: string | null; evidence_document_id: string | null } | null
  let email: SettlementProof['email'] = null
  let document: SettlementProof['document'] = null
  if (row?.evidence_email_id) {
    const { data: e } = await supabase.from('account_emails')
      .select('id, subject, occurred_at, debtor_address, body').eq('id', row.evidence_email_id).maybeSingle()
    const x = e as { id: string; subject: string | null; occurred_at: string; debtor_address: string | null; body: string | null } | null
    if (x) email = { id: x.id, subject: x.subject, occurredAt: x.occurred_at, from: x.debtor_address, body: x.body }
  }
  if (row?.evidence_document_id) {
    const { data: d } = await supabase.from('account_documents')
      .select('id, name, storage_path').eq('id', row.evidence_document_id).maybeSingle()
    const x = d as { id: string; name: string; storage_path: string } | null
    if (x) document = { id: x.id, name: x.name, storagePath: x.storage_path }
  }
  return { email, document }
}

/** The account's emails a liaison might pin, newest first -- the client's replies are usually here. */
export interface PinnableEmail { id: string; subject: string | null; occurredAt: string; direction: string; correspondent: string | null; from: string | null }

export async function fetchPinnableEmails(accountId: string): Promise<PinnableEmail[]> {
  const { data, error } = await supabase.from('account_emails')
    .select('id, subject, occurred_at, direction, correspondent, debtor_address')
    .eq('account_id', accountId).order('occurred_at', { ascending: false }).limit(60)
  if (error) throw new Error(error.message)
  return ((data ?? []) as { id: string; subject: string | null; occurred_at: string; direction: string; correspondent: string | null; debtor_address: string | null }[])
    .map((r) => ({ id: r.id, subject: r.subject, occurredAt: r.occurred_at, direction: r.direction, correspondent: r.correspondent, from: r.debtor_address }))
}

/** A client's accepted settlements across its accounts, for the client file -- each a link to the account. */
export interface ClientSettlement {
  id: string; accountId: string; caseNumber: string | null; accountNumber: string | null; debtor: string | null
  amount: number; expiresOn: string | null; status: string; approvedAt: string | null; evidence: string | null
  hasProof: boolean
}

export async function fetchClientSettlements(companyId: string): Promise<ClientSettlement[]> {
  const { data, error } = await supabase.from('account_settlements')
    .select('id, account_id, amount, expires_on, status, approved_at, approval_evidence, evidence_email_id, evidence_document_id, debtor_accounts!inner(company_id, case_number, account_number, debtor_first_name, debtor_surname)')
    .eq('debtor_accounts.company_id', companyId).in('status', ['approved', 'paid'])
    .order('approved_at', { ascending: false }).limit(200)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const a = (r.debtor_accounts ?? {}) as { case_number?: string | null; account_number?: string | null; debtor_first_name?: string | null; debtor_surname?: string | null }
    return {
      id: String(r.id), accountId: String(r.account_id), caseNumber: a.case_number ?? null,
      accountNumber: a.account_number ?? null,
      debtor: [a.debtor_first_name, a.debtor_surname].filter(Boolean).join(' ') || null,
      amount: Number(r.amount ?? 0), expiresOn: (r.expires_on as string | null) ?? null, status: String(r.status),
      approvedAt: (r.approved_at as string | null) ?? null, evidence: (r.approval_evidence as string | null) ?? null,
      hasProof: !!r.evidence_email_id || !!r.evidence_document_id,
    }
  })
}

export async function closeSettlementOffer(
  id: string, as: 'declined' | 'withdrawn', reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('close_settlement_offer', { p_id: id, p_as: as, p_reason: reason })
  if (error) throw new Error(error.message)
}

/** A person confirming it was paid in full: closes the account as settled. */
export async function closeAsSettled(id: string): Promise<void> {
  const { error } = await supabase.rpc('close_as_settled', { p_id: id })
  if (error) throw new Error(error.message)
}
