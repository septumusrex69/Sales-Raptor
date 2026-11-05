/**
 * THE DEBTOR PORTAL, PART 1 (Raptor H16): who can get in, and what they are told.
 *
 * A debtor signs in with the case number on our notices and a code sent to a contact the firm already holds. The case
 * number is not a secret -- it is printed on everything -- so what keeps a stranger out is that the code never goes
 * anywhere the stranger chose, and the answer never says whose case is whose. Both are held here.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-debtor-portal.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import {
  normaliseCaseNumber, codeDestination, debtorCodeSms, debtorSummary, debtorPayments, DEBTOR_CODE_SENT, debtorCodeEmail,
  debtorPopFile, debtorPopClaim, debtorPopNote, debtorPortalLink, debtorLogin,
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
/* THE FIRM'S LOGO, NOT ITS NAME TYPED (3 Nov, Stephan: "put the Bredell Ferreira logo there ... more in line with our
   branding"): the lockup from the sending site, its name as the alt text for a mail app that blocks pictures. */
const invite = debtorCodeEmail({ name: 'Elsabe', code: '123456', caseNumber: 'RAP-125340', url: 'https://raptor.example/my-account?case=RAP-125340' })
ok('the email wears the firm\'s logo, from the site that sent it', /<img src="https:\/\/raptor\.example\/brand\/email\/bf-lockup\.png"[^>]*alt="BREDELL FERREIRA"/.test(invite.html))
ok('...and the file is there to be fetched', existsSync(new URL('../../public/brand/email/bf-lockup.png', import.meta.url)))
ok('...and the firm\'s own line at the foot', /People &nbsp;\|&nbsp; Process &nbsp;\|&nbsp; Performance/.test(invite.html))

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

/* ---------- part 2: a proof of payment ---------- */
check('a bank app\'s PDF is a proof of payment', debtorPopFile('FNB Payment 23-10.pdf'), { name: 'FNB Payment 23-10.pdf', contentType: 'application/pdf' })
check('...so is an iPhone photo (HEIC)', debtorPopFile('IMG_0042.HEIC')?.contentType, 'image/heic')
check('a path in the name is dropped, and odd characters made safe', debtorPopFile('C:\\Users\\me\\slip <1>.jpg')?.name, 'slip _1_.jpg')
check('a spreadsheet or a program is not', [debtorPopFile('book.xlsx'), debtorPopFile('run.exe'), debtorPopFile('noextension')], [null, null, null])
check('amount and date are optional', debtorPopClaim({}, '2026-11-03'), { ok: true, amount: null, paidOn: null })
check('an amount typed with a comma', debtorPopClaim({ amount: 'R 1500,50' }, '2026-11-03'), { ok: true, amount: 1500.5, paidOn: null })
check('a date in the future is a typing mistake', debtorPopClaim({ paidOn: '2026-11-04' }, '2026-11-03').ok, false)
check('...and so is one more than a year back', debtorPopClaim({ paidOn: '2025-11-02' }, '2026-11-03').ok, false)
check('nought is not an amount paid', debtorPopClaim({ amount: '0' }, '2026-11-03').ok, false)
ok('the note says it is not yet money', /Check it against the trust account before it is treated as paid/.test(debtorPopNote('RAP-1', { amount: 500, paidOn: '2026-11-01' }, (n) => `R${n}`)))

/* ---------- the locks ---------- */
const schema = stripSqlComments(read('supabase/schema.sql'))
for (const t of ['debtor_portal_codes', 'debtor_portal_sessions', 'debtor_portal_logins']) {
  ok(`${t} has RLS on`, schema.includes(`alter table public.${t} enable row level security;`))
  ok(`...and no policy at all -- the portal's server is the only door`, !new RegExp(`create policy[^;]* on public\\.${t}\\b`).test(schema))
}
const api = read('api/_lib/debtorPortal.ts')

