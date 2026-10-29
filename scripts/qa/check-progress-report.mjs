/**
 * THE MONTHLY PROGRESS REPORT (S16, Raptor · Handover 15). Agreed in S14: "one line per debtor (both references,
 * capital handed over, paid this month and to date, capital outstanding, position). No notes, no activity."
 * Holds the columns to that list, the totals to the lines, the PDF to drawing a long book across pages with a
 * name the standard faces cannot print, and the portal's report to the same `book` read Accounts uses.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-progress-report.mjs
 */
import fs from 'node:fs'
import { PDFDocument } from 'pdf-lib'

const { PROGRESS_COLUMNS, progressTotals, progressSheet, progressPdf } = await import('../../src/lib/progressReport.ts')

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`)
}
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const line = (i, over = {}) => ({ ourReference: `RAP-${125000 + i}`, yourReference: `INV-${i}`, debtor: `Debtor ${i}`, client: 'Test',
  capitalHandedOver: 1000, paidThisMonth: i % 3 ? 0 : 100, paidToDate: 250.5, capitalOutstanding: 749.5, position: i % 5 ? 'paying' : 'closed',
  positionLabel: i % 5 ? 'Paying' : 'Closed', ...over })
const lines = Array.from({ length: 95 }, (_, i) => line(i + 1))
lines[3] = line(4, { debtor: 'Zoë Ndlovu 🌍 Ünal', yourReference: 'ŁÓDŹ/7' })

check('the columns are the agreed ones, in order', [...PROGRESS_COLUMNS],
  ['Debtor', 'Your reference', 'Our reference', 'Capital handed over', 'Paid this month', 'Paid to date', 'Capital outstanding', 'Position'])
check('...and nothing about notes or activity', PROGRESS_COLUMNS.some((c) => /note|activity|action|comment/i.test(c)), false)
const t = progressTotals(lines)
check('the totals count every account and the open ones', [t.accounts, t.open], [95, 76])
check('...and add the lines up, to the cent', [t.handedOver, t.paidToDate, t.outstanding, t.paidThisMonth], [95000, 23797.5, 71202.5, 3100])
check('an empty book totals nought', progressTotals([]).handedOver, 0)

const report = { client: "Stephan's Test Client", asAt: '2026-11-11', month: 'November 2026', lines }
const sheet = Buffer.from(progressSheet(report))
check('the spreadsheet is a zip (xlsx)', sheet.subarray(0, 2).toString(), 'PK')
const pdf = await progressPdf(report)
const doc = await PDFDocument.load(pdf)
check('a long book runs onto more pages', doc.getPageCount() >= 3, true)
check('...in landscape', doc.getPage(0).getWidth() > doc.getPage(0).getHeight(), true)
check('a name the standard faces cannot draw does not stop the report', pdf.length > 1000, true)
check('an empty book still makes a report', (await PDFDocument.load(await progressPdf({ ...report, lines: [] }))).getPageCount(), 1)

/* The portal's report reads the same book the Accounts list reads, open and finished, every page. */
const reports = strip(fs.readFileSync('src/pages/portal/PortalReports.tsx', 'utf8'))
check('the report is drawn from the portal book read', /fetchPortalBook\(token, \{ search: '', includeClosed: true, offset: out\.length \}\)/.test(reports), true)
check('...page after page until the whole book is in', /out\.length >= b\.total/.test(reports), true)
check('...and offered as PDF and spreadsheet', /progressPdf\(await report\(\)\)/.test(reports) && /progressSheet\(await report\(\)\)/.test(reports), true)
check('capital, never the balance', /balance/i.test(strip(fs.readFileSync('src/lib/progressReport.ts', 'utf8')).replace(/Capital, not balance/g, '')), false)

if (failures.length) {
  console.log(`check-progress-report: ${pass} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-progress-report: ${pass} passed, 0 failed`)
