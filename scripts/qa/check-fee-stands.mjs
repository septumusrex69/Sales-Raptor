/**
 * DOES A CANCELLED FEE STILL COUNT?
 *
 * TWO RULINGS FROM THE FIRM IN ONE BREATH, PULLING OPPOSITE WAYS UNTIL YOU LOOK AT THE DATA.
 *
 *   "I agree when you reverse a payment that the receipt fee is removed."
 *
 *   "For the PTPs, there should be a charge. You should charge that, keep that. If the guy breaks
 *    the promise to pay, he breaks it. If he makes it again, he makes it again. But it's still an
 *    action and a consultation and something that needs to be captured. And we're allowed and
 *    permissible to charge this."
 *
 * THE SECOND IS NOT AN EXCEPTION THE FIRM INVENTED, IT IS ONE THE IMPORT CREATED. 647 of the 846
 * cancelled fees on the book are Promise to Pay rows -- 82% of every PTP row there is -- and their
 * reasons are "Replaced by New PTP", "Failed PTP cancelled to activate Follow Up PTP", "Cancelled
 * due to RTP", "Account written off". Every one of those is the ARRANGEMENT ending, not the charge
 * being withdrawn. Swordfish's whole action log came across into account_fees, so the arrangement's
 * cancellation landed in the fee's cancelled_at column.
 *
 * SO THE RULE HAS THREE CASES AND A NUMBER ON EACH:
 *
 *   not cancelled                       -> owed.
 *   cancelled, imported Promise to Pay  -> STILL OWED. R 8 802,11 across 118 accounts.
 *   cancelled, anything else            -> off the balance. R 51,75 across 67 accounts today,
 *                                          plus every reversal from here on.
 *
 * AND IT IS WRITTEN TWICE, which is the thing this file mostly exists for. The engine reads it in
 * SQL (`fee_stands`, used by `engine_balances`) and the browser reads it in TypeScript
 * (`feeStands`, used by `computeBalance` AND `buildStatement`). Two places that decide what a
 * debtor owes is how one of them ends up charging for something the firm said was free -- and the
 * failure would be a statement and an account page quietly disagreeing by R 13.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-fee-stands.mjs
 */
import { readFileSync } from 'node:fs'
import { feeStands, computeBalance, buildStatement } from '../../src/lib/accountBalance.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

const sql = read('supabase/schema.sql')
const balance = code('src/lib/accountBalance.ts')
const book = code('src/lib/accountBook.ts')
/*
 * THE ASSEMBLY MOVED AND THE GUARANTEE DID NOT.
 *
 * Building computeBalance's input used to happen inside the account page. The accounts list now
 * shows the same five figures -- the firm: "capital, fees, interest, paid, balance" -- and a second
 * copy there would be a second thing to drift, so the assembly lives in balanceInput.ts and both
 * screens call it. Everything this file asserts about what reaches the balance is asserted on that
 * one place now.
 */
const detail = code('src/lib/balanceInput.ts')
const timeline = code('src/lib/accountTimeline.ts')

/* ---------------- the three cases ---------------- */

check('a fee nobody cancelled is owed', feeStands({ cancelledAt: null }), true)
check('...however it was raised', feeStands({ cancelledAt: null, legacyName: 'Phone Call' }), true)
/* THE FIRM'S RULING ON THE REVERSAL. Raptor cancels exactly one kind of fee -- the item 9 receipt
   fee on a reversed payment -- and it carries no legacy name, because Raptor raised it. */
check('a cancelled fee Raptor raised comes off',
  feeStands({ cancelledAt: '2026-09-30', legacyName: null }), false)
/* AND ON THE PROMISE TO PAY. */
check('a cancelled promise to pay still stands',
  feeStands({ cancelledAt: '2024-03-01', legacyName: 'Promise to Pay' }), true)
/* TWO CASINGS ARE ON THE BOOK -- 785 'Promise to Pay' and one 'Promise To Pay'. Matching one and
   not the other is a R 13 difference nobody would ever go looking for. */
check('...whichever way it was capitalised',
  feeStands({ cancelledAt: '2024-03-01', legacyName: 'Promise To Pay' }), true)
check('...and with whatever spacing', feeStands({ cancelledAt: '2024-03-01', legacyName: '  PROMISE TO PAY ' }), true)
/* NARROW. The other 199 cancelled imported rows are calls, SMSs, letters and consultations undone
   with "cancel", "wrong", "." -- a collector unlogging something they entered by mistake. */
