/**
 * THE DEBTOR PORTAL, PART 1 (Raptor H16): who can get in, and what they are told.
 *
 * A debtor signs in with the case number on our notices and a code sent to a contact the firm already holds. The case
 * number is not a secret -- it is printed on everything -- so what keeps a stranger out is that the code never goes
 * anywhere the stranger chose, and the answer never says whose case is whose. Both are held here.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-debtor-portal.mjs
 */
import { readFileSync } from 'node:fs'
import {
  normaliseCaseNumber, codeDestination, debtorCodeSms, debtorSummary, debtorPayments, DEBTOR_CODE_SENT, debtorCodeEmail,
} from '../../src/lib/debtorPortal.ts'
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

/* ---------- the case number, typed any way ---------- */
for (const typed of ['RAP-125318', 'rap-125318', 'RAP 125318', 'RAP125318', ' 125318 ', 'rap.125318']) check(`"${typed}" is RAP-125318`, normaliseCaseNumber(typed), 'RAP-125318')
check('words are not a case number', normaliseCaseNumber('my account'), null)
check('a client reference is not a case number', normaliseCaseNumber('ALIANNAPH/30182'), null)
check('nothing is not a case number', normaliseCaseNumber(''), null)

/* ---------- where the code goes ---------- */
const c = (kind, value, x = {}) => ({ kind, value, is_primary: false, retired_at: null, ...x })
check('email before a cellphone (an SMS costs, an email does not)',
  codeDestination([c('mobile', '0799746774', { is_primary: true }), c('email', 'a@b.co.za')]), { channel: 'email', to: 'a@b.co.za' })
check('the primary email of two', codeDestination([c('email', 'old@b.co.za'), c('email', 'new@b.co.za', { is_primary: true })]), { channel: 'email', to: 'new@b.co.za' })
check('a retired contact is never used -- the firm knows it is wrong',
  codeDestination([c('email', 'gone@b.co.za', { retired_at: '2026-10-01T00:00:00Z' }), c('mobile', '0799746774')]), { channel: 'sms', to: '0799746774' })
check('an address is not somewhere to send a code', codeDestination([c('address', '1 Long Street')]), null)
check('a malformed email is skipped for the mobile', codeDestination([c('email', 'not an email'), c('mobile', '0799746774')]), { channel: 'sms', to: '0799746774' })
check('no contact, no code', codeDestination([]), null)

