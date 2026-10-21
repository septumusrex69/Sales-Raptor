import type { XlsxSheet } from './xlsx.ts'

/**
 * BALANCES BROUGHT FORWARD FROM SWORDFISH: Camille's "Trust Debtors" workbook, read and matched.
 *
 * HANDOFF §3a, go-live item 3: what each client owes the firm at the cut-over comes into Raptor
 * once, as `client_charges` dated the cut-over, set off against the client's next payover, and the
 * client's ledger opens with it. The workbook is a sheet Camille keeps by hand -- a column per
 * month, newest on the left, one row per client -- so this file does the reading and the matching,
 * in the browser, and `bring_forward_client_balances` writes what a person has looked at.
 *
 * PURE ON PURPOSE: no Supabase, no React. check-brought-forward runs every rule here against an
 * invented sheet, because the real one is client data and this repository is public.
 *
 * THE SIGN IS THE DIRECTION, and it is Camille's:
 *   positive  the client owes the firm -- taken off their next payover;
 *   negative  the client is in credit -- the firm owes THEM, paid with their next payover.
 * Nothing here flips it. A figure that read the other way round would pay a debtor's money to a
 * client who owed it.
 */

/** The sheet the firm keeps the balances on. The other two tabs (Handover, Write Off) are not read. */
export const TRUST_DEBTORS_SHEET = 'Trust Debtors'

/** The cut-over agreed with the user (HANDOFF §3a): the end of 10 December 2026. Editable on screen. */
export const DEFAULT_CUT_OVER = '2026-12-10'

export interface SheetRow {
  /** The spreadsheet row number, 1-based, as Excel shows it. */
  row: number
  /** The client name as typed, trimmed. Empty where the row has none (a total line, a note). */
  name: string
  /** What was in the month's cell, as read. */
  raw: string
  /** Rand and cents, rounded to the cent; null where the cell is blank or not a number. */
  amount: number | null
  /** The cell the figure came from, e.g. "Trust Debtors!E12" -- the audit reference, never the name. */
  ref: string
}

export interface TrustDebtorsSheet {
  sheet: string
  /** The newest month's heading, as an ISO date (yyyy-mm-dd), e.g. 2026-10-01. */
  month: string
  /** The same month in words, e.g. "October 2026". */
  monthLabel: string
  /** The column it is in, as Excel letters, e.g. "E". */
  column: string
  rows: SheetRow[]
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December']

/** "2026-10-01" -> "October 2026". */
export function monthLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

/** What the description on every brought-forward line says -- the database writes the same words. */
export function broughtForwardLabel(iso: string): string {
  return `Balance brought forward from Swordfish (${monthLabel(iso)})`
}

/** 0 -> A, 4 -> E, 26 -> AA. */
export function columnLetters(i: number): string {
  let n = i + 1
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - r) / 26)
  }
  return out
}

/*
 * A MONTH HEADING IS A DATE CELL. xlsx.ts renders one as yyyy/mm/dd; a sheet saved through
 * something else may say yyyy-mm-dd. The text headings to the right ('Dec', '+90', 'Cam Nota') are
 * not months of this table and are never picked, however far left they are moved.
 */
const DATE_HEADING = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/

