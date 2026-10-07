/**
 * WHAT A LINE ON THE TRUST STATEMENT WAS (prompt 12).
 *
 * THE FIRM: "So that the trust fund completely reconciles and gets a zero balance. Every single
 * payment going in or going out should be allocated and have a reason for being there."
 *
 * The database does the allocating (allocate_bank_line) and is the only thing that can. This file
 * is the half a person sees: the names of the kinds, which kinds a line of each direction may be,
 * and a SUGGESTION where the answer is obvious. A suggestion is never an allocation -- a person
 * confirms every one, because each writes an entry on the trust ledger that cannot be taken back.
 *
 * PURE, no Supabase: the rules have to be assertable. The calls are in bankAllocationApi.ts.
 */

export type OutKind = 'payover' | 'refund' | 'business_transfer' | 'bank_charge' | 'other'
export type InKind = 'bank_interest' | 'business_transfer_in' | 'other'
export type AllocationKind = OutKind | InKind

export interface StatementLine {
  id: string
  txnDate: string
  /** Signed, as the bank wrote it: money out is negative. */
  amount: number
  description: string | null
  direction: 'credit' | 'debit'
  reference: string | null
  bankAccount: string
  bankAccountLabel: string | null
}

/** Something a line can be matched to: a run, a refund, or a drawing not yet on a statement. */
export interface Candidate {
  kind: 'payover' | 'refund' | 'business_transfer'
  id: string
  amount: number
  label: string
}

/** The firm's words for each kind, and what it does, as the picker shows them. */
export const KIND_LABEL: Record<AllocationKind, string> = {
  payover: 'Payover to a client',
  refund: 'Refund to a debtor',
  business_transfer: 'Transfer to the business account',
  bank_charge: 'Bank charges',
  other: 'Other',
  bank_interest: 'Bank interest received',
  business_transfer_in: 'From the business account',
}

export const KIND_NOTE: Record<AllocationKind, string> = {
  payover: 'Settles the payover run it paid.',
  refund: 'Settles the refund to the debtor.',
  business_transfer: 'The firm’s fees, commission, interest and VAT drawn from trust.',
  bank_charge: 'The firm’s cost — owed by the business account to the trust.',
  other: 'Recorded against nobody until somebody works out whose it was. Say what it was.',
  bank_interest: 'Interest the bank paid on the trust account, credited to the firm.',
  business_transfer_in: 'The business account paying the trust back, e.g. for bank charges.',
}

/** Which kinds a line may be. A debtor's payment IN is placed on their account, not allocated here. */
export function kindsFor(direction: StatementLine['direction']): AllocationKind[] {
  return direction === 'debit'
    ? ['payover', 'refund', 'business_transfer', 'bank_charge', 'other']
    : ['bank_interest', 'business_transfer_in', 'other']
}

/** Kinds that settle something particular, so the person must choose which. */
export function needsTarget(kind: AllocationKind): boolean {
  return kind === 'payover' || kind === 'refund'
}

/** Kinds where the reason is not optional. */
export function needsReason(kind: AllocationKind): boolean {
  return kind === 'other'
}

/*
 * WHAT A BANK'S OWN WORDING LOOKS LIKE. FNB writes "##BANK CHARGE" (the firm's test statement),
 * "#SERVICE FEE", "#MONTHLY ACC FEE", "CASH DEP FEE"; every bank writes interest as "INTEREST" or
 * "CR INT". Anchored on the bank's words, not on any amount: a R57.50 debit is a bank charge
 * because the bank said so, not because bank charges tend to be small.
 */
const CHARGE = /\bBANK\s*CHARGES?\b|\bSERVICE\s*FEE\b|\bMONTHLY\s*(ACC(OUNT)?\s*)?FEE\b|\bADMIN(ISTRATION)?\s*FEE\b|\bCASH\s*DEP(OSIT)?\s*FEE\b|\bTRANSACTION\s*FEE\b|#\s*[A-Z ]*FEE\b/i
const INTEREST = /\bINTEREST\b|\bCR\.?\s*INT\b|\bINT\.?\s*CAP/i

export interface Suggestion {
  kind: AllocationKind
  targetId: string | null
  /** Why it was suggested, said to the person confirming it. */
  why: string
}

/**
 * THE OBVIOUS ANSWER, OR NONE.
 *
 * EXACT AMOUNTS ONLY, and only where exactly ONE candidate has it: two payover runs of R4 000 is a
 * question for a person, and guessing between them settles the wrong client's run. The business
 * account's own number in the description is the other unambiguous sign.
 */
export function suggestAllocation(
  line: StatementLine,
  candidates: Candidate[],
  businessAccountNumber: string | null = null,
): Suggestion | null {
  const text = line.description ?? ''
  const amt = Math.round(Math.abs(line.amount) * 100)
  const mentionsBusiness = !!businessAccountNumber
    && text.replace(/\s+/g, '').includes(businessAccountNumber.replace(/\s+/g, ''))

  if (line.direction === 'credit') {
    if (INTEREST.test(text)) return { kind: 'bank_interest', targetId: null, why: 'The bank calls it interest.' }
    if (mentionsBusiness) {
      return { kind: 'business_transfer_in', targetId: null, why: 'It names the business account.' }
    }
    return null
  }

  if (CHARGE.test(text)) return { kind: 'bank_charge', targetId: null, why: 'The bank calls it a charge or a fee.' }
  for (const kind of ['payover', 'refund', 'business_transfer'] as const) {
    const same = candidates.filter((c) => c.kind === kind && Math.round(c.amount * 100) === amt)
    if (same.length === 1) {
      return { kind, targetId: same[0].id, why: `The only ${KIND_LABEL[kind].toLowerCase()} of exactly this amount: ${same[0].label}.` }
    }
  }
  if (mentionsBusiness) {
    return { kind: 'business_transfer', targetId: null, why: 'It names the business account.' }
  }
  return null
}

/** The candidates a line could settle: same kind, same amount to the cent. */
export function candidatesFor(line: StatementLine, kind: AllocationKind, candidates: Candidate[]): Candidate[] {
  const amt = Math.round(Math.abs(line.amount) * 100)
  return candidates.filter((c) => c.kind === kind && Math.round(c.amount * 100) === amt)
}

export function toStatementLine(r: Record<string, unknown>): StatementLine {
  return {
    id: String(r.id),
    txnDate: String(r.txn_date),
    amount: Number(r.amount),
    description: (r.description as string | null) ?? null,
    direction: r.direction === 'debit' ? 'debit' : 'credit',
    reference: (r.reference as string | null) ?? null,
    bankAccount: String(r.bank_account ?? ''),
    bankAccountLabel: (r.bank_account_label as string | null) ?? null,
  }
}
