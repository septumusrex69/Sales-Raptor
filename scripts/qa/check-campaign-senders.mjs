/**
 * S13 · CAMPAIGNS: WHO A NEWS CAMPAIGN COMES FROM, AND WHAT FOLLOWS IT UP.
 *
 * The firm, 26 Oct: bulk news may go "from each liaison individually ... the client is for Nicole, it goes
 * out from Nicole, but if the client is assigned to nobody, it just goes out from" reports@ -- and "the only
 * one at BF News is news at BF News". Held here:
 *
 *   - the liaison is the client's account owner ONLY when Active and a Liaison / Liaison Manager; a
 *     sub-account and its contacts follow the PARENT; a client waiting for one, or whose liaison has a
 *     private address Resend cannot send from, goes from reports@;
 *   - a LEAD always goes from news@, whatever was chosen;
 *   - the 22 Oct lock still refuses MARKETING_FROM and the prospect domain on bredellferreira.co.za --
 *     the firm's domain is opened only through firmSender;
 *   - the drain sends each row from the address written on it, with the key its domain needs, and never
 *     claims a row while the firm's key is missing (a claim counts an attempt);
 *   - the results split by sender add up to the campaign's own figures;
 *   - a follow-up reaches only people the email before reached, and never anybody who unsubscribed.
 *
 * Resend is never reached: every call is a stub.
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-campaign-senders.mjs
 */
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'

process.env.EMAIL_CREDENTIALS_KEY = crypto.randomBytes(32).toString('base64')
process.env.RESEND_API_KEY = 're_news_key'
process.env.MARKETING_FROM = 'Bredell Ferreira News <news@bfnews.co.za>'
delete process.env.RESEND_FIRM_API_KEY
delete process.env.VERCEL_ENV; delete process.env.VERCEL_URL; delete process.env.VERCEL_BRANCH_URL

const M = await import('../../src/lib/marketing.ts')
const S = await import('../../api/_lib/marketing.ts')