/* ---------- what is said ---------- */
const sms = debtorCodeSms('123456')
ok(`the SMS is one segment (${sms.length} characters)`, sms.length <= 160)
ok('...in the GSM alphabet only -- no non-breaking space, no curly quote', /^[A-Za-z0-9 .,:!?()'@-]*$/.test(sms))
ok('the answer to "send me a code" never says whether the case exists', !/not found|no such|unknown|exists/i.test(DEBTOR_CODE_SENT))
const mail = debtorCodeEmail({ name: 'Tumelo <b>Patience', code: '123456', caseNumber: 'RAP-125318' })
ok('the code is in the email body, not the subject a lock screen shows', !mail.subject.includes('123456') && mail.html.includes('123456'))
ok('...and a name cannot write markup into it', !mail.html.includes('<b>Patience'))
ok('...in the firm\'s design, headed YOUR ACCOUNT, not CLIENT PORTAL', mail.html.includes('YOUR ACCOUNT') && !mail.html.includes('CLIENT PORTAL'))

/* ---------- the figures are computeBalance's, worded ---------- */
const b = { capital: 177.5, interest: 0, fees: 177.5, receiptFees: 0, vat: 23.15, payments: 0, balance: 355, settlementFee: 35.5, settlement: 390.5, cappedBy: 'in duplum', waived: 0, withheld: 26.64 }
const s = debtorSummary(b)
check('the balance and the settlement are passed through, not recomputed', [s.balance, s.settleToday, s.fees], [355, 390.5, 177.5])
ok('in duplum is said, as the law', /legal maximum \(the in duplum rule\)/.test(s.note ?? ''))
check('no note where nothing capped it', debtorSummary({ ...b, cappedBy: undefined }).note, null)
const pays = debtorPayments([
  { received_at: '2026-10-22T22:00:00Z', amount: '100', approved_at: '2026-10-24T10:00:00Z', reversed_at: null, rejected_at: null },
  { received_at: '2026-10-25T00:00:00+02:00', amount: 50, approved_at: null, reversed_at: null, rejected_at: null },
  { received_at: '2026-10-26T00:00:00+02:00', amount: 70, approved_at: '2026-10-27T10:00:00Z', reversed_at: '2026-10-28T10:00:00Z', rejected_at: null },
])
check('only payments that stand are shown -- not waiting, not reversed -- on their Johannesburg day', pays, [{ on: '2026-10-23', amount: 100 }])

/* ---------- the locks ---------- */
const schema = stripSqlComments(read('supabase/schema.sql'))
for (const t of ['debtor_portal_codes', 'debtor_portal_sessions']) {
  ok(`${t} has RLS on`, schema.includes(`alter table public.${t} enable row level security;`))
  ok(`...and no policy at all -- the portal's server is the only door`, !new RegExp(`create policy[^;]* on public\\.${t}\\b`).test(schema))
}
const api = read('api/_lib/debtorPortal.ts')
/* THE ONLY THING THE CALLER MAY SAY IS THE CASE NUMBER. Read as "every read of the request in this step is
   .caseNumber" rather than "no .email", because the first version of this assertion looked for `body.email` and
   passed a sabotage that read `(req.body ?? {}).email` -- a code sent wherever the caller asked. */
const askStep = api.slice(api.indexOf('const requestCode: Handler'), api.indexOf('const verify: Handler'))
const bodyReads = askStep.match(/req\.body[^\n]{0,24}/g) ?? []
ok(`the code goes to the account's own contact (${bodyReads.length} read(s) of the request, all the case number)`,
  askStep.length > 0 && /const dest = codeDestination\(\(contacts \?\? \[\]\) as ContactRow\[\]\)/.test(askStep)
  && bodyReads.length > 0 && bodyReads.every((r) => /^req\.body \?\? \{\}\)\.caseNumber/.test(r)))
ok('...and an unknown case gets the same answer as a real one',
  /if \(!acct \|\| !dest\) \{[\s\S]{0,200}res\.status\(200\)\.json\(\{ message: DEBTOR_CODE_SENT \}\)/.test(api))
ok('only the hash of the code and of the token is stored', /code_hash: keyedHash\('debtor-code'/.test(api) && /token_hash: keyedHash\('debtor-session', token\)/.test(api))
ok('the account read comes off the SESSION, never the request', /\.eq\('id', who\.accountId\)/.test(api) && !/req\.body[^\n]*accountId/.test(api))
ok('the balance is computeBalance, over the account page\'s own ledgers', /computeBalance\(balanceInputFor\(/.test(api))
/* AND THE ACCOUNT IS READ WITH EVERY COLUMN computeBalance NEEDS. Written out in the API (so check-select-columns can
   read it); a column ACCOUNT_SELECT gains later and this list misses would read as undefined and change the balance
   a debtor is shown -- the hand-written-mapper failure CLAUDE.md describes, in a new place. */
const needed = (read('src/lib/storedBalance.ts').match(/export const ACCOUNT_SELECT =\s*'([^']+)'/) ?? [])[1]?.split(',') ?? []
const acctSelect = (api.match(/from\('debtor_accounts'\)\s*(?:\/\*[\s\S]*?\*\/\s*)?\.select\('([^']+)'\)\s*\.eq\('id', who\.accountId\)/) ?? [])[1]?.split(',') ?? []
ok(`the account is read with every column the balance needs (${needed.length} of them)`, needed.length > 5 && needed.every((c) => acctSelect.includes(c)))
ok('how to pay is the TRUST account, with the case number as the reference', /trust_account_number/.test(api) && /reference: a\.case_number/.test(api) && !/business_bank/.test(api))

console.log(`\ncheck-debtor-portal: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
