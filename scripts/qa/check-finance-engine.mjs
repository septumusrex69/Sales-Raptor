/**
 * THE ALLOCATION ENGINE, HELD TO THE FIRM'S BOARD.
 *
 * WHY THIS IS SOURCE-READ AND NOT ARITHMETIC. The split lives in `finance_split`, in the database,
 * on purpose: the engine, the dry run on the account page and the payover run all call the one
 * function so they cannot disagree about what a payment did. Re-implementing the sums here to
 * "test" them would create the second opinion the design exists to prevent -- and it is the copy
 * in this file that would go stale. The arithmetic is proved against the firm's five worked cases
 * in the database itself, in a transaction that rolls back; what is held HERE is the set of
 * decisions somebody could quietly reverse while every total still added up.
 *
 * ALL SIX OF THEM FAIL SILENTLY. That is why they are worth a check:
 *
 *   - due_to_bf including the commission VAT bills a client for it twice, once in the set-off and
 *     again on the payover invoice. Every column still reconciles.
 *   - A commission rate of NOUGHT where there is no rate pays the client 100% of capital, and the
 *     arithmetic is perfectly consistent with a firm that agreed to work for nothing.
 *   - `amount_accrued` instead of `amount_recoverable` takes interest the in duplum ceiling put
 *     out of reach (NCA s103(5)) -- and it takes it from the debtor, in half A.
 *   - half A taking the odd cent loses R0,01 of every odd payment between debtor and client.
 *   - The receipt fee counted toward the item 1-7 cap crowds out the letters it is not one of.
 *   - A replay touching an allocation already inside an approved payover run rewrites an issued
 *     tax invoice. The firm's rule about imported history, one table along.
 *
 * `schema.sql` IS APPEND-ONLY, so every read below takes the LAST definition of a function. A
 * check reading the first one asserts against the copy a later migration replaced.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-finance-engine.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')

/**
 * The LAST definition of one function, body and all.
 *
 * CLAUDE.md names the trap this avoids twice over. The file is append-only, so a function a later
 * migration replaced appears in it more than once and the first copy is dead code. And a plain
 * `lastIndexOf(name)` lands on the function's grant, revoke or comment -- one-line statements that
 * slice to nothing and make every assertion below pass vacuously. Matching the whole `create or
 * replace function public.<name>(` is what keeps it on a definition.
 */
function lastFn(name) {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const end = sql.indexOf('$$;', at)
  /* COMMENTS OFF. These functions explain at length what they refuse, and a grep cannot tell the
     explanation from the thing: the line saying interest is `amount_recoverable` and NOT
     `amount_accrued` is what made the assertion against `amount_accrued` fail on correct code. */
  return end < 0 ? '' : sql.slice(at, end)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')
}

const split = lastFn('finance_split')
const commission = lastFn('finance_commission')
const allocate = lastFn('allocate_payment')
const replay = lastFn('reallocate_account')
const reverse = lastFn('reverse_payment_allocation')

/* PRESENCE BEFORE ANYTHING ELSE. An empty string satisfies most negative assertions, so a deleted
   function would otherwise read as a clean pass -- CLAUDE.md's `indexOf` trap in another shape. */
ok('finance_split is in the schema', split.length > 500)
ok('finance_commission is in the schema', commission.length > 500)
ok('allocate_payment is in the schema', allocate.length > 1000)
ok('reallocate_account is in the schema', replay.length > 500)
ok('reverse_payment_allocation is in the schema', reverse.length > 200)

/* ---------------- the split touches nothing, which is what makes it the only copy ---------------- */

/*
 * IMMUTABLE AND TABLE-FREE. Three callers share this function so that a collector's dry run and
 * the payover run cannot disagree; the moment it reads a tariff or a balance of its own it can
 * disagree with the caller that passed one in, and the dry run starts promising something the
 * engine will not do.
 */
ok('the split is immutable', /\nimmutable\n/.test(split))
check('...and reads no table at all', (split.match(/\bfrom public\./g) ?? []), [])

