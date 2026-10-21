/*
 * BALANCES BROUGHT FORWARD FROM SWORDFISH (HANDOFF §3a, go-live item 3).
 *
 * Camille's "Trust Debtors" workbook -- a column per month, newest on the LEFT, one row per client --
 * comes in once at the cut-over: positive is owed to the firm and comes off the client's next
 * payover, NEGATIVE is the client in credit and is paid WITH it. This holds:
 *   - the reading: the sheet by name, the Client column by heading, the newest month as the left-most
 *     DATE heading (never a text heading, never today's month), cents rounded, the cell reference;
 *   - the matching: exact name ignoring case and spacing, then the code, then a person's pick; never
 *     a nearest name; two clients of one name left for a person; two rows on one client held back;
 *     a client already brought forward skipped;
 *   - the totals and the payload (the cell, never the name), and that the sign is never flipped;
 *   - the ledger: the brought-forward line opens its day and says where it went;
 *   - the database, read back from the LAST definitions in schema.sql: the credit allowed for this
 *     kind only, the import as the only writer, once per client, the guard, the ledger's netting of
 *     the set-off, Business leaving it out of income, and the revoke loop.
 *
 * Every name and figure here is invented. The real workbook is client data and this repo is public.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-brought-forward.mjs
 */
import { readFileSync } from 'node:fs'
import {
  DEFAULT_CUT_OVER, LEAVE_OUT, broughtForwardLabel, broughtForwardPayload, columnLetters, matchRows,
  monthLabel, normaliseName, parseTrustDebtors, readAmount, roundCents, summarise,
} from '../../src/lib/broughtForward.ts'
import { ledgerByPayover, broughtForwardState } from '../../src/lib/clientLedger.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const throws = (fn) => { try { fn(); return null } catch (e) { return e instanceof Error ? e.message : String(e) } }

/* ---------------- the sheet, in the shape xlsx.ts hands it over ---------------- */

const header = ['', 'Client', 'Name', 'NEW NOTES', '2026/10/01', '2026/08/01', '2026/07/01', 'Dec', '+90', 'Cam Nota']
const sheets = [
  { name: 'Trust Debtors', rows: [
    header,
    ['', '  Acme Holdings ', '', 'note', '1234.5600000000002', '99', '', '', '', ''], // row 2: owed, float noise
    ['', 'BETA  traders', '', '', '-250.4', '', '', '', '', ''],                      // row 3: credit, case/space
    ['', 'GMA', '', '', '300', '', '', '', '', ''],                                    // row 4: a code
    ['', 'Delta Unknown', '', '', '75', '', '', '', '', ''],                          // row 5: unmatched
    ['', 'Echo Twin', '', '', '10', '', '', '', '', ''],                              // row 6: two clients share it
    ['', 'Foxtrot', '', '', '0', '', '', '', '', ''],                                 // row 7: zero
    ['', 'Golf Blank', '', '', '', '5', '', '', '', ''],                              // row 8: blank this month
    ['', '', '', '', '1209.16', '', '', '', '', ''],                                  // row 9: a total line
    ['', 'Hotel', '', '', 'n/a', '', '', '', '', ''],                                 // row 10: unreadable
    ['', 'acme holdings', '', '', '1', '', '', '', '', ''],                           // row 11: Acme again
    ['', 'Indigo', '', '', '20', '', '', '', '', ''],                                 // row 12: already brought forward
    ['', '', '', '', '', '', '', '', '', ''],                                          // empty, ignored
  ] },
  { name: 'Handover', rows: [['Client', '2026/11/01'], ['Acme Holdings', '999999']] },
  { name: 'Write Off', rows: [['x']] },
]

