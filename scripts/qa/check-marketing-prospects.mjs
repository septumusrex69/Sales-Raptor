/**
 * PROSPECT LISTS, THE ONE INTRODUCTION, DELIVERY RESULTS, TWO SENDERS AND THE WARM-UP (S10, 22 Oct).
 *
 * The firm's five decisions on News & campaigns, held here:
 *   1. an uploaded list becomes LEADS ("Imported list"), de-duplicated against leads, clients and
 *      itself, with the counts shown before anything is written;
 *   2. "everyone gets one introduction email to opt in, 'Yes, keep me informed' button" -- and an
 *      imported lead who did not press it is NEVER sent marketing again, refused at the queue AND at
 *      the send;
 *   3. delivered / didn't arrive / opened / clicked / unsubscribed / spam / opted in, per send,
 *      idempotent on the webhook delivery's id;
 *   4. news from MARKETING_FROM, prospect mail personally from the marketer on
 *      MARKETING_PROSPECT_DOMAIN -- and NO bulk From, of either kind, on the firm's own mail domain;
 *   5. a per-sender daily warm-up allowance for prospect mail, enforced by the drain.
 * Resend is never reached: every call is a stub.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-marketing-prospects.mjs
 */
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'

process.env.EMAIL_CREDENTIALS_KEY = crypto.randomBytes(32).toString('base64')
process.env.RESEND_API_KEY = 're_test_not_a_real_key'
process.env.MARKETING_FROM = 'Bredell Ferreira <news@news-domain.example>'
process.env.MARKETING_PROSPECT_DOMAIN = 'prospect-domain.example'
delete process.env.MARKETING_WARMUP_CEILING
delete process.env.VERCEL_ENV; delete process.env.VERCEL_URL; delete process.env.VERCEL_BRANCH_URL

const M = await import('../../src/lib/marketing.ts')
const P = await import('../../src/lib/prospectImport.ts')
const S = await import('../../api/_lib/marketing.ts')
const W = await import('../../api/_lib/email/resendWebhook.ts')
const { CHARTER_EMAIL_STACK } = await import('../../src/lib/charter.ts')

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

/* ------------------------------------------------------------------------------------------------
 * 1. Imported lists
 * ---------------------------------------------------------------------------------------------- */

