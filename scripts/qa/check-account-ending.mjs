/**
 * THE THREE WAYS AN ACCOUNT ENDS.
 *
 * THE FIRM, ASKED WHAT WAS MISSING: *"Do we have an option to make accounts paid up? Write accounts
 * off? Freeze accounts? Or withdraw accounts?"* Freezing existed; the other three did not, so an
 * account could be stopped but never finished.
 *
 * WHAT THIS GUARDS, AND WHY EACH IS HERE RATHER THAN TRUSTED:
 *
 * 1. THE WITHDRAWAL CHARGE NEVER TOUCHES THE DEBTOR'S LEDGER. The single most expensive mistake
 *    available here: a withdrawal fee written into account_fees is a charge the DEBTOR never
 *    incurred, on a file the client has taken back, and it would ride in duplum and the Annexure B
 *    cap with it. The firm invoices its CLIENT; the tariff is between the firm and the debtor.
 *
 * 2. INTEREST CARRIES NO VAT AND FEES AND COMMISSION DO. Interest is the cost of money, not a
 *    service the firm rendered. Getting this wrong overcharges a client by 15% of the interest on
 *    every withdrawal and is invisible on the screen.
 *
 * 3. THE PREVIEW AND THE CHARGE AGREE. The browser works the total out so the figure moves as the
 *    boxes do, and the database works it out again when it raises the charge. Two arithmetics over
 *    one number: the person ticks boxes against one figure and the client is invoiced another.
 *
 * 4. A TYPED AMOUNT REPLACES THE BOXES ENTIRELY, in both. Mixed, the number would mean something
 *    different depending on what happened to be ticked when it was typed.
 *
 * 5. THE MANDATE IS THE FIRM'S. The firm corrected an earlier note that said the opposite, so the
 *    assertion is that `settle_account` asks nobody's permission -- and that the liaison is TOLD.
 *
 * 6. AN ACCOUNT ENDS ONCE.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-account-ending.mjs
 */
import { readFileSync } from 'node:fs'
import {
  SMALL_RESIDUE, WITHDRAWAL_PRESETS, WRITE_OFF_REASONS, endingAdvice, withdrawalTotal,
} from '../../src/lib/accountEnding.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const no = (name, actual) => check(name, actual, false)

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const sql = read('supabase/schema.sql')

function liveBody(name) {
  /* schema.sql is append-only, so the LAST definition is the live one -- and the opening paren is
     part of the search because the bare name also appears in its grant, revoke and comment lines. */
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return null
  const opens = sql.indexOf('as $$', at)
  const ends = sql.indexOf('$$;', opens)
  return opens < 0 || ends < 0 ? null : sql.slice(opens, ends)
}

/* ------------------- 1. the charge is the client's, not the debtor's ------------------- */

