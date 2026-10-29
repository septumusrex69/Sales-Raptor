/**
 * THE MONTHLY PROGRESS REPORT (S16, Raptor · Handover 15). Agreed with Stephan in S14: "monthly, even with no
 * remittance ... one line per debtor (both references, capital handed over, paid this month and to date, capital
 * outstanding, position). No notes, no activity. Remittance advice stays a separate document."
 *
 * PURE, LIKE remittanceAdvice.ts: the lines come in (the portal's own `book` read, so the report and the Accounts
 * list cannot disagree) and two files go out -- a spreadsheet the client can sort, and a PDF in the advice's navy
 * and gold. pdf-lib arrives by dynamic import, so the chunk is paid for only when somebody presses PDF.
 *
 * CAPITAL, NOT BALANCE, as everywhere in the portal: the client is shown what is outstanding of what THEY handed
 * over. And AS AT THE DAY IT IS MADE: a position is today's fact, so a report for a past month would be a
 * reconstruction nobody can vouch for. The kept monthly copies (the email, once Stephan switches it on) are what
 * make last month's report last month's.
 */
import type { PortalLine } from './clientPortal.ts'
import { buildXlsx, type Cell } from './xlsxWrite.ts'
import { printableForPdf } from './winAnsi.ts'
import { amount, rand } from './money.ts'

export interface ProgressReport {
  client: string
  /** The day it is drawn up, YYYY-MM-DD -- Johannesburg's, from the firm's clock. */
  asAt: string
  /** "November 2026": the month "paid this month" is about. */
  month: string
  lines: PortalLine[]
}

export interface ProgressTotals { accounts: number; open: number; handedOver: number; paidThisMonth: number; paidToDate: number; outstanding: number }

export function progressTotals(lines: PortalLine[]): ProgressTotals {
  const sum = (f: (l: PortalLine) => number) => Math.round(lines.reduce((t, l) => t + f(l), 0) * 100) / 100
  return {
    accounts: lines.length,
    open: lines.filter((l) => l.position !== 'closed').length,
    handedOver: sum((l) => l.capitalHandedOver),
    paidThisMonth: sum((l) => l.paidThisMonth),
    paidToDate: sum((l) => l.paidToDate),
    outstanding: sum((l) => l.capitalOutstanding),
  }
}

/* Hand-rolled: en-ZA renders September as "Sept" (CLAUDE.md). */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const longDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

export const PROGRESS_COLUMNS = ['Debtor', 'Your reference', 'Our reference', 'Capital handed over', 'Paid this month', 'Paid to date', 'Capital outstanding', 'Position'] as const

/** The spreadsheet: a title row, the columns, one row per debtor (amounts as NUMBERS, so they sum), the totals. */
export function progressSheet(r: ProgressReport): Uint8Array {
  const t = progressTotals(r.lines)
  const rows: Cell[][] = [
    [{ v: `${r.client} – monthly progress report, ${r.month} (as at ${longDate(r.asAt)})`, style: 'head' }],
    [],
    PROGRESS_COLUMNS.map((v) => ({ v, style: 'head' as const })),
    ...r.lines.map((l): Cell[] => [l.debtor, l.yourReference, l.ourReference,
      { n: l.capitalHandedOver }, { n: l.paidThisMonth }, { n: l.paidToDate }, { n: l.capitalOutstanding }, l.positionLabel]),
    [],
    [{ v: `Total, ${t.accounts} accounts (${t.open} open)`, style: 'head' }, '', '',
      { n: t.handedOver, style: 'head' }, { n: t.paidThisMonth, style: 'head' }, { n: t.paidToDate, style: 'head' }, { n: t.outstanding, style: 'head' }, ''],
  ]
  return buildXlsx('Progress report', rows)
}

/**
 * The PDF: A4 landscape, the advice's navy band with the firm's name in tracked gold, the four totals, then the
 * table, repeated headings on every page and the page number at the foot. A name the standard faces cannot draw
 * is drawn with the character it can (printableForPdf's quiet fixes); a report is not a statutory notice, so a
 * name is never a reason to refuse the whole book.
 */