{
  const sheet = P.readProspectSheet([
    ['Full Name', 'E-mail Address', 'Company Name', 'Cell', 'Industry', 'Met at'],
    ['Thandi Mokoena Dlamini', 'Thandi@Example.test ', 'Acme', '082 000 0000', 'Retail', 'Expo 2026'],
    ['', '', '', '', '', ''],
    ['Pieter', 'pieter@example.test', '', '', '', ''],
  ])
  check('headings are read by name, not position', sheet.columns.map((c) => c.as), ['name', 'email', 'company', 'phone', 'note', 'note'])
  check('a full name is split into first and last', [sheet.rows[0].firstName, sheet.rows[0].lastName], ['Thandi', 'Mokoena Dlamini'])
  check('every other column is kept as a note', sheet.rows[0].note, 'Industry: Retail\nMet at: Expo 2026')
  check('an empty row is skipped and the file row numbers kept', sheet.rows.map((r) => r.line), [2, 4])
  ok('a file with no email column is refused in words', /No email column/.test(P.readProspectSheet([['Name', 'Phone'], ['a', 'b']]).problem ?? ''))
  check('first name / surname columns are read too',
    P.readProspectSheet([['First name', 'Surname', 'Email'], ['A', 'B', 'a@b.co']]).rows.map((r) => [r.firstName, r.lastName]), [['A', 'B']])
}
{
  const row = (email, line) => ({ firstName: 'X', lastName: '', email, company: '', phone: '', note: '', line })
  const plan = P.planProspectImport([
    row('new@one.test', 2), row('NEW@one.test', 3), row('not an address', 4), row('', 5),
    row('client@co.test', 6), row('lead@co.test', 7), row('both@co.test', 8), row('two@one.test', 9),
  ], { leadEmails: new Set(['lead@co.test', 'both@co.test']), clientEmails: new Set(['client@co.test', 'both@co.test']) })
  check('the counts: new / already a lead / already a client / bad email / duplicate in file',
    plan.counts, { new: 2, 'already a lead': 1, 'already a client': 2, 'bad email': 2, 'duplicate in file': 1 })
  check('...only the new are written, normalised', plan.fresh.map((r) => r.email), ['new@one.test', 'two@one.test'])
  check('...an address that is a client\'s and a lead\'s is counted as the client\'s', plan.examples['already a client'], ['client@co.test', 'both@co.test'])
  const lead = P.prospectLeadRow(plan.fresh[0], { ownerId: 'u1', listId: 'L1', listName: 'Expo', fileName: 'expo.csv' })
  check('an imported row is a lead with source "Imported list", on the importer\'s desk, on its list',
    [lead.source, lead.status, lead.owner_id, lead.marketing_list_id], ['Imported list', 'No Contact Yet', 'u1', 'L1'])
  ok('...and its note says where it came from', /Imported from the list “Expo” \(expo\.csv\)/.test(lead.notes))
  const keys = (r) => Object.keys(r).sort().join(',')
  check('every lead row carries exactly the same keys (a bulk insert fills a missing key with NULL)',
    keys(P.prospectLeadRow({ ...plan.fresh[0], company: 'Acme', phone: '1', note: 'n' }, { ownerId: 'u', listId: 'l', listName: 'n', fileName: null })), keys(lead))
}
ok('"Imported list" is a lead source', /\| 'Imported list'/.test(read('src/types.ts')) && /'Imported list'/.test(read('src/data/mockData.ts')))
{
  const lists = code('api/_lib/marketingLists.ts')
  ok('the server plans the write itself, against every lead, company and contact', /planProspectImport\(rows, await knownAddresses\(admin\)\)/.test(lists)
    && /from\('leads'\)/.test(lists) && /from\('companies'\)/.test(lists) && /from\('contacts'\)/.test(lists))
  ok('...a contact on a company is a client, a contact on a lead is a lead', /if \(c\.company_id\) clientEmails\.add\(e\)\s*else leadEmails\.add\(e\)/.test(lists))
  ok('...a failed chunk takes the list and its leads out again',
    /\.delete\(\)\.eq\('marketing_list_id', listId\)[\s\S]{0,120}\.delete\(\)\.eq\('id', listId\)/.test(lists))
  ok('...who, when and which file are kept, the file itself never', /file_name: meta\.fileName/.test(lists) && /uploaded_by: meta\.callerId/.test(lists))
  const mk = code('api/_lib/email/marketing.ts')
  ok('the import is behind marketing.send (the same gate as sending)',
    mk.indexOf("'marketing.send'") > 0 && mk.indexOf("'marketing.send'") < mk.indexOf("body.step === 'import-preview'"))
}

/* ------------------------------------------------------------------------------------------------
 * 2. The introduction, and never again without a yes
 * ---------------------------------------------------------------------------------------------- */

const NOW = '2026-10-22T08:00:00Z'
const base = {
  firstApproach: false,
  companies: [{ id: 'c1', name: 'Client Co', email: 'client@co.test', services: [] }],
  contacts: [{ id: 'p1', firstName: 'Cee', email: 'cee@co.test', companyId: 'c1' }],
  leads: [
    { id: 'l1', firstName: 'New', companyName: '', email: 'new@one.test', status: 'No Contact Yet', source: 'Imported list', createdAt: NOW, marketingListId: 'L1' },
    { id: 'l2', firstName: 'Yes', companyName: '', email: 'yes@one.test', status: 'No Contact Yet', source: 'Imported list', createdAt: NOW, marketingListId: 'L1', marketingConsentAt: NOW },
    { id: 'l3', firstName: 'Asked', companyName: '', email: 'asked@one.test', status: 'No Contact Yet', source: 'Imported list', createdAt: NOW, marketingListId: 'L1' },
    { id: 'l4', firstName: 'Clienty', companyName: '', email: 'cee@co.test', status: 'Interested', source: 'Website', createdAt: NOW },
    { id: 'l5', firstName: 'Other', companyName: '', email: 'other@two.test', status: 'Interested', source: 'Website', createdAt: NOW, marketingListId: 'L2' },
  ],
  activities: [],
  preferences: new Map(),
  approachedLeads: new Set(['l3']),
  now: NOW,
}
const run = (over) => M.resolveAudience({ ...base, ...over })
const emails = (r) => r.recipients.map((x) => x.email)
{
  const intro = run({ audience: { kind: 'imported_list', listIds: ['L1'] }, kind: 'introduction', firstApproach: true })
  check('an introduction goes only to leads never asked and never consented', emails(intro), ['new@one.test'])
  check('...marked as the one first approach', intro.recipients.map((r) => r.firstApproach), [true])
  check('...somebody who already said yes is not asked again', intro.excluded['already said yes'], 1)
  check('...somebody already introduced is not introduced twice', intro.excluded['already approached once'], 1)
  const active = run({ audience: { kind: 'active_leads' }, kind: 'introduction', firstApproach: true })
  check('an introduction never reaches an address that is a client\'s', emails(active).includes('cee@co.test'), false)
  check('...counted as already a client', active.excluded['already a client'], 1)
  check('...and a client audience is refused outright for a prospect kind', run({ audience: { kind: 'all_clients' }, kind: 'introduction', firstApproach: true }).recipients.length, 0)
  const pros = run({ audience: { kind: 'imported_list', listIds: ['L1'] }, kind: 'prospect' })
  check('prospect marketing goes ONLY to those who said yes', emails(pros), ['yes@one.test'])
  check('...the introduced who did not press the button are left out', pros.excluded['no consent recorded'], 2)
  const news = run({ audience: { kind: 'imported_list', listIds: ['L1'] }, kind: 'news' })
  check('news reaches an imported lead only with consent, too', emails(news), ['yes@one.test'])
  check('an imported-list audience is exactly its lists', emails(run({ audience: { kind: 'imported_list', listIds: ['L2'] }, kind: 'prospect' })), [])
  check('a stored imported-list audience reads back', M.parseAudience({ kind: 'imported_list', listIds: ['a', 3] }), { kind: 'imported_list', listIds: ['a'] })
  check('an unknown kind is read as news, the narrowest reach to strangers', M.parseKind('blast'), 'news')
}
const server = code('api/_lib/marketing.ts')
ok('the SERVER decides the first approach from the kind alone -- the introduction is the only one',
  /const firstApproach = kind === 'introduction'/.test(server) && !/campaign\.first_approach\)/.test(server))