const parsed = parseTrustDebtors(sheets)
check('the Trust Debtors sheet is the one read, never Handover or Write Off', parsed.sheet, 'Trust Debtors')
check('the newest month is the left-most DATE heading', parsed.month, '2026-10-01')
check('...said in words on screen', parsed.monthLabel, 'October 2026')
check('...and its column', parsed.column, 'E')
check('an empty row is not a row', parsed.rows.length, 11)
check('the cell reference carries the sheet, column and Excel row', parsed.rows[0].ref, 'Trust Debtors!E2')
check('a formula’s float noise is rounded to the cent', parsed.rows[0].amount, 1234.56)
check('the name is trimmed', parsed.rows[0].name, 'Acme Holdings')
check('a negative stays negative', parsed.rows[1].amount, -250.4)
check('a blank month is null, whatever the older months say', parsed.rows.find((r) => r.name === 'Golf Blank')?.amount, null)

/* THE LEFT-MOST, BY POSITION: move a later month to the left and it is the one taken. A sheet
   brought forward in January must still bring forward the month it was closed on. */
const moved = parseTrustDebtors([{ name: 'trust debtors ', rows: [
  ['Client', 'Dec', '2025/12/01', '2026/10/01'], ['A', 'x', '5', '7']] }])
check('the left-most date wins, not the latest date', moved.month, '2025-12-01')
check('...and a text heading to its left is never a month', moved.column, 'C')
check('...the tab is found ignoring case and spacing', moved.sheet, 'trust debtors ')

ok('a workbook with no Trust Debtors sheet is refused in words',
  /no "Trust Debtors" sheet/.test(throws(() => parseTrustDebtors([{ name: 'Sheet1', rows: [['Client']] }])) ?? ''))
ok('a sheet with no Client heading is refused',
  /no "Client" heading/.test(throws(() => parseTrustDebtors([{ name: 'Trust Debtors', rows: [['Who', '2026/10/01']] }])) ?? ''))
ok('a sheet with no date heading is refused',
  /none of its headings is a date/.test(throws(() => parseTrustDebtors([{ name: 'Trust Debtors', rows: [['Client', 'Oct']] }])) ?? ''))

/* ---------------- amounts and words ---------------- */

check('half a cent rounds away from nothing', roundCents(1.005), 1.01)
check('...on a credit too', roundCents(-1.005), -1.01)
check('R, spaces and thousands commas are read', readAmount('R 1 234,567.5'), 1234567.5)
check('a non-breaking space is read', readAmount('1 000'), 1000)
check('scientific notation is read', readAmount('1.5E3'), 1500)
check('text is not an amount', readAmount('n/a'), null)
check('blank is not an amount', readAmount('  '), null)
check('a month in words', monthLabel('2026-12-01'), 'December 2026')
check('the description the database writes, word for word', broughtForwardLabel('2026-10-01'),
  'Balance brought forward from Swordfish (October 2026)')
check('the cut-over agreed with the user', DEFAULT_CUT_OVER, '2026-12-10')
check('column letters', [columnLetters(0), columnLetters(4), columnLetters(26), columnLetters(53)], ['A', 'E', 'AA', 'BB'])
check('case and spacing are not part of a name', normaliseName('  Smit   &  SEUN '), 'smit & seun')

/* ---------------- matching ---------------- */

const clients = [
  { id: 'c-acme', name: 'Acme Holdings', code: 'ACM' },
  { id: 'c-beta', name: 'Beta Traders', code: 'BTR' },
  { id: 'c-gma', name: 'Gamma Motors', code: 'GMA' },
  { id: 'c-e1', name: 'Echo Twin', code: 'ET1' },
  { id: 'c-e2', name: 'echo  twin', code: 'ET2' },
  { id: 'c-ind', name: 'Indigo', code: 'IND' },
  { id: 'c-del', name: 'Delta Known', code: 'DLK' },
]
const already = new Set(['c-ind'])
const byRow = (rows) => Object.fromEntries(rows.map((r) => [r.row, r]))

