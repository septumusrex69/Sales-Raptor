/**
 * INTEREST IS POSTED WHEN A PAYMENT IS TAKEN, AND THE TWO ENGINES AGREE ON THE FIGURE.
 *
 * THE FIRM, LOOKING AT AN ALLOCATED RECEIPT: "there was zero interest captured... I don't even
 * know if the interest is actually running."
 *
 * IT WAS RUNNING NOWHERE AND BEING TAKEN NOWHERE, and those are two faults with one cause. The
 * browser computes the open period and never writes it, which is deliberate -- no job, no cron,
 * nothing to double-charge. But `engine_balances` adds up `account_interest_accruals` and nothing
 * else, so an account whose interest has only ever been COMPUTED handed `finance_split` an interest
 * balance of nought and every cent of every payment went to costs and capital.
 *
 * SO `allocate_payment` POSTS THE OPEN PERIOD FIRST. That makes the arithmetic exist in TWO places
 * -- `accrueToDate` in TypeScript and `accrue_interest_to` in plpgsql -- and there is no way round
 * it, because the split happens in the database and the quotation happens in the browser. Written
 * twice they drift, and the drift is a collector quoting R500 of interest down the telephone while
 * the engine takes R497.
 *
 * WHAT THIS FILE CAN AND CANNOT DO. It cannot run the plpgsql: there is no database here. So it
 * holds the SQL's RULES against the TypeScript's, one by one, and runs the TypeScript to prove each
 * rule is the one being mirrored. The two were also checked against each other on eight real
 * staging accounts when this was built -- including one with a 923-day open period, one with a fee
 * raised inside the period, one with a payment inside it, and one overpaid -- and agreed to the
 * cent on all of them. That comparison needed a database and so lives in the commit rather than
 * here; what lives here is everything that would have to change for it to stop being true.
 *
 * THE LAST DEFINITION IS THE LIVE ONE. schema.sql is append-only, so every read below takes the
 * LAST `create ... function public.<name>(` -- CLAUDE.md's own warning, and the reason a check once
 * failed on correct code.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-interest-posts-at-payment.mjs
 */
import { readFileSync } from 'node:fs'
import { accrueToDate } from '../../src/lib/interestAccrual.ts'
import { computeBalance } from '../../src/lib/accountBalance.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const near = (name, actual, expected) => {
  if (Math.abs(actual - expected) < 0.005) { pass += 1; return }
  failures.push(`${name}\n    expected ${expected.toFixed(2)}\n    got      ${actual.toFixed(2)}`)
}

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const sql = read('supabase/schema.sql')

/*
 * THE LAST DEFINITION OF A FUNCTION, BODY ONLY.
 *
 * Both spellings are looked for, because a function that was dropped and recreated appears as a
 * bare `create function`. Reading the bare NAME instead would land on its own grant, revoke or
 * comment -- one-line statements that contain nothing -- and every assertion below would pass over
 * an empty string.
 */
function lastFn(name) {
  const at = Math.max(
    sql.lastIndexOf(`create or replace function public.${name}(`),
    sql.lastIndexOf(`create function public.${name}(`),
  )
  if (at < 0) return ''
  const end = sql.indexOf('\nend $$;', at)
  const sqlEnd = sql.indexOf('\n$$;', at)
  const stop = end >= 0 && (sqlEnd < 0 || end < sqlEnd) ? end : sqlEnd
  return stop < 0 ? sql.slice(at) : sql.slice(at, stop)
}

/*
 * COMMENTS OFF BEFORE ANY ASSERTION ABOUT THE CODE. Each of these functions explains at length what
 * it calls and why, and a grep cannot tell the explanation from the call -- allocate_payment's own
 * comment names `engine_balances` four lines ABOVE the statement that posts the accrual, which is
 * enough to fail the order assertion below on correct code. It did.
 */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')
/*
 * THE ARITHMETIC IS IN `open_interest` AND THE WRITING IS IN `accrue_interest_to`, and they are
 * separate for a reason this file has to assert rather than assume: `preview_allocation` draws the
 * open period on the approval queue and must not write, so the loop had to become something a
 * `stable` function could call. Everything below about how interest is computed reads the first;
 * everything about what gets written reads the second.
 */
const accrue = strip(lastFn('open_interest'))
const post = strip(lastFn('accrue_interest_to'))
const movements = strip(lastFn('account_movements'))
const allocate = strip(lastFn('allocate_payment'))
const preview = strip(lastFn('preview_allocation'))