ok('...and a prospect kind refuses a list that is not leads', /isProspectKind\(kind\) && !LEAD_AUDIENCES\.includes\(audience\.kind\)/.test(server))
ok('...the queue resolves with the campaign\'s kind', /resolveOnServer\(admin, campaign\.audience, campaign\.kind\)/.test(server))

/* At the moment of sending, the rule again. */
check('send-time: a lead row that is not the introduction needs consent on record',
  M.sendBlockReason({ leadId: 'l1', companyId: null, firstApproach: false }, { marketingConsentAt: null }), 'No consent recorded, so never sent marketing')
check('...with it, it goes', M.sendBlockReason({ leadId: 'l1', companyId: null, firstApproach: false }, { marketingConsentAt: NOW }), null)
check('...the introduction goes to the unconsented', M.sendBlockReason({ leadId: 'l1', companyId: null, firstApproach: true }, { marketingConsentAt: null }), null)
check('...but not to somebody who said yes meanwhile', M.sendBlockReason({ leadId: 'l1', companyId: null, firstApproach: true }, { marketingConsentAt: NOW }), 'Already said yes, so not asked again')
check('...a lead that is gone is not written to', M.sendBlockReason({ leadId: 'l1', companyId: null, firstApproach: false }, null), 'The lead is gone')
check('...a client row is the unsubscribe check\'s business', M.sendBlockReason({ leadId: null, companyId: 'c1', firstApproach: false }, null), null)

/* ------------------------------------------------------------------------------------------------
 * 3. The opt-in link and the email that carries it
 * ---------------------------------------------------------------------------------------------- */

