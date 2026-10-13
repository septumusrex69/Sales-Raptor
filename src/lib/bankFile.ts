/**
 * THE BANK FILE: EVERY PAYMENT OUT OF TRUST THIS MONTH, IN ONE UPLOAD (S7, the firm, 13 Oct).
 *
 * "We're gonna need like an export sheet to pay all of the different people ... making payments to
 * all of the clients once a month", and then: "you should, for example, choose which you will be able
 * to include and exclude. For example, for a refund, if you don't have the debtor's banking details
 * yet, it stays in a pending state."
 *
 * So a payment is IN THE FILE only if it is ticked AND it can be paid: its day has come (a payover
 * before its payout day is not, unless released early on the run) and the bank has everything it
 * needs -- whose account, which bank, a six-digit branch code and an account number. Anything short
 * of that is PENDING and says what is missing; it cannot be ticked, so a file never carries a line
 * the bank would bounce.
 *
 * THE FORMAT is a plain bulk-payment CSV -- beneficiary, bank, branch code, account number, amount,
 * the reference on OUR statement and the reference on THEIRS -- until the firm sends its bank's own
 * template (asked for on 13 Oct); then only `bankFileCsv` changes. The reference is the BF reference
 * on both sides, because that is the string the statement import matches on.
 *
 * Pure, so a check can hold it.
 */
export interface OutgoingPayment {
  kind: 'payover' | 'refund' | 'drawing'
  id: string
  payee: string
  amount: number
  reference: string | null
  status: string
  dueOn: string | null
  holder: string | null
  bank: string | null
  branch: string | null
  accountNo: string | null
  companyId: string | null
  accountId: string | null
  caseNumber: string | null
}

/** What stops this payment going in the file, in words; empty when it can go. */
export function whatIsMissing(p: OutgoingPayment): string[] {
  const out: string[] = []
  if (p.status === 'scheduled') out.push('not yet due')
  if (!(p.amount > 0)) out.push('nothing to pay')
  if (!p.reference) out.push('no reference')
  if (!p.holder?.trim()) out.push('account holder')
  if (!p.bank?.trim()) out.push('bank')
  if (!/^\d{6}$/.test((p.branch ?? '').replace(/\s/g, ''))) out.push('branch code')
  if (!/^\d{6,16}$/.test((p.accountNo ?? '').replace(/\s/g, ''))) out.push('account number')
  return out
}

/** The pending reason in words: all four bank fields missing is one thing, said once. */
export function pendingWords(missing: string[]): string {
  const bank = ['account holder', 'bank', 'branch code', 'account number']
  const allBank = bank.every((b) => missing.includes(b))
  return (allBank ? [...missing.filter((m) => !bank.includes(m)), 'no banking details'] : missing).join(', ')
}

export const canPay = (p: OutgoingPayment): boolean => whatIsMissing(p).length === 0

/** Only banking details missing (not "not yet due"): the row offers to add them. */
export const needsBanking = (p: OutgoingPayment): boolean =>
  whatIsMissing(p).some((m) => ['account holder', 'bank', 'branch code', 'account number'].includes(m))

const cell = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/**
 * One row a payment, ticked and payable only, in the order given. Amounts with a dot and two places,
 * no thousands separator (a bank import reads "1 234,56" as text). Banks cap a reference at 20
 * characters; the BF references are shorter than that and are cut there rather than refused.
 */
export function bankFileCsv(payments: OutgoingPayment[], ticked: Set<string>): string {
  const rows = payments.filter((p) => ticked.has(keyOf(p)) && canPay(p))
  const head = ['Beneficiary name', 'Bank', 'Branch code', 'Account number', 'Amount', 'Own reference', 'Beneficiary reference']
  const lines = rows.map((p) => [
    (p.holder ?? '').trim(), (p.bank ?? '').trim(), (p.branch ?? '').replace(/\s/g, ''), (p.accountNo ?? '').replace(/\s/g, ''),
    p.amount.toFixed(2), (p.reference ?? '').slice(0, 20), (p.reference ?? '').slice(0, 20),
  ].map(cell).join(','))
  return [head.join(','), ...lines].join('\r\n') + '\r\n'
}

export const keyOf = (p: Pick<OutgoingPayment, 'kind' | 'id'>): string => `${p.kind}:${p.id}`

/** Ticked by default: everything that can be paid today. */
export function defaultTicked(payments: OutgoingPayment[]): Set<string> {
  return new Set(payments.filter(canPay).map(keyOf))
}

/** The total of what would go in the file, in cents so a long list cannot drift. */
export function fileTotal(payments: OutgoingPayment[], ticked: Set<string>): number {
  return payments.filter((p) => ticked.has(keyOf(p)) && canPay(p)).reduce((t, p) => t + Math.round(p.amount * 100), 0) / 100
}
