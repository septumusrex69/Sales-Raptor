/**
 * ACCOUNTS WHOSE MONEY IS IN, AND THE CLOSE THAT FOLLOWS IT (the firm, 12 Oct, on HTH/4004: settled
 * for R5 000, still open, still saying R7 980 to settle -- "when we approve payments ... say that
 * okay, it's been settled. You want to close this account").
 *
 * What this holds:
 *   1. the queue badges the payment that completes an approved settlement, counted the way the
 *      database counts, and never on a closed account;
 *   2. approving asks the DATABASE which accounts are now finished and offers to close them --
 *      on both of the queue's renders, because approving the last row empties it;
 *   3. accounts_ready_to_close finds the two kinds and only those, on open accounts, as the person;
 *   4. a settled one closes through close_as_settled, a paid-up one through settle_account;
 *   5. the list is routed before /accounts/:id, or "ready-to-close" is read as an account id.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-ready-to-close.mjs
 */
import { readFileSync } from 'node:fs'
import { exceptionsOf } from '../../src/lib/paymentsQueue.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

/* 1. THE BADGE. */
const row = {
  paymentId: 'p', client: 'Highveld', receivedOn: '2026-08-05', amount: 5000, paidToClient: false,
  toInterest: 0, toCosts: 0, toReceiptFees: 0, toFees: 0, receiptFee: 0, receiptFeeVat: 0, toCapital: 5000,
  capitalBefore: 9000, capitalAfter: 4000, excess: 0, commission: 0, commissionVat: 0, commissionRate: 0.1,
  toClient: 5000, dueToBf: 0, hasRate: true, interestCant: 0, rfCant: 0, feesCant: 0, cameBackFrom: null,
}
const has = (r, s, closed = null) => exceptionsOf(r, [], null, closed, s).some((e) => e.key === 'completes_settlement')
ok('a payment that reaches the agreed figure completes the settlement', has(row, { amount: 5000, paid: 0 }))
ok('...as does one that reaches it with what came before', has({ ...row, amount: 3000 }, { amount: 5000, paid: 2000 }))
check('one that falls short does not', has({ ...row, amount: 2999 }, { amount: 5000, paid: 2000 }), false)
check('no approved settlement, no badge', has(row, null), false)
check('a closed account never gets it -- that money is held as credit', has(row, { amount: 5000, paid: 0 }, { as: 'withdrawn', on: '2026-07-10' }), false)
ok('...and it says the rest is waived by the client',
  /waived by the client/.test(exceptionsOf(row, [], null, null, { amount: 5000, paid: 0 }).find((e) => e.key === 'completes_settlement')?.detail ?? ''))

/* 2. THE QUEUE ASKS AFTER APPROVING. */
const queue = read('src/pages/finance/AwaitingApproval.tsx')
const approveAt = queue.indexOf('const out = await approvePayments(ids)')
const askAt = queue.indexOf('fetchReadyToClose(accounts)')
ok('approving asks which accounts are now finished', approveAt >= 0 && askAt > approveAt)
ok('...about the accounts read BEFORE the reload took the rows away',
  queue.indexOf('const accounts = rows.filter((r) => ids.includes(r.paymentId))') >= 0
  && queue.indexOf('const accounts = rows.filter((r) => ids.includes(r.paymentId))') < approveAt)
check('the offer is drawn on both renders of the queue, empty and not', (queue.match(/\{closeBox\}/g) ?? []).length, 2)
ok('the queue passes the live settlement to the row check', /liveSettlements\.get\(r\.accountId\) \?\? null\)/.test(queue))

/* 3. THE FUNCTION. */
const sql = read('supabase/schema.sql')
const at = sql.lastIndexOf('create or replace function public.accounts_ready_to_close(')
const fn = at >= 0 ? sql.slice(at, sql.indexOf('$$;', sql.indexOf('as $$', at)) + 3) : ''
ok('accounts_ready_to_close exists', fn.length > 0)
ok('...runs as the person, so it lists only what they may see', /security invoker/.test(fn))
ok('...a settlement counts once what reached trust covers the agreed figure', /where st\.paid >= st\.amount/.test(fn))
ok('...counted the way account_settlement counts it (the window from the offer)',
  /between \(s\.proposed_at at time zone 'Africa\/Johannesburg'\)::date/.test(fn) && /s\.status = 'approved'/.test(fn))
ok('...paid up means the capital is nil, on an account that had capital', /d\.capital_outstanding <= 0/.test(fn) && /capital_handed_over, 0\) > 0/.test(fn))
ok('...and only open accounts', /where d\.ended_as is null\s+order by/.test(fn))
ok('...and anon may not call it', /revoke execute on function public\.accounts_ready_to_close\(uuid\[\]\) from public, anon;/.test(sql))

/* 4. CLOSED THE WAY IT ENDED. */
const lib = read('src/lib/readyToClose.ts')
const closeFn = lib.slice(lib.indexOf('export async function closeReady'))
ok('a settled one closes through close_as_settled', /r\.kind === 'settled' && r\.settlementId[\s\S]{0,80}closeAsSettled\(r\.settlementId\)/.test(closeFn))
ok('a paid-up one through settle_account as paid up', /settleAccount\(r\.accountId, 'paid_up'/.test(closeFn))

/* 5. THE ROUTE. */
const app = read('src/App.tsx')
const list = app.indexOf('path="/accounts/ready-to-close"')
ok('Ready to close is routed before /accounts/:id', list >= 0 && list < app.indexOf('path="/accounts/:id"'))

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-ready-to-close: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
