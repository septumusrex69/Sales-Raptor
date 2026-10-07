/**
 * A SETTLEMENT IS THE CLIENT'S FIGURE, AND ONLY AN APPROVED ONE IS EVER SAID (task #69).
 *
 * THE FIRM'S CALL SCRIPT IS THE SPEC, and its DO NOT list is what this file holds:
 *   "Quote a settlement figure that is not approved on the account."
 *   "Extend an expiry date yourself."
 *   "Call a part payment a settlement."
 * And two rulings from 7 Oct 2026: the client liaison role records the client's approval, and a
 * PERSON confirms a paid settlement -- nothing closes an account by itself.
 *
 * TWO HALVES. The rules as pure functions (which states are quotable, what counts as paid, what the
 * merge fields answer), and the database read back from schema.sql (the LAST definition of each
 * function, comments stripped -- a comment can claim a guard the code does not have, HANDOFF §6).
 * What the database DOES was proved on staging in a rolled-back transaction; see the commit.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-settlement.mjs
 */
import { readFileSync } from 'node:fs'
import {
  isQuotable, isPaidInFull, settlementMergeValues, SETTLEMENT_STATE_LABEL,
} from '../../src/lib/settlement.ts'
import { accountMergeValues } from '../../src/lib/accountMergeValues.ts'
import { MERGE_FIELDS, renderTemplate } from '../../src/lib/messageTemplates.ts'
import { CAPABILITIES, ROLE_CAPABILITIES } from '../../src/lib/capabilities.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').replace(/^\s*\/\/.*$/gm, '')

/* ---------------- which offers may be said ---------------- */

const base = {
  id: 's1', accountId: 'a1', amount: 18000, balanceAtOffer: 48250, balanceAsAt: '2026-10-07',
  saving: 30250, status: 'approved', state: 'approved', expiresOn: '2026-10-31',
  proposedBy: 'u1', proposedAt: '2026-10-07T08:00:00Z', proposalNote: null,
  approvedBy: 'u2', approvedAt: '2026-10-07T09:00:00Z', approvalEvidence: 'Email from client',
  closedBy: null, closedAt: null, closedReason: null, paidToward: 0,
}
const as = (state, extra = {}) => ({
  ...base, state, status: state === 'lapsed' ? 'approved' : state, ...extra,
})

ok('an approved, unlapsed offer may be quoted', isQuotable(as('approved')))
for (const st of ['proposed', 'lapsed', 'declined', 'withdrawn', 'paid']) {
  check(`...a ${st} one may not`, isQuotable(as(st)), false)
}
check('...nor no offer at all', isQuotable(null), false)
/* EVERY STATE HAS THE FIRM'S WORDS. A state with no label draws as its identifier. */
check('every state has a label', ['proposed', 'approved', 'lapsed', 'declined', 'withdrawn', 'paid']
  .filter((st) => !SETTLEMENT_STATE_LABEL[st]), [])

/* ---------------- what counts as paid ---------------- */

ok('paid in full when the trust account holds the figure', isPaidInFull(as('approved', { paidToward: 18000 })))
/* "A PART PAYMENT DOES NOT SETTLE IT", however close. */
check('...but not a rand short', isPaidInFull(as('approved', { paidToward: 17999 })), false)
/* MONEY THAT ARRIVED BEFORE THE EXPIRY STILL COUNTS AFTER IT. paidToward only counts money received
   by the expiry, so a lapsed offer that WAS paid in time is still closable. */
ok('...and a lapsed one paid in time is still paid', isPaidInFull(as('lapsed', { paidToward: 18000 })))
check('...a proposal is never paid -- the client never agreed it',
  isPaidInFull(as('proposed', { paidToward: 18000 })), false)
check('...nor a declined one', isPaidInFull(as('declined', { paidToward: 18000 })), false)

/* ---------------- the merge fields ---------------- */

const money = (n) => `R ${n.toFixed(2)}`
const longDate = (iso) => `long(${iso})`
check('the three fields answer off an approved offer',
  settlementMergeValues(as('approved'), money, longDate),
  { amount: 'R 18000.00', expiry: 'long(2026-10-31)', saving: 'R 30250.00' })
