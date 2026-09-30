/**
 * A RATE IS A PERCENT, AND THE ARITHMETIC IS WHAT SAYS SO.
 *
 * THE FIRM: "interest should run at 24% always. Sometimes we can possibly change the interest rate."
 *
 * THIS FILE EXISTS BECAUSE I GOT THE UNIT BACKWARDS AND IT CAUGHT ME. `commission_rate` on
 * debtor_accounts is a FRACTION -- CLAUDE.md records the migration that made it one -- so I read
 * `interest_rate_annual` as one too, divided 18 741 correct rates by a hundred, and told the firm
 * in two messages that the imported book was storing percentages by mistake. It was not.
 * `accrueToDate` line 132 divides by a hundred ITSELF:
 *
 *     const monthlyRate = annualRate / 100 / MONTHS_PER_YEAR
 *
 * So `24` is 24% a year -- 2% a month, exactly what interestAccrual.ts derived from the posted
 * history -- and it was right all along. What was actually wrong was 5 000 SEEDED rows holding
 * `0.115`, which the engine reads as a ninth of a percent a year.
 *
 * WHAT FOUND IT WAS RUNNING THE ARITHMETIC, one command after the wrong migration was applied: a
 * full month at "0.24" came to twenty CENTS on a thousand rand rather than twenty rand. A check
 * that read the constraint back out of schema.sql would have passed and agreed with me, because
 * the constraint was wrong in the same direction as the belief that wrote it.
 *
 * SO THE ASSERTIONS HERE ARE MOSTLY SUMS. The column and the constraint are checked too, but they
 * are the half that cannot catch this class of fault.
 *
 * AND THE TABLE HOLDS BOTH UNITS, which is the underlying trap and not going away: commission is a
 * fraction, interest is a percent, on the same row. "Rate" alone never tells you which.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-interest-rate-unit.mjs
 */
import { readFileSync } from 'node:fs'
import { accrueToDate } from '../../src/lib/interestAccrual.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const sql = read('supabase/schema.sql')

/* ---------------- the guard ---------------- */

ok('the rate is guarded as a percent',
  /add constraint debtor_accounts_interest_rate_is_a_percent/.test(sql))
/* THE BAND A FRACTION LANDS IN IS REFUSED -- above nothing and below one percent a year. That is
   the shape of my own mistake, and no creditor charges a quarter of a percent. */
ok('...refusing the band a fraction would land in',
  /or \(interest_rate_annual >= 1 and interest_rate_annual <= 200\)/.test(sql))
/* AND A TYPO AT THE OTHER END. 2400 is 24 with the fraction habit applied twice. */
ok('...and a rate nobody could charge', /<= 200/.test(sql))
/*
 * THE FRACTION CONSTRAINT I ADDED BY MISTAKE IS GONE, not merely superseded: left in place it
 * would refuse every correct rate in the table.
 *
 * ASSERTED AS AN ORDER, NOT A PRESENCE, and the break test is why. The wrong block carries its own
 * `drop constraint if exists` before adding it, so a bare presence test passes with the corrective
 * drop deleted -- satisfied by the very block it is supposed to be undoing. Both exist; what
 * matters is which comes last.
 */
const addedFraction = sql.lastIndexOf('add constraint debtor_accounts_interest_rate_is_a_fraction')
const droppedFraction = sql.lastIndexOf('drop constraint if exists debtor_accounts_interest_rate_is_a_fraction')
ok('the wrong constraint was written at some point', addedFraction > 0)
ok('...and dropped after it was added', droppedFraction > addedFraction)
/* ZERO STAYS LEGAL: "no interest on this account" is a real answer, the same choice
   commission_rate made. */
ok('...while charging nothing is still allowed', /interest_rate_annual = 0/.test(sql))
/*
 * AND COMMISSION IS GUARDED AS THE OTHER UNIT, ON THE SAME TABLE. This is the assertion that names
 * the trap rather than the instance: two rate columns, two units, one row. Holding both here means
 * the next person reads them together.
 */
