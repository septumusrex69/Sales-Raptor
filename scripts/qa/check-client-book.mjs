/**
 * THE SALES AND COMMUNICATIONS DASHBOARDS' ARITHMETIC (S8, 18 Oct) -- src/lib/clientBook.ts, and the
 * value band's rule in client_book_summary.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-client-book.mjs
 */
import { readFileSync } from 'node:fs'
import { clientsTouched, goneQuiet, mandateToHandover, monthTrack, recoveryRate, topClients } from '../../src/lib/clientBook.ts'
import { getSalesMonthForKey } from '../../src/lib/salesMonth.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const oct = getSalesMonthForKey('2026-10') // 11 Sep - 10 Oct
const lead = (createdAt, ownerId = 'r1') => ({ createdAt, ownerId })
const mandate = (wonAt, ownerId = 'r1', companyId = 'c1') => ({ stage: 'Won', wonAt, kind: 'Handover', ownerId, companyId })
const t = monthTrack({
  current: oct, months: 3,
  leads: [lead('2026-09-20T10:00:00'), lead('2026-09-21T10:00:00'), lead('2026-09-22T10:00:00'), lead('2026-09-23T10:00:00'), lead('2026-06-01T10:00:00'), lead('2026-09-24T10:00:00', 'r2')],
  deals: [mandate('2026-09-25T10:00:00'), { stage: 'Won', wonAt: '2026-09-25T10:00:00', kind: 'Service', ownerId: 'r1' }, mandate('2026-10-12T10:00:00')],
  intake: [{ day: '2026-09-15', accounts: 5, capital: 500, newAccounts: 2, newCapital: 200 }, { day: '2026-10-11', accounts: 9, capital: 900, newAccounts: 9, newCapital: 900 }],
  owners: new Set(['r1']),
})
check('three months, oldest first, ending with the one asked for', t.map((m) => m.key), ['2026-08', '2026-09', '2026-10'])
check('leads in the month, for the reps in scope', t[2].leads, 4)
check('mandates are handover deals WON in the month, not service deals', t[2].mandates, 1)
check('closing rate = mandates over leads in the month', t[2].closingRate, 25)
check('no leads, no rate (not nought)', t[0].closingRate, null)
check('handovers split new and existing', [t[2].newAccounts, t[2].existingAccounts, t[2].newCapital, t[2].existingCapital], [2, 3, 200, 300])
ok('a handover after the month is not in it', t.every((m) => m.newAccounts !== 9))

const b = (o) => ({ companyId: o.id, name: o.id, ownerId: 'u', mandateSignedAt: null, firstHandover: '2025-01-01', lastHandover: o.last ?? '2026-10-01', accounts: o.accounts ?? 10, capital: o.capital ?? 1000, collected: o.collected ?? 0, periodAccounts: o.pa ?? 0, periodCapital: o.pc ?? 0, valueBand: null })
check('recovery rate', recoveryRate({ capital: 1000, collected: 250 }), 25)
check('...none with nothing handed over', recoveryRate({ capital: 0, collected: 5 }), null)
const books = [b({ id: 'a', last: '2026-08-01' }), b({ id: 'q', last: '2026-07-01' }), b({ id: 'r', last: '2026-10-10' }), { ...b({ id: 'never' }), lastHandover: null, accounts: 0 }]
check('gone quiet: longest silent first, past the window only', goneQuiet(books, '2026-10-18', 60).map((x) => [x.companyId, x.silentDays]), [['q', 109], ['a', 78]])
check('...a client that never handed over is the other list', goneQuiet(books, '2026-10-18', 0).some((x) => x.companyId === 'never'), false)
const ranked = [b({ id: 'small', accounts: 2, capital: 100, collected: 100 }), b({ id: 'big', accounts: 50, capital: 9000, collected: 4500, pa: 3, pc: 300 }), b({ id: 'mid', accounts: 8, capital: 4000, collected: 3000, pa: 1, pc: 900 })]
check('top this month by capital handed over this month', topClients(ranked, 'period').map((x) => x.companyId), ['mid', 'big'])
check('top by book size', topClients(ranked, 'capital').map((x) => x.companyId), ['big', 'mid', 'small'])
check('top by recovery, books of five accounts or more', topClients(ranked, 'recovery').map((x) => x.companyId), ['mid', 'big'])

const acts = [
  { companyId: 'sub1', type: 'Courtesy Call', activityDate: '2026-09-20T09:00:00', userId: 'u1' },
  { companyId: 'p1', type: 'Email', activityDate: '2026-09-21T09:00:00', userId: 'u1' },
  { companyId: 'p2', type: 'Email', activityDate: '2026-09-21T09:00:00', userId: 'u1' },
  { companyId: 'p3', type: 'Courtesy Call', activityDate: '2026-09-21T09:00:00', userId: 'other' },
  { companyId: 'p4', type: 'Courtesy Call', activityDate: '2026-08-01T09:00:00', userId: 'u1' },
]
const touched = clientsTouched(acts, oct, new Set(['u1']), (id) => (id === 'sub1' ? 'p1' : id))
check('unique clients touched, a sub-account counted as its client', [touched.touched, touched.courtesy], [2, 1])

const h = mandateToHandover([mandate('2026-09-01T10:00:00', 'r1', 'c1'), mandate('2026-09-10T10:00:00', 'r1', 'c2'), mandate('2026-09-05T10:00:00', 'r1', 'c3')],
  (id) => ({ c1: '2026-09-11', c2: '2026-09-30', c3: null }[id]))
check('days from mandate to first handover, averaged; a waiting one counted, not averaged', h.get('r1'), { avgDays: 15, handedOver: 2, waiting: 1 })

const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const fn = sql.slice(sql.lastIndexOf('create or replace function public.client_book_summary('))
ok('the band is per month while active, over twelve months', /raptor_today\(\) - 365/.test(fn.slice(0, 3000)) && /greatest\(b\.first_day, public\.raptor_today\(\) - 365\)/.test(fn.slice(0, 3000)))
ok('...cut into thirds', /ntile\(3\)/.test(fn.slice(0, 3000)))
ok('...and only the word leaves the database, never the rand', !/earned_12m[^,]*,\s*$/m.test(fn.slice(fn.indexOf('select c.id'), fn.indexOf('select c.id') + 300)) && !/per_month/.test(fn.slice(fn.indexOf('select c.id'), fn.indexOf('select c.id') + 300)))
ok('...as the caller', /security invoker/.test(fn.slice(0, 600)))

if (failures.length) { console.error(`check-client-book: ${failures.length} failed, ${pass} passed\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log(`check-client-book: ${pass} passed, 0 failed`)
