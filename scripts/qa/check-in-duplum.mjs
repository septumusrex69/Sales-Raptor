/**
 * IN DUPLUM IS A RULE, NOT A COLUMN — AND THE SAME RULE ON BOTH SIDES.
 *
 * THE FIRM, looking at RRC00005: "in duplum is still not working here." It was not. R380,00 of
 * capital, R441,91 of interest and fees, a R380,00 ceiling, and nothing capping it.
 *
 * THE CAUSE WAS A COLUMN STANDING IN FOR AN ANSWER. `debtor_accounts.in_duplum` is Swordfish's own
 * "In Duplum" column -- Yes or No, meaning THIS ACCOUNT HAS REACHED THE CEILING -- and both halves
 * of Raptor read it as "this account is SUBJECT to the rule", a different question whose answer is
 * yes on every account. So imported accounts capped and everything Raptor created did not.
 *
 * WHAT THIS FILE GUARDS, and each of the three is worth money:
 *
 *   1. NOTHING CAN ASK FOR IT NOT TO APPLY. No input, no column, no caller. A single
 *      `inDuplum: false` anywhere is an account quietly charged past its ceiling.
 *   2. THE TWO HALVES AGREE. computeBalance draws the account screen and the statement;
 *      open_interest writes `amount_recoverable` and feeds the payment engine. They apply one
 *      ceiling -- the capital HANDED OVER, never twice it, never recalculated as the balance falls.
 *   3. THE READING IS DERIVED AND NEVER CLEARS. in_duplum_reached is the one definition of "has
 *      reached", and the trigger that writes it only ever sets -- Swordfish's own Yes is imported
 *      history and this code may not overrule it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-in-duplum.mjs
 */
import { readFileSync } from 'node:fs'
import { computeBalance } from '../../src/lib/accountBalance.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
const schema = read('supabase/schema.sql')

/*
 * THE LAST DEFINITION IS THE LIVE ONE. schema.sql is append-only, so a function a later migration
 * replaced appears in it twice and `indexOf` reads the superseded copy -- which CLAUDE.md records
 * as having failed a check on correct code once already. The name also appears in that function's
 * grant, revoke and comment, so a bare `lastIndexOf` on the name lands on a one-line statement.
 */
function lastFunction(name) {
  const at = schema.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const end = schema.indexOf('\nend $$;', at)
  const alt = schema.indexOf('\n$fn$;', at)
  const stop = end < 0 ? alt : (alt < 0 ? end : Math.min(end, alt))
  return stop < 0 ? schema.slice(at) : schema.slice(at, stop)
}

/* ---------------------------------------------------------------------------------------------
 * 1. RRC00005, WHICH IS THE ACCOUNT THE FIRM WAS LOOKING AT
 * ------------------------------------------------------------------------------------------- */

/*
 * THE REAL FIGURES, and they are the firm's own screenshot: R380,00 of capital handed over, the
 * Annexure B fees that have been raised on it, and the interest the rate has earned. Non-capital
 * comes to R441,91 against a R380,00 ceiling.
 */
const rrc = {
  capitalHandedOver: 380,
  handoverDate: '2026-09-01',
  ledgers: {
    payments: [],
    /* One line standing for the R437,01 the account carries: R380,00 plus R57,01 of VAT. */
    fees: [{ date: '2026-09-02', description: 'Costs, items 1-7', exclVat: 380, vat: 57.01, billed: true }],
    interest: [{ from: '2026-09-02', days: 30, amount: 4.90 }],
  },
}
const b = computeBalance(rrc)
check('RRC00005 is capped', b.cappedBy, 'in duplum')
/* CAPITAL PLUS THE CEILING, which is the capital again -- "twice the capital" is the same rule
   stated about the balance rather than about the non-capital, and this is the number the firm's
   section 129 was already quoting while the screen said R821,91. */
check('...and the balance stops at R760,00', b.balance, 760)
check('...withholding R61,91', b.withheld, 61.91)
/* NO ROOM LEFT FOR A SETTLEMENT FEE. Item 9 is a fee like any other, so in duplum binds it: once
   non-capital has reached the ceiling the fee for settling is nil, and the debtor pays the ceiling
   and no more. Charged on top it would put the settlement figure above the cap one line after the
   cap was enforced. */