/*
 * HALF B TAKES THE ODD CENT. `half_a + half_b` must be the payment exactly -- rounding both halves
 * loses R0,01 on every odd-cent payment, which is money vanishing between the debtor and the
 * client, and financeHealth's reconciliation rule is what would eventually report it as an
 * unexplained shortfall on somebody's account.
 */
ok('half A is rounded and half B is the remainder',
  /half_a := round\(greatest\(p_payment, 0\) \/ 2, 2\);\s*\n\s*half_b := greatest\(p_payment, 0\) - half_a;/.test(split))

/* THE CENT IS ROUNDED IN NUMERIC, NEVER DOUBLE PRECISION. Postgres rounds numeric half away from
   zero, which is what the firm's board expects: 5.625 -> 5.63. In double precision it is 5.62. */
check('nothing in the split is cast to a float',
  (split.match(/double precision|::float|::real/g) ?? []), [])

/* HALF A IS INTEREST THEN COSTS, HALF B IS CAPITAL, AND WHAT HALF A CANNOT SPEND ROLLS OVER. The
   roll-over is the line that makes a R1 000 payment put R535 against capital rather than R500. */
ok('what half A cannot spend goes to capital', /v_pot := half_b \+ rolled;/.test(split))
/* AND AN OVERPAYMENT IS HELD, NOT PAID OVER: the client is owed capital and this is not capital. */
ok('what is left when everything is settled is an excess', /excess\s*:= v_over;/.test(split))

/* ---------------- commission ---------------- */

/*
 * NO RATE IS NOT A RATE OF NOUGHT, and this is the half of it that lives in the arithmetic. Nought
 * is a rate somebody chose -- a client whose recovery is free. Null is nobody having chosen, and
 * the engine turns it into an exception rather than paying the client 100% of capital.
 */
ok('no rate returns null rather than nought', /if p_rate is null then return null; end if;/.test(commission))
/* MARGINAL, LIKE TAX BRACKETS. The other reading -- one rate for the whole tier once reached --
   changes what was owed on a payment made earlier the same month. */
ok('the bands are read in the order the mandate writes them',
  /jsonb_array_elements\(p_bands\) with ordinality/.test(commission))
/* ROUNDED ONCE AT THE END: the firm's decision 5 is per LINE, and a line is a payment, not a band.
   Rounding inside the loop rounds a payment that crosses a boundary twice. */
ok('...and rounded once, after the last band',
  /return round\(v_total, 2\);\s*\nend/.test(commission))

/* ---------------- the engine ---------------- */

/*
 * OFF UNTIL THE FIRM SWITCHES IT ON. An engine that began splitting across 23 772 accounts the
 * moment it was created is not something anybody could undo before month end.
 */
ok('nothing is allocated before the cut-over is set',
  /if v_cutover is null or v_pay\.created_at < v_cutover then return null; end if;/.test(allocate))
/* DEMO DATA AND REVERSALS ARE NOT PAYMENTS. Neither is an error, so neither raises. */
ok('invented data and reversed money are skipped',
  /if v_pay\.is_demo or v_pay\.reversed_at is not null then return null; end if;/.test(allocate))

/*
 * INTEREST THE IN DUPLUM CEILING PUT OUT OF REACH WAS NEVER OURS TO TAKE. NCA s103(5) is law, not
 * preference: `amount_accrued` is what the interest would have been, `amount_recoverable` is what
 * may actually be recovered, and half A takes the second. The two columns differ only on the
 * accounts where it matters, so the wrong one passes every test that does not have one.
 */
ok('half A takes recoverable interest', /sum\(amount_recoverable\), 0\) into v_interest/.test(allocate))
check('...and never the accrued figure', (allocate.match(/amount_accrued/g) ?? []), [])

/* THE TARIFF IN FORCE ON THE DAY OF THE PAYMENT, never today's -- CLAUDE.md's rule that a fee is
   priced on the schedule in force on the day of the ACTION. */
ok('the receipt fee is priced on the payment’s own date',
  /v_pay\.received_at::date >= effective_from/.test(allocate))