for (const name of ['Phone Call', 'SMS', 'Email (Outgoing)', 'Letter', 'Consultation', 'Perusal of Documents']) {
  check(`a cancelled ${name} comes off`, feeStands({ cancelledAt: '2024-03-01', legacyName: name }), false)
}
/* AND IT IS NOT A SUBSTRING MATCH. "Promise to Pay Reminder" is a different action. */
check('a name that merely contains it does not qualify',
  feeStands({ cancelledAt: '2024-03-01', legacyName: 'Promise to Pay reminder' }), false)
/* A LEDGER SOMEBODY SYNTHESISED -- the repayment projection -- gives neither field, and undefined
   has to behave exactly as it did before this rule existed. */
check('a synthesised fee line is owed', feeStands({}), true)

/* ---------------- what it does to a balance ---------------- */

const fee = (over) => ({
  date: '2026-09-01', description: 'x', exclVat: 100, vat: 15, billed: true, ...over,
})
const ledgers = (fees) => ({ payments: [], fees, interest: [] })
const owed = (fees) => computeBalance({
  capitalHandedOver: 1000, ledgers: ledgers(fees), accrueTo: '2026-09-30',
}).balance

check('a live fee is in the balance', owed([fee({})]), 1115)
check('...a cancelled one is not', owed([fee({ cancelledAt: '2026-09-02' })]), 1000)
check('...and a cancelled promise to pay is',
  owed([fee({ cancelledAt: '2026-09-02', legacyName: 'Promise to Pay' })]), 1115)

/*
 * AND THE STATEMENT AGREES WITH THE BALANCE, which is the one thing a statement may never fail to
 * do: its lines have to add up to the figure at its foot. Both read splitFeeLedger, so this is
 * really an assertion that nobody has given one of them a second opinion.
 */
/* WITH A HANDOVER DATE, so there is always an opening line. Without one a statement of nothing but
   a cancelled fee has NO lines, and `lines[lines.length - 1]` throws a TypeError two lines below
   the assertion that should have reported the problem -- which is the exact trap CLAUDE.md records.
   The date is also what puts the opening line first. */
const statementOf = (fees) => buildStatement({
  capitalHandedOver: 1000, handoverDate: '2026-08-01',
  ledgers: ledgers(fees), accrueTo: '2026-09-30',
})
for (const [name, fees] of [
  ['a live fee', [fee({})]],
  ['a cancelled fee', [fee({ cancelledAt: '2026-09-02' })]],
  ['a cancelled promise to pay', [fee({ cancelledAt: '2026-09-02', legacyName: 'Promise to Pay' })]],
]) {
  const st = statementOf(fees)
  /* READ DEFENSIVELY: an empty statement must be REPORTED here, not thrown two lines down. */
  ok(`the statement has lines, with ${name}`, st.lines.length > 0)
  const last = st.lines.length > 0 ? st.lines[st.lines.length - 1] : null
  check(`the statement's last balance matches the account's, with ${name}`,
    last ? last.balance : null, owed(fees))
}
/* AND THE LINE ITSELF IS GONE, not merely worth nothing: a statement carrying a cancelled fee as a
   zero line is a statement a debtor asks about. */
check('a cancelled fee is not a line on the statement',
  statementOf([fee({ cancelledAt: '2026-09-02', description: 'Perusal' })]).lines
    .filter((l) => l.kind === 'fee').length, 0)
check('...and a cancelled promise to pay still is',
  statementOf([fee({ cancelledAt: '2026-09-02', legacyName: 'Promise to Pay' })]).lines
    .filter((l) => l.kind === 'fee').length, 1)

/*
 * THE HALF THAT WOULD HAVE PUT THE FEE STRAIGHT BACK ON. A receipt fee cancelled by a reversal
 * drops out of the total -- and `covered` is what stops receiptFeeOn computing the very same fee
 * off the payment again. Built from the LIVE rows it would no longer cover that payment, so the
 * reversal would take the fee off and add it back in the next line, and each half would look right
 * on its own. So `covered` is built from every item 9 row, cancelled ones included.
 */