function headingDate(h: string): string | null {
  const m = DATE_HEADING.exec(h.trim())
  if (!m) return null
  const mm = Number(m[2]); const dd = Number(m[3])
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  return `${m[1]}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

/**
 * ROUNDED TO THE CENT, AWAY FROM NOTHING ON A HALF. A cell that holds a formula carries its
 * floating-point result (1234.5600000000002), and a payover is paid in cents. The tiny lift keeps
 * a half-cent stored as .4999999 from rounding the wrong way.
 */
export function roundCents(n: number): number {
  const r = Math.round((Math.abs(n) + 1e-9) * 100) / 100
  return n < 0 ? -r : r
}

/** A cell as a number of rand, or null. Spaces, commas as thousands and an "R" are tolerated. */
export function readAmount(raw: string): number | null {
  const t = raw.trim().replace(/^R\s*/i, '').replace(/[\s ,]/g, '')
  if (t === '') return null
  if (!/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? roundCents(n) : null
}

/**
 * THE SHEET, READ. Finds the tab by name, the Client column by its heading, and the NEWEST month as
 * the LEFT-MOST date-headed column -- the firm adds each month on the left, so the first date is
 * the latest, and picking it by position rather than by today's date means a sheet brought forward
 * in January still brings forward the month it was closed on. Throws, in words, when the sheet is
 * not the one this reads.
 */
export function parseTrustDebtors(sheets: XlsxSheet[]): TrustDebtorsSheet {
  const tab = sheets.find((s) => s.name.trim().toLowerCase() === TRUST_DEBTORS_SHEET.toLowerCase())
  if (!tab) {
    throw new Error(`This workbook has no "${TRUST_DEBTORS_SHEET}" sheet. Open Camille's Trust Debtors file.`)
  }
  const header = tab.rows[0] ?? []
  const clientCol = header.findIndex((h) => h.trim().toLowerCase() === 'client')
  if (clientCol < 0) {
    throw new Error(`The "${TRUST_DEBTORS_SHEET}" sheet has no "Client" heading in its first row.`)
  }
  let monthCol = -1
  let month: string | null = null
  for (let i = 0; i < header.length; i += 1) {
    const d = headingDate(header[i] ?? '')
    if (d) { monthCol = i; month = d; break }
  }
  if (monthCol < 0 || !month) {
    throw new Error(`The "${TRUST_DEBTORS_SHEET}" sheet has no month columns: none of its headings is a date.`)
  }
  const column = columnLetters(monthCol)
  const rows: SheetRow[] = []
  tab.rows.slice(1).forEach((cells, i) => {
    const name = (cells[clientCol] ?? '').trim()
    const raw = (cells[monthCol] ?? '').trim()
    if (name === '' && raw === '') return
    const rowNumber = i + 2
    rows.push({ row: rowNumber, name, raw, amount: readAmount(raw), ref: `${tab.name}!${column}${rowNumber}` })
  })
  return { sheet: tab.name, month, monthLabel: monthLabel(month), column, rows }
}

/** "  Smit  &  Seun " -> "smit & seun". Case and spacing are not part of a name. */
export function normaliseName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

export interface ClientOption {
  id: string
  name: string
  code: string | null
}

/**
 * WHERE A ROW STANDS:
 *   matched    a client was found (by name, or by code) or picked, and the figure is not nothing;
 *   unmatched  a figure, and no client yet -- a person picks one or leaves it out;
 *   left_out   a person said not to bring it forward;
 *   zero       nothing owed either way that month -- blank or 0, nothing to write;
 *   no_name    a figure with no client name: a total line or a note, never brought forward;
 *   unreadable a client and a cell that is not a number;
 *   twice      two rows on one client -- refused until a person decides which;
 *   already    the client has a balance brought forward already (from this file or another).
 */
export type RowState = 'matched' | 'unmatched' | 'left_out' | 'zero' | 'no_name' | 'unreadable' | 'twice' | 'already'

export interface MatchedRow extends SheetRow {
  state: RowState
  companyId: string | null
  /** How the client was found: by its name, by its code, or picked by a person. */
  how: 'name' | 'code' | 'picked' | null
  /** Why a row was not matched automatically, where there is something to say. */
  note: string | null
}

/** The person's choice for a row: a client id, or LEAVE_OUT. Absent means "as matched". */
export const LEAVE_OUT = '__leave_out__'

/**
 * MATCH EVERY ROW TO A CLIENT. Exact name, ignoring case and spacing; then the name cell read as a
 * client CODE (Camille sometimes types the code); then whatever a person picked. Never a "nearest"
 * name: a guessed client is a balance on somebody else's payover. Two clients sharing one name is
 * left for a person rather than settled by whichever came first.
 */
