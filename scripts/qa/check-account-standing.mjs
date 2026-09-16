/**
 * Who is behind a debtor, and what is already against them.
 *
 * Three facts that change what the call is, and that the book could hold none of:
 *
 *   - an appointed PRACTITIONER, because once a debtor is liquidated, sequestrated, curated,
 *     deceased, in business rescue or under debt review the debt is still owed but the DEBTOR IS
 *     NO LONGER THE PERSON TO ASK;
 *   - the DIRECTORS of a company, because a company is not rung, its people are;
 *   - JUDGMENTS other creditors already hold, which the firm has said will drive an internal
 *     likelihood of collection reported back to clients.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-account-standing.mjs
 */
import { readFileSync } from 'node:fs'
import {
  PRACTITIONER_KINDS, judgmentSummary, practitionerLabel, practitionerMeaning, sortDirectors,
} from '../../src/lib/accountStanding.ts'

let pass = 0
const failures = []
const ok = (name, actual) => {
  if (actual === true) { pass += 1; return }
  failures.push(`${name}\n    expected true\n    got      ${JSON.stringify(actual)}`)
}
const eq = (name, actual, expected) => {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const schema = read('../../supabase/schema.sql')
const book = read('../../src/lib/accountBook.ts')
const detail = read('../../src/pages/accounts/AccountDetail.tsx')

/* ---------- the practitioner: who to deal with instead of the debtor ---------- */

ok('the account can say who is appointed',
  /add column if not exists practitioner_kind/.test(schema))
/*
 * SIX KINDS, NOT FREE TEXT. Each is a different office with a different claim procedure, and a
 * collector has to tell them apart at a glance. Free text would let one estate be filed under
 * "liquidator", the next under "Liq." and the third under a firm's name.
 */
for (const kind of ['liquidator', 'trustee', 'curator', 'executor', 'business_rescue', 'debt_counsellor']) {
  ok(`...and '${kind}' is one of them`,
    new RegExp(`check \\(practitioner_kind in[\\s\\S]{0,200}'${kind}'`).test(schema))
}
/* Their reference, because every claim submission has to quote it back. */
ok('the estate reference is kept', /add column if not exists practitioner_reference text/.test(schema))
/* Claims run on deadlines counted from the appointment, not from our handover. */
ok('...and the appointment date', /add column if not exists practitioner_appointed_on date/.test(schema))
ok('the column says what null means',
  /comment on column public\.debtor_accounts\.practitioner_kind/.test(schema))

/* Every kind in the database has a label and a meaning in the app, and no more. */
eq('the app offers exactly the six the database allows', PRACTITIONER_KINDS.length, 6)
for (const p of PRACTITIONER_KINDS) {
  ok(`'${p.kind}' is in the column's check constraint`,
    new RegExp(`check \\(practitioner_kind in[\\s\\S]{0,200}'${p.kind}'`).test(schema))
  ok(`...and says what it means for the collector`, p.meaning.length > 20)
}
eq('a kind reads as a label', practitionerLabel('business_rescue'), 'Business rescue practitioner')
/* Null is the ordinary case — nobody appointed — and must not read as a missing label. */
eq('nobody appointed has no label', practitionerLabel(null), null)
eq('...and no meaning', practitionerMeaning(null), null)

/* ---------- and it survives the hand-written mapper ---------- */

/*
 * THE TRAP THIS CODEBASE ALREADY HAS A NAME FOR. accountBook.toAccount lists every field by
 * hand, so a column in the database, in the type and in the select('*') but missing from the
 * mapper reads as undefined for ever and nothing fails. diary_capacity sat there for months.
 */
for (const [field, column] of [
  ['practitionerKind', 'practitioner_kind'],
  ['practitionerName', 'practitioner_name'],
  ['practitionerFirm', 'practitioner_firm'],
  ['practitionerReference', 'practitioner_reference'],
  ['practitionerPhone', 'practitioner_phone'],
  ['practitionerEmail', 'practitioner_email'],
  ['practitionerAppointedOn', 'practitioner_appointed_on'],
]) {
  ok(`the type carries ${field}`, new RegExp(`\\n  ${field}:`).test(book))
  ok(`...and the mapper reads ${column}`, new RegExp(`${field}: \\(?r\\.${column}\\b`).test(book))
}

/* ---------- judgments ---------- */

ok('judgments have their own table', /create table if not exists public\.account_judgments/.test(schema))
/*
 * ROWS, NOT A COUNT. Which creditor and how long ago is the whole content: a count cannot tell a
 * small retail judgment from six years ago from SARS last year. Four columns carry that.
 */
for (const col of ['case_number', 'case_type', 'case_reason', 'plaintiff', 'filed_on', 'amount']) {
  ok(`...recording ${col}`,
    new RegExp(`create table if not exists public\\.account_judgments[\\s\\S]{0,900}\\n  ${col} `).test(schema))
}
/* A re-pulled bureau profile must update a judgment, never add a second copy of it. */
ok('a re-pulled profile cannot duplicate a judgment', /unique \(account_id, case_number\)/.test(schema))
ok('...and they are read newest first',
  /account_judgments_account_idx[\s\S]{0,90}\(account_id, filed_on desc\)/.test(schema))
ok('the table is not readable by the world',
  /alter table public\.account_judgments enable row level security/.test(schema))

/* ---------- what the judgments add up to ---------- */

const J = (over) => ({
  id: 'x', accountId: 'a', caseNumber: 'c', caseType: null, caseReason: null, plaintiff: null,
  filedOn: null, amount: null, source: 'xds', recordedAt: '2026-01-01T00:00:00Z', ...over,
})

const none = judgmentSummary([])
eq('no judgments is a count of none', none.count, 0)
eq('...with nothing to date', none.newest, null)
eq('...and nothing owing', none.total, 0)

const two = judgmentSummary([
  J({ id: 'j1', caseNumber: '40990/2023', filedOn: '2023-11-08', amount: 412870.44, plaintiff: 'SARS' }),
  J({ id: 'j2', caseNumber: '40021/2024', filedOn: '2024-10-04', amount: null, plaintiff: 'Bosveld Plant Hire' }),
])
eq('two judgments count as two', two.count, 2)
/*
 * THE NEWEST IS WHAT SAYS WHETHER THIS IS HISTORY OR A LIVE PROBLEM, and it is not the first row
 * or the last: the newest FILING date wins whatever order they arrive in. Both real judgments on
 * one real profile were filed out of case-number order.
 */
eq('...and the newest is the latest filing, not the first row', two.newest, '2024-10-04')
/*
 * A JUDGMENT WITHOUT AN AMOUNT IS NOT ZERO. A summary profile often carries none. Counting it as
 * zero would be a total that reads as the whole when it is a floor, so it is counted separately
 * and the panel says "at least".
 */
eq('...the total leaves out the ones with no amount', two.total, 412870.44)
eq('...and says how many those were', two.withoutAmount, 1)

const undated = judgmentSummary([J({ filedOn: null, amount: 100 })])
eq('a judgment with no filing date leaves the newest unknown', undated.newest, null)
eq('...but still counts', undated.count, 1)

/* ---------- directors ---------- */

const D = (fullName, status) => ({
  id: fullName, accountId: 'a', idNumber: null, fullName, status, appointedOn: null,
  source: 'xds', tracedAt: null,
})
/*
 * ACTIVE FIRST, THEN BY NAME. One real profile carries six directors of whom four have resigned.
 * Sorted by name alone the two people worth a call sit third and fifth in a list nobody reads to
 * the end — so the order is the difference between two calls and six.
 */
const sorted = sortDirectors([
  D('Yolanda Pillay', 'Resigned'),
  D('Thabo Radebe', 'Active'),
  D('Elmarie du Toit', 'Resigned'),
  D('Sipho Radebe', 'Active'),
])
eq('the active directors come first', sorted.slice(0, 2).every((d) => d.status === 'Active'), true)
eq('...in name order among themselves', sorted[0].fullName, 'Sipho Radebe')
eq('...and the resigned follow, also in name order', sorted[2].fullName, 'Elmarie du Toit')
/* Sorting must not reorder the caller's array under it — the fetch reuses the mapped list. */
const original = [D('B', 'Resigned'), D('A', 'Active')]
sortDirectors(original)
eq('sorting leaves the caller\'s list alone', original[0].fullName, 'B')
/*
 * AN UNKNOWN STATUS IS NOT ACTIVE. A bureau row with a blank status must not jump the queue.
 *
 * The names are deliberately the wrong way round: the blank-status director sorts FIRST by name,
 * so only a rule that ranks Active above everything else puts the active one on top. With both
 * names in alphabetical agreement the assertion passes whatever the rule is — which is exactly
 * how it read the first time.
 */
eq('an unknown status does not rank as active',
  sortDirectors([D('Abel Unknown', null), D('Zanele Active', 'Active')])[0].fullName, 'Zanele Active')

/* ---------- and the collector can see all of it ---------- */

ok('there is a panel for it', /function StandingPanel/.test(detail))
ok('...fetched with the account', /fetchStanding\(id\)/.test(detail))
ok('...and refetched after a write', /fetchStanding\(account\.id\)/.test(detail))
/*
 * ABOVE THE PROMISE BOX. A liquidator being appointed is the reason NOT to take a promise, and
 * two default judgments are the reason to doubt the one about to be taken. Below it, both are
 * read after the decision they should have changed.
 *
 * Presence asserted BEFORE order: indexOf returns -1 for something missing, so an order-only
 * assertion passes vacuously the day the panel is deleted.
 */
ok('the panel is placed on the page', /side=\{\[[^\]]*standingPanel/.test(detail))
ok('...and the promise box is too', /side=\{\[[^\]]*promisePanel/.test(detail))
const side = /side=\{\[([^\]]*)\]/.exec(detail)?.[1] ?? ''
ok('...with standing read before the promise is taken',
  side.indexOf('standingPanel') < side.indexOf('promisePanel'))
/*
 * SILENT WHEN THERE IS NOTHING TO SAY — for a PERSON.
 *
 * Nearly the whole book is individuals with no bureau profile pulled, and an empty card on
 * several hundred thousand accounts is a card people stop seeing.
 *
 * A COMPANY IS THE OTHER WAY ROUND. A company with no directors on file is incomplete — there is
 * nobody to ring — and the thing that fixes it is the upload button in this panel's header. So
 * the empty card is the useful state there, and it says what is missing.
 */
ok('the panel knows when it is empty',
  /const bare = !hasPractitioner && directors\.length === 0 && judgments\.length === 0/.test(detail))
ok('...and renders itself away, but only for a person',
  /if \(bare && account\.debtorKind !== 'company'\) return null/.test(detail))
ok('...while a company is told what is missing',
  /No bureau profile filed yet/.test(detail))
/*
 * A WARNING THAT ONLY FIRES WHEN SOMETHING IS ACTUALLY WRONG. The account reports as under
 * administration and there is no record of who is administering it — a claim nobody can submit.
 * On every other rung a missing practitioner is simply the normal case, and warning there would
 * train people to stop reading the warnings.
 */
ok('a missing practitioner is a warning only where it is one',
  /position === 'under_administration' && !hasPractitioner/.test(detail))
ok('...and it says what cannot happen until it is filled in',
  /Nobody recorded to claim from/.test(detail))
ok('the panel says not to deal with the debtor',
  /Deal with the \{\(kindLabel \?\? 'practitioner'\)\.toLowerCase\(\)\}, not the debtor/.test(detail))
/*
 * NO SCORE. The firm has said this data will drive a likelihood of collection reported back to
 * clients — which has to be calibrated against their own recovered outcomes, not invented here.
 * Until then the panel shows the rows and lets a collector read them. See BACKLOG.
 */
ok('the judgments are shown as rows, not as a score', /Judgments against them/.test(detail))
ok('...and the total says it is a floor when one has no amount',
  /summary\.withoutAmount > 0 \? 'At least ' : ''/.test(detail))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
An account can say who to deal with when the debtor is no longer the person to ask, who the
directors of a company are, and what judgments other creditors already hold. The judgments are
shown as rows and not as a score: the likelihood of collection they will feed goes onto a client
report, and has to be calibrated against the firm's own outcomes first.`)