let pass = 0
const failures = []
const check = (name, got, want) => {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g === w) pass += 1
  else failures.push(`${name}\n      expected ${w}\n      got      ${g}`)
}
const ok = (name, v) => check(name, !!v, true)
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* ------------------------------------- the liaison rule ------------------------------------- */
{
  const people = new Map([
    ['nicole', { id: 'nicole', name: 'Nicole Loder', email: 'Nicole@BredellFerreira.co.za', role: 'Liaison', status: 'Active' }],
    ['ryno', { id: 'ryno', name: 'Ryno', email: 'ryno@bredellferreira.co.za', role: 'Liaison Manager', status: 'Active' }],
    ['gone', { id: 'gone', name: 'Left Us', email: 'left@bredellferreira.co.za', role: 'Liaison', status: 'Inactive' }],
    ['rep', { id: 'rep', name: 'A Rep', email: 'rep@bredellferreira.co.za', role: 'Sales Representative', status: 'Active' }],
    ['gmail', { id: 'gmail', name: 'Private', email: 'private@gmail.com', role: 'Liaison', status: 'Active' }],
  ])
  const companies = new Map([
    ['c1', { id: 'c1', accountOwnerId: 'nicole' }],
    ['c1sub', { id: 'c1sub', parentCompanyId: 'c1', accountOwnerId: 'ryno' }],
    ['c2', { id: 'c2', accountOwnerId: 'gone' }],
    ['c3', { id: 'c3', accountOwnerId: 'rep' }],
    ['c4', { id: 'c4', accountOwnerId: null }],
    ['c5', { id: 'c5', accountOwnerId: 'nicole', liaisonNeeded: true }],
    ['c6', { id: 'c6', accountOwnerId: 'gmail' }],
    ['c7', { id: 'c7', accountOwnerId: 'ryno' }],
  ])
  const ctx = { news: M.splitFrom(process.env.MARKETING_FROM), extra: null, liaisonOf: (id) => M.clientLiaison(id, companies, people) }
  const from = (mode, r) => { const s = M.senderForRecipient(mode, r, ctx); return [s.kind, s.address] }
  check('a client with an Active liaison goes from her own address', from('liaison', { companyId: 'c1' }), ['liaison', 'nicole@bredellferreira.co.za'])
  check('...credited to her', M.senderForRecipient('liaison', { companyId: 'c1' }, ctx).liaisonId, 'nicole')
  check('a sub-account follows its PARENT\'s liaison, not its own owner', from('liaison', { companyId: 'c1sub' }), ['liaison', 'nicole@bredellferreira.co.za'])
  check('...and so does a contact on it (the contact carries its own client\'s id)', from('liaison', { companyId: 'c1sub' }), ['liaison', 'nicole@bredellferreira.co.za'])
  check('a Liaison Manager is a liaison', from('liaison', { companyId: 'c7' }), ['liaison', 'ryno@bredellferreira.co.za'])
  check('a liaison who has left: reports@', from('liaison', { companyId: 'c2' }), ['reports', 'reports@bredellferreira.co.za'])
  check('an owner who is not a liaison: reports@', from('liaison', { companyId: 'c3' }), ['reports', 'reports@bredellferreira.co.za'])
  check('no owner: reports@', from('liaison', { companyId: 'c4' }), ['reports', 'reports@bredellferreira.co.za'])
  check('a client waiting for a liaison: reports@', from('liaison', { companyId: 'c5' }), ['reports', 'reports@bredellferreira.co.za'])
  check('a liaison with a private address Resend cannot send from: reports@', from('liaison', { companyId: 'c6' }), ['reports', 'reports@bredellferreira.co.za'])
  for (const mode of ['news', 'liaison', 'reports', 'address']) {
    check(`a LEAD goes from news@ whatever is chosen (${mode})`, from(mode, { leadId: 'l1' }), ['news', 'news@bfnews.co.za'])
  }
  check('BF News is news@ for clients too', from('news', { companyId: 'c1' }), ['news', 'news@bfnews.co.za'])
  check('Reports is reports@ for every client', from('reports', { companyId: 'c1' }), ['reports', 'reports@bredellferreira.co.za'])
  const withExtra = { ...ctx, extra: { name: 'BF Marketing', address: 'marketing@bredellferreira.co.za' } }
  check('an extra address sends from itself', M.senderForRecipient('address', { companyId: 'c1' }, withExtra).address, 'marketing@bredellferreira.co.za')
  check('...and with none chosen, falls back to reports@ rather than to nobody', from('address', { companyId: 'c1' }), ['reports', 'reports@bredellferreira.co.za'])
  check('the stored choice is read safely: anything unknown is BF News', [M.parseSendFrom('liaison'), M.parseSendFrom('team'), M.parseSendFrom(null)], ['liaison', 'news', 'news'])
}

/* ------------------------------------- the split before Send ------------------------------------- */
{
  const row = (kind, label, address) => ({ kind, label, address, name: label, liaisonId: null })
  const rows = [
    ...Array(9).fill(row('reports', 'reports@', 'reports@bredellferreira.co.za')),
    ...Array(31).fill(row('liaison', 'Ryno', 'ryno@bredellferreira.co.za')),
    ...Array(12).fill(row('news', 'news@ (leads)', 'news@bfnews.co.za')),
    ...Array(42).fill(row('liaison', 'Nicole Loder', 'nicole@bredellferreira.co.za')),
  ]
  check('the preview says the split, people first and biggest first', M.describeSplit(M.senderSplit(rows)),
    'From Nicole Loder 42 · Ryno 31 · reports@ 9 · news@ (leads) 12')
  check('...and the shares add up to the list', M.senderSplit(rows).reduce((a, s) => a + s.count, 0), rows.length)
}