check('...and nothing off a proposal', settlementMergeValues(as('proposed'), money, longDate), null)
check('...or a lapsed one', settlementMergeValues(as('lapsed'), money, longDate), null)

const keys = new Set(MERGE_FIELDS.collections.map((f) => f.key))
ok('the three are in the collections vocabulary',
  ['settlement_amount', 'settlement_expiry', 'settlement_saving'].every((k) => keys.has(k)))
/* NOT OPTIONAL. An optional field's line leaves the message; a settlement letter with its figure
   quietly dropped is a wrong letter, not a shorter one. Only the identity number may go. */
check('...and none of them is optional',
  MERGE_FIELDS.collections.filter((f) => f.key.startsWith('settlement_') && f.optional).length, 0)

/* THE DECISION IS accountMergeValues', so both the page and the runner get it -- asserted through
   the assembly itself, not through mergeValuesFor, which takes the answer already decided. */
const firm = {
  firmName: 'Bredell Ferreira', email: 'info@example.co.za', phone: '012', website: null,
  officeHours: null, physicalAddress: null, postalAddress: null, signatoryName: null,
  signatoryTitle: null, paymentInstruction: null, trustBank: null, trustAccountName: null,
  trustAccountNumber: null, trustBranchCode: null, trustAccountType: null, businessBank: null,
  businessAccountName: null, businessAccountNumber: null, businessBranchCode: null,
}
const merged = (settlement) => accountMergeValues({
  account: {
    caseNumber: 'RAP-1', handoverDate: '2026-01-05', paymentsToDate: 0, listingDate: null,
    listingReference: null, bureausListed: null, debtorKind: 'individual', debtorTitle: 'Mr',
    debtorFirstName: 'A', debtorSurname: 'B', accountNumber: 'X1', clientReference: null,
    capitalOutstanding: 40000, capitalHandedOver: 40000, preferredLanguage: null,
  },
  balance: 48250, clientName: 'Probe (Pty) Ltd', agent: null, collector: null, liaison: null,
  debtorIdNumber: null, contacts: [], firm, today: '2026-10-07', money, settlement,
})
const line = '{{client_name}} accepts {{settlement_amount}} by {{settlement_expiry}}.'
check('the script line reads the approved figure',
  renderTemplate(line, merged(as('approved'))).missing, [])
ok('...with the amount in it', renderTemplate(line, merged(as('approved'))).text.includes('R 18000.00'))
/* THE FIRM'S DO NOT, ON THE PAGE: off a proposal the braces STAND, which is what holds an
   unattended step and what the composer warns about. */
check('...and leaves the braces standing off a proposal',
  renderTemplate(line, merged(as('proposed'))).missing, ['settlement_amount', 'settlement_expiry'])
check('...and off a lapsed one', renderTemplate(line, merged(as('lapsed'))).missing.length, 2)
check('...and off no offer at all', renderTemplate(line, merged(null)).missing.length, 2)

/* ---------------- who may do it ---------------- */

ok('settlement.approve is a capability the database enforces', CAPABILITIES['settlement.approve']?.inDatabase === true)
/* THE FIRM'S RULING: the client liaison role, and the Administrator who has everything. */
check('...held by the liaisons and the Administrator, and nobody else by default',
  Object.entries(ROLE_CAPABILITIES).filter(([, caps]) => caps.includes('settlement.approve'))
    .map(([role]) => role).sort(),
  ['Administrator', 'Liaison', 'Liaison Manager'])

/* ---------------- the database, read back ---------------- */

const sql = read('supabase/schema.sql')
const liveFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return null
  const end = sql.indexOf('\n$$;', at)
  return strip(sql.slice(at, end))
}
const approve = liveFn('approve_settlement')
const closeOffer = liveFn('close_settlement_offer')
const settle = liveFn('close_as_settled')
const reader = liveFn('account_settlement')
const propose = liveFn('propose_settlement')
ok('every function is in schema.sql', [approve, closeOffer, settle, reader, propose].every(Boolean))

/* THE TABLE HAS NO WRITE POLICY: every change goes through a function that asks the tick. A policy
   for insert or update would be a door around approve_settlement. */