ok('commission on the same table is guarded as a fraction',
  /add constraint debtor_accounts_commission_rate_is_a_fraction[\s\S]{0,160}?<= 1\)/.test(sql))

/* ---------------- 24%, without anybody typing it ---------------- */

ok('a new account gets the firm’s rate',
  /alter column interest_rate_annual set default 24/.test(sql))
/*
 * AND THE DEFAULT IS THE FIRM'S OWN NUMBER, not a guess. interestAccrual.ts derived it from the
 * imported book before the firm ever said it out loud: "the ratio between consecutive full-month
 * accruals is exactly 1.0200 on 4,845 of them... 24% a year charged as a flat 2% of the running
 * balance each month."
 */
ok('...which is the rate the imported book was already charging',
  /24% a year charged as a flat 2%/.test(read('src/lib/interestAccrual.ts')))

/* ---------------- the correction itself ---------------- */

/*
 * THE WRONG MIGRATION IS STILL IN THE FILE, AND SO IS ITS UNDOING. schema.sql is append-only and
 * the last word wins: replayed from empty it divides every rate by a hundred and then multiplies
 * back, which is a no-op. Asserting BOTH is what says the second half was not forgotten -- a file
 * carrying only the division would rebuild a database charging a quarter of a percent.
 */
ok('the division is recorded', /set interest_rate_annual = interest_rate_annual \/ 100/.test(sql))
ok('...and so is putting it back',
  /set interest_rate_annual = interest_rate_annual \* 100/.test(sql))
const divided = sql.lastIndexOf('interest_rate_annual / 100')
const restored = sql.lastIndexOf('interest_rate_annual * 100')
ok('...after it, so a replay ends on the right number', restored > divided && divided > 0)
/*
 * AND A DELIBERATE RATE SURVIVED BOTH. Two accounts on one client's handover carry 12%, and "we
 * can possibly change the interest rate" is the firm saying that is allowed -- so nothing here may
 * sweep every rate to 24.
 */
ok('no statement sets every rate to the firm’s',
  !/set interest_rate_annual = 24\s*;/.test(sql) && !/set interest_rate_annual = 24\s*\n\s*where true/.test(sql))

/* ---------------- and the arithmetic, which is what actually decides the unit ---------------- */

/*
 * A FULL MONTH AT 24% IS 2% OF THE BALANCE. This is the assertion that found the fault, and it is
 * the figure interestAccrual.ts derived from the posted history: "the ratio between consecutive
 * full-month accruals is exactly 1.0200 on 4,845 of them".
 */
const month = accrueToDate({
  openingBalance: 1000, annualRate: 24, coveredTo: '2026-08-31', asAt: '2026-09-30',
})
ok('a full month at 24 is charged', !!month)
check('...and comes to 2% of the balance', Math.round((month?.amount ?? 0) * 100) / 100, 20)

/*
 * AND 0.24 WOULD HAVE BEEN TWENTY CENTS. Written out because it is the whole of my own mistake in
 * one line: a thousand-rand debt earning twenty cents a month instead of twenty rand, on 18 741
 * accounts, with nothing on any screen looking wrong.
 */
const asFraction = accrueToDate({
  openingBalance: 1000, annualRate: 0.24, coveredTo: '2026-08-31', asAt: '2026-09-30',
})
check('...where 0.24 is a quarter of a percent a year, not 24%',
  Math.round((asFraction?.amount ?? 0) * 100) / 100, 0.2)

/* THE ONE CLIENT'S 12% IS HALF OF IT, so a rate somebody sets deliberately behaves as they expect. */
const twelve = accrueToDate({
  openingBalance: 1000, annualRate: 12, coveredTo: '2026-08-31', asAt: '2026-09-30',
})
check('a deliberate 12% charges half as much', Math.round((twelve?.amount ?? 0) * 100) / 100, 10)

/* AND NOTHING AT ALL IS NOTHING, rather than a crash or a NaN travelling into a balance. */
check('no rate charges nothing',
  accrueToDate({ openingBalance: 1000, annualRate: 0, coveredTo: '2026-08-31', asAt: '2026-09-30' }),
  null)

console.log(`\ncheck-interest-rate-unit: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