/*
 * AND IT IS OUTSIDE THE ITEM 1-7 CAP. Items 1 to 7 share a cap of min(capital, R1 225); item 9 is
 * not one of them. Counted in, every receipt fee would crowd out the letters the firm still has to
 * send -- and the cap would be reached by collecting, which is backwards.
 */
ok('...and does not eat into the item 1-7 cap',
  /counts_toward_fee_cap[\s\S]{0,400}?s\.fee_excl, v_vat \* 100, s\.fee_vat, false,/.test(allocate))

/*
 * `due_to_bf` EXCLUDES THE COMMISSION VAT. The single most contested line in the spec: prompt 2's
 * prose says to include it, but the firm's own PTC case (1 975.11 + 877.47 = 2 852.58, with the
 * note that the VAT is charged on the payover invoice), prompt 3's formula and the Dr Roux
 * reconciliation all exclude it. Including it bills the client for the same VAT twice, and every
 * column still reconciles while it does.
 */
ok('a client-direct payment sets off fees, interest and commission',
  /v_due_to_bf := s\.to_interest \+ s\.to_costs \+ v_commission;/.test(allocate))
ok('...and leaves the commission VAT for the payover invoice',
  !/v_due_to_bf := [^\n]*v_commission_vat/.test(allocate))

/* NO RATE IS FLAGGED AND HELD, never charged as nought -- the other half of the rule above. */
ok('a missing rate is an exception, not a free recovery',
  /if v_commission is null then\s*\n\s*v_status := 'needs_rate';/.test(allocate))
/*
 * AND THE COLUMN CAN SAY SO. `not null default 0` on commission_rate killed the insert -- and
 * because the allocation is written by an INSERT trigger, it killed the payment with it: a client
 * with no rate on file meant a receipt the cashier could not book.
 */
/* NAMED BY ITS TABLE. `debtor_accounts` carries the identical statement one migration back, so an
   unanchored grep finds that one and reports this rule as held whatever this table says -- which
   is how the break test for it passed on broken code. */
const rateColumn = sql.slice(sql.lastIndexOf('alter table public.payment_allocations\n  alter column commission_rate'))
  .split(';')[0]
ok('the rate column admits "none"',
  /drop not null/.test(rateColumn) && /drop default/.test(rateColumn))

/* ONE ALLOCATION PER PAYMENT, EVER. Two splits of one payment is the same money promised to a
   client twice, and it is found at month end or not at all. */
ok('a payment can only be split once',
  /create unique index if not exists payment_allocations_one_per_payment/.test(sql))

/* ---------------- replay, and what it may not touch ---------------- */

/*
 * AN APPROVED PAYOVER RUN IS AN ISSUED TAX INVOICE. The firm's decision 6, and the same rule as
 * imported history one table along: what has been invoiced stays as invoiced, and a correction is
 * a negative line in the NEXT run. Both the count-back and the delete have to be scoped, or the
 * capital is restored for a row that is never removed and the account gains money out of nowhere.
 */
check('a replay leaves an invoiced allocation alone',
  (replay.match(/a\.payover_run_id is null/g) ?? []).length, 2)

/*
 * AND IT LEAVES THE REVERSED PAYMENT'S CANCELLED FEE ON THE LEDGER. The delete exists so the
 * replay can charge a receipt fee again rather than twice -- and the replay loop skips reversed
 * payments, so a reversed payment's fee is never re-charged. Unscoped, it destroyed the cancelled
 * line the reversal had just written one statement earlier, and the account showed no sign a
 * payment had ever bounced.
 */
/* THE DELETE STATEMENT ALONE, not the rest of the function: the replay LOOP below it is scoped to
   `p.reversed_at is null` too, so a slice running to the end of the function finds that one and
   passes however the delete is written. The break test found this by passing on broken code. */
const feeDelete = replay.slice(replay.indexOf('delete from public.account_fees')).split(';')[0]
ok('...and the cancelled receipt fee of a reversal', /p\.reversed_at is null/.test(feeDelete))
ok('...as its own statement, not the replay loop below it',
  feeDelete.length > 0 && feeDelete.length < 500 && !/for v_payment in/.test(feeDelete))

