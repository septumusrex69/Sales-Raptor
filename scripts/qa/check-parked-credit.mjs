/**
 * AN OVERPAYMENT NOBODY CLAIMS.
 *
 * THE FIRM DESCRIBED THE PROBLEM RATHER THAN THE FEATURE: *"who are we going to pay five rand to?
 * We're going to give the guy a call, and the costs are going to be already more than 20 rand. If
 * there's any cost less left... that money stays in the trust or whatever. It can go to us or
 * whatever. It's fine."*
 *
 * SO THERE IS A FOURTH DISPOSAL, and the care is entirely in what it does NOT do.
 *
 * WHAT THIS GUARDS:
 *
 * 1. PARKING MOVES NO MONEY. It is a decision to wait, not a decision about the money -- which is
 *    still the debtor's. If parking quietly credited the firm, the firm would be helping itself to
 *    a debtor's money and calling it an administrative state.
 *
 * 2. TAKING WAITS OUT THE PERIOD, in the database and not only on the screen. Taking a credit the
 *    day it is parked is keeping a debtor's money; waiting is giving up on returning it. That
 *    difference is the entire defensibility of the feature, so a hidden button is not enough.
 *
 * 3. IT REVERSES, AND BY APPENDING. The debtor turning up afterwards is the case this has to
 *    survive. Both directions write two FRESH entries -- the trust ledger has no update or delete
 *    policy at all, which check-financial-immutability exists to keep true.
 *
 * 4. THE PERIOD IS A SETTING, NOT A CONSTANT. The firm said "after a period" and never named it, so
 *    six months is a placeholder and the function must read firm_settings rather than hard-code it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-parked-credit.mjs
 */
import { readFileSync } from 'node:fs'
import {
  DISPOSALS, NOT_WORTH_REFUNDING, disposalAdvice, parkedState,
} from '../../src/lib/excessCredit.ts'

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
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return null
  const opens = sql.indexOf('as $$', at)
  const ends = sql.indexOf('$$;', opens)
  return opens < 0 || ends < 0 ? null : sql.slice(opens, ends)
}

/* ----------------------- 1. parking moves no money ----------------------- */

const dispose = liveBody('dispose_excess_credit')
ok('dispose_excess_credit is in schema.sql', !!dispose)
ok('parked is one of the disposals', /elsif p_disposal = 'parked' then/.test(dispose ?? ''))
ok('...and the closed list allows it',
  /excess_disposal = any \(array\['refund','moved','released','parked'\]\)/.test(sql))

/*
 * THE PARKED BRANCH WRITES NOTHING TO THE LEDGER. Read as the branch's own text rather than the
 * whole function, which legitimately writes elsewhere -- a refund inserts a payment out.
 */
const parkedBranch = (dispose ?? '').split("elsif p_disposal = 'parked' then")[1]?.split('elsif')[0] ?? ''
ok('the parked branch was found', parkedBranch.length > 50)
no('...and it writes no trust entry', /insert into public\.trust_creditor_entries/.test(parkedBranch))
no('...and no payment out', /insert into public\.trust_payments_out/.test(parkedBranch))
/* ALL IT DOES IS SET A DATE. */
ok('...it only sets a date to come back on', /v_until := public\.raptor_today\(\)/.test(parkedBranch))

/* AND IT READS THE SETTING, so naming the period later costs nothing. */
ok('the period is a setting', /from public\.firm_settings/.test(parkedBranch))
ok('...which exists on the table', /add column if not exists parked_credit_months integer/.test(sql))

/* ----------------------- 2. taking waits out the period ----------------------- */

const take = liveBody('take_parked_credit')
ok('take_parked_credit is in schema.sql', !!take)
ok('it refuses an early take',
  /if v_a\.excess_parked_until > public\.raptor_today\(\) then[\s\S]{0,200}raise exception/.test(take ?? ''))
ok('...and refuses one that is not parked at all',
  /excess_disposal is distinct from 'parked'[\s\S]{0,160}raise exception/.test(take ?? ''))
ok('...and refuses taking it twice',
  /excess_taken_at is not null[\s\S]{0,160}raise exception/.test(take ?? ''))
/* IT IS THE TRUST TICK, not merely signed in. */
ok('...and asks the trust capability', /has_capability\('finance\.view'\)/.test(take ?? ''))

/* ----------------------- 3. it reverses, by appending ----------------------- */

const give = liveBody('return_parked_credit')
ok('return_parked_credit is in schema.sql', !!give)

/*
 * TWO ENTRIES EACH WAY, AND NEVER AN EDIT. The pair must be equal and opposite or the trust total
 * changes, which would turn a transfer between parties into money appearing or vanishing.
 */