/* ------------------------------------- the domain lock ------------------------------------- */
{
  ok('the 22 Oct lock still refuses MARKETING_FROM on the firm\'s domain', 'error' in M.newsSender('News <news@bredellferreira.co.za>', null))
  ok('...and on a subdomain of it', 'error' in M.newsSender('news@mail.bredellferreira.co.za', null))
  ok('...and still refuses the prospect domain there', 'error' in M.prospectSender('bredellferreira.co.za', { name: 'R', email: 'r@bredellferreira.co.za' }))
  check('the deliberate door: a liaison goes from the firm\'s domain, replying to herself',
    M.firmSender('Nicole Loder', 'nicole@bredellferreira.co.za'), { from: '"Nicole Loder" <nicole@bredellferreira.co.za>', replyTo: 'nicole@bredellferreira.co.za' })
  ok('...but only the two domains set up for sending', 'error' in M.firmSender('X', 'x@gmail.com'))
  ok('...and not a subdomain', 'error' in M.firmSender('X', 'x@mail.bredellferreira.co.za'))
  ok('...and a quote typed into a name cannot break the header', !/"[^"]*"[^<]*"/.test(M.firmSender('Ni"cole <x>', 'n@bfnews.co.za').from))
  check('an extra address on either domain may be added', [M.senderAddressProblem('marketing@bredellferreira.co.za'), M.senderAddressProblem('Hello@BFNews.co.za')], [null, null])
  ok('...an address anywhere else is refused, and says which domains', /bredellferreira\.co\.za or bfnews\.co\.za/.test(M.senderAddressProblem('me@gmail.com') ?? ''))
  ok('...as is something that is not an address', !!M.senderAddressProblem('marketing'))
  check('the firm\'s domain needs the second key; the news domain the first',
    [M.resendKeyEnvFor('reports@bredellferreira.co.za'), M.resendKeyEnvFor('news@bfnews.co.za')], ['RESEND_FIRM_API_KEY', 'RESEND_API_KEY'])
  /* The extra-address rule and the database's check name the same two domains. */
  const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
  const table = sql.slice(sql.indexOf('create table if not exists public.marketing_senders'))
  ok('marketing_senders holds the same two domains', table.includes('bredellferreira\\.co\\.za|bfnews\\.co\\.za'))
}

/* ------------------------------------- the screen's readiness ------------------------------------- */
{
  const base = { ready: true, missing: [], firm: { ready: false, missing: ['RESEND_FIRM_API_KEY'] } }
  check('without the firm key, the liaisons cannot be chosen, and the screen says what to set',
    S.sendFromNotReady(base, 'liaison'), 'Sending from the liaisons is not set up yet: RESEND_FIRM_API_KEY must be set in Vercel.')
  ok('...nor reports@', /reports@ is not set up yet/.test(S.sendFromNotReady(base, 'reports') ?? ''))
  check('...but BF News, and an extra address on bfnews.co.za, can', [S.sendFromNotReady(base, 'news'), S.sendFromNotReady(base, 'address', 'hello@bfnews.co.za')], [null, null])
  check('with the key, all can', S.sendFromNotReady({ ...base, firm: { ready: true, missing: [] } }, 'liaison'), null)
}