const SEND = '3f1c2a9e-1111-4222-8333-444455556666'
{
  const t = S.optInToken(SEND)
  check('the opt-in token names the send', S.readOptInToken(t), SEND)
  check('a tampered one is refused', S.readOptInToken(t.slice(0, -1) + (t.endsWith('0') ? '1' : '0')), null)
  check('an unsubscribe token is not an opt-in token', S.readOptInToken(S.unsubscribeToken('a@b.co')), null)
  check('an opt-in token is not an unsubscribe token', S.readUnsubscribeToken(t), null)
  check('nonsense is refused', S.readOptInToken('x.y'), null)
}
{
  const face = { emailFont: CHARTER_EMAIL_STACK, emailSizePt: 11 }
  const e = M.renderCampaignEmail({ subject: 'Hello', preheader: '', body: 'Dear {{first_name}},\n\nMay we?' }, { firstName: 'Ann' },
    { unsubscribeUrl: 'https://r.test/unsubscribe/U', firmName: 'Bredell Ferreira', face, basis: 'introduction', optInUrl: 'https://r.test/opt-in/T' })
  ok('the introduction carries the "Yes, keep me informed" button, linked', /<a href="https:\/\/r\.test\/opt-in\/T"[^>]*>Yes, keep me informed<\/a>/.test(e.html))
  ok('...as a table cell, so Outlook draws it as a button', /<td style="background:#1e3a5f/.test(e.html))
  ok('...and in the text twin', e.text.includes('Yes, keep me informed: https://r.test/opt-in/T'))
  ok('...says it is the only marketing email without a yes', /this is the only marketing email we will send you/.test(e.html))
  ok('...and still carries the unsubscribe link', e.html.includes('href="https://r.test/unsubscribe/U"'))
  ok('news carries no opt-in button', !M.renderCampaignEmail({ subject: 'a', preheader: '', body: 'b' }, {},
    { unsubscribeUrl: 'u', firmName: 'f', face, basis: 'client' }).html.includes('keep me informed'))
}
{
  const optIn = code('api/_lib/email/optIn.ts')
  ok('the opt-in action needs no session, only the signed token', !/requireCaller/.test(optIn) && /readOptInToken\(/.test(optIn))
  ok('...a GET never acts (link scanners fetch everything)', /req\.method === 'GET'[\s\S]{0,200}status\(303\)/.test(optIn))
  ok('...records consent on the lead, keeping the first yes\'s date', /marketing_consent_at: now[\s\S]{0,300}\.is\('marketing_consent_at', null\)/.test(optIn))
  ok('...and on the address, as the opt-in link', /how: 'opt-in link'/.test(optIn))
  ok('...and on the send, for the campaign\'s "opted in"', /opted_in_at: now/.test(optIn))
  ok('..."that wasn\'t me" undoes it and unsubscribes', /step === 'withdraw'[\s\S]{0,500}unsubscribe\(admin/.test(optIn))
  const dispatcher = code('api/email/[action].ts')
  ok('it is an action on the email dispatcher, not a new function', /'opt-in': optIn/.test(dispatcher))
  const app = code('src/App.tsx')
  ok('the thank-you page is outside the sign-in', app.indexOf('path="/opt-in/:token"') > 0 && app.indexOf('path="/opt-in/:token"') < app.indexOf('<RequireAuth>'))
  ok('...and says thank you', /Thank you — you’ll hear from us/.test(read('src/pages/news/OptInPage.tsx')))
}

/* ------------------------------------------------------------------------------------------------
 * 4. Two senders, and never the firm's own mail domain
 * ---------------------------------------------------------------------------------------------- */

check('the firm\'s main mail domain', M.FIRM_MAIN_MAIL_DOMAIN, 'bredellferreira.co.za')
ok('NEWS may not go from the firm\'s own mail domain', 'error' in M.newsSender('Bredell Ferreira <news@bredellferreira.co.za>', null))
ok('...nor a subdomain of it', 'error' in M.newsSender('news@news.bredellferreira.co.za', null))
check('...a separate news domain is fine', M.newsSender('Bredell Ferreira <news@news-domain.example>', 'info@x.test'),
  { from: 'Bredell Ferreira <news@news-domain.example>', replyTo: 'info@x.test' })
ok('...a similar-looking but separate domain is not the main domain', !M.isFirmMainDomain('a@bredell-ferreira.co.za') && !M.isFirmMainDomain('a@xbredellferreira.co.za'))
const reino = { name: 'Reino Smit', email: 'Reino@bredellferreira.co.za' }
check('PROSPECT mail goes from the marketer, by name, on the prospect domain, replies to their own inbox',
  M.prospectSender('prospect-domain.example', reino), { from: '"Reino Smit" <reino@prospect-domain.example>', replyTo: 'reino@bredellferreira.co.za' })
ok('...never from the firm\'s own domain', 'error' in M.prospectSender('bredellferreira.co.za', reino))
ok('...nor a subdomain of it', 'error' in M.prospectSender('mail.bredellferreira.co.za', reino))
ok('...without the setting it cannot go, and says which setting', /MARKETING_PROSPECT_DOMAIN is not set/.test(M.prospectSender('', reino).error ?? ''))
ok('...a marketer with no address cannot be the sender', /no email address/.test(M.prospectSender('p.example', { name: 'X', email: null }).error ?? ''))
check('...a quote in a name cannot break the header', M.prospectSender('p.example', { name: 'A "B" <c>', email: 'a@x.test' }).from, '"A B c" <a@p.example>')
ok('the prospect domain is never written into the code', !/prospect-domain|bredell-ferreira/.test(code('src/lib/marketing.ts') + server))
{
  const cfg = await S.senderConfig({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) })
  check('both senders ready when both are set', [cfg.ready, cfg.prospect.ready], [true, true])
  const keep = process.env.MARKETING_PROSPECT_DOMAIN
  delete process.env.MARKETING_PROSPECT_DOMAIN
  const half = await S.senderConfig({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) })
  check('without the prospect domain, news still goes and prospects say what is missing', [half.ready, half.prospect.ready, half.prospect.missing], [true, false, ['MARKETING_PROSPECT_DOMAIN']])
  ok('...in words for the screen', /MARKETING_PROSPECT_DOMAIN must be set/.test(S.kindNotReady(half, 'introduction') ?? ''))
  check('...a news campaign is not held up by it', S.kindNotReady(half, 'news'), null)
  process.env.MARKETING_PROSPECT_DOMAIN = keep
  const keepFrom = process.env.MARKETING_FROM
  process.env.MARKETING_FROM = 'news@bredellferreira.co.za'
  const main = await S.senderConfig({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) })
  ok('MARKETING_FROM on the main domain makes news NOT ready, and says why', !main.ready && /firm’s own mail domain/.test(main.problem ?? ''))
  process.env.MARKETING_FROM = keepFrom
}
ok('the setup steps\' example From is never on the main domain',
  [...M.SENDER_SETUP_STEPS, ...M.PROSPECT_SETUP_STEPS].every((s) => !/<?[a-z]+@bredellferreira\.co\.za>/.test(s.replace(/reino@bredellferreira\.co\.za/g, ''))))