const withdraw = liveBody('withdraw_account')
ok('withdraw_account is in schema.sql', !!withdraw)
ok('it raises a CLIENT charge', /raise_client_charge\(/.test(withdraw ?? ''))
/*
 * AND NEVER AN ACCOUNT FEE. Asserted as an absence, which is the only way to say "this must not
 * happen": there is no positive signal for a line that was never written.
 */
no('...and never writes an account fee', /insert into public\.account_fees/.test(withdraw ?? ''))
ok('...marked as a withdrawal', /p_kind => 'withdrawal'/.test(withdraw ?? ''))
/* OFF THE PAYOVER, not invoiced: the client has a credit to take it from, and the firm's own
   example sets it off against the next run. */
ok('...and set off against the next payover', /p_settlement => 'set_off'/.test(withdraw ?? ''))

/* ------------------------- 2. interest carries no VAT ------------------------- */

/*
 * IN THE DATABASE: fees and commission are added to BOTH the total and the vatable base; interest
 * is added to the total ONLY. Read as three separate lines because that is the whole rule.
 */
ok('fees are vatable', /if p_fees then v_excl := v_excl \+ v_b\.fees; v_vatable := v_vatable \+ v_b\.fees; end if;/.test(withdraw ?? ''))
ok('commission is vatable', /if p_commission then v_excl := v_excl \+ v_b\.commission; v_vatable := v_vatable \+ v_b\.commission; end if;/.test(withdraw ?? ''))
ok('interest is NOT', /if p_interest then v_excl := v_excl \+ v_b\.interest; end if;/.test(withdraw ?? ''))
no('...and interest never reaches the vatable base',
  /p_interest then[\s\S]{0,80}v_vatable/.test(withdraw ?? ''))

/* AND IN THE BROWSER, by arithmetic rather than by reading the source. */
const basis = { fees: 200, interest: 100, commission: 300, vatRate: 0.15, capital: 1000, commissionRate: 0.3 }
check('all three: VAT is on fees and commission only',
  withdrawalTotal(basis, { fees: true, interest: true, commission: true }),
  { excl: 600, vat: 75, incl: 675 })
check('interest alone carries no VAT at all',
  withdrawalTotal(basis, { fees: false, interest: true, commission: false }),
  { excl: 100, vat: 0, incl: 100 })
check('fees alone', withdrawalTotal(basis, { fees: true, interest: false, commission: false }),
  { excl: 200, vat: 30, incl: 230 })
check('nothing ticked charges nothing',
  withdrawalTotal(basis, { fees: false, interest: false, commission: false }),
  { excl: 0, vat: 0, incl: 0 })

/* ------------------- 3 & 4. the preview and the charge agree ------------------- */

/*
 * THE SAME SUM, WORKED BOTH WAYS. The browser's withdrawalTotal and the database's withdraw_account
 * each compute the charge; this asserts they land on the same figure for each of the firm's two
 * presets, so somebody cannot tick boxes against one number and have the client invoiced another.
 *
 * The database's arithmetic is read out of its own source rather than re-implemented here, which
 * would only prove this file agrees with itself.
 */
for (const preset of WITHDRAWAL_PRESETS) {
  const t = withdrawalTotal(basis, preset.charge)
  const expectedExcl = (preset.charge.fees ? basis.fees : 0)
    + (preset.charge.interest ? basis.interest : 0)
    + (preset.charge.commission ? basis.commission : 0)
  const expectedVat = Math.round((((preset.charge.fees ? basis.fees : 0)
    + (preset.charge.commission ? basis.commission : 0)) * basis.vatRate) * 100) / 100
  check(`preset "${preset.id}" totals`, { excl: t.excl, vat: t.vat }, { excl: expectedExcl, vat: expectedVat })
}

/* A TYPED AMOUNT IS THE WHOLE CHARGE, in both halves. */
check('a typed amount ignores the boxes',
  withdrawalTotal(basis, { fees: true, interest: true, commission: true, amount: 250 }),
  { excl: 250, vat: 37.5, incl: 287.5 })
ok('and the database does the same', /if p_amount is not null then[\s\S]{0,400}v_excl := round\(p_amount, 2\);[\s\S]{0,120}v_vatable := v_excl;/.test(withdraw ?? ''))
no('...refusing a negative one', !/A withdrawal charge cannot be negative/.test(withdraw ?? ''))

/* A ZERO CHARGE RAISES NOTHING -- "charge them nothing" is one of the firm's own options, and an
   invoice line for R0.00 is a document somebody has to explain. */
ok('nothing charged raises no invoice', /if v_excl > 0 then[\s\S]{0,200}raise_client_charge/.test(withdraw ?? ''))

/* THE FIRM'S TWO CASES ARE BOTH OFFERED, and they differ in exactly the way the firm described:
   an arrangement takes the commission, a bad handover does not. */
const byId = Object.fromEntries(WITHDRAWAL_PRESETS.map((p) => [p.id, p.charge]))
check('an arrangement charges all three', byId.arrangement,
  { fees: true, interest: true, commission: true })
check('a bad handover charges fees only', byId.not_handed_over,
  { fees: true, interest: false, commission: false })
check('and nothing is an option', byId.nothing,
  { fees: false, interest: false, commission: false })

/* ------------------------- 5. the mandate is the firm's ------------------------- */

const settle = liveBody('settle_account')
ok('settle_account is in schema.sql', !!settle)
/*
 * NOTHING WAITS ON THE CLIENT. The firm: "we hold the mandate to be able to cancel any debt or a
 * part thereof." Asserted as an absence of any client-permission gate, and as the presence of the
 * thing that replaced it: the liaison is TOLD.
 */
no('it asks no client permission', /client_action_ask|consent_status|awaiting_client/.test(settle ?? ''))
/* THE OPENING PAREN IS PART OF THE PATTERN. Without it `public.tasks` matches `public.tasks_x`
 * as a prefix, and a break test that renamed the table away passed. */
ok('a write-off raises the liaison a task', /insert into public\.tasks \(/.test(settle ?? ''))
ok('...owned by the client liaison', /p\.name = c\.liaison/.test(settle ?? ''))
/* AND A PAID-UP ACCOUNT RAISES NOTHING: nobody needs telling a debt was paid, and a task for every
   settled account would bury the write-offs among them. */
ok('...and only for a write-off', /if p_as = 'written_off' then[\s\S]{0,600}insert into public\.tasks \(/.test(settle ?? ''))

/* TWO DIFFERENT TICKS. Writing off is the Administrator's; marking one paid up is the floor's. */
ok('writing off asks the trust capability', /written_off' and not public\.has_capability\('finance\.view'\)/.test(settle ?? ''))
ok('paid up asks who may record a payment', /paid_up' and not public\.may_record_payment\(\)/.test(settle ?? ''))

/* ------------------------- 6. an account ends once ------------------------- */

for (const [name, body] of [['withdraw_account', withdraw], ['settle_account', settle]]) {
  ok(`${name} refuses an account already closed`,
    /if v_a\.ended_as is not null then[\s\S]{0,200}raise exception/.test(body ?? ''))
}
ok('and the column is a closed list',
  /ended_as in \('paid_up', 'written_off', 'withdrawn'\)/.test(sql))

/* ------------------------- the ending reaches the app ------------------------- */

/*
 * THE HAND-WRITTEN MAPPER IS WHERE COLUMNS GO TO DIE. CLAUDE.md: a field present in the database,
 * in the type and in the select, and missing from toAccount, reads as undefined for ever and
 * nothing fails -- diary_capacity sat in that state for months. So all four are asserted.
 */
const book = read('src/lib/accountBook.ts')
for (const [col, field] of [
  ['ended_as', 'endedAs'], ['ended_on', 'endedOn'],
  ['ended_reason', 'endedReason'], ['ended_note', 'endedNote'],
]) {
  ok(`${field} is in the interface`, new RegExp(`\\n  ${field}[?]?:`).test(book))
  ok(`...and in the mapper, reading ${col}`, new RegExp(`${field}: \\(?r\\.${col}`).test(book))
}

/* AND IT MAKES THE ACCOUNT CLOSED. clientPosition's `closed` input beats every other rung, which
   is what stops a withdrawn account still being reported as Paying. */
const status = read('src/lib/accountStatus.ts')
ok('accountEnded reads the real column', /account\.endedAs/.test(status))
/* BOTH ROUTES. An account written off in Swordfish before the import has only the string; one
   Raptor closed has the column. Reading either alone misses half the book. */
ok('...and still the imported status', /isWrittenOff\(account\.status\)/.test(status))

/* ------------------------- the wording, which is not a gate ------------------------- */

/*
 * R50 IS WHERE THE FIRM STOPS CHASING, confirmed as WORDING ONLY. It changes what the screen says,
 * never what it allows -- making it a gate would be the app deciding something the firm said it
 * decides case by case.
 */
check('the residue the firm named', SMALL_RESIDUE, 50)
check('nothing outstanding is paid up', endingAdvice(0).ending, 'paid_up')
check('a small residue is still a write-off', endingAdvice(22.77).ending, 'written_off')
check('and so is a large balance', endingAdvice(5000).ending, 'written_off')
/* The small-residue wording says so rather than implying it is a lesser thing. */
ok('...and the small one says it is still a write-off',
  /still a write-off/.test(endingAdvice(22.77).because))
/* NEITHER SENTENCE RESTATES THE BALANCE: the screen says it immediately above, and printing it
   twice in a row reads as a bug even though both halves are correct. */
for (const b of [0, 22.77, 5000]) {
  no(`the advice at ${b} does not restate the figure`, /outstanding/.test(endingAdvice(b).because))
}

/* The reasons stay a closed list: "what has this client written off, and why" is a question free
   text cannot answer, and the liaison's conversation starts from whichever it was. */
ok('uncontactable is a reason', WRITE_OFF_REASONS.includes('Uncontactable'))
ok('and so is a small residue', WRITE_OFF_REASONS.includes('Small residue, not worth chasing'))

/* THE NOTE THE FIRM CORRECTED IS GONE. It read "THE CLIENT DECIDES, ALWAYS", which is the opposite
   of the mandate they hold. Asserted because a stale comment is how the next person gets it wrong. */
const dormancy = read('src/lib/dormancy.ts')
no('dormancy no longer says the client always decides',
  /THE CLIENT DECIDES, ALWAYS\. These are the reasons a REQUEST quotes/.test(dormancy))
ok('...it says the firm holds the mandate', /FIRM HOLDS THE MANDATE/.test(dormancy))

console.log(`check-account-ending: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
if (failures.length) process.exit(1)
