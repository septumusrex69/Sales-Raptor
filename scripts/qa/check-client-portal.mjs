/**
 * THE CLIENT PORTAL (S14, Raptor H13). A client signs in with an emailed code and is never a Supabase user;
 * the portal's server reads with the service role, so every line of protection is in what it reads and
 * for whom. See src/lib/clientPortal.ts and api/_lib/portal.ts.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-client-portal.mjs
 */
import fs from 'node:fs'
import {
  CODE_SENT_MESSAGE, PORTAL_CODE_MESSAGE, isPortalToken, normalisePortalEmail, portalCodeCheck, portalLine,
  PORTAL_MESSAGE_MAX, PORTAL_TICKET_LABEL, portalCallback, portalMessageText, portalTicketNo, portalTicketTurn,
} from '../../src/lib/clientPortal.ts'
import { ESCALATION_KINDS, ESCALATION_KIND_ORDER, clientSection } from '../../src/lib/disputeCategories.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`)
}
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/* ---------- one line per debtor: the firm's columns, and nothing the client should not read ---------- */
const row = {
  case_number: 'RAP-125321', account_number: 'ALP00013', client_reference: 'ALIANNAPH/30209', debtor: 'Alicia Smith',
  client_name: 'Alianna Pharmacy', capital_handed_over: 800.4, capital_outstanding: 600.4, paid_this_month: 0, paid_to_date: 200,
  status: 'Active: Unfrozen', sub_status: null, bucket: null, book: 'active', ended_as: null, disputed: false,
}
const line = portalLine(row)
check('the line carries exactly the firm\'s columns -- no status, sub-status, bucket or book', Object.keys(line).sort(),
  ['capitalHandedOver', 'capitalOutstanding', 'client', 'debtor', 'ourReference', 'paidThisMonth', 'paidToDate',
   'position', 'positionLabel', 'yourReference'])
check('nothing of the database\'s vocabulary leaks through any value', JSON.stringify(line).includes('Unfrozen'), false)
check('our reference is Raptor\'s case number', line.ourReference, 'RAP-125321')
check('their reference is their own filing first', line.yourReference, 'ALIANNAPH/30209')
check('...then the account number off their sheet', portalLine({ ...row, client_reference: null }).yourReference, 'ALP00013')
check('an untouched account is In progress', line.positionLabel, 'In progress')
check('money this month is Paying', portalLine({ ...row, paid_this_month: 50 }).positionLabel, 'Paying')
check('an open dispute is Disputed', portalLine({ ...row, disputed: true }).positionLabel, 'Disputed')
check('off the book is Closed', portalLine({ ...row, book: 'closed' }).positionLabel, 'Closed')
check('a section 129 is still In progress, never Legal', portalLine({ ...row, sub_status: 'Section 129' }).positionLabel, 'In progress')

/* ---------- the sign-in ---------- */
check('an address is lower-cased and trimmed', normalisePortalEmail('  Jan@Client.CO.ZA '), 'jan@client.co.za')
check('not an address is nothing', normalisePortalEmail('jan at client'), null)
check('a token is 64 hex', [isPortalToken('a'.repeat(64)), isPortalToken('a'.repeat(63)), isPortalToken('Z'.repeat(64))], [true, false, false])
const t0 = Date.parse('2026-10-28T08:00:00Z')
check('no code waiting', portalCodeCheck(null, t0), 'none')
check('expired before used-up', portalCodeCheck({ expiresAt: '2026-10-28T07:59:00Z', attempts: 9 }, t0), 'expired')
check('five wrong tries', portalCodeCheck({ expiresAt: '2026-10-28T08:05:00Z', attempts: 5 }, t0), 'used-up')
check('otherwise compare', portalCodeCheck({ expiresAt: '2026-10-28T08:05:00Z', attempts: 4 }, t0), 'compare')

