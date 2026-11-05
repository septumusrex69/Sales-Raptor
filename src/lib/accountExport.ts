/**
 * THE BOOK, AS A SPREADSHEET (Raptor · Handover 17, S18).
 *
 * THE FIRM, 5 Nov: "an export function to export a CSV ... you can export anything that you want
 * to. If it's the whole book, closed, everything, active accounts, if you want to choose, for
 * example, for a specific client, so use your filters ... the reference number, all of the
 * necessary information that is there, like the handover date, the capital handover, the fees and
 * the interest, receipt fees ... what's been paid, who's the person working on the account, when
 * has it last been worked, the status, the position, stuff like that."
 *
 * PURE. What a row says lives here; fetching the rows lives in accountExportRun.ts. Split so a
 * check can hold the columns and the CSV against fixtures without a database.
 *
 * THE MONEY IS computeBalance's, THE SAME FIGURES THE LIST AND THE ACCOUNT PAGE DRAW. A spreadsheet
 * that disagreed with the screen it was exported from is the one thing an export must never be --
 * somebody reconciling it against the account page would find two answers and trust neither.
 * Where the ledgers were not read (the person chose a quick export) the money columns are EMPTY,
 * never nought: a nought is a real figure ("nothing paid") and would state something false.
 */
import type { BalanceBreakdown } from './accountBalance.ts'
import type { DebtorAccount } from './accountBook.ts'
import { bookLabel, closureLabel } from './accountBooks.ts'
import { accountEnded } from './accountStatus.ts'
import { DESK_POSITIONS, deskPosition } from './clientPosition.ts'
import { deskLabel } from './firmDesk.ts'

/** Everything a column needs to answer for one account. */
export interface ExportContext {
  /** computeBalance's answer, or null where the ledgers were not read. */
  balance: BalanceBreakdown | null
  /** A collector's name off their id. */
  nameOf: (id: string) => string | null | undefined
}

export interface ExportColumn {
  header: string
  /** A money column: empty without the ledgers, two decimals with them. */
  money?: boolean
  value: (a: DebtorAccount, ctx: ExportContext) => string | number | null
}

const money = (pick: (b: BalanceBreakdown) => number): ExportColumn['value'] =>
  (_a, ctx) => (ctx.balance ? cents(pick(ctx.balance)) : null)