let m = byRow(matchRows(parsed, clients, {}, already))
check('an exact name, ignoring case and spacing, matches', [m[3].state, m[3].companyId, m[3].how], ['matched', 'c-beta', 'name'])
check('a name cell that is a client code matches by code', [m[4].state, m[4].companyId, m[4].how], ['matched', 'c-gma', 'code'])
check('a name nobody has is unmatched -- never the nearest name', [m[5].state, m[5].companyId], ['unmatched', null])
check('two clients sharing a name are left for a person', [m[6].state, m[6].companyId], ['unmatched', null])
ok('...and the screen says why', /2 clients in Raptor share this name/.test(m[6].note ?? ''))
check('nothing owed is zero', m[7].state, 'zero')
check('a blank month is zero', m[8].state, 'zero')
check('a figure with no client name is never brought forward', m[9].state, 'no_name')
check('a cell that is not a number is unreadable', m[10].state, 'unreadable')
check('two rows on one client are BOTH held back', [m[2].state, m[11].state], ['twice', 'twice'])
check('a client already brought forward is skipped', m[12].state, 'already')

let s = summarise(Object.values(m))
check('the summary counts', [s.matched, s.unmatched, s.zero], [2, 2, 2])
check('...owed is only matched positives', s.owed, 300)
check('...credit is only matched negatives, as a positive figure', s.credited, 250.4)
check('...and it is not ready while anything waits on a person', s.ready, false)

/* A PERSON DECIDES: Acme's second row left out, Delta and Echo picked, Hotel left out. */
const picks = { 'Trust Debtors!E11': LEAVE_OUT, 'Trust Debtors!E5': 'c-del', 'Trust Debtors!E6': 'c-e2', 'Trust Debtors!E10': LEAVE_OUT }
m = byRow(matchRows(parsed, clients, picks, already))
check('a pick matches, and says it was picked', [m[5].state, m[5].companyId, m[5].how], ['matched', 'c-del', 'picked'])
check('leaving one twin out frees the other', [m[2].state, m[11].state], ['matched', 'left_out'])
check('an unreadable row can be left out', m[10].state, 'left_out')
s = summarise(Object.values(m))
check('now ready', s.ready, true)
check('owed: 1234.56 + 300 + 75 + 10', s.owed, 1619.56)
check('credited: 250.40', s.credited, 250.4)

const payload = broughtForwardPayload(Object.values(m))
check('the payload is the matched rows only', payload.map((p) => p.row_ref).sort(),
  ['Trust Debtors!E2', 'Trust Debtors!E3', 'Trust Debtors!E4', 'Trust Debtors!E5', 'Trust Debtors!E6'])
ok('...carrying the cell and never the client name', payload.every((p) => !('name' in p) && !JSON.stringify(p).includes('Acme')))
check('...and the sign untouched: owed positive, credit negative',
  payload.find((p) => p.company_id === 'c-beta')?.amount, -250.4)
check('...one row a client', new Set(payload.map((p) => p.company_id)).size, payload.length)

/* Picking a client onto another row's client makes both "twice" again. */
m = byRow(matchRows(parsed, clients, { ...picks, 'Trust Debtors!E5': 'c-acme' }, already))
check('a pick onto a client already matched holds both back', [m[2].state, m[5].state], ['twice', 'twice'])

/* ---------------- the ledger opens with it ---------------- */

const e = (on, kind, amount, extra = {}) =>
  ({ on, kind, amount, description: kind, reference: null, caseNumber: null, balance: 0, runId: null, chargeId: null, ...extra })