const policies = strip(sql).match(/create policy \w+ on public\.account_settlements[\s\S]*?;/g) ?? []
check('account_settlements has one policy', policies.length, 1)
ok('...and it is for reading', /for select/.test(policies[0] ?? ''))

ok('approving asks settlement.approve', /has_capability\('settlement\.approve'\)/.test(approve ?? ''))
ok('...and refuses an expiry already past', /p_expires_on < public\.settlement_today\(\)/.test(approve ?? ''))
ok('...and refuses without saying how the client approved', /v_why is null/.test(approve ?? ''))
/* A SETTLEMENT IS LESS THAN THE BALANCE. A figure at or over it is a payment in full. */
ok('...and refuses a figure at or over the balance', /v_amount >= v_s\.balance_at_offer/.test(approve ?? ''))
ok('declining asks the same tick', /has_capability\('settlement\.approve'\)/.test(closeOffer ?? ''))
/* WITHDRAWING A PROPOSAL IS OPEN TO WHOEVER PUT IT UP -- and only a proposal, and only theirs. */
ok('...a proposer may withdraw only their own proposal',
  /p_as = 'withdrawn' and v_s\.status = 'proposed' and v_s\.proposed_by = auth\.uid\(\)/.test(closeOffer ?? ''))
ok('a proposal needs nobody\'s tick, only a session', /auth\.uid\(\) is null/.test(propose ?? '')
  && !/has_capability/.test(propose ?? ''))
ok('...and refuses a second live offer', /status in \('proposed', 'approved'\)/.test(propose ?? ''))

/* "A PART PAYMENT DOES NOT SETTLE IT", in the function that closes the account -- before it closes
   it. Presence first, then order: indexOf is -1 when a guard is deleted (CLAUDE.md). */
const partAt = (settle ?? '').indexOf('v_s.paid_toward < v_s.amount')
const closeAt = (settle ?? '').indexOf("public.settle_account(v_s.account_id, 'settled'")
ok('closing refuses a part payment', partAt > 0)
ok('...and closes through settle_account, as settled', closeAt > 0)
ok('...refusing before it closes', partAt > 0 && partAt < closeAt)
ok('...and only an approved settlement', /v_s\.status <> 'approved'/.test(settle ?? ''))

/* LAPSED IS DERIVED, ON JOHANNESBURG'S DATE -- never stored, so no nightly job can fail to run. */
ok('lapsed is worked out, not stored', /then 'lapsed'/.test(reader ?? ''))
check('...and is not a stored status', /'lapsed'/.test(strip(sql).match(/create table if not exists public\.account_settlements[\s\S]*?\n\);/)?.[0] ?? 'lapsed'), false)
ok('...against the firm\'s date', /Africa\/Johannesburg/.test(liveFn('settlement_today') ?? ''))
/* ONLY MONEY THAT IS REALLY THERE counts towards it. */
for (const col of ['approved_at is not null', 'reversed_at is null', 'rejected_at is null', 'suspended_at is null']) {
  ok(`paid-toward counts only payments where ${col}`, (reader ?? '').includes(`p.${col}`))
}

/* NOT REACHABLE BY anon. Postgres grants EXECUTE to PUBLIC on every new function (HANDOFF §6). */
for (const sig of ['settlement_today()', 'account_settlement(uuid)', 'propose_settlement(uuid, numeric, numeric, text)',
  'approve_settlement(uuid, date, text, numeric)', 'close_settlement_offer(uuid, text, text)', 'close_as_settled(uuid)']) {
  ok(`${sig} is revoked from public and anon`, sql.includes(`revoke all on function public.${sig} from public, anon;`))
}

/* ---------------- the two callers ---------------- */

const page = strip(read('src/pages/accounts/AccountDetail.tsx'))
const step = strip(read('api/_lib/workflow/step.ts'))
ok('the account page hands its settlement to the merge', /\n\s*settlement,\n/.test(page))
ok('...and pops the settlement script only off a quotable one', /settlementLive: isQuotable\(settlement\)/.test(page))
ok('...and draws the panel', /<SettlementPanel/.test(page))
ok('the workflow runner reads the settlement', /admin\.rpc\('account_settlement'/.test(step))
ok('...and hands it to the merge', /settlement: \(\(\) =>/.test(step))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-settlement: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