/** Two decimals, a dot, no thousands separator: what every spreadsheet reads as a number. */
export function cents(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

/** A date as yyyy-mm-dd, whatever came out of the database (a date or a timestamp). */
export function isoDay(v: string | null | undefined): string | null {
  return v ? v.slice(0, 10) : null
}

/** The desk position's label, read exactly as the list's PositionPill reads it. */
export function positionLabel(a: DebtorAccount): string {
  const position = deskPosition({
    closed: accountEnded(a),
    status: a.status,
    subStatus: a.subStatus,
    bucket: a.bucket,
    everWorked: !!a.lastActionAt,
  })
  return DESK_POSITIONS[position].label
}

/**
 * THE COLUMNS, IN THE ORDER A ROW IS READ: who it is, whose book, when, the money left to right as
 * the list builds it (capital, fees and interest, paid, to settle), then where it stands and who
 * has it.
 *
 * FEES, INTEREST AND RECEIPT FEES ARE APART HERE, though the list joins them. The list is read;
 * a spreadsheet is added up, and the firm named the three separately ("the fees and the interest,
 * receipt fees"). The joined column is kept too, so the export and the screen can be laid side by
 * side.
 */
export const EXPORT_COLUMNS: ExportColumn[] = [
  { header: 'Case number', value: (a) => a.caseNumber },
  { header: 'Account number', value: (a) => a.accountNumber },
  { header: 'Client reference', value: (a) => a.clientReference },
  { header: 'Debtor', value: (a) => [a.debtorFirstName, a.debtorSurname].filter(Boolean).join(' ') || null },
  { header: 'Debtor type', value: (a) => (a.debtorKind === 'company' ? 'Company' : 'Individual') },
  { header: 'ID / registration number', value: (a) => a.debtorIdNumber },
  { header: 'Client', value: (a) => a.companyName },
  { header: 'Handed over', value: (a) => isoDay(a.handoverDate) },
  { header: 'Capital handed over', value: (a) => cents(a.capitalHandedOver) },
  { header: 'Interest', money: true, value: money((b) => b.interest) },
  { header: 'Fees (incl VAT)', money: true, value: money((b) => b.fees) },
  { header: 'Receipt fees (incl VAT)', money: true, value: money((b) => b.receiptFees) },
  { header: 'Fees and interest', money: true, value: money((b) => b.fees + b.receiptFees + b.interest) },
  { header: 'Paid', money: true, value: money((b) => b.payments) },
  { header: 'Balance', money: true, value: money((b) => b.balance) },
  { header: 'To settle', money: true, value: money((b) => b.settlement) },
  { header: 'Capped by', money: true, value: (_a, ctx) => (ctx.balance ? (ctx.balance.cappedBy ?? '') : null) },
  { header: 'Interest rate', value: (a) => `${+(a.interestRateAnnual * 100).toFixed(2)}%` },
  { header: 'Book', value: (a) => bookLabel(a.book) },
  { header: 'Position', value: (a) => positionLabel(a) },
  { header: 'Status', value: (a) => a.status || null },
  { header: 'Sub-status', value: (a) => a.subStatus },
  { header: 'Ended as', value: (a) => (a.endedAs ? closureLabel(a.endedAs) : null) },
  { header: 'Ended on', value: (a) => isoDay(a.endedOn) },
  { header: 'In duplum', value: (a) => (a.inDuplum ? 'Yes' : 'No') },
  { header: 'Working the account', value: (a, ctx) => deskLabel(a, ctx.nameOf) ?? 'Unallocated' },
  { header: 'Last worked', value: (a) => isoDay(a.lastActionAt) },
  { header: 'Diary date', value: (a) => isoDay(a.diaryDate) },
  { header: 'Last payment', value: (a) => isoDay(a.lastPaymentAt) },
  { header: 'Prescription date', value: (a) => isoDay(a.prescriptionDate) },
]

/**
 * One CSV cell.
 *
 * QUOTED where it has to be (a comma, a quote, a line break -- client names carry all three).
 *
 * AND A TEXT CELL THAT STARTS LIKE A FORMULA IS DEFUSED with a leading apostrophe. A debtor's name
 * and a client's reference come off sheets nobody at the firm wrote, and Excel runs "=HYPERLINK(...)"
 * in a cell it opens. Money columns are never touched: they are ours, and a negative balance has to
 * stay a number.
 */
export function csvCell(value: string | number | null | undefined, isNumber = false): string {
  if (value === null || value === undefined) return ''
  let s = String(value)
  if (!isNumber && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Which columns go out: the money ones only where the ledgers were read. */
export function exportColumns(withMoney: boolean): ExportColumn[] {
  return withMoney ? EXPORT_COLUMNS : EXPORT_COLUMNS.filter((c) => !c.money)
}

export function headerLine(columns: ExportColumn[]): string {
  return columns.map((c) => csvCell(c.header)).join(',')
}

/** Columns whose values are numbers we wrote, and so are never defused. */
const NUMERIC = new Set(['Capital handed over', 'Interest', 'Fees (incl VAT)', 'Receipt fees (incl VAT)',
  'Fees and interest', 'Paid', 'Balance', 'To settle'])

export function rowLine(columns: ExportColumn[], a: DebtorAccount, ctx: ExportContext): string {
  return columns.map((c) => csvCell(c.value(a, ctx), NUMERIC.has(c.header))).join(',')
}

/**
 * THE FILE. Lines joined with CRLF, which is what RFC 4180 says and what Excel on Windows expects,
 * and a byte-order mark first, without which Excel opens UTF-8 as Windows-1252 and every "é" in a
 * debtor's name arrives as two characters.
 */
export const CSV_BOM = '﻿'
export const CSV_EOL = '\r\n'

export function exportFilename(parts: { clientName?: string | null; book?: string | null; today: string }): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const bits = ['accounts', parts.clientName ? slug(parts.clientName) : null, parts.book ? slug(parts.book) : null, parts.today]
  return `${bits.filter(Boolean).join('-')}.csv`
}