/* ------------------------------------- the drain ------------------------------------- */
/** Enough of a Supabase client for the drain, with profiles and extra senders to name a From. */
function fakeAdmin(db) {
  const log = { records: [], activities: [], claims: 0 }
  const builder = (table) => {
    const b = {
      select: () => b, eq: () => b, neq: () => b, not: () => b, order: () => b, limit: () => b, range: () => b, in: () => b, is: () => b,
      ilike: (c, v) => { b.who = v; return b },
      insert: (rows) => { if (table === 'activities') log.activities.push(...rows); return Promise.resolve({ error: null }) },
      update: () => b,
      maybeSingle: () => Promise.resolve({ data: table === 'marketing_campaigns' ? db.campaign
        : table === 'firm_settings' ? { firm_name: 'Bredell Ferreira' }
          : table === 'profiles' ? (db.people ?? []).find((p) => p.email === b.who) ?? null
            : table === 'marketing_senders' ? null : null }),
      then: (res) => res(table === 'marketing_sends' ? { count: db.queue.length }
        : table === 'marketing_campaigns' ? { data: db.campaign ? [db.campaign] : [] }
          : table === 'leads' ? { data: db.leads ?? [], error: null } : { data: [], error: null }),
    }
    return b
  }
  return {
    log, from: builder,
    rpc: async (name, args) => {
      if (name === 'marketing_claim_sends') { log.claims += 1; return { data: db.queue.splice(0, args.p_limit), error: null } }
      if (name === 'marketing_record_results') { log.records.push(...args.p_results); return { data: 1, error: null } }
      return { data: null, error: null }
    },
  }
}
const row = (i, email, sender, extra = {}) => ({ id: `s${i}`, campaign_id: 'c', email, first_name: 'Anna', company_name: 'Smit', company_id: 'c1', contact_id: null, lead_id: null, first_approach: false, attempts: 1, sender, ...extra })
const liaisonCampaign = { id: 'c', name: 'n', subject: 'October', preheader: '', body: 'Hi', image_url: null, audience: { kind: 'all_clients' }, first_approach: false, kind: 'news', status: 'sending', created_by: 'u1', queued_by: 'u2', send_from: 'liaison' }
const capture = (calls) => async (url, init) => {
  const list = JSON.parse(init.body)
  const mails = Array.isArray(list) ? list : [list]
  calls.push({ key: init.headers.Authorization, mails })
  return { ok: true, status: 200, json: async () => (Array.isArray(list) ? { data: list.map((_, i) => ({ id: `re_${i}` })) } : { id: 're_0' }) }
}
{
  /* No firm key: a liaison campaign's rows are NOT claimed -- a claim counts an attempt. */
  const db = { campaign: liaisonCampaign, queue: [row(1, 'a@x.co', 'nicole@bredellferreira.co.za')], people: [] }
  const admin = fakeAdmin(db)
  const calls = []
  const report = await S.drainMarketing(admin, { budgetMs: 3000, host: 'raptor.test', fetchImpl: capture(calls) })
  check('without the firm key a liaison campaign is not claimed at all', [admin.log.claims, calls.length], [0, 0])
  ok('...and the report says what to set', /RESEND_FIRM_API_KEY must be set in Vercel/.test(report.stoppedFor ?? ''))
}
{
  process.env.RESEND_FIRM_API_KEY = 're_firm_key'
  const db = {
    campaign: liaisonCampaign,
    people: [{ id: 'nicole', name: 'Nicole Loder', email: 'nicole@bredellferreira.co.za' }],
    /* A lead goes only with its yes on record (POPIA s69) -- this one said yes. */
    leads: [{ id: 'l1', marketing_consent_at: '2026-10-01T08:00:00Z' }],
    queue: [row(1, 'a@x.co', 'nicole@bredellferreira.co.za'), row(2, 'b@x.co', 'reports@bredellferreira.co.za'),
      row(3, 'lead@x.co', 'news@bfnews.co.za', { company_id: null, lead_id: 'l1' }), row(4, 'c@x.co', 'nicole@bredellferreira.co.za')],
  }
  const admin = fakeAdmin(db)
  const calls = []
  await S.drainMarketing(admin, { budgetMs: 8000, host: 'raptor.test', fetchImpl: capture(calls) })
  const byFrom = Object.fromEntries(calls.map((c) => [c.mails[0].from, { key: c.key, to: c.mails.map((m) => m.to[0]), replyTo: c.mails[0].reply_to }]))
  check('each row goes from the address written on it at queue time: Nicole\'s two together',
    byFrom['"Nicole Loder" <nicole@bredellferreira.co.za>']?.to, ['a@x.co', 'c@x.co'])
  check('...with the firm\'s key, replying to Nicole', [byFrom['"Nicole Loder" <nicole@bredellferreira.co.za>']?.key, byFrom['"Nicole Loder" <nicole@bredellferreira.co.za>']?.replyTo],
    ['Bearer re_firm_key', 'nicole@bredellferreira.co.za'])
  check('reports@ signs as the firm, with the firm\'s key', [byFrom['"Bredell Ferreira" <reports@bredellferreira.co.za>']?.to, byFrom['"Bredell Ferreira" <reports@bredellferreira.co.za>']?.key],
    [['b@x.co'], 'Bearer re_firm_key'])
  check('the lead goes from news@ with the news key', [byFrom['Bredell Ferreira News <news@bfnews.co.za>']?.to, byFrom['Bredell Ferreira News <news@bfnews.co.za>']?.key],
    [['lead@x.co'], 'Bearer re_news_key'])
  ok('every one of them still carries the one-click unsubscribe', calls.every((c) => c.mails.every((m) => /unsubscribe\?t=/.test(m.headers['List-Unsubscribe']) && m.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click')))
  check('the timeline line for Nicole\'s clients is credited to Nicole',
    admin.log.activities.filter((a) => a.notes === 'Sent to a@x.co' || a.notes === 'Sent to c@x.co').map((a) => a.user_id), ['nicole', 'nicole'])
  check('...and the rest to whoever pressed Send', admin.log.activities.filter((a) => a.notes === 'Sent to b@x.co').map((a) => a.user_id), ['u2'])
  delete process.env.RESEND_FIRM_API_KEY
}

/* ------------------------------------- results by sender ------------------------------------- */
{
  const s = (sender, state, extra = {}) => ({ sender, state, resend_id: state === 'queued' ? null : 'r', delivered_at: null, first_opened_at: null, first_clicked_at: null, unsubscribed_at: null, ...extra })
  const rows = [
    s('nicole@bredellferreira.co.za', 'sent', { delivered_at: 't', first_opened_at: 't' }),
    s('nicole@bredellferreira.co.za', 'bounced'),
    s('reports@bredellferreira.co.za', 'sent', { delivered_at: 't', first_clicked_at: 't', first_opened_at: 't' }),
    s('reports@bredellferreira.co.za', 'sent', { delivered_at: 't', unsubscribed_at: 't' }),
    s(null, 'queued'), s(null, 'skipped'),
  ]
  const by = M.resultsBySender(rows)
  const sum = (k) => by.reduce((a, r) => a + r[k], 0)
  check('the per-sender rows add up to the campaign', ['total', 'accepted', 'delivered', 'bounced', 'opened', 'clicked', 'unsubscribed', 'queued', 'skipped'].map(sum), [6, 4, 3, 1, 2, 1, 1, 1, 1])
  check('...a bounce is not delivered and is counted against its sender', by.find((r) => r.sender === 'nicole@bredellferreira.co.za')?.bounced, 1)
  /* The same filters as marketing_campaign_results(): if that function changes, this must too. */
  const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
  const fn = sql.slice(sql.lastIndexOf('create or replace function public.marketing_campaign_results('))
  ok('...counted with the database\'s own filters', /s\.resend_id is not null and s\.state in \('sent', 'bounced', 'complained'\)/.test(fn)
    && /s\.delivered_at is not null and s\.state <> 'bounced'/.test(fn))
}

/* ------------------------------------- follow-ups ------------------------------------- */
{
  const r = (state, o = {}) => ({ state, first_opened_at: null, first_clicked_at: null, unsubscribed_at: null, ...o })
  check('a follow-up reaches only who the email before reached', ['bounced', 'failed', 'skipped', 'complained', 'queued'].map((st) => M.inWorkflowAudience('everyone', r(st))), [false, false, false, false, false])
  check('...never anybody who unsubscribed from it', M.inWorkflowAudience('everyone', r('sent', { unsubscribed_at: 't' })), false)
  check('"did not open" and "opened" split the delivered', [M.inWorkflowAudience('not_opened', r('sent')), M.inWorkflowAudience('not_opened', r('sent', { first_opened_at: 't' })), M.inWorkflowAudience('opened', r('sent', { first_opened_at: 't' }))], [true, false, true])
  check('"did not click" and "clicked" likewise', [M.inWorkflowAudience('not_clicked', r('sent')), M.inWorkflowAudience('clicked', r('sent', { first_clicked_at: 't' }))], [true, true])
  check('an unknown audience is read as "did not open", the database\'s default', M.parseWorkflowAudience('banana'), 'not_opened')
  check('due N days after the email before finished, on Johannesburg\'s day', M.followUpDueOn('2026-10-28T23:30:00Z', 20), '2026-11-18')
  check('...nothing is due before it has gone', M.followUpDueOn(null, 20), null)

  const src = strip(readFileSync(new URL('../../api/_lib/marketing.ts', import.meta.url), 'utf8'))
  const q = src.slice(src.indexOf('export async function queueWorkflowStep'), src.indexOf('export async function campaignFigures'))
  const stamp = q.indexOf(".update({ run_at: nowIso })")
  const insert = q.indexOf(".from('marketing_sends').insert(")
  ok('a step is stamped on condition BEFORE its list is queued, so two mornings cannot both send it', stamp > 0 && insert > 0 && stamp < insert && /\.is\('run_at', null\)\.select\('id'\)/.test(q))
  ok('...and un-stamped if the list cannot be saved', /if \(error\) \{[\s\S]{0,300}update\(\{ run_at: null \}\)/.test(q))
  ok('only News can be a follow-up', /campaign\.kind !== 'news'/.test(q))
  ok('a follow-up\'s rows are first approaches never', /first_approach: false, sender:/.test(q))
  const rr = src.slice(src.indexOf('export async function sendResultsEmail'))
  const rstamp = rr.indexOf("update({ results_sent_at: new Date().toISOString() })")
  const rsend = rr.indexOf('await resendSend(')
  ok('the results email is stamped before it goes, so it never goes twice', rstamp > 0 && rsend > 0 && rstamp < rsend && /\.is\('results_sent_at', null\)/.test(rr))
  ok('...and un-stamped when Resend refuses it, to try again tomorrow', /if \(!outcome\.ok\) \{[\s\S]{0,200}results_sent_at: null/.test(rr))
  ok('...and it does not claim to know what was deleted unread', /No mail system reports what was deleted unread/.test(rr))
}

/* ------------------------------------- the queue writes who ------------------------------------- */
{
  const src = strip(readFileSync(new URL('../../api/_lib/marketing.ts', import.meta.url), 'utf8'))
  const queue = src.slice(src.indexOf('export async function queueCampaign'), src.indexOf('export interface Allowance'))
  ok('the queue writes each row\'s bare From address', /sender: resolved\.senders\?\.\[i\]\?\.address \?\? null/.test(queue))
  ok('...from the same resolve as the preview', /resolveOnServer\(admin, campaign\.audience, campaign\.kind,\s*\{ sendFrom: campaign\.send_from/.test(queue))
  ok('...and refuses a sender that is not set up', /sendFromNotReady\(await senderConfig\(admin\), campaign\.send_from/.test(queue))
  const resolve = src.slice(src.indexOf('export async function resolveOnServer'), src.indexOf('async function clientStoppedEmails'))
  ok('introductions and prospects get no sender here: theirs is the marketer\'s', /if \(kind !== 'news'\) return \{ \.\.\.resolved, senders: null \}/.test(resolve))
  const route = strip(readFileSync(new URL('../../api/_lib/email/marketing.ts', import.meta.url), 'utf8'))
  ok('the preview returns the split from that same resolve', /senders: resolved\.senders \? senderSplit\(resolved\.senders\) : null/.test(route))
}

console.log(`\ncheck-campaign-senders: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