/* ---------- the server: whose book, read by whom ---------- */
const api = fs.readFileSync('api/_lib/portal.ts', 'utf8')
const code = strip(api)
const body = (name) => {
  const at = code.indexOf(`const ${name}: Handler = async`)
  if (at < 0) return ''
  const next = code.indexOf(': Handler = async', at + `const ${name}: Handler`.length)
  return code.slice(at, next < 0 ? code.length : next)
}
const book = body('book')
check('the book route exists', book.length > 0, true)
check('the book asks for a portal session first', /requirePortalUser\(req, admin\)/.test(book) && book.indexOf('requirePortalUser') < book.indexOf("rpc('portal_book'"), true)
check('the CLIENT comes off the session, never the request', /p_client:\s*who\.companyId/.test(book) && !/p_client:\s*body/.test(book), true)
check('the book goes out through portalLine, so status columns never reach the browser', /\.map\(portalLine\)/.test(book), true)
for (const r of ['me', 'signOut']) check(`${r} asks for a portal session`, /requirePortalUser\(req, admin\)/.test(body(r)), true)
for (const r of ['staffList', 'staffInvite', 'staffSetActive']) check(`${r} asks for staff with the tick`, /requireStaff\(req, res, admin\)/.test(body(r)), true)
check('the staff tick is dispute.write_to_client', /'dispute\.write_to_client'/.test(code), true)
const req = body('requestCode')
check('an address that may not sign in gets the same answer as one that may',
  /if \(!user \|\| !user\.active\) \{\s*(console\.log\([^\n]*\)\s*)?res\.status\(200\)\.json\(\{ message: CODE_SENT_MESSAGE \}\); return\s*\}/.test(req), true)