const runs = [{ id: 'r1', invoiceNumber: 'PO-ZZZ-2702', periodStart: '2026-12-11', periodEnd: '2027-01-10', status: 'approved' }]
const lines = [
  e('2026-12-10', 'held', 400),
  e('2026-12-10', 'brought_forward', -1000, { description: 'Balance brought forward from Swordfish (October 2026)', reference: 'PO-ZZZ-2702', runId: 'r1', chargeId: 'ch1' }),
  e('2027-01-05', 'held', 2000),
]
const rows = ledgerByPayover(lines, runs)
check('the brought-forward line is the first line of its day', rows[0].lines[0].kind, 'brought_forward')
check('...its own line, not folded into a payover', rows[0].key.startsWith('own:'), true)
check('...saying which payover took it', rows[0].state, 'Set off against PO-ZZZ-2702')
check('...and the balance still closes on the sum', rows[rows.length - 1].balance, 1400)
check('an owed balance not yet taken', broughtForwardState(e('2026-12-10', 'brought_forward', -5)), 'Comes off the next payover')
check('a credit not yet paid', broughtForwardState(e('2026-12-10', 'brought_forward', 5)), 'Paid with the next payover')
check('a credit paid', broughtForwardState(e('2026-12-10', 'brought_forward', 5, { reference: 'PO-1' })), 'Paid with PO-1')

/* ---------------- the database, from the LAST definitions ---------------- */

const sql = read('supabase/schema.sql')
function liveBody(name) {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const end = sql.indexOf('$$;', sql.indexOf('$$', at) + 2)
  return end < 0 ? '' : sql.slice(at, end + 3)
}
const lastConstraint = (name) => {
  const at = sql.lastIndexOf(`add constraint ${name}`)
  return at < 0 ? '' : sql.slice(at, sql.indexOf(';', at))
}

const kinds = lastConstraint('client_charges_kind_check')
ok('brought_forward is a charge kind', /'brought_forward'/.test(kinds))
ok('...beside the three there were', /'withdrawal', 'listing', 'other'/.test(kinds))
const amount = lastConstraint('client_charges_amount_check')
ok('a charge is still more than nothing', /amount > 0/.test(amount))
ok('...except a brought-forward CREDIT, below nothing', /kind = 'brought_forward' and amount < 0/.test(amount))
ok('...only as a set-off, with no VAT, never paid', /settlement = 'set_off'/.test(amount) && /vat = 0/.test(amount) && /paid_at is null/.test(amount))
const shape = lastConstraint('client_charges_brought_forward_shape')
ok('a brought-forward balance carries its source file and cell', /source_file is not null and source_ref is not null/.test(shape))
ok('...is never about one account', /account_id is null/.test(shape))
ok('once per client: a unique index on live brought-forward balances',
  /create unique index if not exists client_charges_brought_forward_once\s+on public\.client_charges \(company_id\)\s+where kind = 'brought_forward' and cancelled_at is null/.test(sql))

const bring = liveBody('bring_forward_client_balances')
ok('the import function exists', bring.length > 0)
ok('...security definer', /security definer/.test(bring))
ok('...Administrator, compared so a null role cannot slip through', /current_user_role\(\) is distinct from 'Administrator'/.test(bring))
ok('...AND the trust tick', /has_capability\('finance\.view'\)/.test(bring))
ok('...refuses one client on two rows', /count\(\*\) <> count\(distinct x->>'company_id'\)/.test(bring))
ok('...skips a client that already has one, rather than adding a second', /kind = 'brought_forward'[\s\S]*?cancelled_at is null\) then\s+v_skipped := v_skipped \+ 1;\s+continue;/.test(bring))
ok('...writes a set-off with no VAT, dated the cut-over', /'brought_forward', v_label, v_amount, 0, 'set_off', auth\.uid\(\), p_cut_over/.test(bring))
ok('...describes it as the screen says', /'Balance brought forward from Swordfish \(' \|\| to_char\(p_month, 'FMMonth YYYY'\) \|\| '\)'/.test(bring))
ok('...refuses a row with nothing to bring forward', /v_amount = 0 then/.test(bring))
ok('...and two presses at once cannot both write', /pg_advisory_xact_lock/.test(bring))
ok('anon cannot call it', /revoke all on function public\.bring_forward_client_balances\(text, date, date, jsonb\) from public, anon/.test(sql))

