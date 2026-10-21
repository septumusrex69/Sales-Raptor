/**
 * COLLECTIONS PERFORMANCE ON THE CLIENT PAGE (S9, 19 Oct): what was collected each sales month, and
 * the recovery rate of the whole book at each month's end -- ending on the same figure the ring and
 * the tile state.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-client-collections.mjs
 */
import { readFileSync } from 'node:fs'
import { collectionMonths } from '../../src/lib/clientCollections.ts'

let pass = 0
const failures = []
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }
const check = (name, got, want) => ok(`${name}\n    expected ${JSON.stringify(want)}\n    got      ${JSON.stringify(got)}`, JSON.stringify(got) === JSON.stringify(want))

const rows = [
  { day: '2025-01-15', capital: 10000, collected: 0 }, // before any window: still in the rate
  { day: '2026-05-15', capital: 10000, collected: 0 },
  { day: '2026-06-10', capital: 0, collected: 1000 }, // the 10th: the JUNE sales month
  { day: '2026-06-11', capital: 0, collected: 2000 }, // the 11th: the JULY sales month
  { day: '2026-10-12', capital: 0, collected: 3000 }, // in the month still running
]
const six = collectionMonths(rows, '2026-10-19', 6)
check('six sales months, ending on the one holding today, named for the month they end in',
  six.map((m) => m.label), ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'])
check('the 10th falls in the month it ends, the 11th in the next', six.map((m) => m.collected), [1000, 2000, 0, 0, 0, 3000])
check('the rate is the whole book to that month’s end, history before the window included',
  six.map((m) => m.rate), [5, 15, 15, 15, 15, 30])
check('...and ends on collected over handed over, the ring’s own division', six[5].rate, Math.round((6000 / 20000) * 1000) / 10)
check('only the month holding today is still running', six.map((m) => m.current), [false, false, false, false, false, true])

const all = collectionMonths(rows, '2026-10-19', 'all')
check('all time opens on the first month anything happened in (15 Jan is the February sales month)', all[0].label, 'Feb 25')
check('...the year said once the months cross one', all[all.length - 1].label, 'Nov 26')
check('nothing handed over: no rate rather than a nought', collectionMonths([], '2026-10-19', 6)[0].rate, null)

/* THE SAME ACCOUNTS AS THE RING: withdrawn left out of both halves, live money only. */
const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const fn = sql.slice(sql.lastIndexOf('create or replace function public.client_money_by_day('))
const body = fn.slice(0, fn.indexOf('$$;'))
ok('withdrawn accounts are left out, as in client_account_outcomes', /a\.ended_as is distinct from 'withdrawn'/.test(body))
ok('...and reversed, rejected and demo money', /p\.reversed_at is null and p\.rejected_at is null and not coalesce\(p\.is_demo, false\)/.test(body))
ok('...a client counted with its sub-accounts', /coalesce\(c\.parent_company_id, c\.id\) = p_client/.test(body))
ok('...a payment on the firm’s day, not the server’s', /received_at at time zone 'Africa\/Johannesburg'/.test(body))
ok('...as the caller', /security invoker/.test(fn.slice(0, 300)))

/* NO COMMISSION OR ANNEXURE B INCOME on the collections card: it is the client's money. */
const card = readFileSync(new URL('../../src/components/companies/ClientCollectionsCard.tsx', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
ok('the collections card shows no commission', !/commission/i.test(card))
/* AND THE PAYOVER CARD, which does, only for somebody who may see the trust. */
const page = readFileSync(new URL('../../src/pages/companies/CompanyDetail.tsx', import.meta.url), 'utf8')
ok('the upcoming payover is shown only with the trust tick', /\{canViewTrust\(currentUser\) && \(\s*<ClientUpcomingPayover/.test(page))

if (failures.length) { console.error(`check-client-collections: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`); process.exit(1) }
console.log(`check-client-collections: ${pass} passed, 0 failed`)