export function matchRows(
  sheet: TrustDebtorsSheet,
  clients: ClientOption[],
  picks: Record<string, string> = {},
  already: Set<string> = new Set(),
): MatchedRow[] {
  const byName = new Map<string, ClientOption[]>()
  const byCode = new Map<string, ClientOption[]>()
  for (const c of clients) {
    const n = normaliseName(c.name)
    byName.set(n, [...(byName.get(n) ?? []), c])
    if (c.code) {
      const k = normaliseName(c.code)
      byCode.set(k, [...(byCode.get(k) ?? []), c])
    }
  }

  const out: MatchedRow[] = sheet.rows.map((r) => {
    const base = { ...r, companyId: null as string | null, how: null as MatchedRow['how'], note: null as string | null }
    if (r.name === '') return { ...base, state: r.amount ? 'no_name' : 'zero' }
    const pick = picks[r.ref]
    if (r.amount === null) {
      if (r.raw === '') return { ...base, state: 'zero' }
      /* Only ever left out: there is no figure to put on a client. */
      return pick === LEAVE_OUT ? { ...base, state: 'left_out' }
        : { ...base, state: 'unreadable', note: `"${r.raw}" is not an amount` }
    }
    if (r.amount === 0) return { ...base, state: 'zero' }

    if (pick === LEAVE_OUT) return { ...base, state: 'left_out' }
    if (pick) return { ...base, state: 'matched', companyId: pick, how: 'picked' }

    const key = normaliseName(r.name)
    const named = byName.get(key) ?? []
    if (named.length === 1) return { ...base, state: 'matched', companyId: named[0].id, how: 'name' }
    if (named.length > 1) return { ...base, state: 'unmatched', note: `${named.length} clients in Raptor share this name` }
    const coded = byCode.get(key) ?? []
    if (coded.length === 1) return { ...base, state: 'matched', companyId: coded[0].id, how: 'code' }
    return { ...base, state: 'unmatched', note: null }
  })

  /* ONE BALANCE A CLIENT: two rows on one client are both held back until a person decides. */
  const seen = new Map<string, number>()
  for (const r of out) if (r.state === 'matched' && r.companyId) seen.set(r.companyId, (seen.get(r.companyId) ?? 0) + 1)
  for (const r of out) {
    if (r.state !== 'matched' || !r.companyId) continue
    if ((seen.get(r.companyId) ?? 0) > 1) { r.state = 'twice'; r.note = 'Another row is matched to the same client' }
    else if (already.has(r.companyId)) { r.state = 'already'; r.note = 'This client already has a balance brought forward' }
  }
  return out
}

export interface BroughtForwardSummary {
  matched: number
  unmatched: number
  zero: number
  /** Rows that will not be written and are not zero: left out, no name, unreadable, twice, already. */
  held: number
  /** What matched clients owe the firm, in total. */
  owed: number
  /** What the firm owes matched clients (their credits), as a positive figure. */
  credited: number
  /** True only when nothing is waiting on a person: no unmatched, unreadable or twice rows. */
  ready: boolean
}

export function summarise(rows: MatchedRow[]): BroughtForwardSummary {
  let owed = 0; let credited = 0
  const count = (s: RowState) => rows.filter((r) => r.state === s).length
  for (const r of rows) {
    if (r.state !== 'matched' || r.amount === null) continue
    if (r.amount > 0) owed += r.amount
    else credited -= r.amount
  }
  const matched = count('matched')
  return {
    matched,
    unmatched: count('unmatched'),
    zero: count('zero'),
    held: count('left_out') + count('no_name') + count('unreadable') + count('twice') + count('already'),
    owed: roundCents(owed),
    credited: roundCents(credited),
    ready: matched > 0 && count('unmatched') === 0 && count('unreadable') === 0 && count('twice') === 0,
  }
}

/** What `bring_forward_client_balances` is given: the matched rows only, the cell and not the name. */
export function broughtForwardPayload(rows: MatchedRow[]): { company_id: string; amount: number; row_ref: string }[] {
  return rows
    .filter((r) => r.state === 'matched' && r.companyId && r.amount !== null && r.amount !== 0)
    .map((r) => ({ company_id: r.companyId as string, amount: r.amount as number, row_ref: r.ref }))
}
