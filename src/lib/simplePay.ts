import { LEAVE_KINDS, LEAVE_META, type LeaveKind } from './leave.ts'

/**
 * THE SIMPLEPAY EXPORT: ONE PAY DAY AS A SPREADSHEET THE FIRM'S PAYROLL CAN TAKE IN (23 Oct 2026).
 *
 * THE FIRM (Stephan) uses SimplePay, South African payroll: "do the export one first, API later".
 * So this is a .csv, made in the browser from the very Month summary on the screen (summarise ->
 * buildStatement), never a second sum -- the figure on the screen and the figure in the file are one
 * calculation. Nothing is sent anywhere and nothing is stored.
 *
 * THE HEADINGS ARE PLAIN AND PROVISIONAL. SimplePay's bulk input takes its own template, with its own
 * column names per pay item, and the firm has not yet supplied theirs (HANDOFF §4). Every heading is
 * in SIMPLEPAY_HEADINGS below and nowhere else, so when the template arrives the change is that one
 * constant -- the rows are built against its keys, not its words.
 *
 * WHICH MONTH EACH COLUMN IS FOR, because the pay day pays for two: commission is the collections
 * month (11th to 10th) as on the statement, and the basic and LEAVE are the salary month (26th to
 * 25th), because leave is time off the salaried month. Both are named in the file name's period.
 *
 * AMOUNTS AS PLAIN NUMBERS ("3652.17"): no R, no thousands separator. en-ZA groups thousands with a
 * non-breaking space, which a spreadsheet import reads as text. Leave in days, to the half day.
 */
export const SIMPLEPAY_HEADINGS = {
  employeeNumber: 'Employee number',
  name: 'Employee',
  email: 'Email',
  basic: 'Basic salary',
  commission: 'Commission',
  ...(Object.fromEntries(LEAVE_KINDS.map((k) => [`leave_${k}`, `${LEAVE_META[k].label} (days)`])) as Record<`leave_${LeaveKind}`, string>),
} as const

export type SimplePayKey = keyof typeof SIMPLEPAY_HEADINGS

export interface SimplePayPerson {
  name: string
  email: string
  employeeNumber: string | null
  /** Basic paid this pay day: pro rata where it is (basicFor), as the summary shows it. */
  basic: number
  /** Commission payable this pay day: payments plus PTCs released. Waiting PTCs are not paid. */
  commission: number
  /** Leave taken in the salary month, by kind (leaveInPeriod). */
  leave: Record<LeaveKind, number>
}

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
const days = (n: number) => {
  const r = Math.round(n * 2) / 2
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/** One row a person, keyed by SIMPLEPAY_HEADINGS' keys, in its order. */
export function simplePayRows(people: SimplePayPerson[]): Record<SimplePayKey, string>[] {
  return people.map((p) => {
    const row: Record<string, string> = {
      employeeNumber: p.employeeNumber ?? '',
      name: p.name,
      email: p.email,
      basic: money(p.basic),
      commission: money(p.commission),
    }
    for (const k of LEAVE_KINDS) row[`leave_${k}`] = days(p.leave[k] ?? 0)
    return row as Record<SimplePayKey, string>
  })
}

/** RFC 4180: a cell with a comma, a quote or a line break is quoted, its quotes doubled. */
function cell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** The whole file: the heading row, then a row a person; CRLF, which every spreadsheet reads. */
export function simplePayCsv(people: SimplePayPerson[]): string {
  const keys = Object.keys(SIMPLEPAY_HEADINGS) as SimplePayKey[]
  const lines = [keys.map((k) => cell(SIMPLEPAY_HEADINGS[k])).join(',')]
  for (const r of simplePayRows(people)) lines.push(keys.map((k) => cell(r[k])).join(','))
  return lines.join('\r\n') + '\r\n'
}

/** "simplepay-2026-11.csv": the pay day's key, which names both months it pays for. */
export function simplePayFilename(periodKey: string): string {
  return `simplepay-${periodKey}.csv`
}
