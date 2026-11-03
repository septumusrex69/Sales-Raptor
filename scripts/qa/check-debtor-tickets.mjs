/**
 * A DEBTOR DISPUTES, OR ASKS (Raptor H16, debtor portal part 4).
 *
 * Stephan, 2 Nov: "raise a dispute or send a message that lands on their account as a ticket." Held here: a debtor's
 * reasons are the firm's own classifications underneath (so the reports count them); a portal dispute is a WRITTEN
 * dispute (it starts the real sequence and stops collection, as CLAUDE.md's three exits require); nothing is charged;
 * and a question is its own kind, never chargeable and never raised from the account page.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-debtor-tickets.mjs
 */
import { readFileSync } from 'node:fs'
import { DEBTOR_DISPUTE_REASONS, debtorDispute, debtorQuestion } from '../../src/lib/debtorPortal.ts'
import { QUERY_CATEGORIES, ESCALATION_KINDS, ESCALATION_KIND_ORDER, escalationChargeable, clientSection } from '../../src/lib/disputeCategories.ts'
import { stripSqlComments } from './sqlComments.mjs'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

const firms = new Set(QUERY_CATEGORIES.map((c) => c.value))
ok(`every reason a debtor can give is one of the firm's classifications (${DEBTOR_DISPUTE_REASONS.length})`, DEBTOR_DISPUTE_REASONS.every((r) => firms.has(r.category)))
ok('...and the debtor never sees the firm\'s jargon', DEBTOR_DISPUTE_REASONS.every((r) => !firms.has(r.label)))
check('a dispute needs a reason', debtorDispute({ text: 'The amount is far too high for what I bought' }).ok, false)
check('...and words', debtorDispute({ reason: 'The amount is wrong', text: 'wrong' }).ok, false)
check('...then it is classified as the firm classifies it', debtorDispute({ reason: 'This is not my debt', text: 'I never had an account with them.' }), { ok: true, category: 'Liability dispute', text: 'I never had an account with them.' })
check('"Something else" needs the firm\'s fifteen characters', debtorDispute({ reason: 'Something else', text: 'Not mine at all' }).ok, true)
check('...and not fewer', debtorDispute({ reason: 'Something else', text: 'Not mine!!' }).ok, false)
check('a question needs words', [debtorQuestion({ text: 'hi' }).ok, debtorQuestion({ text: 'Can I pay on the 25th?' }).ok], [false, true])

/* ---------- the new kind ---------- */
ok('the debtor\'s question is a kind of its own', !!ESCALATION_KINDS.debtor && /debtor asked/i.test(ESCALATION_KINDS.debtor.label))
ok('...never chargeable', escalationChargeable('debtor') === false)
ok('...not offered on the account page (only the portal raises it)', !ESCALATION_KIND_ORDER.includes('debtor'))
ok('...and on no client list', clientSection('debtor') === null)
const schema = stripSqlComments(read('supabase/schema.sql'))
const lastKind = schema.lastIndexOf('add constraint account_queries_kind_check')
ok('the table accepts it (the last definition of the kind check)', lastKind > 0 && /'debtor'\]\)\)/.test(schema.slice(lastKind, lastKind + 220)))

/* ---------- the server ---------- */
const api = read('api/_lib/debtorPortal.ts')
const disp = api.slice(api.indexOf('const dispute: Handler'), api.indexOf('const ask: Handler'))
const ask = api.slice(api.indexOf('const ask: Handler'), api.indexOf('const signOut: Handler'))
ok('a portal dispute is a WRITTEN dispute -- alleged and received today, in writing', /alleged_on: today, received_on: today, in_writing: true/.test(disp))
ok('...classified, and given to the client\'s liaison (or the collector)', /category: d\.category/.test(disp) && /const owner = liaison \?\? /.test(disp))
ok('...its sequence planned now, and the dispute saved even if that fails', /try \{ await sweep\(admin, \{ accountIds: \[a\.id as string\]/.test(disp) && disp.indexOf("from('account_queries').insert(") < disp.indexOf('await sweep('))
ok('...a second open dispute is answered in the debtor\'s terms', /error\?\.code === '23505'/.test(disp))
/* Stephan, 3 Nov: a dispute is "correspondence received ... just charge them for the correspondence received". */
ok('a portal dispute is charged item 6, as a debtor\'s email is -- the same constants, every cap', /chargeItemWith\(admin, \{[\s\S]{0,80}itemId: CORRESPONDENCE_ITEM_ID, actionCode: CORRESPONDENCE_ACTION_CODE/.test(disp))
ok('...never item 3', !/itemId: '3'|actionCode: 'dispute'/.test(disp))
ok('...and only after the ticket is saved', disp.indexOf("from('account_queries').insert(") >= 0 && disp.indexOf("from('account_queries').insert(") < disp.indexOf('chargeItemWith('))
ok('a question raises no fee', ask.length > 0 && !/chargeItem|account_fees|actionCode|itemId/.test(ask))
ok('a question is the debtor kind, with the collector', /kind: 'debtor'/.test(ask) && /owner_id: a\.assigned_to/.test(ask))

console.log(`\ncheck-debtor-tickets: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