/* THE FLOOR, BEFORE ANYTHING IS ASSERTED ABOUT WHAT IS IN THEM. An empty string satisfies every
   `!/.../.test()` below, which is the vacuous pass this whole suite has been caught by before. */
ok('open_interest is in the schema', accrue.length > 2000)
ok('accrue_interest_to is in the schema', post.length > 200)
ok('account_movements is in the schema', movements.length > 500)
ok('allocate_payment is in the schema', allocate.length > 2000)
ok('preview_allocation is in the schema', preview.length > 1500)

/* ---------------- one calculation, two callers ---------------- */

/*
 * THE WHOLE POINT OF THE SPLIT. The queue shows what a payment WOULD do; approving does it. Those
 * are the same arithmetic or they are a contradiction, and a contradiction here is a screen saying
 * R 0,00 while the engine takes R 2 936 -- worse than the silence it replaced, because the firm
 * would act on it.
 */
ok('the writer asks open_interest rather than computing its own',
  /open_interest\(p_account, p_as_at, p_exclude_payment\)/.test(post))
ok('...and the preview asks the same function',
  /open_interest\(p_account, v_day, p_exclude_payment\)/.test(preview))
/* AND NEITHER KEEPS A SECOND COPY OF THE LOOP. This is the assertion that fails the day somebody
   inlines the arithmetic back into one of them "to save a call". */
ok('...and the writer holds no loop of its own', !/while v_cursor <= p_as_at loop/.test(post))
ok('...nor does the preview', !/while v_cursor/.test(preview))

/*
 * THE PREVIEW ADDS THE OPEN PERIOD TO WHAT IS POSTED, and takes the RECOVERABLE half.
 * engine_balances counts amount_recoverable on every posted row, so taking `accrued` here would
 * let a split reach past the in duplum ceiling that the ledger itself respects.
 */
ok('the preview adds the open period to the posted balance',
  /v_interest := b\.interest \+ interest_open/.test(preview))
ok('...taking what may be recovered, not what was earned',
  /interest_open := coalesce\(o\.recoverable, 0\)/.test(preview))
/* AND IT IS WHAT THE SCREEN CALLS "interest on the account", so the retained figure beside it can
   never exceed the figure it came out of. */
ok('...and reports it as the interest before the split',
  /interest_before := v_interest/.test(preview))

/*
 * THE PREVIEW IS TAKEN ON THE PAYMENT'S OWN DAY. Interest to the day the money arrived, and the
 * Annexure B item 9 tariff in force THAT day -- `scheduleFor` takes the action's date, and this
 * used to read `current_date` while allocate_payment read the payment's. A receipt banked before
 * 7 April 2026 was previewed against the R610 cap and charged at R502.
 */
ok('the preview day defaults to today but can be given',
  /v_day date := coalesce\(p_as_at, current_date\)/.test(preview))
ok('...and the item 9 tariff is read on that day, not on today',
  /item = '9' and v_day >= effective_from/.test(preview))
ok('...with no current_date left in the tariff lookup',
  !/item = '9' and current_date >= effective_from/.test(preview))
/* AND THE QUEUE PASSES IT. The firm's day, not the first ten characters of a UTC timestamp. */
const queue = strip(lastFn('payments_awaiting_approval'))
ok('payments_awaiting_approval is in the schema', queue.length > 800)
ok('the queue previews each payment on the day it arrived',
  /preview_allocation\([\s\S]{0,200}at time zone 'Africa\/Johannesburg'\)::date, p\.id\)/.test(queue))
/* AND THE ROW CARRIES WHAT THE INTEREST CAME OUT OF, not only what was taken. A retained figure
   with nothing beside it is a number nobody on the floor can check. */
ok('...and returns the interest either side of the split',
  /pv\.interest_before, pv\.interest_after/.test(queue))
ok('...and how much of it is not yet posted',
  /pv\.interest_open, pv\.interest_open_from/.test(queue))

/* ---------------- the split reads a row, so the row has to be there first ---------------- */

/*
 * PRESENCE BEFORE ORDER. `indexOf` returns -1, so an order-only assertion passes vacuously the
 * moment the thing it orders is deleted -- and here the deleted thing would be the whole fix.
 */
