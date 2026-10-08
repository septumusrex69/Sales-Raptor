/**
 * AN OVERPAYMENT MOVED TO ANOTHER OF THE DEBTOR'S ACCOUNTS IS MOVED, NOT JUST NOTED.
 *
 * THE FIRM, 8 Oct: "If it's being moved to another account, then that will be allocated." The
 * 'moved' disposal used to record excess_moved_to and do nothing else -- the credit stayed on the
 * first account and nothing reached the second.
 *
 * WHAT THIS HOLDS, read from the LAST definitions in schema.sql, comments stripped:
 *   1. dispose_excess_credit takes the credit off the first account (a NEGATIVE debtor entry in the
 *      trust ledger) and writes an approved payment on the second, source 'moved', pointing back.
 *   2. allocate_payment charges no receipt fee on it (the firm's ruling: no second fee) and writes
 *      no fee row.
 *   3. The firm's collection totals do not count it twice; the account's own settlement does count
 *      it, because on that account it is a real reduction of the debt.
 *   4. reverse_payment refuses a payment whose overpayment was moved.
 *
 * Proved on staging in rolled-back probes (HANDOFF): R769.35 moved, trust total unchanged at
 * 44 839.92, the first account's credit nil, R766.12 capital + R3.23 interest on the second with
 * no fee; reversing the original refused with the message below.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-moved-overpayment.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, actual) => { if (actual === true) pass += 1; else failures.push(name) }
const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
const liveFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const m = /\bas \$(\w*)\$([\s\S]*?)\$\1\$/.exec(sql.slice(at))
  return strip(m?.[2] ?? '')
}

ok('account_payments has the moved marker',
  /add column if not exists moved_from_allocation_id uuid references public\.payment_allocations \(id\)/.test(sql))

/* ---- 1. the move ---- */
const dispose = liveFn('dispose_excess_credit')
ok('dispose_excess_credit exists', dispose.length > 0)
const move = dispose.slice(dispose.lastIndexOf("if p_disposal = 'moved' then"))
ok('a move takes the credit off the first account',
  /insert into public\.trust_creditor_entries \([\s\S]*?values \('debtor', v_company, v_a\.account_id, -v_a\.excess_credit,/.test(move))
ok('...and puts it on the second as an approved payment',
  /insert into public\.account_payments \([\s\S]*?approved_at, approved_by, allocated_on, moved_from_allocation_id[\s\S]*?\) values \(\s*p_move_to, coalesce\(v_received, now\(\)\), v_a\.excess_credit/.test(move))
ok('...marked as moved, pointing back at where it came from',
  /'moved', 'Overpayment moved from '[\s\S]*?, v_a\.id\s*\);/.test(move))
ok('...after the decision is recorded, so the first account no longer holds the run',
  dispose.indexOf('update public.payment_allocations') >= 0
  && dispose.indexOf('update public.payment_allocations') < dispose.lastIndexOf("if p_disposal = 'moved' then"))

/* ---- 2. no second receipt fee ---- */
const alloc = liveFn('allocate_payment')
ok('a moved payment is charged no receipt fee',
  /if v_pay\.moved_from_allocation_id is not null then v_fee_rate := 0; end if;/.test(alloc))
ok('...set before the split is worked out', alloc.indexOf('v_fee_rate := 0') >= 0
  && alloc.indexOf('v_fee_rate := 0') < alloc.indexOf('public.finance_split('))
ok('...and writes no nil fee row', /if v_fee_rate > 0 then\s*insert into public\.account_fees/.test(alloc))

/* ---- 3. not counted twice ---- */
const perf = liveFn('collector_performance')
ok('the collectors are not credited with it', (perf.match(/p\.source <> 'moved'/g) ?? []).length === 2)
ok('...nor the day by day', /p\.source <> 'moved'/.test(liveFn('collector_daily')))
ok('...nor the Payments in tiles', /p\.source <> 'moved'/.test(liveFn('payments_in_month')))
ok('...nor a client\'s payments to date', /p\.source <> 'moved'/.test(liveFn('client_book_totals')))
ok('the account\'s own settlement still counts it', !/p\.source <> 'moved'/.test(liveFn('account_settlement')))

/* ---- 4. not reversed into a second credit ---- */
const rev = liveFn('reverse_payment')
ok('reversing a payment whose overpayment moved is refused',
  /a\.excess_disposal = 'moved'\) then\s*raise exception 'Its overpayment was moved/.test(rev))
ok('...before anything is reversed', rev.indexOf("excess_disposal = 'moved'") >= 0
  && rev.indexOf("excess_disposal = 'moved'") < rev.indexOf('set reversed_at = now()'))

const ui = readFileSync(new URL('../../src/components/finance/DisposeExcessModal.tsx', import.meta.url), 'utf8')
ok('the box offers the debtor\'s accounts, not a key to type', /fetchMoveTargets\(accountId\)/.test(ui) && !/The account's id/.test(ui))

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-moved-overpayment: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
