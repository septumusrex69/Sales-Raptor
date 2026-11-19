/**
 * KEPT OUT OF accountSummaryLetter.ts ON PURPOSE: the server's workflow sender imports that file (debtorStatement.ts ->
 * api/_lib/workflow/step.ts), and xlsxWrite carries browser-only saving with it. Only the account page needs this.
 */
import { oneInterestLinePerMonth } from './accountBalance.ts'
import { shortish, type AccountLetterInput } from './accountSummaryLetter.ts'
import { buildXlsx, cellsToCsv, type Cell } from './xlsxWrite.ts'

/**
 * THE DEBTOR'S STATEMENT AS A SPREADSHEET (Stephan, 19 Nov: "the excel statement is for debtor's accounts as well"),
 * for an administrator to work with rather than read. THE SAME LINES THE PDF PRINTS -- oneInterestLinePerMonth over
 * the same statement -- and the same "how the balance is made up", so the sheet and the letter can never disagree.
 * Figures go in as numbers so a column sums; the references stay text.
 */
export function statementRows(input: AccountLetterInput & { debtor?: string | null; reference?: string | null; client?: string | null }): Cell[][] {
  const head = (t: string): Cell => ({ v: t, style: 'head' })
  const b = input.breakdown
  const feesNet = b.fees + b.receiptFees - b.vat
  const rows: Cell[][] = [
    [head(`Statement of account${input.reference ? ` ${input.reference}` : ''}`)],
    ...(input.debtor ? [['Debtor', input.debtor]] : []),
    ...(input.client ? [['Creditor', input.client]] : []),
    ['As at', shortish(input.asAt)],
    [],
    [head('How the balance is made up')],
    ['Hand-over balance', { n: input.handedOver }],
    ['Interest', { n: b.interest }],
    ['Fees and expenses', { n: feesNet }],
    ['VAT', { n: b.vat }],
    ['Payments received', { n: -b.payments }],
  ]
  if (b.withheld > 0) rows.push([b.cappedBy === 'written off' ? 'Written off' : 'Not recoverable (in duplum)', { n: -b.withheld }])
  rows.push([head('Balance now owing'), { n: b.balance, style: 'head' }], [])
  rows.push([head('Every movement on the account')])
  rows.push([head('Date'), head('Detail'), head('Debit'), head('Credit'), head('Balance')])
  for (const l of oneInterestLinePerMonth(input.lines ?? [])) {
    rows.push([shortish(l.date), l.description,
      l.debit > 0 ? { n: l.debit } : null, l.credit > 0 ? { n: l.credit } : null, { n: l.balance }])
  }
  return rows
}

export function statementXlsx(input: Parameters<typeof statementRows>[0]): Uint8Array {
  return buildXlsx('Statement', statementRows(input))
}

export function statementCsv(input: Parameters<typeof statementRows>[0]): string {
  return cellsToCsv(statementRows(input))
}