/* ------------------------------------------------------------------------------------------------
 * 5. Warm-up
 * ---------------------------------------------------------------------------------------------- */

const day = (n) => new Date(Date.parse(NOW) + n * 86_400_000).toISOString()
check('a sender that has never sent starts at 30 a day', M.warmupDailyCap(null, NOW), 30)
check('week by week: 30, 60, 120, 250, then the ceiling', [0, 7, 14, 21, 28, 90].map((d) => M.warmupDailyCap(NOW, day(d))), [30, 60, 120, 250, 500, 500])
check('day 6 is still week 1', M.warmupDailyCap(NOW, day(6.9)), 30)
check('the ceiling is the firm\'s', M.warmupDailyCap(NOW, day(40), 1000), 1000)
check('...and a ceiling lower than the schedule wins', M.warmupDailyCap(NOW, day(21), 100), 100)
check('...nonsense is the default', M.warmupDailyCap(NOW, day(40), Number.NaN), 500)

/* ------------------------------------------------------------------------------------------------
 * The drain, stubbed: a prospect introduction under the warm-up
 * ---------------------------------------------------------------------------------------------- */

function fakeAdmin(db) {
  const log = { records: [], claims: [], activities: [] }
  const builder = (table) => {
    const q = { filters: [] }
    const b = {
      select: () => b, neq: () => b, not: () => b, order: () => b, is: () => b, limit: () => b,
      eq: (c, v) => { q.filters.push(['eq', c, v]); return b },
      in: (c, v) => { q.filters.push(['in', c, v]); return b },
      insert: (rows) => { if (table === 'activities') log.activities.push(...rows); return Promise.resolve({ error: null }) },
      update: () => b, upsert: () => Promise.resolve({ error: null }),
      maybeSingle: () => Promise.resolve({ data: table === 'profiles' ? db.marketer : table === 'firm_settings' ? { firm_name: 'Bredell Ferreira' } : null }),
      then: (res) => {
        const inList = q.filters.find((f) => f[0] === 'in')?.[2] ?? []
        if (table === 'marketing_campaigns') return res({ data: [db.campaign] })
        if (table === 'marketing_preferences') return res({ data: [] })
        if (table === 'leads') return res({ data: db.leads.filter((l) => inList.includes(l.id)) })
        if (table === 'marketing_sends') return res({ count: db.queue.length })
        return res({ data: [] })
      },
    }
    return b
  }
  return {
    log, from: builder,
    rpc: async (name, args) => {
      if (name === 'marketing_sender_today') return { data: [{ used: db.used, first_sent_at: db.firstSentAt }], error: null }
      if (name === 'marketing_claim_prospect') {
        log.claims.push(args)
        const take = Math.max(0, Math.min(args.p_limit, args.p_cap - db.used))
        const chunk = db.queue.splice(0, take)
        db.used += chunk.length
        return { data: chunk, error: null }
      }
      if (name === 'marketing_claim_sends') { log.claims.push({ news: true }); return { data: [], error: null } }
      if (name === 'marketing_record_results') { log.records.push(...args.p_results); return { data: 1, error: null } }
      return { data: null, error: null }
    },
  }
}
const intro = { id: 'c', name: 'Intro', subject: 'May we keep in touch?', preheader: '', body: 'Dear {{first_name}}', image_url: null,
  audience: { kind: 'imported_list', listIds: ['L1'] }, first_approach: true, kind: 'introduction', sender_id: 'm1', status: 'sending', created_by: 'm1', queued_by: 'm1' }