for (const [name, body, firstParty] of [
  ['take_parked_credit', take, 'debtor'], ['return_parked_credit', give, 'firm'],
]) {
  const inserts = [...(body ?? '').matchAll(/values \('(debtor|firm)',[\s\S]{0,120}?(-?)round\(v_a\.excess_credit, 2\)/g)]
  check(`${name} writes exactly two ledger entries`, inserts.length, 2)
  check(`...the first one is the ${firstParty}'s, and negative`,
    [inserts[0]?.[1], inserts[0]?.[2]], [firstParty, '-'])
  check('...and the second is the other party, positive',
    [inserts[1]?.[1], inserts[1]?.[2]], [firstParty === 'debtor' ? 'firm' : 'debtor', ''])
  /* NOTHING IS REWRITTEN. The ledger has no update policy; an update here would be refused by
     Postgres anyway, which is worse than not writing one -- it would fail at the worst moment. */
  no(`${name} never updates the ledger`,
    /update public\.trust_creditor_entries/.test(body ?? ''))
  no(`${name} never deletes from it`,
    /delete from public\.trust_creditor_entries/.test(body ?? ''))
}

/* ----------------------- the screen's own rules ----------------------- */

/* FOUR DISPOSALS, AND THE TWO THAT NEED SOMETHING SAY SO. A refund with nobody to pay and a move
   with nowhere to go are both refused in the database; the box must ask rather than discover. */
check('four ways to decide an overpayment', DISPOSALS.map((d) => d.id).sort(),
  ['moved', 'parked', 'refund', 'released'])
check('a refund needs somebody to pay', DISPOSALS.find((d) => d.id === 'refund')?.needs, 'payable_to')
check('a move needs somewhere to go', DISPOSALS.find((d) => d.id === 'moved')?.needs, 'move_to')
check('releasing needs nothing', DISPOSALS.find((d) => d.id === 'released')?.needs, undefined)
check('and parking needs nothing', DISPOSALS.find((d) => d.id === 'parked')?.needs, undefined)

/*
 * THE FIRM'S OWN ARITHMETIC: a telephone call costs more than R20 before anything is paid, so
 * refunding less than that loses money and returns almost nothing.
 */
check('the figure the firm named', NOT_WORTH_REFUNDING, 20)
check('R4.12 is not worth refunding', disposalAdvice(4.12).suggest, 'parked')
check('R19.99 still is not', disposalAdvice(19.99).suggest, 'parked')
check('R20 is', disposalAdvice(20).suggest, 'refund')
check('and R410.63 certainly is', disposalAdvice(410.63).suggest, 'refund')
/* IT IS A SUGGESTION AND THE SCREEN SAYS WHY, rather than hiding the option or implying it by
   ordering -- "too small to bother with" is a judgement the firm makes case by case. */
ok('the small-amount advice explains itself', /costs the firm more/.test(disposalAdvice(5).because))
const modal = read('src/components/finance/DisposeExcessModal.tsx')
ok('every disposal stays on the screen', /DISPOSALS\.map/.test(modal))
no('...none is hidden by amount', /DISPOSALS\.filter/.test(modal))
/* A REASON IS ALWAYS REQUIRED: in six months it is the only account of why. */
ok('the button waits for a reason', /reason\.trim\(\) === ''/.test(modal))

/* THREE STATES, AND THE MIDDLE ONE IS WHY SOMEBODY OPENS THE LIST. */
const row = { allocationId: 'a', accountId: 'b', caseNumber: null, debtor: '', client: null,
  amount: 5, parkedOn: null, ripeOn: null, ripe: false, takenAt: null, reason: null }
check('parked and waiting', parkedState(row), 'waiting')
check('parked and ripe', parkedState({ ...row, ripe: true }), 'ripe')
check('taken beats ripe', parkedState({ ...row, ripe: true, takenAt: '2026-10-05' }), 'taken')
/* TAKEN BEATS NOT-RIPE TOO: a credit taken and then its date edited must still read as taken. */
check('...and beats waiting', parkedState({ ...row, takenAt: '2026-10-05' }), 'taken')

const list = read('src/components/finance/ParkedCredits.tsx')
/* THE BUTTON IS ONLY ON A RIPE ONE -- the courtesy over the database's refusal. */
ok('only a ripe credit offers to be taken', /state === 'ripe' \?[\s\S]{0,300}Take it/.test(list))
/* AND A TAKEN ONE CAN ALWAYS GO BACK. */
ok('a taken credit can be given back', /Give it back/.test(list))
/* NOTHING PARKED DRAWS NOTHING. It is the firm's normal condition, not an empty state worth a card. */
ok('an empty list draws nothing at all', /rows\.length === 0 && !error\) return null/.test(list))

console.log(`check-parked-credit: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
if (failures.length) process.exit(1)
