/**
 * THE DEBTOR'S CREDIT LEAVING THE ACCOUNT (Raptor · Handover 17, S18; Stephan, 5 Nov: "a refund should
 * be appearing on the debtor's statement as well. That he has been refunded").
 *
 * An overpayment refunded, moved to another of the debtor's accounts, or released to the client is no
 * longer this account's credit. Before S18 nothing that adds up a balance read any of them, so a
 * refunded account showed the debtor in credit for ever. Held here: the balance comes back to nil,
 * the statement shows the line and still adds up to its foot, the payee never appears, and every
 * reader of a balance reads the same thing.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-money-out.mjs
 */
import { readFileSync } from 'node:fs'
import { buildStatement, computeBalance } from '../../src/lib/accountBalance.ts'
import { balanceInputFor } from '../../src/lib/balanceInput.ts'
import { ledgerRowsByAccount } from '../../src/lib/storedBalance.ts'

let pass = 0
const failures = []
const check = (n, a, e) => { if (Object.is(a, e)) pass += 1; else failures.push(`${n}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`) }
const ok = (n, a) => check(n, a, true)
const cents = (n) => Math.round(n * 100) / 100

/* R300 owed, R1 000 paid: R300 + R34.50 receipt fee settles it, R665.50 is the debtor's credit. */
const base = {
  capitalHandedOver: 300, handoverDate: '2026-04-10',
  ledgers: { payments: [{ id: 'p1', date: '2026-05-01', amount: 1000 }], fees: [], interest: [] },
}
const before = computeBalance(base)
check('the overpayment leaves the debtor in credit', before.balance, -665.5)

const refunded = { ...base, ledgers: { ...base.ledgers, paidOut: [{ date: '2026-05-10', amount: 665.5, kind: 'refund', detail: 'paid' }] } }
const after = computeBalance(refunded)
check('a refund brings the balance back to nil', after.balance, 0)
check('...and reports what left', after.paidOut, 665.5)
check('...without touching what was paid', after.payments, 1000)
check('...or the receipt fee charged on the settlement', after.receiptFees, before.receiptFees)
check('nothing paid out: paidOut is nought', before.paidOut, 0)

const st = buildStatement(refunded)
const line = st.lines.find((l) => l.kind === 'paid-out')
ok('the statement has the refund line', !!line)
check('...as a debit (the credit leaving)', line?.debit, 665.5)
check('...saying it was paid to the debtor', line?.description, 'Refund paid to you')
const sum = cents(st.lines.reduce((t, l) => t + (l.debit ?? 0) - (l.credit ?? 0), 0))
check('the statement still adds up to its own balance', sum, after.balance)

const instructed = buildStatement({ ...base, ledgers: { ...base.ledgers, paidOut: [{ date: '2026-05-10', amount: 665.5, kind: 'refund', detail: 'instructed' }] } })
check('a refund not yet paid says so', instructed.lines.find((l) => l.kind === 'paid-out')?.description, 'Refund to you — instructed')
const moved = buildStatement({ ...base, ledgers: { ...base.ledgers, paidOut: [{ date: '2026-05-10', amount: 665.5, kind: 'moved', detail: 'RAP-100002' }] } })
check('a move names the account it went to', moved.lines.find((l) => l.kind === 'paid-out')?.description, 'Overpayment moved to RAP-100002')
const released = buildStatement({ ...base, ledgers: { ...base.ledgers, paidOut: [{ date: '2026-05-10', amount: 665.5, kind: 'released', detail: 'PO-X-2605' }] } })
check('a release names the run', released.lines.find((l) => l.kind === 'paid-out')?.description, 'Overpayment released to the client (PO-X-2605)')

/* ---------- from the database's rows to the balance, the way every reader goes ---------- */
const rows = ledgerRowsByAccount(['a1'], {
  payments: [{ account_id: 'a1', id: 'p1', received_at: '2026-04-30T22:00:00Z', amount: 1000, paid_to_client: false, reversed_at: null, receipt_fee_legacy: null }],
  fees: [], accruals: [],
  moneyOut: [{ account_id: 'a1', out_id: 'r1', kind: 'refund', on_day: '2026-05-10', amount: '665.50', detail: 'paid' },
    { account_id: 'zz', out_id: 'r2', kind: 'refund', on_day: '2026-05-10', amount: '1', detail: 'paid' }],
})
check('the rows are read onto their own account only', rows.get('a1').moneyOut.length, 1)
const viaInput = computeBalance(balanceInputFor({
  account: { capitalHandedOver: 300, handoverDate: '2026-04-10', interestRateAnnual: 0, status: 'Active', lastActionAt: null },
  ledgers: rows.get('a1'), today: '2026-06-01',
}))
check('...and through balanceInputFor the refund lands on the balance', viaInput.balance, 0)

/* ---------- every reader asks, and nothing private travels ---------- */
const stored = readFileSync(new URL('../../src/lib/storedBalance.ts', import.meta.url), 'utf8')
const book = readFileSync(new URL('../../src/lib/accountBook.ts', import.meta.url), 'utf8')
ok('the shared ledger read (list, export, nightly, portal, notices) asks for it', /fetchMoneyOut\(client, ids\)/.test(stored))
ok('...and the account page’s own read does too', /fetchMoneyOut\(supabase, \[accountId\]\)/.test(book))
ok('a failed read throws rather than reading as nothing refunded', /if \(error\) throw new Error\(error\.message\)\s*\n\s*return \(data \?\? \[\]\) as any\[\]/.test(stored))

const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const fnAt = sql.lastIndexOf('create or replace function public.account_money_out(')
ok('account_money_out is in the schema', fnAt > 0)
const fn = sql.slice(fnAt, sql.indexOf('\n$$;', fnAt))
ok('...returns no payee or bank detail', !/payable_to|bank_account|bank_name|branch_code/.test(fn.split('as $$')[0] + fn.replace(/\/\*[\s\S]*?\*\//g, '').split('select').slice(1).map((x) => x.split('from')[0]).join(' ')))
ok('...leaves a cancelled refund out', /t\.cancelled_at is null/.test(fn))
ok('...and a release only once its run is issued', /not public\.payover_run_is_open\(pr\.status\) and pr\.status <> 'void'/.test(fn))
ok('...and is not offered to anyone signed out', /revoke all on function public\.account_money_out\(uuid\[\]\) from public, anon;/.test(sql))

console.log(`${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1) }
