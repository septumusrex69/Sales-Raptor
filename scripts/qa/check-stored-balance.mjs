/**
 * THE BOOK CAN BE SORTED BY BALANCE, AND THE ORDER IS THE ACCOUNT PAGE'S OWN NUMBER (S9).
 *
 * THE FIRM, 18 Oct: "we should be able to sort, for example, highest number to lowest number,
 * collected or outstanding balance." The book is paged in the database, so the order is the
 * database's -- and the only SQL balance there was, engine_balances, says R817,01 on RRC00005 where
 * the account page says R760,00.
 *
 * So `account_balances` holds computeBalance's OWN answer, written through the same
 * balanceInputFor the list and the account page use, and knows when it has stopped being true (a
 * ledger version and a day). This file holds the four things that make that so:
 *
 *   1. the stored figure IS the figure the column draws -- computeBalance's settlement, through the
 *      same mapping, on the in duplum account the two readings disagree on;
 *   2. it goes stale when anything it was computed from moves -- every ledger, and every account
 *      column balanceInputFor reads, in BOTH directions;
 *   3. the version is read BEFORE the ledgers, or a payment landing between them is lost;
 *   4. the list catches up before it sorts, writes back what it draws, and says when the order is
 *      behind -- and the nightly job exists, on the firm's day.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-stored-balance.mjs
 */
import { readFileSync } from 'node:fs'
import { computeBalance } from '../../src/lib/accountBalance.ts'
import { balanceInputFor } from '../../src/lib/balanceInput.ts'
import {
  ACCOUNT_SELECT, LEDGER_SELECT, balanceAccountFromRow, ledgerRowsByAccount, storedAgrees, storedRow,
} from '../../src/lib/storedBalance.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/* ---------------- 1. the stored figure is the column's figure ---------------- */

/*
 * RRC00005 AS THE DATABASE HANDS IT OVER: snake_case rows, an item 9 receipt fee carried as a fee
 * row against its payment (counted once, not twice), a rejected receipt that was never the
 * debtor's, and fees at the in duplum ceiling -- every branch the mapping has to get right.
 */
const today = '2026-10-11'
const account = {
  id: 'rrc5', capital_handed_over: '380.00', handover_date: '2026-09-01', interest_rate_annual: '24',
  status: 'Active', last_action_at: null, ended_as: null, ended_on: null, prescribed: false, prescription_date: null,
}
const raw = {
  payments: [
    { account_id: 'rrc5', id: 'p1', received_at: '2026-09-20T08:00:00Z', amount: '100.00', paid_to_client: false, reversed_at: null, receipt_fee_legacy: null, rejected_at: null },
    { account_id: 'rrc5', id: 'p2', received_at: '2026-09-21T08:00:00Z', amount: '999.00', paid_to_client: false, reversed_at: null, receipt_fee_legacy: null, rejected_at: '2026-09-22T08:00:00Z' },
  ],
  fees: [
    { account_id: 'rrc5', incurred_at: '2026-09-02T08:00:00Z', description: 'Costs, items 1-7', amount_excl_vat: '380.00', vat_amount: '57.01', billed: true, segments: null, cancelled_at: null, annexure_item: '1', payment_id: null, legacy_name: null },
    { account_id: 'rrc5', incurred_at: '2026-09-20T08:00:00Z', description: 'Receipt of instalment', amount_excl_vat: '10.00', vat_amount: '1.50', billed: true, segments: null, cancelled_at: null, annexure_item: '9', payment_id: 'p1', legacy_name: null },
  ],
  accruals: [],
}
const ledgers = ledgerRowsByAccount(['rrc5', 'empty'], raw)
ok('every account asked about has a ledger, even one with no rows', ledgers.has('empty') && ledgers.get('empty').fees.length === 0)
check('a rejected receipt is not the debtor’s payment', ledgers.get('rrc5').payments.map((p) => p.id), ['p1'])
check('the receipt fee row keeps its item and its payment', [ledgers.get('rrc5').fees[1].annexureItem, ledgers.get('rrc5').fees[1].paymentId], ['9', 'p1'])

