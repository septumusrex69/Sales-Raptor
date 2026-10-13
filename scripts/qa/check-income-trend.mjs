/**
 * WHAT THE FIRM EARNED, MONTH BY MONTH, AND THE SHARE OF COLLECTIONS IT WAS (S7).
 *
 * The firm, 13 Oct: line graphs of interest, fees, commission and total, and earned against collected
 * ("40 and 50%"). Held here, on staging's own months to the cent: each line is the parts the firm
 * named (interest with the bank's, fees with charges, commission without its VAT); total earned is the
 * ledger total less commission VAT, so it is the Income page's figure less SARS's money; the ratio is
 * null rather than 0% in a month nothing was collected; the empty months before the first are dropped
 * and the empty ones after are kept; the SQL calls business_income rather than splitting again, dates
 * collections by approval, and answers nobody without business.income; and the company dashboard does
 * not draw any of it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-income-trend.mjs
 */
import { readFileSync } from 'node:fs'
import { toIncomeMonth, trendPoint, trendSeries, trendTotals } from '../../src/lib/incomeTrend.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const row = (month, o = {}) => toIncomeMonth({ month, interest: 0, costs: 0, commission: 0, commission_vat: 0, credit_taken: 0,
  charges_raised: 0, bank_interest: 0, other: 0, total: 0, collected: 0, ...o })

/* STAGING, 13 OCT, as business_income_months returned it. */
const staging = [
  row('2026-04-01'),
  row('2026-05-01'),
  row('2026-06-01', { interest: 4147.49, costs: 4445.27, commission: 2798.72, commission_vat: 419.81, other: 356.25, total: 12167.54, collected: 24100 }),
  row('2026-07-01', { interest: 4809.13, costs: 5684.60, commission: 4296.95, commission_vat: 644.56, bank_interest: 42.18, charges_raised: 1871.12, total: 17348.54, collected: 36450 }),
  row('2026-08-01', { interest: 2874.74, costs: 4510.63, commission: 4561.53, commission_vat: 684.25, bank_interest: 47.65, charges_raised: 136.88, other: 748.12, total: 13563.80, collected: 27750 }),
  row('2026-09-01', { interest: 3160.04, costs: 2959.69, commission: 4655.17, commission_vat: 698.31, bank_interest: 38.40, total: 11511.61, collected: 27750 }),
  row('2026-10-01'),
]
const s = trendSeries(staging)
check('the empty months before the first are dropped, the empty one after kept', s.map((p) => p.month),
  ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'])
const jul = s[1]
check('interest is the debtors\' and the bank\'s', jul.interest, 4851.31)
check('fees are Annexure B fees and costs, and charges to clients', jul.fees, 7555.72)
check('commission is without its VAT', jul.commission, 4296.95)
check('total earned is the Income page\'s total less commission VAT', jul.earned, 16703.98)
check('...and the ratio is earned over collected', jul.ratio, 45.8)
check('staging reads the 40 to 50% the firm quoted, every month', s.slice(0, 4).map((p) => p.ratio), [48.7, 45.8, 46.4, 39])
check('a month with nothing collected has no ratio, not 0% (and not NaN, which JSON prints as null)', s[4].ratio === null, true)
check('...and earned nothing, drawn as nothing', s[4].earned, 0)
check('the axis says the month short, the tooltip in full', [jul.name, jul.fullLabel], ['Jul \'26', 'July 2026'])
const t = trendTotals(s)
check('over the months drawn, the totals and the share', t, { earned: 52144.56, collected: 116050, ratio: 44.9 })
check('in a month with no unclaimed credit or other entries, the three lines are the total to the cent',
  Math.round((jul.interest + jul.fees + jul.commission) * 100) / 100, jul.earned)
check('nothing at all is no series', trendSeries([row('2026-01-01'), row('2026-02-01')]), [])
check('collections alone start the series (a month collected but not yet earned on is real)',
  trendSeries([row('2026-01-01'), row('2026-02-01', { collected: 500 })]).map((p) => [p.month, p.earned, p.ratio]), [['2026-02-01', 0, 0]])
check('a refund month can earn below nothing, and the line goes below the axis rather than being clamped',
  trendPoint(row('2026-03-01', { total: -200, collected: 1000 })).earned, -200)

/* THE SQL: one calculation, dated like the ledger, behind the tick. */
const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const at = sql.lastIndexOf('create or replace function public.business_income_months(')
check('business_income_months is in schema.sql', at >= 0, true)
const body = at >= 0 ? sql.slice(at, sql.indexOf('$$;', sql.indexOf('as $$', at)) + 3) : ''
check('...and sums business_income month by month rather than splitting again', /lateral public\.business_income\(mo\.m_start, mo\.m_end\)/.test(body), true)
check('...dates collections by approval, as the ledger dates the earnings', /coalesce\(p\.approved_at, p\.received_at\)/.test(body), true)
check('...leaves out the reversed, rejected and returned unpaid', ['p.reversed_at is null', 'p.rejected_at is null', 'p.returned_unpaid_on is null'].every((x) => body.includes(x)), true)
check('...and answers nobody without business.income', /where public\.has_capability\('business\.income'\)/.test(body), true)
check('...executable by the signed in only', /revoke all on function public\.business_income_months\(date, date\) from public, anon;/.test(sql.slice(at)), true)

/* WHERE IT IS DRAWN: on Income, which is behind the tick, and never on the company dashboard. */
const income = readFileSync(new URL('../../src/pages/business/BusinessIncome.tsx', import.meta.url), 'utf8')
check('the Income page draws it', /<IncomeTrend \/>/.test(income), true)
const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
check('...and Income is behind RequireIncome', /path="income" element=\{<RequireIncome><BusinessIncome \/><\/RequireIncome>\}/.test(app), true)
const company = readFileSync(new URL('../../src/pages/CompanyDashboard.tsx', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
check('the company dashboard does not draw the earnings', /IncomeTrend|fetchIncomeMonths|business_income/.test(company), false)

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-income-trend: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
