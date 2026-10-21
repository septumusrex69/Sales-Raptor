/**
 * RECORDING ONE PAYMENT BY HAND — and the PTC that has no other way in.
 *
 * THE FIRM: "we should be able to load a manual payment... and we need to account for the PTCs
 * that we usually type in manually", and then, on where: "let's do it in the finance section and
 * you will be able to do it on the account as well."
 *
 * ITS OWN MODULE, AND NOT payover.ts, WHICH IS A RULE RATHER THAN A TIDY-UP. Everything in
 * payover.ts is Administrator-only and check-finance-is-administrator-only asserts exactly that
 * of every RPC it calls. Capture is NOT Administrator-only -- the firm wants it on the account,
 * where collectors and liaisons work -- so leaving it there would have meant weakening a security
 * check to fit a feature. The two rules are different because the questions are different:
 *
 *   THE FINANCE SECTION   who may see the payment SPLIT. "Sales representatives never see the
 *                         payment split."
 *   CAPTURE               who may record that money arrived. Whoever works the book or talks to
 *                         the client, because that is who learns a PTC happened.
 *
 * `may_record_payment()` in the database is the real boundary; `canRecordPayment` below is the
 * browser's copy of it, for deciding whether to draw a button.
 */
import { supabase } from './supabase'

export interface ManualPayment {
  accountId: string
  amount: number
  /** The day the money came in, not today: the payover cycle is cut on it. */
  receivedOn: string
  /**
   * WHICH DIRECTION THE MONEY WENT, and the single most consequential field on the form.
   *
   * false — the debtor paid the FIRM. It is in trust, the firm owes the client the capital less
   *         its commission, and remittance pays it out.
   * true  — the debtor paid the CLIENT. The client already holds it and now owes the firm the
   *         interest, the costs and the commission.
   *
   * Wrong, it does not produce a wrong figure -- it produces the right figure pointing the wrong
   * way, on an invoice, possibly in a month already remitted.
   */
  paidToClient: boolean
  method?: string
  reference?: string | null
  details?: string | null
  /** Set only after a person has been shown the duplicate and said it is a second payment. */
  confirmDuplicate?: boolean
  /**
   * THE CLIENT'S CONFIRMATION, already uploaded against this account. REQUIRED ON A PTC.
   *
   * The firm: "whenever a PTC is uploaded, it should ask you for a confirmation and you should
   * upload the confirmation." A trust receipt is witnessed by the firm's own bank statement; a
   * PTC is CLAIMED -- the firm never sees the money, and on the strength of that claim it reduces
   * a debtor's balance and invoices the client for commission. This is what the invoice rests on.
   */
  proofDocumentId?: string | null
}

/** Thrown when an identical payment is already on the account that day. */
export class DuplicatePayment extends Error {}
/** Thrown when a PTC arrives without the client's confirmation. */
export class ProofRequired extends Error {}
/**
 * Thrown when a payment is captured with no reference on it.
 *
 * THE FIRM, LOOKING AT THE BOX: "this reference here should be compulsory." Money on a bank
 * statement carries the debtor's own reference and is matched on it; a payment typed in by hand
 * has nothing unless somebody writes it down -- and a reversal three months later has to be
 * findable in the bank's records, which "R 5 000, 29 September" is not.
 */
export class ReferenceRequired extends Error {}

export async function recordManualPayment(input: ManualPayment): Promise<string> {
  const { data, error } = await supabase.rpc('record_manual_payment', {
    p_account: input.accountId,
    /* A string: the column is numeric and a JSON number is a double. */
    p_amount: input.amount.toFixed(2),
    p_received_on: input.receivedOn,
    p_paid_to_client: input.paidToClient,
    p_method: input.method ?? 'EFT',
    p_reference: input.reference ?? null,
    p_details: input.details ?? null,
    p_confirm_duplicate: input.confirmDuplicate ?? false,
    p_proof_document: input.proofDocumentId ?? null,
  })
  if (error) {
    /* Two refusals the screen answers differently from a failure: 23505 asks whether this is a
       second payment, 23514 asks for the confirmation. Both carry a sentence written to be read,
       so they are shown as they are. */
    if (error.code === '23505') throw new DuplicatePayment(error.message)
    if (error.code === '23514') throw new ProofRequired(error.message)
    if (error.code === '23502') throw new ReferenceRequired(error.message)
    throw new Error(error.message)
  }
  return String(data)
}

/**
 * SPLITTING ONE RECEIPT BETWEEN SEVERAL ACCOUNTS.
 *
 * THE FIRM: "this would happen for us in case we have, for example, debt counsellors that pay one
 * payment for five different debtors."
 *
 * NOT IN payover.ts, for the reason capture is not: `split_bank_line` is guarded by
 * may_record_payment, which is wider than Administrator, and check-finance-is-administrator-only
 * asserts every RPC in that module is Administrator-only.
 */
export interface SplitPart {
  accountId: string
  amount: number
}

export async function splitBankLine(lineId: string, parts: SplitPart[]): Promise<number> {
  const { data, error } = await supabase.rpc('split_bank_line', {
    p_line: lineId,
    /* Amounts as strings, as everywhere: the column is numeric and a JSON number is a double.
       Here it matters twice over, because the parts have to add up to the penny or the database
       refuses the whole split. */
    p_parts: parts.map((p) => ({ account_id: p.accountId, amount: p.amount.toFixed(2) })),
  })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}