/* What the list draws: the account page's assembly over the same rows. */
const drawn = computeBalance(balanceInputFor({ account: balanceAccountFromRow(account), ledgers: ledgers.get('rrc5'), today }))
ok('RRC00005 is at the ceiling, which is where the two readings part', drawn.cappedBy === 'in duplum')
const row = storedRow('rrc5', 3, drawn, today)
check('what is stored is the column’s figure: computeBalance’s settlement', row.to_settle, drawn.settlement)
check('...and the balance beside it', row.balance, drawn.balance)
check('...on the day and version it was worked out for', [row.as_at, row.version], [today, 3])
ok('...and not engine_balances’ reading', row.balance !== 817.01)

/* storedAgrees: nothing written when the stored key already says it. */
const fresh = { to_settle: String(drawn.settlement), as_at: today, computed_version: '3', ledger_version: 3 }
ok('a current key at the drawn figure is left alone', storedAgrees(fresh, drawn, today))
ok('...but not one a ledger has moved on from', !storedAgrees({ ...fresh, ledger_version: 4 }, drawn, today))
ok('...nor one from yesterday', !storedAgrees({ ...fresh, as_at: '2026-10-10' }, drawn, today))
ok('...nor one a cent out', !storedAgrees({ ...fresh, to_settle: String(drawn.settlement + 0.01) }, drawn, today))
ok('...nor one never worked out', !storedAgrees({ ...fresh, to_settle: null }, drawn, today) && !storedAgrees(null, drawn, today))

/* ---------------- 2. it goes stale when what it was computed from moves ---------------- */

const sql = read('supabase/schema.sql')
for (const t of ['account_payments', 'account_fees', 'account_interest_accruals']) {
  ok(`a change to ${t} bumps the version`,
    new RegExp(`after insert or update or delete on public\\.${t}\\s+for each row execute function public\\.mark_balance_stale\\(\\)`).test(sql))
}
/*
 * THE ACCOUNT COLUMNS, BOTH DIRECTIONS. What balanceInputFor actually reads off the account (the
 * mapper's columns, less the two it is handed and ignores) must be exactly the trigger's `update
 * of` list: one missing and a change to it leaves the order wrong; one extra and the book goes
 * stale on edits that cannot move a balance.
 */
const trig = sql.match(/after update of ([a-z_, ]+)\s+on public\.debtor_accounts\s+for each row execute function public\.mark_account_balance_stale\(\)/)
ok('a change to the account’s own inputs bumps it too', !!trig)
const trigCols = (trig?.[1] ?? '').split(',').map((c) => c.trim()).sort()
/* `status` and `last_action_at` are read and NOT used: a write-off no longer stops the clock. */
const readCols = ACCOUNT_SELECT.split(',').filter((c) => !['id', 'status', 'last_action_at'].includes(c)).sort()
check('...and exactly the columns the balance reads', trigCols, readCols)
const mapperSrc = read('src/lib/storedBalance.ts')
const mapperCols = [...stripComments(mapperSrc.slice(mapperSrc.indexOf('export function balanceAccountFromRow'), mapperSrc.indexOf('export interface StoredBalanceRow'))).matchAll(/r\.([a-z_]+)/g)].map((m) => m[1])
check('...which are the columns the mapper reads, no more and no fewer',
  [...new Set(mapperCols)].sort(), ACCOUNT_SELECT.split(',').filter((c) => c !== 'id').sort())
ok('a version for a deleted account is not created (a cascade would refuse the delete)',
  /select p_account, 1 where exists \(select 1 from public\.debtor_accounts where id = p_account\)/.test(sql))
const write = sql.slice(sql.lastIndexOf('create or replace function public.record_account_balances('))
ok('an older figure never overwrites a newer one',
  /computed_at = public\.raptor_now\(\)\s+where b\.computed_version is null\s+or excluded\.computed_version > b\.computed_version/.test(write))