ok('allocate_payment posts the open period', /accrue_interest_to/.test(allocate))
ok('...and still asks engine_balances for the balances', /engine_balances/.test(allocate))
ok('...in that order, or there is nothing for the split to give interest to',
  allocate.indexOf('accrue_interest_to') < allocate.indexOf('engine_balances'))

/*
 * TO THE PAYMENT'S OWN DAY, never to today. A receipt captured on the 29th for money banked on the
 * 12th must not carry seventeen days the debtor's money was already with the firm. `now()` here
 * would be invisible on every payment captured the same day it arrived, which is most of them.
 */
/*
 * THE CALL ITSELF, cut out at its own semicolon rather than matched inside a window of the function.
 * The break test is why: a window of 200 characters after `accrue_interest_to(` reaches the
 * `engine_balances(v_acct.id, p_payment_id)` two statements below, so dropping the exclusion from
 * this call left the assertion passing on the NEXT call's argument.
 */
const accrueCall = (allocate.match(/accrue_interest_to\([^;]*\);/) ?? [''])[0]
ok('...and the call is really there to read', accrueCall.length > 20)
/*
 * THE DAY IS NAMED ONCE AND PASSED THREE TIMES, so the assertion follows the variable rather than
 * the literal. allocate_payment used to compute the payment's day inside the accrue call and again
 * for the tariff; it now sets `v_day` at the top and hands it to accrue_interest_to, to fee_split
 * and to open_interest -- three readers that MUST agree about which day the money arrived, and
 * three places a timezone could have been dropped from.
 *
 * ASSERTED AS A CHAIN: the day comes from the payment's own received_at read in Johannesburg, and
 * the accrual is given that day. Either half alone would pass on code that had lost the other.
 */
const dayLine = (allocate.match(/v_day := [^;]*;/) ?? [''])[0]
ok('the payment’s day is worked out once', dayLine.length > 20)
ok('the period is accrued to the payment’s date',
  /v_pay\.received_at/.test(dayLine) && /\bv_day\b/.test(accrueCall))
/* THE FIRM'S DAY, not the first ten characters of a UTC timestamp -- a payment recorded on the 29th
   is stored as 22:00 on the 28th, and `::date` alone reads it a day early. */
ok('...read in Johannesburg', /at time zone 'Africa\/Johannesburg'\)::date/.test(dayLine))

/*
 * AND THE PAYMENT IS EXCLUDED FROM THE BALANCE IT IS BEING SPLIT AGAINST, exactly as
 * engine_balances has always been. Without it the payment's own day accrues on a balance the
 * payment has already reduced, and a synthetic receipt fee is invented for a payment whose real
 * item 9 row allocate_payment raises a few statements later.
 */
ok('...excluding the payment being allocated', /p_payment_id/.test(accrueCall))
ok('...which is what account_movements takes it for',
  /p_exclude_payment/.test(movements) && /p\.id <> p_exclude_payment/.test(movements))
/* AND THE ITEM 9 FEE RAISED ON IT GOES WITH IT. Left in, the fee for this very payment would be
   part of the base the payment is measured against. */
ok('...together with the fee raised on it',
  /f\.payment_id[\s\S]{0,120}<> p_exclude_payment/.test(movements))

/* ---------------- the clock starts where the browser's does ---------------- */

/*
 * THE HANDOVER IS THE FALLBACK AND THE POSTED HISTORY IS THE ANCHOR. The firm: "normally, interest
 * starts occurring from the date of handover", and of an import, "it should just continue running."
 * Reversing these two would restart an imported account's clock years back and bill the debtor
 * interest the client already charged and already folded into the capital.
 */
ok('the clock picks up from the last posted accrual',
  /max\(accrued_on \+ a\.days\) into v_covered/.test(accrue))
ok('...and falls back to the day BEFORE the handover',
  /v_covered := v_acct\.handover_date - 1/.test(accrue))
ok('...in that order, so a posted accrual wins',
  accrue.indexOf('max(accrued_on + days) into v_covered')
    < accrue.indexOf('v_covered := v_acct.handover_date - 1'))
/*
 * AND THE DAY BEFORE IS NOT A TYPO. `coveredTo` is the last day ALREADY covered, so the first
 * accruing day is the one after it -- which means starting ON the handover takes the day before it.
 * Run here rather than asserted from the source, because a day of 24% on the book's average capital
 * is not nothing and the off-by-one would be silent.
 */
