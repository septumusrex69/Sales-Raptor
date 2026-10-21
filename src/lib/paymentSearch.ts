/**
 * FINDING ONE PAYMENT AMONG ALL OF THEM, AND SAYING WHETHER IT CAN BE UNDONE (prompt 11).
 *
 * The firm, 11 Oct, needing to reverse a wrongly allocated R3 500.00 on KLR/1005: History had no
 * search, the payment was four steps deep, and the account number they knew from the statement
 * and the client was not in the column they read. So one box searches every month and every client
 * for the things a person actually has in hand -- the client's account number, our RAP- reference,
 * the client's own reference, the debtor's name, what the bank wrote, and the amount.
 *
 * Pure, so a check can import it.
 */

export interface Searchable {
  accountNumber: string | null
  caseNumber: string | null
  clientReference?: string | null
  debtor: string | null
  client?: string | null
  reference: string | null
  bankDescription: string | null
  amount: number
}

/* "KLR / 1005", "klr/1005" and "KLR/1005" are one account: case and spaces are not information. */
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '')

/**
 * AN AMOUNT IS MATCHED AS AN AMOUNT, NOT AS TEXT. "3500", "3 500", "R3 500.00" and "3500,00" all
 * find R3 500.00; "350" does not, because a person who types an amount means that amount and a
 * substring match would bury it under every R35, R350 and R3 501 in the book.
 */
export function amountOf(q: string): number | null {
  const t = q.trim().replace(/^r\s*/i, '').replace(/[\s ]/g, '')
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) return null
  return Math.round(Number(t.replace(',', '.')) * 100) / 100
}

export function matchesPayment(p: Searchable, query: string): boolean {
  const q = query.trim()
  if (!q) return true
  const amount = amountOf(q)
  if (amount !== null && Math.round(p.amount * 100) === Math.round(amount * 100)) return true
  const needle = squash(q)
  return [p.accountNumber, p.caseNumber, p.clientReference, p.debtor, p.client, p.reference, p.bankDescription]
    .some((v) => !!v && squash(v).includes(needle))
}

/** What may stop a reversal, said before the button is pressed rather than after. */
export interface ReverseFacts {
  approved: boolean
  reversedOn: string | null
  swordfish: boolean
}

/**
 * NULL WHEN IT MAY BE REVERSED, otherwise the sentence the tooltip carries (the firm: say WHY, rather
 * than the button silently not being there). The database refuses the same cases (reverse_payment).
 */
export function reverseBlocked(f: ReverseFacts): string | null {
  if (f.reversedOn) return 'Already reversed.'
  if (f.swordfish) return 'Paid over in Swordfish before Raptor: it is imported history and cannot be reversed here.'
  if (!f.approved) return 'Not approved yet: change or reject it in the approval queue instead.'
  return null
}