const sendRow = (i, extra = {}) => ({ id: `3f1c2a9e-1111-4222-8333-${String(i).padStart(12, '0')}`, campaign_id: 'c', email: `p${i}@one.test`,
  first_name: 'P', company_name: null, company_id: null, contact_id: null, lead_id: `l${i}`, first_approach: true, attempts: 1, ...extra })
{
  const queue = Array.from({ length: 45 }, (_, i) => sendRow(i + 1))
  const db = { campaign: intro, marketer: { id: 'm1', name: 'Reino Smit', email: 'reino@bredellferreira.co.za' }, queue, used: 0, firstSentAt: null,
    leads: queue.map((r) => ({ id: r.lead_id, marketing_consent_at: r.lead_id === 'l2' ? NOW : null })) }
  const admin = fakeAdmin(db)
  const sent = []
  const report = await S.drainMarketing(admin, { budgetMs: 8000, host: 'raptor.test', fetchImpl: async (url, init) => {
    const list = JSON.parse(init.body); const arr = Array.isArray(list) ? list : [list]; sent.push(...arr)
    return { ok: true, status: 200, json: async () => (Array.isArray(list) ? { data: arr.map((_, i) => ({ id: `re_${i}` })) } : { id: 're_0' }) }
  } })
  check('week 1: the drain claims no more than 30 for a new sender', admin.log.claims.map((c) => [c.p_sender, c.p_cap]), [['reino@prospect-domain.example', 30]])
  check('...the rest wait for tomorrow', report.waitingForTomorrow, 15)
  ok('...and the screen is told so', /15 waiting for tomorrow’s allowance/.test(report.stoppedFor ?? ''))
  check('...with the sender\'s day', report.allowance, { sender: 'reino@prospect-domain.example', week: 1, cap: 30, used: 30 })
  check('every prospect email goes from the marketer, replies to their inbox', [...new Set(sent.map((m) => `${m.from} -> ${m.reply_to}`))],
    ['"Reino Smit" <reino@prospect-domain.example> -> reino@bredellferreira.co.za'])
  ok('NO bulk email the drain wrote is From the firm\'s own mail domain', sent.length > 0 && sent.every((m) => !M.isFirmMainDomain(m.from)))
  check('a lead who said yes in the meantime is not introduced', admin.log.records.find((r) => r.id.endsWith('000000000002'))?.state, 'skipped')
  const link = /href="(https:\/\/raptor\.test\/opt-in\/[^"]+)"/.exec(sent[0].html)?.[1] ?? ''
  check('each introduction\'s button is signed for its own send', S.readOptInToken(link.split('/opt-in/')[1]), sendRow(1).id)
}
{
  /* Already at today's allowance: nothing is claimed at all, and nothing is lost. */
  const db = { campaign: intro, marketer: { id: 'm1', name: 'Reino', email: 'reino@bredellferreira.co.za' }, queue: [sendRow(1)], used: 60,
    firstSentAt: day(-8), leads: [{ id: 'l1', marketing_consent_at: null }] }
  const admin = fakeAdmin(db)
  let called = false
  const report = await S.drainMarketing(admin, { budgetMs: 3000, host: 'raptor.test', fetchImpl: async () => { called = true; return { ok: true, status: 200, json: async () => ({}) } } })
  check('week 2 at 60 used: nothing is claimed or sent', [admin.log.claims.length, called], [0, false])
  check('...and the row waits', report.waitingForTomorrow, 1)
}
{
  /* A prospect campaign (not the introduction): an imported lead with no yes is never sent it. */
  const db = { campaign: { ...intro, kind: 'prospect', first_approach: false }, marketer: { id: 'm1', name: 'Reino', email: 'reino@bredellferreira.co.za' },
    queue: [sendRow(1, { first_approach: false }), sendRow(2, { first_approach: false })], used: 0, firstSentAt: null,
    leads: [{ id: 'l1', marketing_consent_at: null }, { id: 'l2', marketing_consent_at: NOW }] }
  const admin = fakeAdmin(db)
  const sent = []
  await S.drainMarketing(admin, { budgetMs: 3000, host: 'raptor.test', fetchImpl: async (url, init) => {
    const list = JSON.parse(init.body); const arr = Array.isArray(list) ? list : [list]; sent.push(...arr)
    return { ok: true, status: 200, json: async () => ({ id: 're_1' }) }
  } })
  check('at the moment of sending: an imported lead who did not press the button is never sent marketing', sent.map((m) => m.to[0]), ['p2@one.test'])
  check('...the other is skipped, saying why', admin.log.records.find((r) => r.id.endsWith('000000000001'))?.error, 'No consent recorded, so never sent marketing')
  ok('...and no opt-in button on anything but the introduction', !sent[0].html.includes('keep me informed'))
}
{
  /* No prospect domain: a prospect campaign does not go, a news one is not held up. */
  const keep = process.env.MARKETING_PROSPECT_DOMAIN
  delete process.env.MARKETING_PROSPECT_DOMAIN
  const admin = fakeAdmin({ campaign: intro, marketer: { id: 'm1', name: 'R', email: 'r@x.test' }, queue: [sendRow(1)], used: 0, firstSentAt: null, leads: [] })
  const report = await S.drainMarketing(admin, { budgetMs: 2000, host: 'raptor.test', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) })
  check('without MARKETING_PROSPECT_DOMAIN nothing is claimed for a prospect campaign', admin.log.claims.length, 0)
  ok('...and it says which setting', /MARKETING_PROSPECT_DOMAIN/.test(report.stoppedFor ?? ''))
  process.env.MARKETING_PROSPECT_DOMAIN = keep
}
{
  const sql = read('supabase/schema.sql')
  const tail = sql.slice(sql.lastIndexOf('-- S10 / PROSPECT LISTS, THE INTRODUCTION'))
  ok('the warm-up is counted in the database under a lock on the sender',
    /pg_advisory_xact_lock\(hashtext\('marketing-sender:' \|\| p_sender\)\)/.test(tail) && /greatest\(coalesce\(p_cap, 0\) - coalesce\(v_used, 0\), 0\)/.test(tail))
  ok('...on Johannesburg\'s real day', /at time zone 'Africa\/Johannesburg'\)::date\s*= \(now\(\) at time zone 'Africa\/Johannesburg'\)::date/.test(tail))
  ok('...and the claim functions are the server\'s alone',
    tail.includes('revoke all on function public.marketing_claim_prospect(uuid, text, integer, integer) from public, anon, authenticated;')
    && tail.includes('revoke all on function public.marketing_sender_today(text) from public, anon, authenticated;'))
}
ok('news is not held to the warm-up: only prospect kinds claim against an allowance',
  /if \(isProspectKind\(campaign\.kind\)\) \{[\s\S]{0,400}warmupDailyCap/.test(server))

/* ------------------------------------------------------------------------------------------------
 * 3 again. Delivery results
 * ---------------------------------------------------------------------------------------------- */

{
  for (const type of ['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.opened', 'email.clicked']) {
    check(`${type} is recorded on its send`, W.deliveryEvent({ type, created_at: NOW, data: { email_id: 're_1' } }, 'msg_1')?.type, type)
  }
  check('anything else is ignored', W.deliveryEvent({ type: 'contact.created', data: { email_id: 're_1' } }, 'msg_1'), null)
  check('an event with no email is ignored', W.deliveryEvent({ type: 'email.opened', data: {} }, 'msg_1'), null)
  check('a retry of one delivery has one key: the svix-id', W.deliveryEvent({ type: 'email.opened', data: { email_id: 're_1' } }, ' msg_9 ').eventId, 'msg_9')
  check('a click on the unsubscribe link is not counted as a click',
    W.deliveryEvent({ type: 'email.clicked', data: { email_id: 're_1', click: { link: 'https://r.test/unsubscribe/abc' } } }, 'm').countClick, false)
  check('...a click on anything else is', W.deliveryEvent({ type: 'email.clicked', data: { email_id: 're_1', click: { link: 'https://bf.test/blog' } } }, 'm').countClick, true)
  const hook = code('api/_lib/email/resendWebhook.ts')
  ok('the webhook records every delivery through one idempotent function', /rpc\('marketing_record_event'/.test(hook))
  ok('...and a repeated delivery changes nothing more', /r\.status === 'duplicate'\) \{ res\.status\(200\)/.test(hook)
    && hook.indexOf("r.status === 'duplicate'") < hook.indexOf('bounceOutcome(event)\n'))
  ok('...a failure is a 500, so Resend tries again', /if \(error\) \{ res\.status\(500\)/.test(hook))
  const sql = read('supabase/schema.sql')
  const tail = sql.slice(sql.lastIndexOf('-- S10 / PROSPECT LISTS, THE INTRODUCTION'))
  ok('one row per delivery, keyed on its id', /create table if not exists public\.marketing_send_events \(\s*event_id text primary key/.test(tail))
  ok('...inserted first; a conflict returns before anything is counted',
    /on conflict \(event_id\) do nothing;\s*if not found then\s*return jsonb_build_object\('status', 'duplicate'\)/.test(tail))
  ok('an open or a click also means it arrived', /when p_type in \('email\.delivered', 'email\.opened', 'email\.clicked'\)/.test(tail))
  for (const c of ['delivered_at', 'first_opened_at', 'open_count', 'first_clicked_at', 'click_count', 'bounced_at', 'complained_at', 'unsubscribed_at', 'opted_in_at']) {
    ok(`marketing_sends.${c}`, new RegExp(`add column if not exists ${c} `).test(tail))
  }
  ok('the results count delivered without what later bounced', /filter \(where s\.delivered_at is not null and s\.state <> 'bounced'\)/.test(tail))
  ok('the events and the lists have row-level security and no write policy',
    tail.includes('alter table public.marketing_send_events enable row level security;') && tail.includes('alter table public.marketing_lists enable row level security;')
    && !/on public\.(marketing_send_events|marketing_lists) for (insert|update|delete)/.test(tail))
  ok('"opt-in link" is a way a preference is recorded', /'re-subscribed from the link', 'opt-in link'/.test(tail))
  const clear = sql.slice(sql.lastIndexOf('create or replace function public.clear_staging('))
  ok('Clear staging empties the events with the sends, and the lists with the leads',
    /public\.marketing_send_events, public\.marketing_sends/.test(clear) && /'de' \|\| 'lete from public\.marketing_lists'/.test(clear))
  const unsub = code('api/_lib/email/unsubscribe.ts')
  ok('an unsubscribe is put against the last campaign that reached the address', /order\('sent_at', \{ ascending: false \}\)\.limit\(1\)/.test(unsub) && /unsubscribed_at:/.test(unsub))
}
{
  const r = M.resultRates({ accepted: 200, delivered: 190, bounced: 10, opened: 95, clicked: 19, unsubscribed: 2, complained: 1, opted_in: 38 })
  check('delivery and bounces are out of what was sent', [r.delivered, r.bounced], [95, 5])
  check('opens, clicks, unsubscribes, spam and opt-ins are out of what was delivered', [r.opened, r.clicked, r.unsubscribed, r.complained, r.optedIn], [50, 10, 1.1, 0.5, 20])
  check('nothing to divide by is no rate, not 0%', M.resultRates({ accepted: 0, delivered: 0, bounced: 0, opened: 0, clicked: 0, unsubscribed: 0, complained: 0, opted_in: 0 }).opened, null)
  ok('the screen says opens are approximate, and why', /Apple Mail/.test(M.OPENS_ARE_APPROXIMATE) && /pictures/.test(M.OPENS_ARE_APPROXIMATE))
  const page = code('src/pages/news/NewsPage.tsx')
  ok('...beside the figures', /data-testid="news-opens-note">\{OPENS_ARE_APPROXIMATE\}/.test(page))
  ok('an introduction\'s results include who opted in', /kind === 'introduction' \? \[\{ label: 'Opted in'/.test(page))
  ok('the introduction\'s preview says the rest will never be sent marketing again', /never be sent another marketing email/.test(page))
  const webhookStep = M.SENDER_SETUP_STEPS.find((s) => /webhook/.test(s)) ?? ''
  ok('the webhook step lists delivered, opened and clicked as well',
    ['email.delivered', 'email.opened', 'email.clicked', 'email.bounced', 'email.complained'].every((e) => webhookStep.includes(e)))
  ok('...and the firm is told to switch on open and click tracking', M.SENDER_SETUP_STEPS.some((s) => /open tracking and click tracking/.test(s))
    && M.PROSPECT_SETUP_STEPS.some((s) => /open tracking and click tracking/.test(s)))
  ok('the prospect steps name the setting and the warm-up', M.PROSPECT_SETUP_STEPS.some((s) => s.includes('MARKETING_PROSPECT_DOMAIN'))
    && M.PROSPECT_SETUP_STEPS.some((s) => /30 a day in the first week/.test(s)))
}

console.log(`\ncheck-marketing-prospects: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