const fromHandover = accrueToDate({
  openingBalance: 10000, annualRate: 24, coveredTo: '2026-08-31', asAt: '2026-09-30',
})
check('a handover on 1 September accrues from 1 September', fromHandover?.from, '2026-09-01')
near('...and a full month is the flat 2%', fromHandover?.amount ?? 0, 200)

/* NEITHER ONE MEANS NOTHING RUNS, in both engines: no day the firm can point at as the day the debt
   became theirs, and inventing one would charge for days nobody can evidence. */
ok('with neither, the SQL accrues nothing', /if v_covered is null then return; end if/.test(accrue))
check('...and neither does the browser', computeBalance({
  capitalHandedOver: 10000, handoverDate: null,
  ledgers: { payments: [], fees: [], interest: [] },
  interestRateAnnual: 24, accrueTo: '2026-09-30',
}).interestAccruing, 0)

/* ---------------- and it stops where the browser stops ---------------- */

/*
 * A RATE OF NOUGHT. The firm: "whether or not they charge the interest is up to them. So we will
 * not ask Raptor to calculate this."
 */
ok('no rate, no accrual in the SQL',
  /if coalesce\(v_acct\.interest_rate_annual, 0\) <= 0 then return; end if/.test(accrue))
check('...nor in the browser', accrueToDate({
  openingBalance: 10000, annualRate: 0, coveredTo: '2026-08-31', asAt: '2026-09-30',
}), null)

/*
 * A WRITTEN-OFF ACCOUNT STOPPED ACCRUING WHEN IT WAS WRITTEN OFF, and the first version of
 * accrue_interest_to did not know it. `computeBalance` returns no open period at all for one, so
 * posting here would write a permanent row the screen says does not exist -- on the one kind of
 * account where the firm has already decided to stop charging.
 */
