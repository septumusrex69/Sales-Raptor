/**
 * THE CLIENT REPORT (S9, 19 Oct). The firm sent their Excel "Collection dashboard" as a reference --
 * "you can fix all of that" -- and what it got wrong is what this holds:
 *
 *   - percentages that did not add up (298.95% beside 100%): every share column here adds to
 *     exactly 100.0, by largest remainder;
 *   - a ring with no labels: every chart in the PDF sits on a table of its own figures;
 *   - a blank page: two pages, both drawn on.
 *
 * And what it must not do: show commission or fees -- it goes to the client.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-client-report.mjs
 */
import { readFileSync } from 'node:fs'
import { buildClientReport, clientReportFilename, shares } from '../../src/lib/clientReport.ts'
import { clientReportPdf, reportDate } from '../../src/lib/clientReportPdf.ts'

let pass = 0
const failures = []
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }
const check = (name, got, want) => ok(`${name}\n    expected ${JSON.stringify(want)}\n    got      ${JSON.stringify(got)}`, JSON.stringify(got) === JSON.stringify(want))
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const sum1 = (xs) => Math.round(xs.reduce((t, x) => t + x, 0) * 10) / 10

/* ---------- shares that add up ---------- */
check('three equal thirds still add to 100.0', sum1(shares([1, 1, 1])), 100)
check('...the extra tenth to the first', shares([1, 1, 1]), [33.4, 33.3, 33.3])
check('an awkward split adds to 100.0', sum1(shares([21, 63, 9])), 100)
check('nothing is nought everywhere, not NaN', shares([0, 0]), [0, 0])
let worst = 0
for (let seed = 1; seed < 400; seed += 1) {
  const xs = Array.from({ length: 1 + (seed % 13) }, (_, i) => ((seed * 7919 + i * 104729) % 997) + 1)
  worst = Math.max(worst, Math.abs(sum1(shares(xs)) - 100))
}
check('four hundred random splits: every one adds to 100.0', worst, 0)

/* ---------- the report ---------- */
const report = buildClientReport({
  client: { name: 'Rinda Roo Company', code: 'RRC' },
  today: '2026-10-19',
  outcomes: [
    { outcome: 'recovered', accounts: 21, capital: 80000, collected: 70000 },
    { outcome: 'active', accounts: 3, capital: 3000, collected: 500 },
    { outcome: 'closed', accounts: 9, capital: 30000, collected: 1000 },
  ],
  active: [
    { status: 'Active', subStatus: 'Promise to pay', bucket: null, capital: 1000 },
    { status: 'Active', subStatus: 'Tracing', bucket: null, capital: 1200 },
    { status: 'Active', subStatus: 'Tracing', bucket: null, capital: 800 },
  ],
  money: [
    { day: '2026-03-15', capital: 113000, collected: 0 },
    { day: '2026-09-20', capital: 0, collected: 71500 },
  ],
  handovers: [{ label: 'Apr', accounts: 33, capital: 113000 }],
})
check('at a glance: the counts', [report.glance.accounts, report.glance.recovered, report.glance.active, report.glance.closed], [33, 21, 3, 9])
check('...the money', [report.glance.capital, report.glance.collected], [113000, 71500])
check('...and the recovery rate, collected over capital, to one place', report.glance.recoveryRate, 63.3)
check('what became of them adds to 100.0%', sum1(report.outcomes.map((o) => o.pct)), 100)
check('where the active ones stand: busiest first, in the firm’s words', report.positions.map((p) => [p.label, p.accounts]), [['Tracing', 2], ['Arranged', 1]])
check('...adding to 100.0%', sum1(report.positions.map((p) => p.pct)), 100)
check('...with the capital beside each', report.positionsTotal, { accounts: 3, capital: 3000 })
check('handed over since the first handover day', report.since, '2026-03-15')
check('twelve months of collections, ending with the running one', [report.collections.length, report.collections.at(-1)?.current], [12, true])
check('the file is named for the client first', clientReportFilename('Rinda Roo / Company', '2026-10-19'), 'Rinda Roo Company collection report 19 Oct 2026.pdf')
check('dates written out, never en-ZA’s "Sept"', reportDate('2026-09-01'), '1 Sep 2026')

/* ---------- the PDF ---------- */
const { bytes, problem } = await clientReportPdf(report, { name: 'Bredell Ferreira', phone: '011 592 0520', address: null }, { logo: undefined })
check('it draws, with nothing unprintable', [Buffer.from(bytes.subarray(0, 5)).toString('latin1'), problem], ['%PDF-', null])
const { PDFDocument } = await import('pdf-lib')
check('two pages, neither of them blank (the reference’s page 2 was)', (await PDFDocument.load(bytes)).getPageCount(), 2)
const bad = await clientReportPdf({ ...report, client: { name: 'Ωmega Holdings', code: null } }, { name: 'Bredell Ferreira', phone: null, address: null })
ok('a client name the PDF cannot draw is reported, not substituted', !!bad.problem)

/* ---------- no commission, no fees: it goes to the client ---------- */
for (const f of ['src/lib/clientReport.ts', 'src/lib/clientReportPdf.ts', 'src/lib/clientReportData.ts']) {
  const code = strip(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'))
  ok(`${f} reads and prints no commission or fees`, !/commission|annexure|fee_|account_fees|client_charges/i.test(code))
}
const pdfSrc = strip(readFileSync(new URL('../../src/lib/clientReportPdf.ts', import.meta.url), 'utf8'))
ok('every chart sits on a table of its own figures', (pdfSrc.match(/rows\.forEach\(\(r, ri\)/g) ?? []).length === 1 && (pdfSrc.match(/section\(/g) ?? []).length === 2)
const detail = read('src/pages/companies/CompanyDetail.tsx')
function read(f) { return readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8') }
ok('the client page offers it, on a client, over the client and its sub-accounts', /<ClientReportButton client=\{\{ id: company\.id, name: company\.name, code: company\.code \?\? null, accountIds: \[company\.id, \.\.\.subAccounts\.map\(\(s\) => s\.id\)\] \}\} \/>/.test(detail))

if (failures.length) { console.error(`check-client-report: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`); process.exit(1) }
console.log(`check-client-report: ${pass} passed, 0 failed`)
