/**
 * Our share of collections (S21 · Raptor H19). Stephan, 9 Nov: "if we collect 2 million, or 3 million, how much of that
 * is [our] share? How much of that is the client share? ... the profitability margin ratio."
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-collections-share.mjs
 */
import { readFileSync } from 'node:fs'
import { oursFromIncome, percent, shareOf, totalShare } from '../../src/lib/collectionsShare.ts'

let pass = 0
const failures = []
const check = (name, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) pass += 1; else failures.push(`${name}\n    expected ${JSON.stringify(b)}\n    got      ${JSON.stringify(a)}`) }
const ok = (name, v) => check(name, v, true)
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

const s = shareOf(3000000, 1200000, 60000)
check('of R3 000 000 collected, R1 200 000 ours and R60 000 VAT for SARS, the clients\' share is the rest', s.clients, 1740000)
check('...and the ratio is ours alone, 40.0%', percent(s.ratio), '40.0%')
check('nothing collected is no ratio, not 0%', percent(shareOf(0, 0).ratio), '—')
check('our share from the Income figures: commission + fees + interest, the VAT apart', oursFromIncome({ interest: 100, costs: 250.5, commission: 1000, commissionVat: 150 }), { ours: 1350.5, vat: 150 })
check('several months add their totals and take the ratio of those, not an average of ratios',
  percent(totalShare([{ collected: 1000, ours: 500 }, { collected: 9000, ours: 900 }]).ratio), '14.0%')

const sql = read('supabase/schema.sql')
const fn = sql.slice(sql.lastIndexOf('create function public.collections_share('))
ok('per client, behind business.income', /where public\.has_capability\('business\.income'\)/.test(fn))
ok('...collected by the Income graph\'s own rule (approval date; not reversed, rejected or returned)',
  /coalesce\(p\.approved_at, p\.received_at\) at time zone 'Africa\/Johannesburg'/.test(fn) && /p\.reversed_at is null and p\.rejected_at is null and p\.returned_unpaid_on is null/.test(fn))
ok('...ours from business_income\'s earnings on receipts only, the VAT apart', /b\.interest \+ b\.costs \+ b\.commission as ours, b\.commission_vat as vat/.test(fn) && !/charges_raised|bank_interest/.test(fn.slice(0, fn.indexOf('$$;'))))
const page = read('src/pages/business/BusinessIncome.tsx')
ok('it is on the Income page, which needs business.income', /<OurShareOfCollections year=\{year\} month=\{month\} \/>/.test(page))
ok('...and nowhere on the company dashboard', !/OurShareOfCollections|collections_share|collectionsShare/.test(read('src/pages/CompanyDashboard.tsx') + read('src/pages/trust/TrustOverview.tsx')))

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-collections-share: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