/* SIGN IN WITH WHAT YOU HAVE (Stephan, 4 Nov: "with your ID number ... your email address, or your case number"). */
const L = (x) => JSON.stringify(debtorLogin(x))
ok('a case number is a case number, however it is typed', L(' rap 125318 ') === JSON.stringify({ kind: 'case', value: 'RAP-125318' }))
ok('an email is an email, lower-cased', L(' Stephan@BredellFerreira.co.za ') === JSON.stringify({ kind: 'email', value: 'stephan@bredellferreira.co.za' }))
ok('an ID number is thirteen digits, spaces and dashes ignored', L('800101 5009 087') === JSON.stringify({ kind: 'id', value: '8001015009087' }))
ok('...and anything else is nothing, so the page says what to type', debtorLogin('blah') === null && debtorLogin('') === null && debtorLogin(42) === null && debtorLogin('12') === null)
ok('the server reads the login the same way on all three doors',
  ['const requestCode', 'const verify', 'const signIn'].every((h) => {
    const i = api.indexOf(`${h}: Handler`); return i >= 0 && /debtorLogin\((req\.)?body/.test(api.slice(i, i + 400)) || /debtorLogin\(\(req\.body/.test(api.slice(i, i + 400))
  }))
ok('a password opens only the account it belongs to, and a wrong one counts against each it was tried on',
  /const matched = open\.filter\(\(l\) => passwordMatches\(password/.test(api) && /for \(const l of open\)[\s\S]{0,200}password_failures/.test(api))
/* THE ONLY THING THE CALLER MAY SAY IS THE CASE NUMBER. Read as "every read of the request in this step is
   .caseNumber" rather than "no .email", because the first version of this assertion looked for `body.email` and
   passed a sabotage that read `(req.body ?? {}).email` -- a code sent wherever the caller asked. */
const askStep = api.slice(api.indexOf('const requestCode: Handler'), api.indexOf('const verify: Handler'))
const bodyReads = askStep.match(/req\.body[^\n]{0,24}/g) ?? []
ok(`the code goes to the account's own contact (${bodyReads.length} read(s) of the request, all the case number)`,
  askStep.length > 0 && /const dest = codeDestination\(\(contacts \?\? \[\]\) as ContactRow\[\]\)/.test(askStep)
  && bodyReads.length > 0 && bodyReads.every((r) => /^req\.body \?\? \{\}\)\.(login|caseNumber)\b/.test(r)))
/* A case number, ID number or email (4 Nov) names the account; the request still never names where the code goes. */
ok('...and a code goes only where exactly one account matches what was typed',
  /const acct = found\.length === 1 \? found\[0\] : null/.test(askStep) && /eq\('account_id', acct\.id\)/.test(askStep))
ok('...and an unknown account gets the same answer as a real one',
  /if \(!acct \|\| !dest\) \{[\s\S]{0,200}res\.status\(200\)\.json\(\{ message: DEBTOR_CODE_SENT \}\)/.test(api))
ok('only the hash of the code and of the token is stored', /code_hash: keyedHash\('debtor-code'/.test(api) && /token_hash: keyedHash\('debtor-session', token\)/.test(api))
/* Everything a DEBTOR calls -- i.e. the file without the staff invite, where a collector names the account and
   requireCaller has checked they are staff. */
const debtorSide = api.slice(0, api.indexOf('const invite: Handler')) + api.slice(api.indexOf('/* ------------------------------------------------------------------ a signed-in debtor */'))
ok('the account a debtor reads comes off the SESSION, never the request', /\.eq\('id', who\.accountId\)/.test(api) && !/req\.body[^\n]*accountId/.test(debtorSide))
ok('the balance is computeBalance, over the account page\'s own ledgers', /computeBalance\(balanceInputFor\(/.test(api))
/* AND THE ACCOUNT IS READ WITH EVERY COLUMN computeBalance NEEDS. Written out in the API (so check-select-columns can
   read it); a column ACCOUNT_SELECT gains later and this list misses would read as undefined and change the balance
   a debtor is shown -- the hand-written-mapper failure CLAUDE.md describes, in a new place. */
const needed = (read('src/lib/storedBalance.ts').match(/export const ACCOUNT_SELECT =\s*'([^']+)'/) ?? [])[1]?.split(',') ?? []
const acctSelect = (api.match(/from\('debtor_accounts'\)\s*(?:\/\*[\s\S]*?\*\/\s*)?\.select\('([^']+)'\)\s*\.eq\('id', who\.accountId\)/) ?? [])[1]?.split(',') ?? []
ok(`the account is read with every column the balance needs (${needed.length} of them)`, needed.length > 5 && needed.every((c) => acctSelect.includes(c)))
ok('how to pay is the TRUST account, with the case number as the reference', /trust_account_number/.test(api) && /reference: a\.case_number/.test(api) && !/business_bank/.test(api))

/* ---------- a code once, a password after (Stephan, 3 Nov: "do one ... But not every single time") ---------- */
const verifyStep = api.slice(api.indexOf('const verify: Handler'), api.indexOf('async function openDebtorSession('))
ok('a code confirms the debtor once, and asks for a password where there is none (or they forgot it)',
  /confirmed_at: new Date\(t\)\.toISOString\(\)/.test(verifyStep) && /needsPassword: !login\?\.password_hash \|\| body\.reset === true/.test(verifyStep))
const signInStep = api.slice(api.indexOf('const signIn: Handler'), api.indexOf('const setPassword: Handler'))
ok('the everyday sign-in is case number, ID number or email, and password, checked against the scrypt hash', /passwordMatches\(password, l\.password_hash as string\)/.test(signInStep))
ok('...one answer for an account that is not ours, no password yet, or a wrong one', (signInStep.match(/DEBTOR_PASSWORD_WRONG/g) ?? []).length === 1
  && /\.filter\(\(l\) => l\.password_hash\)/.test(signInStep) && /if \(matched\.length === 0\)/.test(signInStep))
ok('...and five wrong in a row lock it (the client portal\'s numbers)', /PORTAL_PASSWORD_FAILURES/.test(signInStep) && /password_locked_until/.test(signInStep))
const setStep = api.slice(api.indexOf('const setPassword: Handler'), api.indexOf('const invite: Handler'))
ok('a password is stored as its hash, never as typed, and only from a signed-in session', /requireDebtor\(req, admin\)/.test(setStep) && /password_hash: hashPassword\(password as string\)/.test(setStep) && /portalPasswordProblem\(password, null\)/.test(setStep))
ok('"keep me signed in" is a month; without it, a day', /\(remember \? DEBTOR_REMEMBER_DAYS : 1\) \* 86_400_000/.test(api))

/* ---------- inviting the debtor (Stephan, 3 Nov: "I don't know how to invite someone") ---------- */
const inviteStep = api.slice(api.indexOf('const invite: Handler'), api.indexOf('/* ------------------------------------------------------------------ a signed-in debtor */'))
ok('only somebody signed in to Raptor may invite', /const caller = await requireCaller\(req, admin\)/.test(inviteStep))
ok('...to the email ON THE ACCOUNT, never one typed here', /const dest = codeDestination\(\(contacts \?\? \[\]\) as ContactRow\[\]\)/.test(inviteStep) && !/req\.body[^\n]*\.(email|to)\b/.test(inviteStep))
ok('...from the inviter\'s own mailbox, noted on the timeline, not charged', /sendAsUser\(admin, me\.id as string/.test(inviteStep) && /account_notes'\)\.insert/.test(inviteStep) && !/chargeItem|account_fees/.test(inviteStep))
check('the link carries the case number, and nothing secret', debtorPortalLink('https://x.app/', 'RAP-125318'), 'https://x.app/my-account?case=RAP-125318')

console.log(`\ncheck-debtor-portal: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