/* The ledger columns: the same list the account page's balance reads. */
for (const c of ['annexure_item', 'payment_id', 'legacy_name', 'cancelled_at']) {
  ok(`the fee ledger is read with ${c}`, LEDGER_SELECT.fees.split(',').includes(c))
}
ok('the payments are read with rejected_at', LEDGER_SELECT.payments.split(',').includes('rejected_at'))

/* ---------------- 3. the version is read before the ledgers ---------------- */

const refresh = stripComments(mapperSrc.slice(mapperSrc.indexOf('export async function refreshBalances'), mapperSrc.indexOf('export async function recordBalances')))
const vAt = refresh.indexOf(".select('account_id,ledger_version')")
const lAt = refresh.indexOf('fetchLedgerRows(client, chunk)')
ok('refreshBalances reads the version', vAt > 0)
ok('...and the ledgers', lAt > 0)
ok('...the version FIRST', vAt > 0 && lAt > 0 && vAt < lAt)
ok('...and through the one assembly', /computeBalance\(balanceInputFor\(\{/.test(refresh))

/* ---------------- 4. the list, the sort, the job ---------------- */

const book = read('src/lib/accountBook.ts')
ok('the sort reads the stored figure', /balance: 'account_balances\(to_settle\)'/.test(book))
ok('...embedded with the row, version and all',
  /account_balances\(to_settle,as_at,ledger_version,computed_version\)/.test(book))
ok('the list’s ledgers are the stored balance’s ledgers', /return fetchLedgerRows\(supabase, accountIds\)/.test(book))

const list = stripComments(read('src/pages/accounts/AccountsList.tsx'))
ok('“To settle” is a sort', /\{sortBy\('balance', 'To settle', /.test(list))
ok('...starting highest first', /by === 'balance'/.test(list.slice(list.indexOf('const numeric'), list.indexOf('const numeric') + 200)))
const loadAt = list.indexOf("if (query.sort?.by === 'balance')")
ok('sorted by balance, the stored figures are caught up', loadAt > 0 && /readyBalanceSort\(firmToday\(\)\)/.test(list))
ok('...BEFORE the page is read', loadAt > 0 && loadAt < list.indexOf('fetchAccounts({ ...query, page: 0, pageSize })', loadAt))
ok('...and a catch-up that fails does not fail the list', /readyBalanceSort\(firmToday\(\)\)\.catch\(/.test(list))
ok('the order says when it is behind', /data-testid="balance-sort-lag"/.test(list) && /sortLag\.outOfDate !== 0/.test(list))
ok('every row drawn writes back where the key disagrees', /recordBalances\(supabase, drifted\)/.test(list))
ok('...with the version read with the row, not after the ledgers', /storedRow\(a\.id, stored\?\.ledgerVersion \?\? 0, b, today\)/.test(list))
ok('...worked out outside the state updater, which may run late',
  list.indexOf('drifted.push(') > 0 && list.indexOf('drifted.push(') < list.indexOf('setBalances((prev) =>', list.indexOf('const drifted')))

const job = stripComments(read('api/_lib/workflow/balances.ts'))
ok('the nightly job asks the database what day it is', /await firmClock\(admin\)/.test(job))
ok('...and works out every account not current', /refreshOutOfDate\(admin, today,/.test(job) && !/onlyStale/.test(job))
ok('...answering only to the timer or an Administrator',
  /isCron/.test(job) && /callerIsAdmin\(admin, caller\.id\)/.test(job))
ok('it is a route', /\bbalances,/.test(read('api/workflow/[action].ts')))
const vercel = JSON.parse(read('vercel.json'))
const cron = (vercel.crons ?? []).find((c) => c.path === '/api/workflow/balances')
/* 22:05 UTC is 00:05 in Johannesburg, which keeps no daylight saving: just after the day turns. */
check('...run just after midnight in Johannesburg', cron?.schedule, '5 22 * * *')

if (failures.length) {
  console.log(`check-stored-balance: ${pass} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-stored-balance: ${pass} passed, 0 failed`)