/* S15 logs which it was, for the firm -- on the server only. The browser must still get one answer. */
check('...the log may say which, the response may not', /console\.log\([^\n]*\)\s*res\.status\(200\)\.json\(\{ message: CODE_SENT_MESSAGE \}\)/.test(req)
  && !/res\.status\(\d+\)\.json\(\{ message: (?!CODE_SENT_MESSAGE)/.test(req.slice(0, req.indexOf('resendDecision'))), true)
check('...and that answer does not say whether the address is known', /not|unknown|no such/i.test(CODE_SENT_MESSAGE.replace('If that address may sign in', '')), false)
check('a wrong code and no code read the same', /PORTAL_CODE_MESSAGE\.none/.test(body('verify')) && /not right/.test(PORTAL_CODE_MESSAGE.none), true)
check('a code is spent the moment it matches', /client_portal_codes'\)\.delete\(\)/.test(body('verify')), true)
check('switching somebody off signs them out now', /client_portal_sessions'\)\.delete\(\)\.eq\('user_id'/.test(body('staffSetActive')), true)
check('a switched-off contact\'s session stops working at once', /if \(!u \|\| !u\.active\) return null/.test(code), true)
check('only the hash of a code or a token is stored', /token_hash: keyedHash\('portal-session', token\)/.test(code) && /code_hash: keyedHash\('portal-code'/.test(code), true)

/* ---------- the database: no door but the server ---------- */
const schema = fs.readFileSync('supabase/schema.sql', 'utf8')
for (const t of ['client_portal_users', 'client_portal_codes', 'client_portal_sessions']) {
  check(`${t} exists`, schema.includes(`create table if not exists public.${t} (`), true)
  check(`${t} has RLS on`, schema.includes(`alter table public.${t} enable row level security;`), true)
  check(`${t} has NO policy -- not even a read`, new RegExp(`create policy[^;]*on public\\.${t}\\b`, 'i').test(schema), false)
  check(`${t} is not granted to the browser's roles`, new RegExp(`grant[^;]*on (table )?public\\.${t}\\b[^;]*(anon|authenticated)`, 'i').test(schema), false)
}
check('one address, one client', /create unique index if not exists client_portal_users_email_key on public\.client_portal_users \(lower\(email\)\)/.test(schema), true)
const sig = 'public.portal_book(uuid, text, boolean, integer, integer)'
check('portal_book is revoked from the browser\'s roles', schema.includes(`revoke all on function ${sig} from public, anon, authenticated;`), true)
check('...and granted to the server only', schema.includes(`grant execute on function ${sig} to service_role;`)
  && !new RegExp(`grant execute on function ${sig.replace(/[().]/g, '\\$&')} to [^;]*(anon|authenticated)`).test(schema), true)
const fnAt = schema.lastIndexOf('create or replace function public.portal_book(')
const fn = fnAt < 0 ? '' : schema.slice(fnAt, schema.indexOf('$$;', fnAt))
check('portal_book exists', fn.length > 0, true)
check('portal_book reads the client and its sub-accounts', /coalesce\(c\.parent_company_id, c\.id\) = p_client/.test(fn), true)
check('portal_book shows CAPITAL outstanding, never the balance with fees', /capital_outstanding/.test(fn) && !/account_balances|to_settle|fee/i.test(fn), true)
check('portal_book counts live money only', /reversed_at is null and p\.rejected_at is null and not coalesce\(p\.is_demo, false\)/.test(fn), true)
check('portal_book is security invoker', /security invoker/.test(fn), true)

/* ---------- the browser ---------- */
const page = fs.readFileSync('src/lib/portalApi.ts', 'utf8')
check('the portal\'s calls do not import Supabase -- a client has no Supabase session', /from '\.\/supabase'/.test(page), false)
check('...and send the session in its own header', /PORTAL_TOKEN_HEADER/.test(page), true)
const app = fs.readFileSync('src/App.tsx', 'utf8')
const portalRoute = app.indexOf('path="/portal"')
const requireAuth = app.indexOf('<RequireAuth>')
check('/portal is a route', portalRoute > 0, true)
check('/portal sits outside RequireAuth and the firm\'s navigation', requireAuth > 0 && portalRoute < requireAuth, true)

/* ---------- phase 2a (S15): tickets, questions, callbacks ---------- */
check('a ticket number reads as T-123, 123 or a number', [portalTicketNo('T-123'), portalTicketNo('123'), portalTicketNo(123), portalTicketNo('t123')], [123, 123, 123, 123])
check('...and nothing else is a ticket number', [portalTicketNo('1; drop'), portalTicketNo(''), portalTicketNo(null), portalTicketNo(-4)], [null, null, null, null])
check('an empty message is no message', [portalMessageText('   '), portalMessageText(undefined)], [null, null])
check('a message is trimmed and capped', portalMessageText(' hi\r\nthere ') === 'hi\nthere' && portalMessageText('x'.repeat(9000)).length === PORTAL_MESSAGE_MAX, true)
check('a callback needs a real number', portalCallback({ phone: '123' }).ok, false)
check('...a number and nothing else is fine, any time', portalCallback({ phone: '082 123 4567' }), { ok: true, phone: '082 123 4567', when: 'Any time', about: '' })
check('waiting on the client is theirs; any other open stage is ours', [portalTicketTurn({ status: 'open', stage: 'client' }), portalTicketTurn({ status: 'open', stage: 'liaison' }), portalTicketTurn({ status: 'closed', stage: 'client' })], ['yours', 'ours', 'closed'])
check('the client is told about exactly the kinds portal_tickets returns', Object.keys(PORTAL_TICKET_LABEL).sort(), ['client', 'dispute', 'import', 'litigation'])
check('a client\'s question is on their QUERY list', clientSection('client'), 'query')
check('...never raises item 3', ESCALATION_KINDS.client.chargeable, false)
check('...and is not offered on the staff Escalate menu (the client raises it, not an agent)', ESCALATION_KIND_ORDER.includes('client'), false)

const server = strip(fs.readFileSync('api/_lib/portal.ts', 'utf8'))
for (const route of ['tickets', 'ticket', 'ticketReply', 'ask', 'callback']) {
  const at = server.indexOf(`const ${route}: Handler`)
  const end = server.indexOf('\n}\n', at)
  const body = at >= 0 ? server.slice(at, end) : ''
  check(`${route} is a route`, at >= 0, true)
  check(`${route} asks who is signed in before anything else`, body.length > 0 && /requirePortalUser\(req, admin\)/.test(body.slice(0, 200)), true)
  check(`${route} never takes the client from the request`, /body\.(companyId|client|company)\b/.test(body), false)
}
const ownTicket = server.slice(server.indexOf('async function clientTicket'), server.indexOf('const tickets: Handler'))
check('a ticket is only found inside the client\'s own group', /clientGroup\(admin, who\.companyId\)/.test(ownTicket), true)
check('...and only of a kind the client may see', /\['dispute', 'import', 'litigation', 'client'\]/.test(ownTicket), true)
const replyBody = server.slice(server.indexOf('const ticketReply: Handler'), server.indexOf('async function clientAccount'))
check('a closed ticket takes no reply', /t\.status !== 'open'/.test(replyBody), true)
check('a reply hands the ticket back to the liaison', /stage: 'liaison'/.test(replyBody), true)
const ownAccount = server.slice(server.indexOf('async function clientAccount'), server.indexOf('const ask: Handler'))
check('an account is found by our reference inside the client\'s own group', /eq\('case_number'/.test(ownAccount) && /clientGroup\(admin, who\.companyId\)/.test(ownAccount), true)
check('a question is a client ticket on the liaison\'s stage', /kind: 'client', stage: 'liaison'/.test(server), true)
/* NOT CHARGED until the firm says a portal message is the same as an email (asked, S15). If they say
   yes, this check changes with the code -- deliberately, so the decision cannot happen by accident. */
check('nothing the client types is charged to the debtor yet', /chargeItemWith|chargeItem\(/.test(server), false)
check('...and the filed message says so in the row', /charged_excl_vat: 0/.test(server), true)

if (failures.length) {
  console.log(`check-client-portal: ${pass} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-client-portal: ${pass} passed, 0 failed`)