ok('a written-off account is refused by the SQL',
  /written\.off' then return; end if/.test(accrue))
check('...and accrues nothing in the browser', computeBalance({
  capitalHandedOver: 10000, handoverDate: '2026-01-01',
  ledgers: { payments: [], fees: [], interest: [] },
  interestRateAnnual: 24, accrueTo: '2026-09-30', writtenOffAt: '2026-06-30',
}).interestAccruing, 0)

/*
 * AN OVERPAID ACCOUNT DOES NOT EARN THE DEBTOR INTEREST. The guard is per-day in the SQL because a
 * payment can take the balance under water partway through the period; the browser refuses at the
 * opening balance and again per run.
 */
ok('the SQL only charges while something is owed', /if v_balance > 0 then/.test(accrue))
check('...and the browser refuses an opening balance of nothing', accrueToDate({
  openingBalance: 0, annualRate: 24, coveredTo: '2026-08-31', asAt: '2026-09-30',
}), null)

/* NOTHING RUNS BACKWARDS, in either. A statement reprinted as at a day already covered is a real
   zero and must not come back negative. */
ok('the SQL refuses a date already covered', /if v_from > p_as_at then return; end if/.test(accrue))
check('...and so does the browser', accrueToDate({
  openingBalance: 10000, annualRate: 24, coveredTo: '2026-09-30', asAt: '2026-09-09',
}), null)

/* ---------------- the same arithmetic, said the same way ---------------- */

/*
 * A MONTH AT A TIME, CAPITALISING AT THE BOUNDARY AND NOWHERE ELSE. The posted history compounds
 * monthly and not daily -- interestAccrual.ts derived it: "the ratio between consecutive full-month
 * accruals is exactly 1.0200". The SQL accumulates the month into its own variable and joins it to
 * the balance once, at the close; adding it inside the day loop would compound within the month and
 * every figure would come out high.
 */
ok('the SQL accumulates the month separately', /v_month := v_month \+ v_balance \* v_monthly/.test(accrue))
ok('...and joins it to the balance at the close, outside the day loop',
  /v_balance := v_balance \+ v_month;/.test(accrue))
/* PRO-RATED BY THE DAYS IN THAT CALENDAR MONTH, which is what makes a whole month land on the flat
   monthly figure to the cent whether it has 28 days or 31. */
ok('...pro-rated by the days in that calendar month', /v_monthly \/ v_dim/.test(accrue))
ok('...where the divisor is the month’s own length',
  /v_dim := extract\(day from v_month_end\)/.test(accrue))
/* Two months of it compound: R10 000 at 2% twice is R404, not R400. */
near('two months compound on each other', accrueToDate({
  openingBalance: 10000, annualRate: 24, coveredTo: '2026-08-31', asAt: '2026-10-31',
})?.amount ?? 0, 404)
/* And February is a whole month too -- 28 days over 28. */
near('a short month is still a whole month', accrueToDate({
  openingBalance: 10000, annualRate: 24, coveredTo: '2026-01-31', asAt: '2026-02-28',
})?.amount ?? 0, 200)

/*
 * THE RATE IS A PERCENT IN BOTH. `accrueToDate` divides by a hundred itself, and so must the SQL --
 * the fault that had 18 741 correct rates divided by a hundred and a thousand-rand debt earning
 * twenty cents a month. commission_rate on the same table is a FRACTION; "rate" alone never says
 * which.
 */
ok('the SQL reads the rate as a percent',
  /v_monthly := v_acct\.interest_rate_annual \/ 100\.0 \/ 12\.0/.test(accrue))
near('...as the browser does', accrueToDate({
  openingBalance: 1000, annualRate: 24, coveredTo: '2026-08-31', asAt: '2026-09-30',
})?.amount ?? 0, 20)

/*
 * EVERY FEE AND PAYMENT LANDS ON ITS OWN DAY, in both. This is what made posting from the handover
 * safe at all: sixteen months of open period run on one closing balance would charge interest from
 * day one on a fee raised in month eight and never give back the months after a payment.
 */
ok('the SQL applies movements before the day earns anything',
  /while v_i <= v_n and v_days\[v_i\] <= v_day loop/.test(accrue))
const feeMidway = computeBalance({
  capitalHandedOver: 10000, handoverDate: '2026-09-01',
  ledgers: { payments: [], fees: [{ date: '2026-09-16', exclVat: 3000, vat: 0 }], interest: [] },
  interestRateAnnual: 24, accrueTo: '2026-09-30',
})
/* 15 days on R10 000 and 15 on R13 000: R100 + R130. Folded in from day one it would be R260. */
near('a fee raised on the 16th earns from the 16th', feeMidway.interestAccruing, 230)

/*
 * AND THE BASE IS THE OUTSTANDING BALANCE, NOT THE CAPITAL. The firm: "interest is calculated on
 * the outstanding balance, which includes the handover plus fees plus other interest minus
 * payments." The SQL opens on capital plus posted accruals plus the movements before the anchor;
 * a base of capital alone is a defensible reading and a smaller number on every account in the book.
 */
ok('the SQL opens on capital plus what is already posted',
  /v_balance := greatest\(coalesce\(v_acct\.capital_handed_over, 0\), 0\) \+ v_posted/.test(accrue))
ok('...plus every movement on or before the anchor',
  /m\.on_day <= v_covered/.test(accrue))
ok('...and hands the rest to the period as movements',
  /m\.on_day >= v_from and m\.on_day <= p_as_at/.test(accrue))

/* ---------------- what gets written, and what it means ---------------- */

/*
 * `days` IS SWORDFISH'S EXCLUSIVE OFFSET: accrued_on + days is the LAST day covered, which is how
 * coveredTo reads it back. Written as the inclusive count, the next period would start a day late
 * and one day of every payment's interest would fall through the gap for ever.
 */
ok('the row covers exactly up to the day asked for',
  /days := \(p_as_at - v_from\)/.test(accrue))
ok('...and that is how the period is read back',
  /max\(accrued_on \+ a\.days\)/.test(accrue))

/*
 * IN DUPLUM ON THE WAY IN. `amount_recoverable` is what may be collected, `amount_accrued` is what
 * the debt earned, and both are kept: the client is owed an honest account of what was written off
 * rather than a quietly smaller number. engine_balances takes the recoverable half, which is the
 * half that must not pass the ceiling.
 */
/*
 * AND IT IS NOT ASKED FIRST. This asserted `if v_acct.in_duplum then`, which is the bug: that
 * column is Swordfish's "has this account REACHED the ceiling", false on everything Raptor ever
 * created, so no ceiling engaged on any account the firm opened. THE FIRM, looking at RRC00005:
 * "in duplum is still not working here." The rule binds every debt -- common law on all of them,
 * NCA s103(5) wider on credit agreements -- so there is nothing to ask.
 */
ok('in duplum caps what is recoverable', /v_recoverable := greatest\(0, least\(v_accrued/.test(accrue))
ok('...on every account, with no column asked first', !/if v_acct\.in_duplum then/.test(accrue))
ok('...at the capital handed over, not at twice it',
  /v_ceiling := greatest\(coalesce\(v_acct\.capital_handed_over, 0\), 0\)/.test(accrue))
/*
 * AND INTEREST IS CLIPPED BY WHAT INTEREST HAS ALREADY CLAIMED, NOT BY THE FEES.
 *
 * THIS READ `v_ceiling - v_non_capital` -- the fees plus the posted interest, so the fees filled
 * the ceiling and the accrual took what was left. THE FIRM reversed it: "because interest doesn't
 * charge VAT... it takes interest rather than the Annexure B fees. So the Annexure B fees is pushed
 * out and the interest comes in... interest precedes Annexure B fees in an in duplum scenario."
 *
 * IT COMPOUNDED THE OTHER WAY ROUND. On an account whose fees had reached the ceiling every month
 * posted `amount_recoverable = 0`, and a posted accrual is a financial record -- that interest was
 * gone for good. See check-in-duplum, which holds the whole of the rule.
 */
ok('...never below nothing',
  /greatest\(0, least\(v_accrued, v_ceiling - v_posted_recoverable\)\)/.test(accrue))
/* BOTH FIGURES SURVIVE THE HANDOVER BETWEEN THE TWO FUNCTIONS: open_interest returns them and
   accrue_interest_to writes them into their own columns. Returning only the recoverable half would
   lose what the debt actually earned, which is what the client is owed an account of. */
ok('...while what was earned is still returned in full',
  /accrued := v_accrued;/.test(accrue) && /recoverable := v_recoverable;/.test(accrue))
ok('...and written into its own column',
  /amount_accrued, amount_recoverable/.test(post) && /o\.accrued, o\.recoverable/.test(post))

/*
 * daily_rate IS LEFT AT NOUGHT. The book's convention is a flat MONTHLY rate pro-rated by the days
 * in each calendar month, so there is no one daily rate a period ran at -- and writing the monthly
 * figure into a column called daily_rate is the same unit lie that put 24% into a column read as
 * 2400%. Asserted because "fill in the empty column" is exactly the tidy-up somebody will reach for.
 */
const insert = (post.match(/insert into public\.account_interest_accruals[^;]*;/) ?? [''])[0]
ok('the accrual really is inserted', insert.length > 200)
/* READ OFF THE VALUES ROW, not off a window after the word `daily_rate`. The break test is why: the
   column list and the values are twenty-odd characters apart in the source, so a window big enough
   to be useful reaches past the value and a window small enough to be tight never reaches it. */
ok('...with daily_rate left at nought', /o\.opening_balance, 0,/.test(insert))
ok('...and never a monthly figure in a column called daily', !/v_monthly/.test(insert))

/* ---------------- and none of it is reachable from outside ---------------- */

/*
 * Supabase grants EXECUTE on every new public function to `anon` -- the UNAUTHENTICATED PostgREST
 * role -- and `revoke ... from public` does not touch a role grant. `accrue_interest_to` is
 * `security definer` and WRITES to an append-only ledger, so a stranger who could call it could post
 * interest on any account in the book, with no policy to stop them: a definer function runs as the
 * owner and policies do not apply to it.
 *
 * REVOKED FROM `authenticated` TOO. allocate_payment reaches these through `perform`, which runs as
 * the definer and needs no grant on the caller's role at all.
 */
for (const fn of [
  'accrue_interest_to(uuid, date, uuid)',
  'account_movements(uuid, uuid)',
  'receipt_fee_incl_vat(numeric, date)',
  'allocate_payment(uuid)',
  'engine_balances(uuid, uuid)',
]) {
  const name = fn.slice(0, fn.indexOf('('))
  ok(`${name} is out of reach of anon and authenticated`,
    sql.includes(`revoke execute on function public.${fn} from anon, authenticated;`))
}
/* AND NOTHING IN THE APP ASKS FOR THEM, which is what makes that revoke free rather than a
   breakage. A call added tomorrow fails this and has to be argued for. */
for (const p of ['src/lib/payover.ts', 'src/lib/accountBook.ts']) {
  const code = read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok(`${p} does not call the interest engine directly`,
    !/accrue_interest_to|account_movements|allocate_payment/.test(code))
}

console.log(`\ncheck-interest-posts-at-payment: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