const ledger = liveBody('client_ledger')
ok('the ledger draws the brought-forward line', /'brought_forward',\s+c\.description/.test(ledger))
ok('...first thing on its day (midnight in Johannesburg)', /c\.raised_on::timestamp at time zone 'Africa\/Johannesburg', 'brought_forward'/.test(ledger))
ok('...and not again as a pending charge', /c\.settlement = 'set_off'\s+and c\.kind <> 'brought_forward'/.test(ledger))
ok('...the run’s set-off is shown less the brought-forward part it already drew',
  /e\.amount \+ case when e\.reason like 'Charges set off%' then coalesce\(\(\s+select sum\(b\.amount \+ b\.vat\) from public\.client_charges b\s+where b\.payover_run_id = e\.payover_run_id and b\.kind = 'brought_forward'\), 0\)/.test(ledger))
ok('...and a set-off left at nothing is not drawn', /not \(l\.kind = 'set_off' and l\.amount = 0\)/.test(ledger))
ok('...still behind the trust or business tick', /has_capability\('finance\.view'\) or public\.has_capability\('business\.view'\)/.test(ledger))

ok('Business income leaves it out of charges raised', /c\.kind <> 'brought_forward'/.test(liveBody('business_income')))
const month = liveBody('business_month')
ok('Business month leaves it out of invoiced', /raised_on between p_from and p_to\s+\/\*[^*]*\*\/\s+and kind <> 'brought_forward'/.test(month))
ok('...and a credit is not owed by clients', /cancelled_at is null and paid_at is null\s+\/\*[^*]*\*\/\s+and amount > 0/.test(month))

/* THE PAYOVER NEEDS NOTHING NEW, and that is the claim: the run nets the charge lines out of the
   net payover, so a negative line adds. Held here so a change to that arithmetic is seen. */
ok('the run still takes charges off the net payover', /\+ t\.carried_in\s+- t\.charges\s/.test(liveBody('recompute_payover_run')))
ok('...and claims set-off charges whatever their sign', /c\.settlement = 'set_off'\s+and c\.payover_run_id is null/.test(liveBody('build_payover_run')))

const revokeAt = sql.lastIndexOf("revoke execute on function public.%s from public, anon")
const loop = revokeAt > 0 ? sql.slice(sql.lastIndexOf('foreach fn in array array[', revokeAt), revokeAt) : ''
ok('the import is in the LAST finance revoke loop', /'bring_forward_client_balances\(text, date, date, jsonb\)'/.test(loop))

/* ---------------- the browser side ---------------- */

const payover = read('src/lib/payover.ts')
ok('the Finance library calls it (so check-finance-is-administrator-only covers it)',
  /\.rpc\('bring_forward_client_balances'/.test(payover))
const page = read('src/pages/trust/BroughtForward.tsx')
ok('the page reads the workbook in the browser with xlsx.ts', /readXlsxSheets\(await file\.arrayBuffer\(\)\)/.test(page))
ok('...sends the file NAME as the source, never the file', /source: fileName/.test(page) && !/storage\.from|upload\(/.test(page))
ok('...shows which month it is', /data-testid="bf-month"/.test(page) && /sheet\.monthLabel/.test(page))
ok('...defaults the cut-over', /useState\(DEFAULT_CUT_OVER\)/.test(page))
ok('...and the button waits until nothing waits on a person', /disabled=\{!summary\.ready/.test(page))
ok('the route is under the trust workspace', /path="brought-forward" element=\{<BroughtForward \/>\}/.test(read('src/App.tsx')))
ok('Trust settings opens it', /to="\/trust\/brought-forward"/.test(read('src/pages/finance/FinanceSettings.tsx')))
const advice = read('src/lib/remittanceAdvice.ts')
ok('the remittance advice says a credit is ADDED, not "less our charges"',
  /setOff > 0\)[\s\S]*?Less our charges[\s\S]*?setOff < 0\)[\s\S]*?Add the credit we owed you/.test(advice))
ok('Business’s list of client debts does not count a credit as a debt', /if \(gross <= 0\) continue/.test(read('src/lib/business.ts')))

console.log(`\ncheck-brought-forward: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
if (failures.length) process.exit(1)
