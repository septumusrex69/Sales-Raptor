/**
 * A DATE IS THE FIRM'S DAY, NOT A UTC STRING'S FIRST TEN CHARACTERS.
 *
 * THE FIRM: "this is funny, I'm recording a payment on like 29th of September and it loads it on
 * the 28th."
 *
 * THE STORAGE WAS RIGHT AND EVERY READER WAS WRONG. `record_manual_payment` writes midnight
 * Johannesburg, so a payment dated 29 September is stored as `2026-09-28 22:00:00+00` -- which IS
 * 29 September here. Then the account page took `.slice(0, 10)` of that string and got the UTC
 * day, which for the two hours SAST runs ahead is YESTERDAY. Not occasionally: midnight local is
 * always 22:00 the previous day, so every hand-captured payment read a day early, on the
 * statement, in the balance's date arithmetic and on the summary letter.
 *
 * I GOT THIS WRONG ONCE ALREADY. Looking at the same account earlier I read those 28 September
 * payments as back-dated test capture and built a guard against a payment predating its handover
 * on the strength of it. The guard is still right -- the firm has nothing to receive before the
 * client hands the account over -- but the reason the statement looked out of order was this.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-firm-day.mjs
 */
import { readFileSync } from 'node:fs'
import { firmDay, firmToday } from '../../src/lib/dateLabels.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

/* ---------------- the day itself ---------------- */

/*
 * THE FIRM'S OWN CASE, to the hour. Midnight on the 29th in Johannesburg is 22:00 on the 28th in
 * UTC, and the first ten characters of that say the 28th.
 */
const midnight = '2026-09-28T22:00:00+00:00'
check('midnight in Johannesburg is that day, not the one before', firmDay(midnight), '2026-09-29')
check('...which is exactly what slicing the string got wrong', midnight.slice(0, 10), '2026-09-28')

/* THE LAST SECOND OF THE DAY IS STILL THAT DAY. 21:59:59 UTC is 23:59:59 local on the 28th --
   which is where the receipt fee was landing when it was dated a second before its payment. */
check('the last second before midnight is the previous day', firmDay('2026-09-28T21:59:59+00:00'), '2026-09-28')
/* AND AN ORDINARY DAYTIME INSTANT IS UNCHANGED, or the fix would be moving everything. */
check('a daytime instant is the same day either way', firmDay('2026-09-29T09:15:00+00:00'), '2026-09-29')
/* THE OTHER EDGE: late evening UTC is already tomorrow here. */
check('ten at night UTC is tomorrow in Johannesburg', firmDay('2026-09-29T22:30:00+00:00'), '2026-09-30')

/* NOT THE BROWSER'S ZONE. An iPad in the office is SAST and a laptop in London is not, and a
   ledger that reads differently on the aeroplane is not a ledger. */
check('read in Johannesburg wherever the reader is sitting',
  firmDay(new Date('2026-09-28T22:00:00Z').toISOString()), '2026-09-29')
/* A BAD STRING IS NOT A CRASH. It is a date on a statement; falling back to what was there before
   is better than a page that will not draw. */
check('a string that is not a date falls back rather than throwing', firmDay('not a date'), 'not a date')

/* TODAY, ON THE SAME CALENDAR. Between midnight and two in the morning local, toISOString still
   says yesterday -- which would quote interest a day short. */
check('today is the firm’s today', firmToday(new Date('2026-09-29T22:30:00Z')), '2026-09-30')
check('...and not UTC’s', new Date('2026-09-29T22:30:00Z').toISOString().slice(0, 10), '2026-09-29')

/* ---------------- and the ledger is read through it ---------------- */

/*
 * THE ASSEMBLY MOVED AND THE GUARANTEE DID NOT.
 *
 * Building computeBalance's input used to happen inside the account page. The accounts list now
 * shows the same five figures -- the firm: "capital, fees, interest, paid, balance" -- and a second
 * copy there would be a second thing to drift, so the assembly lives in balanceInput.ts and both
 * screens call it. Everything this file asserts about what reaches the balance is asserted on that
 * one place now.
 */
const detail = read('src/lib/balanceInput.ts')
ok('a payment’s date is the firm’s day', /date: firmDay\(p\.receivedAt\)/.test(detail))
ok('...and a fee’s is too', /date: firmDay\(f\.incurredAt\)/.test(detail))
/* THE ASSERTION THAT THE OLD WAY IS GONE, not merely that the new one is present. */
ok('...with no UTC slicing left on the ledger',
  !/receivedAt\.slice\(0, 10\)/.test(detail) && !/incurredAt\.slice\(0, 10\)/.test(detail))
/* INTEREST RUNS TO THE FIRM'S TODAY, or a settlement quoted at one in the morning is a day short. */
/*
 * THE DAY IS CHOSEN BY THE SCREEN AND USED BY THE ASSEMBLY, which is the split that lets the
 * accounts list compute the same balance: balanceInput.ts has no clock of its own -- a pure
 * function that asked `new Date()` could not be checked, and the server's day is not the firm's.
 */
const page = read('src/pages/accounts/AccountDetail.tsx')
ok('interest accrues to the firm’s today', /today: firmToday\(\)/.test(page))
ok('...and the assembly uses the day it is handed', /accrueTo: input\.today/.test(detail))
ok('...rather than reading a clock of its own', !/new Date\(\)/.test(detail))
ok('...and the statement is struck on it', /asAt=\{firmToday\(\)\}/.test(page))
/* AND THE LIST STRIKES ITS OWN ROWS ON THE SAME DAY, or the book and the account would quote
   interest to two different dates. */
ok('...and so is every row of the book',
  /today: firmToday\(\)/.test(read('src/pages/accounts/AccountsList.tsx')))

/* ---------------- and the receipt fee is not dated a second early ---------------- */

/*
 * schema.sql is append-only: the LAST definition is the live one. A second before midnight local
 * is the previous day, so the fee landed on the wrong date on every payment typed in by hand.
 * Nothing ordered on that second: engine_balances excludes the fee by payment_id, and the
 * statement orders a payment above its own receipt fee by KIND.
 */
const sql = read('supabase/schema.sql')
const at = Math.max(
  sql.lastIndexOf('create or replace function public.allocate_payment('),
  sql.lastIndexOf('create function public.allocate_payment('),
)
ok('allocate_payment is in the schema', at > 0)
const engine = at > 0 ? sql.slice(at, sql.indexOf('$$;', at) + 3) : ''
ok('...and the receipt fee shares its payment’s instant',
  /v_pay\.received_at, 'raptor', p_payment_id/.test(engine))
ok('...rather than a second before it', !/received_at - interval '1 second'/.test(engine))

console.log(`\ncheck-firm-day: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
