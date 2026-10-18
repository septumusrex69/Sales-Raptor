/**
 * EACH CLIENT'S HANDOVER RHYTHM, AND A TYPICAL MONTH (S8, 18 Oct; the firm chose "3 then 1").
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-client-rhythm.mjs
 */
import { readFileSync } from 'node:fs'
import { rhythm, rhythmWords, typicalMonth } from '../../src/lib/clientRhythm.ts'

let pass = 0
const failures = []
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }
const check = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want))
const d = (...days) => days.map((day) => ({ day, accounts: 1 }))

/* The 25th, every month. */
const monthly = d('2026-05-25', '2026-06-25', '2026-07-24', '2026-08-25', '2026-09-25')
const onTime = rhythm(monthly, '2026-10-20')
check('a monthly client: the gap and the day', [onTime.everyDays, onTime.aroundDay], [31, 25])
check('...said in words', rhythmWords(onTime), 'about once a month, usually around the 25th')
check('...expected the 26th of October, not late on the 20th', [onTime.expected, onTime.state], ['2026-10-26', 'on_pattern'])
check('...not late inside the week\'s grace', rhythm(monthly, '2026-11-02').state, 'on_pattern')
const late = rhythm(monthly, '2026-11-05')
check('...late past it, and how late', [late.state, late.daysLate], ['late', 10])
check('fewer than three handover days is no pattern', rhythm(d('2026-05-25', '2026-06-25'), '2026-12-01').state, 'no_pattern')
check('one odd gap does not move the rhythm: the median, not the mean (45)', rhythm(d('2026-01-25', '2026-02-25', '2026-03-25', '2026-06-25', '2026-07-25'), '2026-07-30').everyDays, 31)
check('days of the month all over: only the gap is said', rhythm(d('2026-05-02', '2026-06-20', '2026-07-08', '2026-08-28'), '2026-09-01').aroundDay, null)
check('two batches on one day are one handover day', rhythm([...monthly, { day: '2026-09-25', accounts: 4 }], '2026-10-20').days, 5)

/* A typical month: average accounts per day of the month, over the span. */
const tm = typicalMonth([{ day: '2026-08-31', accounts: 4 }, { day: '2026-07-31', accounts: 2 }, { day: '2026-08-15', accounts: 3, newAccounts: 3 }], '2026-07-01', '2026-08-31', 'existing')
check('the 31st averaged over the months that have one', tm.find((x) => x.dom === 31)?.average, 3)
check('...new clients\' accounts left out of the existing view', tm.find((x) => x.dom === 15)?.average, 0)
check('...thirty-one days, always', tm.length, 31)

const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const fn = sql.slice(sql.lastIndexOf('create or replace function public.client_handover_days('))
ok('the days roll sub-accounts into their client', /coalesce\(c\.parent_company_id, c\.id\)/.test(fn.slice(0, 900)) && /security invoker/.test(fn.slice(0, 300)))

if (failures.length) { console.error(`check-client-rhythm: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`); process.exit(1) }
console.log(`check-client-rhythm: ${pass} passed, 0 failed`)
