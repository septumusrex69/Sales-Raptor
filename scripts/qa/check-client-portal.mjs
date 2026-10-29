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
  PORTAL_TOPICS, portalTopic, portalSingleHandover, portalHandoverSheetName, portalHandoverPdfName, PORTAL_HANDOVER_MAX_BYTES, portalQuestion, portalPaymentReport, portalPaymentText, portalOutcomes,
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
for (const route of ['tickets', 'ticket', 'ticketReply', 'ask', 'callback', 'paymentReport', 'dashboard', 'reports', 'reportFile']) {
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

/* ---------- S15: what the client wants, a payment made to them, reports ---------- */
check('a topic off the list is kept', portalTopic('New details for the debtor'), 'New details for the debtor')
check('...anything else is Something else', portalTopic('<script>'), 'Something else')
check('the topic leads the ticket, on its own line', portalQuestion('An update on this account', 'Any news?'), 'An update on this account\n\nAny news?')
check('the list is short (Stephan: "we shouldn\'t make it too complicated")', PORTAL_TOPICS.length <= 6, true)
const T = '2026-10-28'
check('a payment needs an amount', portalPaymentReport({ amount: '0', paidOn: T, reference: 'x' }, T).ok, false)
check('...a day not in the future', portalPaymentReport({ amount: '10', paidOn: '2026-10-29', reference: 'x' }, T).ok, false)
check('...and a reference', portalPaymentReport({ amount: '10', paidOn: T, reference: ' ' }, T).ok, false)
check('R 1 500,50 reads as 1500.50', portalPaymentReport({ amount: 'R 1 500,50', paidOn: T, reference: 'x' }, T), { ok: true, report: { amount: 1500.5, paidOn: T, reference: 'x', note: '' } })
check('1,500.50 reads as 1500.50', portalPaymentReport({ amount: '1,500.50', paidOn: T, reference: 'x' }, T).report?.amount, 1500.5)
const ptcText = portalPaymentText({ amount: 1500.5, paidOn: T, reference: 'RCPT-9', note: '' })
check('the ticket says the amount, the day, the reference -- and that it waits for approval',
  /R 1 500\.50/.test(ptcText) && /2026-10-28/.test(ptcText) && /RCPT-9/.test(ptcText) && /approved/.test(ptcText) && !/\u00a0/.test(ptcText), true)

const pay = server.slice(server.indexOf('const paymentReport: Handler'), server.indexOf('const callback: Handler'))
check('a payment is recorded by portal_record_ptc, with the client from the SESSION', /rpc\('portal_record_ptc'/.test(pay) && /p_client: who\.companyId/.test(pay), true)
check('...BEFORE the ticket is made (a ticket about a refused payment is about nothing)', pay.indexOf("rpc('portal_record_ptc'") > 0 && pay.indexOf("rpc('portal_record_ptc'") < pay.indexOf("from('account_queries')"), true)
check('...and never written to the ledger from the server directly', /from\('account_payments'\)/.test(server), false)
const schemaSql = fs.readFileSync('supabase/schema.sql', 'utf8')
const ptcAt = schemaSql.lastIndexOf('create or replace function public.portal_record_ptc(')
const ptcFn = ptcAt >= 0 ? schemaSql.slice(ptcAt, schemaSql.indexOf('end $$;', ptcAt)) : ''
check('portal_record_ptc is in the schema', ptcAt > 0, true)
check('...checks the account is on the client\'s own book', /v_owner is distinct from p_client/.test(ptcFn), true)
check('...refuses a closed account, the future, before the handover, no reference, a same-day duplicate',
  /ended_as is not null/.test(ptcFn) && /> public\.raptor_today\(\)/.test(ptcFn) && /< v_a\.handover_date/.test(ptcFn)
  && /v_reference is null/.test(ptcFn) && /errcode = '23505'/.test(ptcFn), true)
check('...writes a PTC, from the portal, UNAPPROVED (approval stays in Trust)',
  /'portal', true, null/.test(ptcFn) && !/approved_at/.test(ptcFn.slice(ptcFn.indexOf('insert into'))), true)
const ptcGrants = schemaSql.slice(schemaSql.indexOf('end $$;', ptcAt), schemaSql.indexOf('end $$;', ptcAt) + 400)
check('...and only the service role may call it', /revoke all on function public\.portal_record_ptc[^;]*from public, anon, authenticated/.test(ptcGrants)
  && /grant execute on function public\.portal_record_ptc[^;]*to service_role/.test(ptcGrants), true)
const approve = fs.readFileSync('src/pages/finance/AwaitingApproval.tsx', 'utf8')
check('Trust\'s approval list marks a payment the client recorded', /source === 'portal'/.test(approve) && /From the client portal/.test(approve), true)

const rf = server.slice(server.indexOf('const reportFile: Handler'), server.indexOf('/* ------------------------------------------------------------------ staff'))
check('a report file is only given for the client\'s own group', /clientGroup\(admin, who\.companyId\)/.test(rf), true)
check('...as a short-lived link to the kept copy (never rebuilt)', /createSignedUrl\(path, 120/.test(rf) && /payover_run_sends/.test(rf), true)
const rp = server.slice(server.indexOf('const reports: Handler'), server.indexOf('const reportFile: Handler'))
check('the report list never hands the browser a storage path', /pdf_path:|xlsx_path:/.test(rp.slice(rp.indexOf('res.status(200)'))), false)
const dash = server.slice(server.indexOf('const dashboard: Handler'), server.indexOf('const reports: Handler'))
check('the dashboard is ONE read of the book (portal_summary), not a page-by-page walk', /rpc\('portal_summary'/.test(dash) && !/portal_book/.test(dash), true)
check('...turned into outcomes by portalOutcomes', /portalOutcomes\(d\.groups\)/.test(dash), true)
check('...and carries no fee, commission or interest', /commission|annexure|fee|interest/i.test(dash.replace(/\/\*[\s\S]*?\*\//g, '')), false)

/* ---------- outcomes: finished by how they finished, open by where they stand ---------- */
const G = (o) => ({ book: 'active', ended_as: null, status: 'Active: Activated', sub_status: null, bucket: null,
  paid_now: false, disputed: false, accounts: 1, handed_over: 100, outstanding: 80, paid_to_date: 20, ...o })
const out = portalOutcomes([
  G({ ended_as: 'paid_up', book: 'closed', accounts: 3, outstanding: 0 }),
  G({ ended_as: 'withdrawn', book: 'withdrawn', accounts: 1 }),
  G({ paid_now: true, accounts: 2 }),
  G({ disputed: true, accounts: 1 }),
  G({ accounts: 4 }),
  G({ book: 'closed', accounts: 1 }),
])
const of = (k) => out.find((o) => o.outcome === k)
check('paid up is counted by how it ended', of('paid_up')?.accounts, 3)
check('...withdrawn too', of('withdrawn')?.accounts, 1)
check('money this month on an open account is Paying', of('paying')?.accounts, 2)
check('an open dispute is Disputed', of('disputed')?.accounts, 1)
check('the rest sit where clientPosition puts them (In progress)', of('in_progress')?.accounts, 4)
check('a closed account with no ending is Closed', of('closed')?.accounts, 1)
check('open outcomes come first, finished after', out.findIndex((o) => o.finished) > out.findIndex((o) => !o.finished)
  && out.slice(out.findIndex((o) => o.finished)).every((o) => o.finished), true)
check('a finished account carries no outstanding', of('withdrawn')?.outstanding, 0)
const sch = fs.readFileSync('supabase/schema.sql', 'utf8')
const sumAt = sch.lastIndexOf('create or replace function public.portal_summary(')
const sumFn = sumAt > 0 ? sch.slice(sumAt, sch.indexOf('$$;', sch.indexOf('$$', sumAt) + 2)) : ''
check('portal_summary reads the client AND its sub-accounts, open and closed', /coalesce\(c\.parent_company_id, c\.id\) = p_client/.test(sumFn) && !/book in \('active', 'on_hold'\)\)\s*\n\s*\), paid/.test(sumFn), true)
check('...groups by exactly what a position is read off', /group by book, ended_as, status, sub_status, bucket, paid_this_month > 0, is_disputed/.test(sumFn), true)
check('...with portal_book\'s money rules', /reversed_at is null and p\.rejected_at is null and not coalesce\(p\.is_demo, false\)/.test(sumFn), true)
check('...service role only', /revoke all on function public\.portal_summary\(uuid\) from public, anon, authenticated/.test(sch)
  && /grant execute on function public\.portal_summary\(uuid\) to service_role/.test(sch), true)

/* ---------- handing accounts over (S15, phase 2b) ---------- */
check('a sheet is a csv, zip, xlsx or xlsm', ['a.xlsx', 'a.CSV', 'a.zip', 'a.xlsm', 'a.pdf', 'a.exe'].map(portalHandoverSheetName),
  ['a.xlsx', 'a.CSV', 'a.zip', 'a.xlsm', null, null])
check('...and a path in the name is flattened, never followed', portalHandoverSheetName('../../x/evil.xlsx'), '.. .. x evil.xlsx')
check('only PDFs go beside it', [portalHandoverPdfName('a.pdf'), portalHandoverPdfName('a.docx')], ['a.pdf', null])
check('the whole of it fits a request once it is base64 (4.5 MB)', PORTAL_HANDOVER_MAX_BYTES * 4 / 3 < 4.5e6, true)
check('one account needs their reference, the name, the amount and the date of default',
  ['client_reference', 'name', 'capital', 'default_date'].map((k) => {
    const full = { client_reference: 'X1', name: 'Smit', capital: '100', default_date: '01/02/2026' }
    delete full[k]; return portalSingleHandover(full).ok
  }), [false, false, false, false])
const one = portalSingleHandover({ client_reference: 'ALP-9', name: 'Smit & Seun, "Pty"', capital: 'R 12 500,50', default_date: '01/02/2026', debtor_kind: 'Business' })
check('one account becomes a one-line sheet headed with the sheet\'s own labels', one.ok && one.csv.split('\r\n')[0], 'Your reference,Person or business,"Surname, or the business name",Handover amount,Date of default')
check('...the amount a plain number, a comma or quote in a name kept whole', one.ok && one.csv.split('\r\n')[1], 'ALP-9,Business,"Smit & Seun, ""Pty""",12500.50,01/02/2026')
check('...and a person-or-business that is neither is refused', portalSingleHandover({ client_reference: 'X', name: 'Y', capital: '1', default_date: '1/1/2026', debtor_kind: 'Trust' }).ok, false)
const hs = server.slice(server.indexOf('async function receiveHandover'), server.indexOf('const handoverSingle: Handler') + 1200)
check('a handover is kept under the client from the session, never one named by the browser', /const folder = `\$\{who\.companyId\}\//.test(hs) && /company_id: who\.companyId/.test(hs), true)
check('...the files first, the row after (a row pointing at nothing is worse than none)', hs.indexOf('store.upload(sheetPath') > 0 && hs.indexOf('store.upload(sheetPath') < hs.indexOf("from('client_handover_submissions').insert"), true)
check('...and nothing in the portal loads an account', /from\('debtor_accounts'\)\.insert|handover_drafts|approveDraft/.test(server), false)
const decideAt = schemaSql.lastIndexOf('create or replace function public.decide_client_handover(')
const decideFn = decideAt > 0 ? schemaSql.slice(decideAt, schemaSql.indexOf('end $$;', decideAt)) : ''
check('deciding asks may_load_accounts, refuses a second decision, and a decline must say why',
  /may_load_accounts\(v_s\.company_id\)/.test(decideFn) && /v_s\.status <> 'received'/.test(decideFn) && /p_status = 'declined' and length/.test(decideFn), true)
check('the files are read under may_load_accounts on the client\'s folder', /portal_handovers_read on storage\.objects[\s\S]{0,200}may_load_accounts\(nullif\(\(storage\.foldername\(name\)\)\[1\]/.test(schemaSql), true)
const importCard = fs.readFileSync('src/components/settings/HandoverImportCard.tsx', 'utf8')
check('the import marks the portal handover loaded, with the batch, once accounts opened',
  /if \(fromPortal && result\.created > 0\)[\s\S]{0,120}decideClientHandover\(fromPortal\.id, 'loaded', \{ handoverId: result\.handoverId \}\)/.test(importCard), true)

if (failures.length) {
  console.log(`check-client-portal: ${pass} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-client-portal: ${pass} passed, 0 failed`)
