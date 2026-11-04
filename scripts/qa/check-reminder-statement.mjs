/**
 * THE ARRANGEMENT REMINDER CARRIES THE STATEMENT, AND legal@ SENDS FOR AN ACCOUNT NOBODY HOLDS (Raptor H16, S17, 4 Nov).
 *
 * Stephan: "Yeah, that's the statement to the reminder. I think legal." Two things, read back from source and the
 * schema, and the one pure function run:
 *   - the reminder email (both audiences) is flagged attaches_statement, the runner reads the flag and builds the
 *     statement with the SAME statementDocument the portal's download draws;
 *   - an account with no collector sends from legal@ where it is connected, holds (saying so) where it is not, and
 *     the debtor's code goes collector -> legal@ -> Administrators.
 */
import { readFileSync } from 'node:fs'
import { stripSqlComments } from './sqlComments.mjs'
import { UNASSIGNED_MAILBOX, withLegal } from '../../src/lib/unassignedMailbox.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

const schema = stripSqlComments(read('supabase/schema.sql'))
const step = read('api/_lib/workflow/step.ts')
const portal = read('api/_lib/debtorPortal.ts')
const stmt = read('src/lib/debtorStatement.ts')

/* ---------- the statement on the reminder ---------- */
ok('message_templates has attaches_statement, false unless said', /add column if not exists attaches_statement boolean not null default false/.test(schema))
ok('...only an email may carry it', /check \(attaches_statement = false or kind = 'email'\)/.test(schema))
const flagged = /update public\.message_templates\s+set attaches_statement = true\s+where seed_key in \(([^)]*)\)/.exec(schema)
check('...set on exactly the two arrangement reminder emails', flagged ? flagged[1].split(',').map((x) => x.trim()).sort() : null,
  ["'email-ptp-reminder-company'", "'email-ptp-reminder-individual'"])
ok('the runner reads the flag', /attachment_id, attaches_schedule, attaches_statement, seed_key/.test(step))
ok('...and builds the statement for THIS account today when it is set',
  /r\.attaches_statement\s*\?\s*\{ key: 'Statement of account', doc: statementDocument\(buildStatement\(balanceInput\)/.test(step))
ok('the portal download is drawn by the same statementDocument', /const doc = statementDocument\(st,/.test(stmt) && /export function statementDocument\(/.test(stmt))

/* ---------- legal@ for accounts nobody holds ---------- */
check('the address is the one the firm chose', UNASSIGNED_MAILBOX, 'legal@bredellferreira.co.za')
check('no legal@ connected: the order is unchanged', withLegal(['col', 'adm1', 'adm2'], 'col', null), ['col', 'adm1', 'adm2'])
check('connected: the collector, then legal@, then the Administrators', withLegal(['col', 'adm1', 'adm2'], 'col', 'legal'), ['col', 'legal', 'adm1', 'adm2'])
check('nobody holds the account: legal@ first', withLegal(['adm1', 'adm2'], null, 'legal'), ['legal', 'adm1', 'adm2'])
check('a collector who cannot send is not put back in front', withLegal(['adm1'], 'col', 'legal'), ['legal', 'adm1'])
ok('the debtor\'s code goes in that order', /const order = withLegal\(ordered,/.test(portal) && /for \(const senderId of order\)/.test(portal))
const holdAt = step.indexOf('is not connected in Raptor, so there is no mailbox')
const lookAt = step.indexOf(".from('email_connections').select('user_id').ilike('email', UNASSIGNED_MAILBOX)")
ok('a workflow email with no collector looks for legal@ BEFORE it holds', lookAt > 0 && holdAt > lookAt)
ok('...and is sent from whichever mailbox was chosen', /sendAsUser\(admin, senderId!,/.test(step) && !/sendAsUser\(admin, collector!\.id/.test(step))

if (failures.length) {
  console.log(`check-reminder-statement: ${pass} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-reminder-statement: ${pass} passed, 0 failed`)