check('...and settling costs the ceiling and no more', b.settlement, 760)
check('...with nothing added for settling', b.settlementFee, 0)

/* AND NOTHING CAN TURN IT OFF. The old shape took `inDuplum`, and a caller passing false is now an
   unknown property rather than an escape hatch -- asserted on the behaviour, because a stray
   property on an object literal is not an error at runtime. */
const tryingToEscape = computeBalance({ ...rrc, inDuplum: false })
check('an input asking for it not to apply changes nothing', tryingToEscape.balance, b.balance)

/* ---------------------------------------------------------------------------------------------
 * 2. AND IT APPLIES WHERE NOBODY ASKED
 * ------------------------------------------------------------------------------------------- */

const uncapped = computeBalance({
  capitalHandedOver: 1000,
  handoverDate: '2024-01-01',
  ledgers: { payments: [], fees: [], interest: [{ from: '2024-02-01', days: 30, amount: 5000 }] },
})
check('R5 000 of interest on R1 000 of capital stops at R1 000', uncapped.balance, 2000)
check('...and says so', uncapped.cappedBy, 'in duplum')

/* THE CEILING IS THE CAPITAL HANDED OVER AND IS NEVER RECALCULATED AS THE BALANCE FALLS. A debtor
   who pays R500 does not thereby lower the ceiling to R500 and find the fees unrecoverable. */
const paid = computeBalance({
  capitalHandedOver: 1000,
  handoverDate: '2024-01-01',
  ledgers: {
    payments: [{ date: '2024-03-01', amount: 500 }],
    fees: [],
    interest: [{ from: '2024-02-01', days: 30, amount: 5000 }],
  },
})
check('a payment does not move the ceiling', paid.balance, 1500)

/* UNDER THE CEILING NOTHING IS WITHHELD, which is the half that stops this being a cap on
   everything. Most of the book is nowhere near it. */
const under = computeBalance({
  capitalHandedOver: 10000,
  handoverDate: '2024-01-01',
  ledgers: { payments: [], fees: [], interest: [{ from: '2024-02-01', days: 30, amount: 200 }] },
})
check('an account under the ceiling is not capped', under.cappedBy, undefined)
check('...and withholds nothing', under.withheld, 0)

/* ---------------------------------------------------------------------------------------------
 * 3. NOTHING IN THE SOURCE ASKS FIRST
 * ------------------------------------------------------------------------------------------- */

const balanceLib = read('src/lib/accountBalance.ts')
/* `inDuplum` survives in prose explaining why it is gone; what must not survive is a read of it. */
ok('computeBalance reads no in-duplum input', !/input\.inDuplum/.test(balanceLib))
ok('...and takes none', !/^\s*inDuplum\??:/m.test(balanceLib))

for (const [what, file] of [
  ['the account screen', 'src/pages/accounts/AccountDetail.tsx'],
  ['the workflow step that quotes a notice', 'api/_lib/workflow/step.ts'],
]) {
  /* A COLON, so the prose and the comments that explain the removal do not count. What is barred
     is passing it, which is what `inDuplum:` looks like at every call site. */
  ok(`${what} passes no in-duplum switch`, !/\binDuplum:/.test(read(file)))
}

/*
 * AND THE SQL ASKS NOBODY EITHER. open_interest is the only live place the database applies the
 * ceiling -- accrue_interest_to delegates to it entirely -- so this one function is the whole of
 * the server half.
 */
const openInterest = lastFunction('open_interest')
ok('open_interest is found in the file at all', openInterest.length > 0)
ok('...and applies the ceiling',
  /v_recoverable := greatest\(0, least\(v_accrued, v_ceiling - v_non_capital\)\)/.test(openInterest))
ok('...at the capital handed over, not at twice it',
  /v_ceiling := greatest\(coalesce\(v_acct\.capital_handed_over, 0\), 0\)/.test(openInterest))