export async function progressPdf(r: ProgressReport): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const sans = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const NAVY = rgb(17 / 255, 30 / 255, 45 / 255), GOLD = rgb(198 / 255, 159 / 255, 84 / 255)
  const SLATE = rgb(90 / 255, 107 / 255, 128 / 255), INK = rgb(27 / 255, 43 / 255, 62 / 255), ZEBRA = rgb(242 / 255, 245 / 255, 248 / 255)
  const W = 841.89, H = 595.28, M = 36
  const text = (s: string) => printableForPdf(s).text
  const t = progressTotals(r.lines)
  /* Column x positions and alignment: text left, amounts right. */
  const cols: { title: string; x: number; w: number; right?: boolean }[] = [
    { title: 'Debtor', x: M, w: 190 }, { title: 'Your reference', x: M + 196, w: 104 }, { title: 'Our reference', x: M + 304, w: 76 },
    { title: 'Handed over', x: M + 384, w: 76, right: true }, { title: 'Paid this month', x: M + 464, w: 76, right: true },
    { title: 'Paid to date', x: M + 544, w: 76, right: true }, { title: 'Outstanding', x: M + 624, w: 76, right: true },
    { title: 'Position', x: M + 710, w: W - M - (M + 710) },
  ]
  const fit = (s: string, w: number, size: number, f = sans) => {
    let out = text(s)
    while (out.length > 1 && f.widthOfTextAtSize(out, size) > w) out = out.slice(0, -2) + '…'
    return printableForPdf(out).text
  }
  let page = doc.addPage([W, H])
  let y = 0
  const pages: typeof page[] = [page]
  const header = (first: boolean) => {
    page.drawRectangle({ x: 0, y: H - 64, width: W, height: 64, color: NAVY })
    page.drawRectangle({ x: 0, y: H - 67, width: W, height: 3, color: GOLD })
    page.drawText('B R E D E L L   F E R R E I R A', { x: M, y: H - 30, size: 11, font: bold, color: GOLD })
    page.drawText(text(`${r.client} – monthly progress report, ${r.month}`), { x: M, y: H - 48, size: 10, font: sans, color: rgb(1, 1, 1) })
    const asAt = text(`As at ${longDate(r.asAt)}`)
    page.drawText(asAt, { x: W - M - sans.widthOfTextAtSize(asAt, 9), y: H - 48, size: 9, font: sans, color: rgb(0.75, 0.8, 0.86) })
    y = H - 90
    if (first) {
      const tiles: [string, string][] = [
        ['ACCOUNTS', `${t.accounts} (${t.open} open)`], ['CAPITAL HANDED OVER', rand(t.handedOver)],
        ['PAID THIS MONTH', rand(t.paidThisMonth)], ['PAID TO DATE', rand(t.paidToDate)], ['CAPITAL OUTSTANDING', rand(t.outstanding)],
      ]
      const tw = (W - 2 * M - 4 * 10) / 5
      tiles.forEach(([label, value], i) => {
        const x = M + i * (tw + 10)
        page.drawRectangle({ x, y: y - 46, width: tw, height: 46, color: i === 3 ? NAVY : ZEBRA })
        page.drawText(label, { x: x + 10, y: y - 16, size: 7, font: bold, color: i === 3 ? GOLD : SLATE })
        page.drawText(text(value), { x: x + 10, y: y - 35, size: 13, font: bold, color: i === 3 ? rgb(1, 1, 1) : NAVY })
      })
      y -= 66
    }
    for (const c of cols) {
      const s = c.title
      page.drawText(s, { x: c.right ? c.x + c.w - bold.widthOfTextAtSize(s, 7.5) : c.x, y, size: 7.5, font: bold, color: SLATE })
    }
    page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 0.6, color: rgb(0.84, 0.86, 0.89) })
    y -= 18
  }
  header(true)
  r.lines.forEach((l, i) => {
    if (y < M + 24) { page = doc.addPage([W, H]); pages.push(page); header(false) }
    if (i % 2 === 0) page.drawRectangle({ x: M - 4, y: y - 4, width: W - 2 * M + 8, height: 15, color: ZEBRA })
    const cells = [l.debtor, l.yourReference, l.ourReference, amount(l.capitalHandedOver), amount(l.paidThisMonth), amount(l.paidToDate), amount(l.capitalOutstanding), l.positionLabel]
    cells.forEach((v, k) => {
      const c = cols[k]
      const s = fit(v ?? '', c.w, 8)
      page.drawText(s, { x: c.right ? c.x + c.w - sans.widthOfTextAtSize(s, 8) : c.x, y, size: 8, font: k === 0 ? bold : sans, color: INK })
    })
    y -= 15
  })
  if (r.lines.length === 0) page.drawText('No accounts on the book yet.', { x: M, y, size: 9, font: sans, color: SLATE })
  pages.forEach((p, i) => {
    const foot = `Page ${i + 1} of ${pages.length}  ·  Capital, not balance: what is outstanding of what you handed over.`
    p.drawText(text(foot), { x: M, y: 18, size: 7, font: sans, color: SLATE })
  })
  return doc.save()
}