/* THE CAPITAL GOES BACK BEFORE THE REPLAY. capital_outstanding is decremented as the engine goes,
   so replaying without restoring takes the same capital twice. */
ok('the capital is restored before anything is replayed',
  replay.indexOf('set capital_outstanding = coalesce(capital_outstanding, 0) + v_restored')
    < replay.indexOf('perform public.allocate_payment(v_payment.id)'))
/* IN CAPTURE ORDER, because each allocation depends on the balances the ones before it left. */
ok('...and the payments are replayed in the order they were captured',
  /order by p\.created_at, p\.id/.test(replay))

/* A REVERSAL CANCELS THE FEE WITH A REASON rather than deleting it: it WAS charged, and the
   balance engine already excludes cancelled fees, so the ledger keeps the record for nothing. */
ok('a reversal cancels the receipt fee with a reason',
  /cancel_reason = coalesce\(new\.reversal_reason, 'The payment was reversed'\)/.test(reverse))
/* ...and replays the account, because every payment after it was split against balances it moved. */
ok('...and replays what came after it', /perform public\.reallocate_account\(new\.account_id\)/.test(reverse))

/* ---------------- the switch, and what keeps a settings form off it ---------------- */

/*
 * THE CUT-OVER TRAVELS WITH THE REST OF firm_settings -- selected, mapped and written back, because
 * the five hand-written lists on that row stay in step or a column reads as undefined for ever.
 * Which puts it on a form somebody saves for unrelated reasons, so the DATABASE holds it: a
 * settings tab opened before the engine was switched on would otherwise write back the null it
 * loaded and turn the engine off, and the first sign would be a payover run short by a month.
 */
const guard = lastFn('protect_finance_cutover')
ok('the cut-over is guarded in the database', guard.length > 100)
ok('...and freezes once the engine has split anything',
  /exists \(select 1 from public\.payment_allocations limit 1\)/.test(guard))
/* REVERTS RATHER THAN RAISES, like protect_closed_diary_entries: somebody saving the firm's phone
   number was not asking about the allocation engine and must not be stopped by it. */
ok('...by reverting the change, not refusing the save',
  /new\.finance_cutover_at := old\.finance_cutover_at;/.test(guard))
check('...and it raises nothing', (guard.match(/raise exception/g) ?? []), [])
/* BEFORE, or the row is already written and there is nothing left to revert. */
ok('...before the row is written', /before update on public\.firm_settings/.test(sql))
/* AND THE APP CARRIES IT BOTH WAYS. A column in the select and missing from the update is a field
   the screen reads and silently fails to save -- the failure CLAUDE.md names on this exact row. */
const settingsRow = readFileSync(new URL('../../src/lib/firmSettingsRow.ts', import.meta.url), 'utf8')
const settingsLib = readFileSync(new URL('../../src/lib/firmSettings.ts', import.meta.url), 'utf8')
ok('the app selects the cut-over', /finance_cutover_at, updated_at/.test(settingsRow))
ok('...maps it', /financeCutoverAt: r\.finance_cutover_at/.test(settingsRow))
ok('...and writes it back', /finance_cutover_at: next\.financeCutoverAt/.test(settingsLib))

/* ---------------- what needs a person ---------------- */

/*
 * A VIEW, NOT A TABLE. Every exception is a STATE -- it stops being true the moment somebody sets
 * the rate or refunds the credit. A table needs a second thing to keep it in step, and the day
 * that thing fails the queue is wrong in the direction that says there is nothing to do.
 */
ok('the exception queue is a view', /create or replace view public\.finance_exceptions as/.test(sql))
for (const kind of ['needs_rate', 'excess_credit', 'closed_account']) {
  ok(`...and reports ${kind}`,
    new RegExp(`'${kind}'`).test(sql.slice(sql.lastIndexOf('create or replace view public.finance_exceptions as'))))
}

console.log(`\ncheck-finance-engine: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