ok('the covered set is built from every item 9 row, not the live ones',
  /const covered = new Set\(\s*ledgers\.fees\.filter\(\(f\) => f\.annexureItem === '9'\)/.test(balance))

/* ---------------- one filter, where both readers see it ---------------- */

ok('there is one place the ledger is filtered',
  /const live = ledgers\.fees\.filter\(feeStands\)/.test(balance))
/* IN splitFeeLedger, which computeBalance and buildStatement both call. Filtered in one of them
   only, the statement and the account page disagree and neither looks wrong. */
const split = balance.slice(balance.indexOf('function splitFeeLedger('), balance.indexOf('export function computeBalance('))
ok('...inside the split both readers go through', /ledgers\.fees\.filter\(feeStands\)/.test(split))
/* AND THE WRITTEN-OFF FIGURE READS THE SAME LEDGER DIRECTLY, so it needs the filter by hand or it
   explains the balance with fees the balance has already dropped. */
ok('...and the withheld figure applies it too',
  /ledgers\.fees\.filter\(\(f\) => feeStands\(f\) && !within\(f\.date\)\)/.test(balance))

/* ---------------- the column has to reach the rule ---------------- */

/*
 * CLAUDE.md's OWN WARNING, AND THE EXACT SHAPE OF IT. A column in the table, the type and the
 * select but missing from the hand-written mapper reads as undefined for ever and nothing fails.
 * Here that is `legacyName` undefined on every fee, which makes every cancelled promise to pay
 * come off -- R 8 802,11 across 118 accounts, silently.
 */
/*
 * NOT ANCHORED TO THE END OF THE SELECT, and this file made the same mistake it fixed next door.
 * It read `payment_id,legacy_name'` -- with the closing quote -- so adding `source` after it failed
 * an assertion about legacy_name. check-receipt-fee-once had the identical fault one column
 * earlier, and repeating it the same afternoon is the argument for never writing the quote.
 * What matters is that the column is asked for, not where it sits.
 */
ok('the select asks for the legacy name', /select\('id,incurred_at[^']*legacy_name/.test(book))
ok('...the mapper carries it', /legacyName: r\.legacy_name \?\? null,/.test(book))
ok('...and the cancellation with it', /cancelledAt: r\.cancelled_at,/.test(book))
/* AND THE ACCOUNT HANDS BOTH TO THE BALANCE. The ledger computeBalance reads is assembled here by
   hand, so a field the mapper carries and this does not is the same bug one step later. */
ok('the account hands the cancellation to the balance', /cancelledAt: f\.cancelledAt,/.test(detail))
ok('...and the legacy name', /legacyName: f\.legacyName,/.test(detail))

/* ---------------- and the words on the timeline match the arithmetic ---------------- */

/*
 * IT USED TO SAY "the fee stands" OF EVERY CANCELLED FEE. True of a promise to pay, false of a
 * receipt fee on a reversed payment -- which is the one the firm agreed comes off. One sentence
 * for both tells a collector the debtor owes a fee that has just left their balance.
 */
ok('the timeline asks the same function', /feeStands\(f\)/.test(timeline))
ok('...and no longer says one thing for both',
  !/Cancelled\. The fee stands — it attaches to the action being issued\./.test(timeline))

/* ---------------- written twice, so held together ---------------- */

/* schema.sql is append-only: the LAST definition is the live one. */
const at = sql.lastIndexOf('create or replace function public.fee_stands(')
ok('the database has the rule too', at > 0)
const fn = at > 0 ? sql.slice(at, sql.indexOf('$$;', at)) : ''
ok('...a fee nobody cancelled is owed', /p_cancelled_at is null/.test(fn))
ok('...a promise to pay survives cancellation',
  /lower\(btrim\(coalesce\(p_legacy_name, ''\)\)\) = 'promise to pay'/.test(fn))
/* FOLDED, NOT ilike WITH WILDCARDS: `ilike '%promise to pay%'` would catch a "Promise to Pay
   reminder" that the TypeScript side refuses, and the two would disagree on a row nobody looks at. */
ok('...matched exactly rather than by substring', !/ilike '%promise to pay%'/.test(fn))
/* AND THE ENGINE ASKS IT rather than repeating `cancelled_at is null`, which is what it did and
   which is what was taking the PTP charges off. */
/*
 * THE THREE-ARGUMENT DEFINITION, which is the one with the body in it. `engine_balances` is live
 * in two arities -- it gained an argument for interest about to be posted, and the old shape was
 * kept as a thin wrapper passing nought rather than a second copy of the gathering. The wrapper is
 * appended AFTER the body, so `lastIndexOf` landed on three lines of delegation and the assertion
 * below passed vacuously. CLAUDE.md's append-only rule still holds; it just needs the arity.
 */
const engMark = 'create or replace function public.engine_balances(\n  p_account uuid, p_exclude_payment uuid, p_interest_pending numeric)'
const engAt = sql.lastIndexOf(engMark)
ok('the engine exists', engAt > 0)
const eng = engAt > 0 ? sql.slice(engAt, sql.indexOf('$$;', engAt)) : ''
ok('...and asks fee_stands', /public\.fee_stands\(f\.cancelled_at, f\.legacy_name\)/.test(eng))
ok('...rather than deciding for itself', !/f\.cancelled_at is null/.test(eng))
/* IMMUTABLE, so it can be used in an index or a generated column later without a surprise, and
   search_path pinned like everything else here. */
ok('...and the rule is immutable with its search path pinned',
  /immutable\s*\n\s*set search_path to 'public'/.test(sql.slice(at, at + 400)))

console.log(`\ncheck-fee-stands: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