ok('...without asking a column first', !/if v_acct\.in_duplum then/.test(openInterest))
/* BOTH FIGURES SURVIVE. `amount_accrued` is what the debt earned and `amount_recoverable` is what
   may be collected; they diverge on a capped account and the client is owed the honest pair. */
ok('...and still returns what was earned as well as what may be taken',
  /accrued := v_accrued;/.test(openInterest) && /recoverable := v_recoverable;/.test(openInterest))

/* ---------------------------------------------------------------------------------------------
 * 4. THE READING IS DERIVED, AND IT NEVER CLEARS
 * ------------------------------------------------------------------------------------------- */

const reached = lastFunction('in_duplum_reached')
ok('there is one definition of "has reached"', reached.length > 0)
ok('...measured against the capital handed over',
  />= coalesce\(d\.capital_handed_over, 0\)/.test(reached))
/* A CEILING OF NOUGHT IS A DATA PROBLEM, NOT A CAPPED ACCOUNT -- otherwise every broken row wears
   the amber pill and people stop seeing it. */
ok('...and a ceiling of nought reads false rather than true',
  /when coalesce\(d\.capital_handed_over, 0\) <= 0 then false/.test(reached))

/* THE VIEW DERIVES IT INSTEAD OF ECHOING THE COLUMN. The chip it draws says "non-capital has
   reached the capital handed over"; it was drawing Swordfish's answer, which is false on
   everything Raptor created. */
const viewAt = schema.lastIndexOf('create or replace view public.account_money_position as')
const view = schema.slice(viewAt)
ok('the money view derives the reading', /public\.in_duplum_reached\(d\.id\) as in_duplum/.test(view))
ok('...rather than echoing the column', !/coalesce\(d\.in_duplum, false\) as in_duplum/.test(view))

/*
 * AND THE TRIGGER ONLY EVER SETS IT.
 *
 * Imported history is frozen at what was imported: Swordfish said Yes out of a fee history Raptor
 * does not hold, and clearing one of those would be this code overruling the firm's own record of
 * an account a client has already been invoiced on. It is a ratchet on the merits too -- the
 * ceiling is fixed at handover, so a capped account does not leave the cap by being paid.
 */
const mark = lastFunction('mark_in_duplum')
ok('the column is kept by a trigger', mark.length > 0)
ok('...off the same one definition', /public\.in_duplum_reached\(v_account\)/.test(mark))
ok('...setting it true', /set in_duplum = true/.test(mark))
ok('...and never clearing it', !/set in_duplum = false/.test(mark) && !/in_duplum = not /.test(mark))

/* CREATED BEHIND A GUARD, not "drop trigger if exists": DROP hangs through the tooling migrations
   are applied with, which is why the policies in this file are guarded on pg_policies too. */
ok('the triggers are created behind an existence guard',
  /if not exists \(select 1 from pg_trigger where tgname = 'mark_in_duplum_on_fee'/.test(schema)
  && /if not exists \(select 1 from pg_trigger where tgname = 'mark_in_duplum_on_accrual'/.test(schema))
ok('...rather than dropped first', !/drop trigger if exists mark_in_duplum/.test(schema))

/* ---------------------------------------------------------------------------------------------
 * 5. AND NO PLAN CALLS A BOUNDED DEBT HOPELESS
 * ------------------------------------------------------------------------------------------- */

/*
 * 'never' MEANT "a full payment leaves the debt no smaller, so no number of them will", and its own
 * note already said it was only reachable with in duplum off. The debt is bounded on every account
 * now -- it climbs to the ceiling, interest stops, and any payment above its own receipt fee gets
 * there eventually -- so the outcome cannot arise, and a schedule refusing an offer because "the
 * account would never be settled by it" would be a lie a debtor could disprove by paying.
 */
const plan = read('src/lib/repaymentPlan.ts')
ok('the plan has no "never" outcome to reach', !/\|\s*'never'/.test(plan))
ok('...and nothing sets one', !/outcome = 'never'/.test(plan))
ok('...while the fact a collector needs survives', /belowTheInterest = true/.test(plan))
ok('the letter does not refuse an offer as never settling',
  !/never be settled/.test(read('src/lib/repaymentLetter.ts')))

console.log(`\ncheck-in-duplum: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
